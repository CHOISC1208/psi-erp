"""API endpoints exposing manual PSI edits."""
from __future__ import annotations

import csv
from datetime import date
from io import StringIO
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DBSession, aliased, contains_eager, selectinload
from sqlalchemy.sql import Select

from .. import models, schemas
from ..config import settings
from ..deps import get_current_user, get_db

router = APIRouter()


def _with_audit_options(
    query: Select, *, join_users: bool
) -> tuple[Select, Any, Any]:
    """Apply eager loading for audit user relationships when required."""

    creator_alias = None
    updater_alias = None

    if join_users:
        creator_alias = aliased(models.User)
        updater_alias = aliased(models.User)
        query = query.outerjoin(
            creator_alias, models.PSIEdit.created_by == creator_alias.id
        )
        query = query.outerjoin(
            updater_alias, models.PSIEdit.updated_by == updater_alias.id
        )
        query = query.options(
            contains_eager(models.PSIEdit.created_by_user, alias=creator_alias),
            contains_eager(models.PSIEdit.updated_by_user, alias=updater_alias),
        )
    else:
        query = query.options(
            selectinload(models.PSIEdit.created_by_user),
            selectinload(models.PSIEdit.updated_by_user),
        )

    return query, creator_alias, updater_alias


def _serialize_edit(edit: models.PSIEdit) -> schemas.PSIEditRead:
    """Convert a PSI edit model into the API schema respecting feature flags."""

    data = schemas.PSIEditRead.model_validate(edit, from_attributes=True)
    data.created_by_username = (
        edit.created_by_user.username if edit.created_by_user else None
    )
    data.updated_by_username = (
        edit.updated_by_user.username if edit.updated_by_user else None
    )
    if not settings.audit_metadata_enabled:
        data.created_by = None
        data.updated_by = None
    return data


def _apply_username_search(
    query: Select,
    *,
    username: str | None,
    creator_alias: Any,
    updater_alias: Any,
) -> Select:
    """Filter PSI edits by matching creator or updater usernames."""

    if not username:
        return query

    if creator_alias is None or updater_alias is None:
        raise RuntimeError("username filtering requires joined user aliases")

    lowered = f"%{username.lower()}%"
    return query.where(
        or_(
            func.lower(creator_alias.username).like(lowered),
            func.lower(updater_alias.username).like(lowered),
        )
    )


@router.get(
    "",
    response_model=list[schemas.PSIEditRead],
    response_model_exclude_none=True,
)
@router.get(
    "/",
    response_model=list[schemas.PSIEditRead],
    response_model_exclude_none=True,
)
def list_psi_edits(
    *,
    session_id: UUID | None = None,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    updated_at: date | None = Query(None),
    username: str | None = None,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[schemas.PSIEditRead]:
    """Return PSI edit records matching the provided filters."""

    _ = current_user

    query = select(models.PSIEdit)
    join_users = settings.audit_metadata_enabled or bool(username)
    query, creator_alias, updater_alias = _with_audit_options(
        query, join_users=join_users
    )

    if session_id is not None:
        query = query.where(models.PSIEdit.session_id == session_id)
    if sku_code:
        lowered = f"%{sku_code.lower()}%"
        query = query.where(func.lower(models.PSIEdit.sku_code).like(lowered))
    if warehouse_name:
        lowered = f"%{warehouse_name.lower()}%"
        query = query.where(
            func.lower(models.PSIEdit.warehouse_name).like(lowered)
        )
    if updated_at is not None:
        query = query.where(func.date(models.PSIEdit.updated_at) == updated_at)

    query = _apply_username_search(
        query,
        username=username,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )

    query = query.order_by(
        models.PSIEdit.date.asc(),
        models.PSIEdit.sku_code.asc(),
        models.PSIEdit.warehouse_name.asc(),
        models.PSIEdit.channel.asc(),
    )

    edits = db.scalars(query).unique().all()
    return [_serialize_edit(edit) for edit in edits]


@router.get("/{session_id}/export")
def export_psi_edits(
    *,
    session_id: UUID,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    updated_at: date | None = Query(None),
    username: str | None = None,
    include_audit: bool = Query(False),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream PSI edits as a CSV download respecting provided filters."""

    _ = current_user

    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    query = select(models.PSIEdit).where(models.PSIEdit.session_id == session_id)
    join_users = settings.audit_metadata_enabled or include_audit or bool(username)
    query, creator_alias, updater_alias = _with_audit_options(
        query, join_users=join_users
    )

    if sku_code:
        lowered = f"%{sku_code.lower()}%"
        query = query.where(func.lower(models.PSIEdit.sku_code).like(lowered))
    if warehouse_name:
        lowered = f"%{warehouse_name.lower()}%"
        query = query.where(
            func.lower(models.PSIEdit.warehouse_name).like(lowered)
        )
    if updated_at is not None:
        query = query.where(func.date(models.PSIEdit.updated_at) == updated_at)

    query = _apply_username_search(
        query,
        username=username,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )

    query = query.order_by(
        models.PSIEdit.date.asc(),
        models.PSIEdit.sku_code.asc(),
        models.PSIEdit.warehouse_name.asc(),
        models.PSIEdit.channel.asc(),
    )

    edits = db.scalars(query).unique().all()
    include_audit_columns = include_audit and settings.audit_metadata_enabled

    def iter_rows():
        buffer = StringIO()
        writer = csv.writer(buffer)

        header = [
            "session_title",
            "date",
            "sku_code",
            "warehouse_name",
            "channel",
            "inbound_qty",
            "outbound_qty",
            "safety_stock",
        ]
        if include_audit_columns:
            header.extend(
                [
                    "created_by",
                    "created_by_username",
                    "created_at",
                    "updated_by",
                    "updated_by_username",
                    "updated_at",
                ]
            )

        writer.writerow(header)
        yield buffer.getvalue().encode("utf-8")
        buffer.seek(0)
        buffer.truncate(0)

        for edit in edits:
            data = _serialize_edit(edit)
            row = [
                session.title,
                edit.date.isoformat(),
                edit.sku_code,
                edit.warehouse_name,
                edit.channel,
                str(edit.inbound_qty) if edit.inbound_qty is not None else "",
                str(edit.outbound_qty) if edit.outbound_qty is not None else "",
                str(edit.safety_stock) if edit.safety_stock is not None else "",
            ]
            if include_audit_columns:
                row.extend(
                    [
                        str(data.created_by) if data.created_by else "",
                        data.created_by_username or "",
                        data.created_at.isoformat(),
                        str(data.updated_by) if data.updated_by else "",
                        data.updated_by_username or "",
                        data.updated_at.isoformat(),
                    ]
                )

            writer.writerow(row)
            yield buffer.getvalue().encode("utf-8")
            buffer.seek(0)
            buffer.truncate(0)

    filename = f"psi-edits-{session_id}.csv"
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}

    return StreamingResponse(
        iter_rows(),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )
