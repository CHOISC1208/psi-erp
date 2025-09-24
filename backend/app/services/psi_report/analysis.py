"""Stockout risk calculations for PSI reports."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from .config import Settings
from .data import PivotRow


@dataclass(frozen=True, slots=True)
class StockoutRisk:
    sku_code: str
    sku_name: str | None
    warehouse_name: str | None
    date: date
    channels_count: int
    total_stock: float
    total_deficit: float
    total_surplus: float
    has_deficit: bool
    can_fully_cover: bool


def detect_stockout_risk(rows: Iterable[PivotRow], cfg: Settings) -> list[StockoutRisk]:
    _ = cfg  # placeholder for future tuning knobs
    grouped: dict[tuple[str, str | None, date], list[PivotRow]] = defaultdict(list)
    for row in rows:
        grouped[(row.sku_code, row.warehouse_name, row.date)].append(row)

    risks: list[StockoutRisk] = []
    for (sku_code, warehouse_name, record_date), items in grouped.items():
        sku_name = items[0].sku_name
        total_stock = sum(item.stock_closing for item in items)
        total_deficit = sum(max(0.0, -item.stock_closing) for item in items)
        total_surplus = sum(max(0.0, item.stock_closing) for item in items)
        has_deficit = total_deficit > 0
        can_cover = has_deficit and total_surplus >= total_deficit
        risks.append(
            StockoutRisk(
                sku_code=sku_code,
                sku_name=sku_name,
                warehouse_name=warehouse_name,
                date=record_date,
                channels_count=len(items),
                total_stock=total_stock,
                total_deficit=total_deficit,
                total_surplus=total_surplus,
                has_deficit=has_deficit,
                can_fully_cover=can_cover,
            )
        )

    risks.sort(key=lambda item: (item.date, item.warehouse_name or ""))
    return risks


def first_stockout_date(
    risk_rows: Iterable[StockoutRisk], sku_code: str, warehouse_name: str | None
) -> date | None:
    for row in risk_rows:
        if row.sku_code == sku_code and row.warehouse_name == warehouse_name and row.has_deficit:
            return row.date
    return None
