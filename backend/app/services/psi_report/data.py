"""Transform PSI channel responses into pivot-style rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Sequence

from ... import schemas


@dataclass(frozen=True, slots=True)
class PivotRow:
    """Single daily PSI observation for a SKU/channel."""

    sku_code: str
    sku_name: str | None
    warehouse_name: str
    channel: str
    date: date
    stock_closing: float
    inbound_qty: float
    outbound_qty: float
    channel_move: float
    safety_stock: float
    inventory_days: float | None = None
    category_1: str | None = None
    category_2: str | None = None
    category_3: str | None = None
    fw_rank: str | None = None
    ss_rank: str | None = None


@dataclass(slots=True)
class PivotResult:
    rows: list[PivotRow]
    start_date: date | None
    end_date: date | None


def _coerce_float(value: float | int | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def build_pivot_rows(
    channels: Sequence[schemas.ChannelDailyPSI],
    *,
    target_days_ahead: int,
) -> PivotResult:
    """Flatten PSI channel responses into per-day rows."""

    rows: list[PivotRow] = []
    for channel in channels:
        for entry in channel.daily:
            rows.append(
                PivotRow(
                    sku_code=channel.sku_code,
                    sku_name=channel.sku_name,
                    category_1=channel.category_1,
                    category_2=channel.category_2,
                    category_3=channel.category_3,
                    fw_rank=channel.fw_rank,
                    ss_rank=channel.ss_rank,
                    warehouse_name=channel.warehouse_name,
                    channel=channel.channel,
                    date=entry.date,
                    stock_closing=_coerce_float(entry.stock_closing),
                    inbound_qty=_coerce_float(entry.inbound_qty),
                    outbound_qty=_coerce_float(entry.outbound_qty),
                    channel_move=_coerce_float(entry.channel_move),
                    safety_stock=_coerce_float(entry.safety_stock),
                    inventory_days=float(entry.inventory_days)
                    if entry.inventory_days is not None
                    else None,
                )
            )

    if not rows:
        return PivotResult(rows=[], start_date=None, end_date=None)

    rows.sort(key=lambda item: (item.date, item.warehouse_name, item.channel))
    start = rows[0].date
    cutoff = start + timedelta(days=target_days_ahead - 1)
    filtered = [row for row in rows if row.date <= cutoff]
    end = max(row.date for row in filtered) if filtered else None
    return PivotResult(rows=filtered, start_date=start, end_date=end)
