"""Core algorithms supporting transfer plan recommendations."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

ZERO = Decimal("0")
QUANT = Decimal("0.000001")
MOVE_UNIT = Decimal("1")


@dataclass(slots=True)
class MatrixRowData:
    """Aggregated PSI metrics for a SKU/channel combination."""

    sku_code: str
    sku_name: str | None
    warehouse_name: str
    channel: str
    stock_at_anchor: Decimal
    inbound_qty: Decimal
    outbound_qty: Decimal
    stock_closing: Decimal
    stdstock: Decimal
    gap: Decimal
    move: Decimal
    stock_fin: Decimal


@dataclass(slots=True)
class RecommendedMove:
    """Suggested stock transfer between two channels."""

    sku_code: str
    from_warehouse: str
    from_channel: str
    to_warehouse: str
    to_channel: str
    qty: Decimal
    reason: str


class _CellState:
    __slots__ = (
        "stock_at_anchor",
        "stdstock",
        "gap",
        "surplus_remaining",
        "allocated_out",
    )

    def __init__(self, *, stock_at_anchor: Decimal, stdstock: Decimal, gap: Decimal) -> None:
        self.stock_at_anchor = stock_at_anchor
        self.stdstock = stdstock
        self.gap = gap
        surplus = gap if gap > ZERO else ZERO
        self.surplus_remaining = surplus
        self.allocated_out = ZERO

    def available_surplus(self) -> Decimal:
        stock_remaining = self.stock_at_anchor - self.allocated_out
        if stock_remaining <= ZERO:
            return ZERO
        if self.surplus_remaining <= ZERO:
            return ZERO
        return min(self.surplus_remaining, stock_remaining)

    def allocate(self, qty: Decimal) -> None:
        self.allocated_out += qty
        remaining = self.surplus_remaining - qty
        self.surplus_remaining = remaining if remaining > ZERO else ZERO


def recommend_plan_lines(
    matrix_rows: Iterable[MatrixRowData],
    *,
    warehouse_main_channels: dict[str, str],
) -> list[RecommendedMove]:
    """Create recommended transfer moves based on aggregated gaps."""

    rows_by_sku: dict[str, dict[tuple[str, str], _CellState]] = {}
    for row in matrix_rows:
        sku_cells = rows_by_sku.setdefault(row.sku_code, {})
        key = (row.warehouse_name, row.channel)
        sku_cells[key] = _CellState(
            stock_at_anchor=row.stock_at_anchor if row.stock_at_anchor > ZERO else ZERO,
            stdstock=row.stdstock if row.stdstock > ZERO else ZERO,
            gap=row.gap,
        )

    recommendations: list[RecommendedMove] = []

    for sku_code, cells in rows_by_sku.items():
        shortages: list[tuple[str, str, Decimal]] = []
        for warehouse, main_channel in warehouse_main_channels.items():
            cell = cells.get((warehouse, main_channel))
            if cell is None:
                continue
            shortage = ZERO - cell.gap if cell.gap < ZERO else ZERO
            if shortage > ZERO:
                shortages.append((warehouse, main_channel, shortage))

        shortages.sort(key=lambda item: item[2], reverse=True)

        for warehouse, main_channel, shortage in shortages:
            shortage_remaining = shortage

            # Intra-warehouse fulfilment
            donors_intra: list[tuple[tuple[str, str], _CellState]] = [
                (key, state)
                for key, state in cells.items()
                if key[0] == warehouse
                and key[1] != main_channel
                and state.available_surplus() > ZERO
            ]
            donors_intra.sort(key=lambda item: item[1].available_surplus(), reverse=True)

            for (from_warehouse, from_channel), donor_state in donors_intra:
                if shortage_remaining <= ZERO:
                    break
                available = donor_state.available_surplus()
                if available <= ZERO:
                    continue
                qty = min(available, shortage_remaining)
                if qty <= ZERO:
                    continue
                qty = qty.quantize(MOVE_UNIT, rounding=ROUND_HALF_UP)
                if qty <= ZERO:
                    continue
                recommendations.append(
                    RecommendedMove(
                        sku_code=sku_code,
                        from_warehouse=from_warehouse,
                        from_channel=from_channel,
                        to_warehouse=warehouse,
                        to_channel=main_channel,
                        qty=qty,
                        reason="fill main channel (intra)",
                    )
                )
                donor_state.allocate(qty)
                shortage_remaining -= qty

            if shortage_remaining <= ZERO:
                continue

            donors_inter: list[tuple[tuple[str, str], _CellState]] = [
                (key, state)
                for key, state in cells.items()
                if key[0] != warehouse and state.available_surplus() > ZERO
            ]
            donors_inter.sort(key=lambda item: item[1].available_surplus(), reverse=True)

            for (from_warehouse, from_channel), donor_state in donors_inter:
                if shortage_remaining <= ZERO:
                    break
                available = donor_state.available_surplus()
                if available <= ZERO:
                    continue
                qty = min(available, shortage_remaining)
                if qty <= ZERO:
                    continue
                qty = qty.quantize(MOVE_UNIT, rounding=ROUND_HALF_UP)
                if qty <= ZERO:
                    continue
                recommendations.append(
                    RecommendedMove(
                        sku_code=sku_code,
                        from_warehouse=from_warehouse,
                        from_channel=from_channel,
                        to_warehouse=warehouse,
                        to_channel=main_channel,
                        qty=qty,
                        reason="fill main channel (inter)",
                    )
                )
                donor_state.allocate(qty)
                shortage_remaining -= qty

    return recommendations


__all__ = [
    "MatrixRowData",
    "RecommendedMove",
    "recommend_plan_lines",
    "QUANT",
    "ZERO",
]
