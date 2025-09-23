"""Channel transfer API routes."""
from __future__ import annotations

import csv
from datetime import date
from io import StringIO
from uuid import UUID

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession, aliased, contains_eager, selectinload
from sqlalchemy.sql import Select

from .. import models, schemas
from ..config import settings
from ..deps import get_current_user, get_db

router = APIRouter()

def _ensure_channel_transfer_table(db: DBSession) -> None:
    """Guarantee the channel transfers table exists before querying."""

    bind = db.get_bind()
    if bind is not None:
        models.ensure_channel_transfers_table(bind)


def _with_audit_options(
    query: Select, *, join_users: bool
) -> tuple[Select, Any, Any]:
    """Apply eager loading for audit relationships when required."""

    creator_alias: Any = None
    updater_alias: Any = None

    if join_users:
        creator_alias = aliased(models.User)
        updater_alias = aliased(models.User)
        query = query.outerjoin(
            creator_alias, models.ChannelTransfer.created_by == creator_alias.id
        )
        query = query.outerjoin(
            updater_alias, models.ChannelTransfer.updated_by == updater_alias.id
        )
        query = query.options(
            contains_eager(
                models.ChannelTransfer.created_by_user, alias=creator_alias
            ),
            contains_eager(
                models.ChannelTransfer.updated_by_user, alias=updater_alias
            ),
        )
    else:
        query = query.options(
            selectinload(models.ChannelTransfer.created_by_user),
            selectinload(models.ChannelTransfer.updated_by_user),
        )

    return query, creator_alias, updater_alias


def _refresh_audit_relationships(
    db: DBSession, transfer: models.ChannelTransfer
) -> None:
    """Refresh audit relationships when audit exposure is enabled."""

    db.refresh(transfer, attribute_names=["created_by_user", "updated_by_user"])


def _serialize_transfer(transfer: models.ChannelTransfer) -> schemas.ChannelTransferRead:
    """Convert a transfer model into the API schema respecting feature flags."""

    data = schemas.ChannelTransferRead.model_validate(transfer, from_attributes=True)
    data.created_by_username = (
        transfer.created_by_user.username if transfer.created_by_user else None
    )
    data.updated_by_username = (
        transfer.updated_by_user.username if transfer.updated_by_user else None
    )
    if not settings.audit_metadata_enabled:
        data.created_by = None
        data.updated_by = None
    return data


def _apply_transfer_filters(
    query: Select,
    *,
    sku_code: str | None,
    warehouse_name: str | None,
    channel: str | None,
    updated_at: date | None,
    start_date: date | None,
    end_date: date | None,
) -> Select:
    """Apply common filter clauses shared by listing and export endpoints."""

    if sku_code:
        lowered = sku_code.lower()
        query = query.where(
            func.lower(models.ChannelTransfer.sku_code).like(f"%{lowered}%")
        )
    if warehouse_name:
        lowered = warehouse_name.lower()
        query = query.where(
            func.lower(models.ChannelTransfer.warehouse_name).like(f"%{lowered}%")
        )
    if channel:
        lowered = channel.lower()
        query = query.where(
            or_(
                func.lower(models.ChannelTransfer.from_channel) == lowered,
                func.lower(models.ChannelTransfer.to_channel) == lowered,
            )
        )

    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    if start_date is not None:
        query = query.where(models.ChannelTransfer.transfer_date >= start_date)
    if end_date is not None:
        query = query.where(models.ChannelTransfer.transfer_date <= end_date)
    if updated_at is not None:
        query = query.where(func.date(models.ChannelTransfer.updated_at) == updated_at)

    return query


def _apply_actor_filter(
    query: Select,
    *,
    actor: str | None,
    creator_alias: Any,
    updater_alias: Any,
) -> Select:
    """Restrict results to transfers touched by the requested user."""

    if not actor:
        return query

    try:
        actor_uuid = UUID(actor)
    except ValueError:
        assert creator_alias is not None and updater_alias is not None
        lowered = actor.lower()
        return query.where(
            or_(
                func.lower(creator_alias.username) == lowered,
                func.lower(updater_alias.username) == lowered,
            )
        )

    return query.where(
        or_(
            models.ChannelTransfer.created_by == actor_uuid,
            models.ChannelTransfer.updated_by == actor_uuid,
        )
    )


def _apply_username_search(
    query: Select,
    *,
    username: str | None,
    creator_alias: Any,
    updater_alias: Any,
) -> Select:
    """Filter transfers by matching creator or updater usernames."""

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
def _get_transfer_or_404(
    db: DBSession,
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
) -> models.ChannelTransfer:
    _ensure_channel_transfer_table(db)

    transfer = db.get(
        models.ChannelTransfer,
        (session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel),
    )
    if transfer is None:
        raise HTTPException(status_code=404, detail="channel transfer not found")
    return transfer


