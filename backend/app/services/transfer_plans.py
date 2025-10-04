"""Helpers for transfer plan aggregation and recommendation."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable, Sequence
from uuid import UUID

from sqlalchemy import and_, case, func, literal, select, union_all
from sqlalchemy.orm import Session as DBSession

from .. import models
from .transfer_logic import MatrixRowData, QUANT, ZERO, recommend_plan_lines


def _to_decimal(value: Decimal | float | int | None) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
def fetch_matrix_rows(
    db: DBSession,
    *,
    session_id: UUID,
    start_date: date,
    end_date: date,
    plan_id: UUID | None = None,
    sku_codes: Sequence[str] | None = None,
    warehouses: Sequence[str] | None = None,
    channels: Sequence[str] | None = None,
) -> list[MatrixRowData]:
    """Return aggregated PSI metrics for the requested period."""

    psi = models.PSIBase

    stock_anchor_expr = func.max(
        case((psi.date == start_date, psi.stock_at_anchor), else_=None)
    ).label("stock_at_anchor")
    sku_name_expr = func.max(psi.sku_name).label("sku_name")
    stdstock_expr = func.max(case((psi.date == start_date, psi.stdstock), else_=None)).label(
        "stdstock"
    )
    stock_close_expr = func.max(
        case((psi.date == end_date, psi.stock_closing), else_=None)
    ).label("stock_closing")
    inbound_expr = func.sum(func.coalesce(psi.inbound_qty, ZERO)).label("inbound_qty")
    outbound_expr = func.sum(func.coalesce(psi.outbound_qty, ZERO)).label("outbound_qty")

    base_query = (
        select(
            psi.sku_code,
            psi.warehouse_name,
            psi.channel,
            stock_anchor_expr,
            sku_name_expr,
            inbound_expr,
            outbound_expr,
            stock_close_expr,
            stdstock_expr,
        )
        .where(psi.session_id == session_id)
        .where(and_(psi.date >= start_date, psi.date <= end_date))
        .group_by(psi.sku_code, psi.warehouse_name, psi.channel)
    )

    if sku_codes:
        base_query = base_query.where(psi.sku_code.in_(list({*sku_codes})))
    if warehouses:
        base_query = base_query.where(psi.warehouse_name.in_(list({*warehouses})))
    if channels:
        base_query = base_query.where(psi.channel.in_(list({*channels})))

    aggregated = base_query.subquery().alias("aggregated")

    moves_sub = None
    if plan_id is not None:
        line = models.TransferPlanLine
        outgoing = (
            select(
                line.plan_id,
                line.sku_code,
                line.from_warehouse.label("warehouse_name"),
                line.from_channel.label("channel"),
                (-line.qty).label("delta"),
            )
            .where(line.plan_id == plan_id)
        )
        incoming = (
            select(
                line.plan_id,
                line.sku_code,
                line.to_warehouse.label("warehouse_name"),
                line.to_channel.label("channel"),
                line.qty.label("delta"),
            )
            .where(line.plan_id == plan_id)
        )
        movements = union_all(outgoing, incoming).subquery()
        moves_sub = (
            select(
                movements.c.sku_code,
                movements.c.warehouse_name,
                movements.c.channel,
                func.sum(movements.c.delta).label("move"),
            )
            .group_by(
                movements.c.sku_code,
                movements.c.warehouse_name,
                movements.c.channel,
            )
        ).subquery()

        key_union = union_all(
            select(
                aggregated.c.sku_code,
                aggregated.c.warehouse_name,
                aggregated.c.channel,
            ),
            select(moves_sub.c.sku_code, moves_sub.c.warehouse_name, moves_sub.c.channel),
        ).subquery()
        keys = (
            select(
                key_union.c.sku_code,
                key_union.c.warehouse_name,
                key_union.c.channel,
            )
            .distinct()
            .subquery()
        )
    else:
        keys = aggregated

    move_expr = func.coalesce(moves_sub.c.move, ZERO) if moves_sub is not None else literal(ZERO)

    query = (
        select(
            keys.c.sku_code,
            aggregated.c.sku_name,
            keys.c.warehouse_name,
            keys.c.channel,
            func.coalesce(aggregated.c.stock_at_anchor, ZERO).label("stock_at_anchor"),
            func.coalesce(aggregated.c.inbound_qty, ZERO).label("inbound_qty"),
            func.coalesce(aggregated.c.outbound_qty, ZERO).label("outbound_qty"),
            func.coalesce(aggregated.c.stock_closing, ZERO).label("stock_closing"),
            func.coalesce(aggregated.c.stdstock, ZERO).label("stdstock"),
            move_expr.label("move"),
        )
        .select_from(keys)
        .order_by(keys.c.sku_code, keys.c.warehouse_name, keys.c.channel)
    )

    if aggregated is not keys:
        query = query.outerjoin(
            aggregated,
            and_(
                aggregated.c.sku_code == keys.c.sku_code,
                aggregated.c.warehouse_name == keys.c.warehouse_name,
                aggregated.c.channel == keys.c.channel,
            ),
        )

    if moves_sub is not None:
        query = query.outerjoin(
            moves_sub,
            and_(
                moves_sub.c.sku_code == keys.c.sku_code,
                moves_sub.c.warehouse_name == keys.c.warehouse_name,
                moves_sub.c.channel == keys.c.channel,
            ),
        )

    rows = db.execute(query).all()

    result: list[MatrixRowData] = []
    for row in rows:
        stock_at_anchor = _to_decimal(row.stock_at_anchor)
        stdstock = _to_decimal(row.stdstock)
        gap = stock_at_anchor - stdstock
        move_value = _to_decimal(row.move)
        stock_closing = _to_decimal(row.stock_closing)
        stock_fin = stock_closing + move_value
        result.append(
            MatrixRowData(
                sku_code=row.sku_code,
                sku_name=row.sku_name,
                warehouse_name=row.warehouse_name,
                channel=row.channel,
                stock_at_anchor=stock_at_anchor,
                inbound_qty=_to_decimal(row.inbound_qty),
                outbound_qty=_to_decimal(row.outbound_qty),
                stock_closing=stock_closing,
                stdstock=stdstock,
                gap=gap,
                move=move_value,
                stock_fin=stock_fin,
            )
        )
    return result


def fetch_summary_matrix_rows(
    db: DBSession,
    *,
    session_id: UUID,
    sku_codes: Sequence[str] | None = None,
    warehouses: Sequence[str] | None = None,
    channels: Sequence[str] | None = None,
) -> list[MatrixRowData]:
    """Return matrix-style rows derived from summary snapshot data."""

    summary = models.PSISummaryBase

    query = (
        select(
            summary.sku_code,
            summary.sku_name,
            summary.warehouse_name,
            summary.channel,
            summary.inbound_qty,
            summary.outbound_qty,
            summary.stock,
            summary.std_stock,
        )
        .where(summary.session_id == session_id)
        .order_by(summary.sku_code, summary.warehouse_name, summary.channel)
    )

    if sku_codes:
        query = query.where(summary.sku_code.in_(list({*sku_codes})))
    if warehouses:
        query = query.where(summary.warehouse_name.in_(list({*warehouses})))
    if channels:
        query = query.where(summary.channel.in_(list({*channels})))

    rows = db.execute(query).all()

    result: list[MatrixRowData] = []
    for row in rows:
        stock_value = _to_decimal(row.stock)
        std_stock = _to_decimal(row.std_stock)
        inbound_value = _to_decimal(row.inbound_qty)
        outbound_value = _to_decimal(row.outbound_qty)
        gap = stock_value - std_stock
        result.append(
            MatrixRowData(
                sku_code=row.sku_code,
                sku_name=row.sku_name,
                warehouse_name=row.warehouse_name,
                channel=row.channel,
                stock_at_anchor=stock_value,
                inbound_qty=inbound_value,
                outbound_qty=outbound_value,
                stock_closing=stock_value,
                stdstock=std_stock,
                gap=gap,
                move=ZERO,
                stock_fin=stock_value,
            )
        )
    return result


def fetch_main_channel_map(
    db: DBSession, *, warehouses: Iterable[str] | None = None
) -> dict[str, str]:
    query = select(models.WarehouseMaster.warehouse_name, models.WarehouseMaster.main_channel)
    warehouse_list = list({*(warehouses or [])})
    if warehouse_list:
        query = query.where(models.WarehouseMaster.warehouse_name.in_(warehouse_list))
    rows = db.execute(query).all()
    return {
        warehouse: channel
        for warehouse, channel in rows
        if channel is not None and channel != ""
    }
