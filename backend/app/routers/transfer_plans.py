"""API endpoints for transfer plan management."""
from __future__ import annotations

import uuid
from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_current_user, get_db
from ..services.transfer_plans import (
    QUANT,
    fetch_main_channel_map,
    fetch_matrix_rows,
    recommend_plan_lines,
)


router = APIRouter()


def _ensure_plan(session: DBSession, plan_id: UUID) -> models.TransferPlan:
    plan = session.get(models.TransferPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return plan


@router.post(
    "/recommend",
    response_model=schemas.TransferPlanRecommendResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_recommended_plan(
    payload: schemas.TransferPlanRecommendRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Generate a draft transfer plan covering the requested scope."""

    if payload.start > payload.end:
        raise HTTPException(status_code=400, detail="start must be on or before end")

    session = db.get(models.Session, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    matrix_rows = fetch_matrix_rows(
        db,
        session_id=payload.session_id,
        start_date=payload.start,
        end_date=payload.end,
        sku_codes=payload.sku_codes,
        warehouses=payload.warehouses,
        channels=payload.channels,
    )

    warehouses: set[str] = {row.warehouse_name for row in matrix_rows}
    warehouse_main_channels = fetch_main_channel_map(db, warehouses=warehouses)

    plan = models.TransferPlan(
        session_id=session.id,
        start_date=payload.start,
        end_date=payload.end,
        status="draft",
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(plan)
    db.flush()

    recommended_moves = recommend_plan_lines(
        matrix_rows,
        warehouse_main_channels=warehouse_main_channels,
    )

    for move in recommended_moves:
        db.add(
            models.TransferPlanLine(
                plan_id=plan.plan_id,
                sku_code=move.sku_code,
                from_warehouse=move.from_warehouse,
                from_channel=move.from_channel,
                to_warehouse=move.to_warehouse,
                to_channel=move.to_channel,
                qty=move.qty,
                is_manual=False,
                reason=move.reason,
                created_by=current_user.id,
                updated_by=current_user.id,
            )
        )

    db.commit()
    db.refresh(plan, attribute_names=["lines"])

    lines = (
        db.execute(
            select(models.TransferPlanLine).where(
                models.TransferPlanLine.plan_id == plan.plan_id
            )
        )
        .scalars()
        .all()
    )

    return schemas.TransferPlanRecommendResponse(
        plan=schemas.TransferPlanRead.model_validate(plan, from_attributes=True),
        lines=[
            schemas.TransferPlanLineRead.model_validate(line, from_attributes=True)
            for line in lines
        ],
    )


@router.put(
    "/{plan_id}/lines",
    response_model=schemas.TransferPlanLineUpsertResponse,
)
def replace_plan_lines(
    plan_id: UUID,
    payload: schemas.TransferPlanLineUpsertRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Replace all lines of the specified transfer plan."""

    plan = _ensure_plan(db, plan_id)

    outgoing_totals: dict[tuple[str, str, str], Decimal] = defaultdict(lambda: Decimal("0"))
    seen_line_ids: set[UUID] = set()

    for line in payload.lines:
        if line.plan_id and line.plan_id != plan_id:
            raise HTTPException(status_code=422, detail="line plan_id mismatch")
        if (
            line.from_warehouse == line.to_warehouse
            and line.from_channel == line.to_channel
        ):
            raise HTTPException(status_code=422, detail="from and to cannot be identical")
        if line.line_id is not None:
            if line.line_id in seen_line_ids:
                raise HTTPException(status_code=422, detail="duplicate line_id detected")
            seen_line_ids.add(line.line_id)
        key = (line.sku_code, line.from_warehouse, line.from_channel)
        outgoing_totals[key] += Decimal(str(line.qty))

    if outgoing_totals:
        matrix_rows = fetch_matrix_rows(
            db,
            session_id=plan.session_id,
            start_date=plan.start_date,
            end_date=plan.end_date,
            sku_codes=list({key[0] for key in outgoing_totals.keys()}),
        )
        stock_map = {
            (row.sku_code, row.warehouse_name, row.channel): row.stock_at_anchor
            for row in matrix_rows
        }
        for key, qty in outgoing_totals.items():
            stock = stock_map.get(key, Decimal("0"))
            if qty - stock > QUANT:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Insufficient stock at anchor for "
                        f"SKU={key[0]} {key[1]} {key[2]}"
                    ),
                )

    db.execute(
        delete(models.TransferPlanLine).where(models.TransferPlanLine.plan_id == plan_id)
    )
    db.flush()

    for line in payload.lines:
        db.add(
            models.TransferPlanLine(
                line_id=line.line_id or uuid.uuid4(),
                plan_id=plan.plan_id,
                sku_code=line.sku_code,
                from_warehouse=line.from_warehouse,
                from_channel=line.from_channel,
                to_warehouse=line.to_warehouse,
                to_channel=line.to_channel,
                qty=Decimal(str(line.qty)),
                is_manual=line.is_manual,
                reason=line.reason,
                created_by=current_user.id,
                updated_by=current_user.id,
            )
        )

    plan.updated_by = current_user.id
    db.add(plan)
    db.commit()

    return schemas.TransferPlanLineUpsertResponse(ok=True)