@router.get(
    "",
    response_model=list[schemas.ChannelTransferRead],
    response_model_exclude_none=True,
)
@router.get(
    "/",
    response_model=list[schemas.ChannelTransferRead],
    response_model_exclude_none=True,
)
def list_channel_transfers(
    *,
    session_id: UUID | None = None,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    updated_at: date | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    actor: str | None = None,
    username: str | None = None,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[schemas.ChannelTransferRead]:
    """List channel transfer records matching the provided filters."""

    _ = current_user
    _ensure_channel_transfer_table(db)

    query = select(models.ChannelTransfer)
    join_users = settings.audit_metadata_enabled or actor is not None or bool(username)
    query, creator_alias, updater_alias = _with_audit_options(
        query, join_users=join_users
    )

    if session_id is not None:
        query = query.where(models.ChannelTransfer.session_id == session_id)

    query = _apply_transfer_filters(
        query,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        channel=None,
        updated_at=updated_at,
        start_date=start_date,
        end_date=end_date,
    )
    query = _apply_actor_filter(
        query,
        actor=actor,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )
    query = _apply_username_search(
        query,
        username=username,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )

    query = query.order_by(
        models.ChannelTransfer.transfer_date.asc(),
        models.ChannelTransfer.sku_code.asc(),
        models.ChannelTransfer.warehouse_name.asc(),
        models.ChannelTransfer.from_channel.asc(),
        models.ChannelTransfer.to_channel.asc(),
    )

    transfers = db.scalars(query).unique().all()
    return [_serialize_transfer(transfer) for transfer in transfers]


@router.get("/{session_id}/export")
def export_channel_transfers(
    *,
    session_id: UUID,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    channel: str | None = None,
    updated_at: date | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    actor: str | None = None,
    username: str | None = None,
    include_audit: bool = Query(False),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> StreamingResponse:
    """Export channel transfers as a CSV stream using the provided filters."""

    _ = current_user
    _ensure_channel_transfer_table(db)

    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    query = select(models.ChannelTransfer).where(
        models.ChannelTransfer.session_id == session_id
    )
    join_users = (
        settings.audit_metadata_enabled or include_audit or actor is not None or bool(username)
    )
    query, creator_alias, updater_alias = _with_audit_options(
        query, join_users=join_users
    )

    query = _apply_transfer_filters(
        query,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        channel=channel,
        updated_at=updated_at,
        start_date=start_date,
        end_date=end_date,
    )
    query = _apply_actor_filter(
        query,
        actor=actor,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )
    query = _apply_username_search(
        query,
        username=username,
        creator_alias=creator_alias,
        updater_alias=updater_alias,
    )

    query = query.order_by(
        models.ChannelTransfer.transfer_date.asc(),
        models.ChannelTransfer.sku_code.asc(),
        models.ChannelTransfer.warehouse_name.asc(),
        models.ChannelTransfer.from_channel.asc(),
        models.ChannelTransfer.to_channel.asc(),
    )

    transfers = db.scalars(query).unique().all()
    include_audit_columns = include_audit and settings.audit_metadata_enabled

    def iter_rows():
        buffer = StringIO()
        writer = csv.writer(buffer)

        header = [
            "session_title",
            "transfer_date",
            "sku_code",
            "warehouse_name",
            "from_channel",
            "to_channel",
            "qty",
            "note",
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

        for transfer in transfers:
            data = _serialize_transfer(transfer)
            row = [
                session.title,
                transfer.transfer_date.isoformat(),
                transfer.sku_code,
                transfer.warehouse_name,
                transfer.from_channel,
                transfer.to_channel,
                str(transfer.qty),
                transfer.note or "",
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

    filename = f"channel-transfers-{session_id}.csv"
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}

    return StreamingResponse(
        iter_rows(),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


@router.post(
    "",
    response_model=schemas.ChannelTransferRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
@router.post(
    "/",
    response_model=schemas.ChannelTransferRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
def create_channel_transfer(
    payload: schemas.ChannelTransferCreate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.ChannelTransferRead:
    """Create a new channel transfer entry."""

    _ensure_channel_transfer_table(db)

    session = db.get(models.Session, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    if payload.from_channel == payload.to_channel:
        raise HTTPException(status_code=400, detail="from_channel and to_channel must differ")

    transfer = models.ChannelTransfer(**payload.model_dump())
    transfer.created_by = current_user.id
    transfer.updated_by = current_user.id
    db.add(transfer)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="channel transfer already exists") from exc

    db.refresh(transfer)
    _refresh_audit_relationships(db, transfer)
    return _serialize_transfer(transfer)


@router.put(
    "/{session_id}/{sku_code}/{warehouse_name}/{transfer_date}/{from_channel}/{to_channel}",
    response_model=schemas.ChannelTransferRead,
    response_model_exclude_none=True,
)
def update_channel_transfer(
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
    payload: schemas.ChannelTransferUpdate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.ChannelTransferRead:
    """Update an existing channel transfer entry."""

    transfer = _get_transfer_or_404(
        db,
        session_id=session_id,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        transfer_date=transfer_date,
        from_channel=from_channel,
        to_channel=to_channel,
    )

    update_values = payload.model_dump(exclude_unset=True)

    if "from_channel" in update_values and "to_channel" in update_values:
        if update_values["from_channel"] == update_values["to_channel"]:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )
    elif "from_channel" in update_values:
        if update_values["from_channel"] == transfer.to_channel:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )
    elif "to_channel" in update_values:
        if transfer.from_channel == update_values["to_channel"]:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )

    for field, value in update_values.items():
        setattr(transfer, field, value)
    transfer.updated_by = current_user.id

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="channel transfer already exists") from exc

    db.refresh(transfer)
    _refresh_audit_relationships(db, transfer)
    return _serialize_transfer(transfer)


@router.delete(
    "/{session_id}/{sku_code}/{warehouse_name}/{transfer_date}/{from_channel}/{to_channel}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_channel_transfer(
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> Response:
    """Remove a channel transfer entry."""

    _ = current_user
    transfer = _get_transfer_or_404(
        db,
        session_id=session_id,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        transfer_date=transfer_date,
        from_channel=from_channel,
        to_channel=to_channel,
    )

    db.delete(transfer)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
