"""Core algorithms supporting transfer plan recommendations."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from typing import Iterable

from .reallocation_policy import PolicyRoundingMode, ReallocationPolicyData

ZERO = Decimal("0")
QUANT = Decimal("0.000001")
MOVE_UNIT = Decimal("1")

logger = logging.getLogger(__name__)


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
        "stock_closing",
        "surplus_remaining",
        "allocated_out",
        "allocated_in",
    )

    def __init__(
        self,
        *,
        stock_at_anchor: Decimal,
        stdstock: Decimal,
        gap: Decimal,
        stock_closing: Decimal,
    ) -> None:
        self.stock_at_anchor = stock_at_anchor
        self.stdstock = stdstock
        self.gap = gap
        self.stock_closing = stock_closing
        surplus = gap if gap > ZERO else ZERO
        self.surplus_remaining = surplus
        self.allocated_out = ZERO
        self.allocated_in = ZERO

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

    def receive(self, qty: Decimal) -> None:
        self.allocated_in += qty

    def remaining_capacity(self) -> Decimal:
        capacity = self.stdstock - (self.stock_closing + self.allocated_in)
        return capacity if capacity > ZERO else ZERO


def _round_quantity(qty: Decimal, mode: PolicyRoundingMode) -> Decimal:
    if qty <= ZERO:
        return ZERO
    if mode == "floor":
        return qty.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
    if mode == "ceil":
        return qty.quantize(MOVE_UNIT, rounding=ROUND_CEILING)
    return qty.quantize(MOVE_UNIT, rounding=ROUND_HALF_UP)


_BUCKET_REASON = {
    "intra_nonmain": "fill main channel (intra)",
    "inter_nonmain": "fill main channel (inter non-main)",
    "inter_main": "fill main channel (inter main)",
}


def recommend_plan_lines(
    matrix_rows: Iterable[MatrixRowData],
    *,
    warehouse_main_channels: dict[str, str],
    policy: ReallocationPolicyData,
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
            stock_closing=row.stock_closing if row.stock_closing > ZERO else ZERO,
        )

    recommendations: list[RecommendedMove] = []

    for sku_code, cells in rows_by_sku.items():
        shortages: list[tuple[str, str, Decimal, _CellState]] = []
        for warehouse, main_channel in warehouse_main_channels.items():
            cell = cells.get((warehouse, main_channel))
            if cell is None:
                continue
            shortage = ZERO - cell.gap if cell.gap < ZERO else ZERO
            if shortage > ZERO:
                shortages.append((warehouse, main_channel, shortage, cell))

        shortages.sort(key=lambda item: item[2], reverse=True)

        for warehouse, main_channel, shortage, receiver_state in shortages:
            shortage_remaining = shortage
            bucket_attempts = {
                "intra_nonmain": 0,
                "inter_nonmain": 0,
                "inter_main": 0,
            }
            blocked_reasons: set[str] = set()

            # Intra-warehouse fulfilment
            donors_intra: list[tuple[tuple[str, str], _CellState]] = [
                (key, state)
                for key, state in cells.items()
                if key[0] == warehouse
                and key[1] != main_channel
                and state.available_surplus() > ZERO
            ]
            donors_intra.sort(key=lambda item: item[1].available_surplus(), reverse=True)

            donors_inter: list[tuple[tuple[str, str], _CellState]] = [
                (key, state)
                for key, state in cells.items()
                if key[0] != warehouse and state.available_surplus() > ZERO
            ]
            donors_inter.sort(key=lambda item: item[1].available_surplus(), reverse=True)

            donors_inter_nonmain: list[tuple[tuple[str, str], _CellState]] = []
            donors_inter_main: list[tuple[tuple[str, str], _CellState]] = []
            for donor in donors_inter:
                donor_warehouse, donor_channel = donor[0]
                if warehouse_main_channels.get(donor_warehouse) == donor_channel:
                    donors_inter_main.append(donor)
                else:
                    donors_inter_nonmain.append(donor)

            def allocate_from_bucket(
                donors: list[tuple[tuple[str, str], _CellState]],
                bucket: str,
            ) -> bool:
                nonlocal shortage_remaining
                for (from_warehouse, from_channel), donor_state in donors:
                    if shortage_remaining <= ZERO:
                        break
                    bucket_attempts[bucket] += 1
                    available = donor_state.available_surplus()
                    if available <= ZERO:
                        continue
                    receiver_room = None
                    if not policy.allow_overfill:
                        receiver_room = receiver_state.remaining_capacity()
                        if receiver_room <= ZERO:
                            blocked_reasons.add("overfill")
                            return False
                    raw_qty = min(available, shortage_remaining)
                    if receiver_room is not None:
                        raw_qty = min(raw_qty, receiver_room)
                    if raw_qty <= ZERO:
                        continue
                    qty = _round_quantity(raw_qty, policy.rounding_mode)
                    if qty <= ZERO:
                        blocked_reasons.add("rounding_zero")
                        continue
                    max_allowed = raw_qty.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
                    if receiver_room is not None:
                        max_allowed = min(
                            max_allowed,
                            receiver_room.quantize(MOVE_UNIT, rounding=ROUND_FLOOR),
                        )
                    max_allowed = min(
                        max_allowed,
                        available.quantize(MOVE_UNIT, rounding=ROUND_FLOOR),
                        shortage_remaining.quantize(MOVE_UNIT, rounding=ROUND_FLOOR),
                    )
                    if max_allowed <= ZERO:
                        blocked_reasons.add("rounding_zero")
                        continue
                    if qty > max_allowed:
                        qty = max_allowed
                    if qty <= ZERO:
                        blocked_reasons.add("rounding_zero")
                        continue

                    donor_state.allocate(qty)
                    receiver_state.receive(qty)
                    shortage_remaining -= qty
                    move_reason = _BUCKET_REASON[bucket]
                    recommendations.append(
                        RecommendedMove(
                            sku_code=sku_code,
                            from_warehouse=from_warehouse,
                            from_channel=from_channel,
                            to_warehouse=warehouse,
                            to_channel=main_channel,
                            qty=qty,
                            reason=move_reason,
                        )
                    )
                    logger.info(
                        "MOVE_DECISION %s",
                        json.dumps(
                            {
                                "sku": sku_code,
                                "from": {
                                    "warehouse": from_warehouse,
                                    "channel": from_channel,
                                },
                                "to": {"warehouse": warehouse, "channel": main_channel},
                                "qty": str(qty),
                                "reason": bucket,
                            },
                        ),
                    )
                return True

            if not allocate_from_bucket(donors_intra, "intra_nonmain"):
                continue

            if shortage_remaining <= ZERO:
                continue

            if not allocate_from_bucket(donors_inter_nonmain, "inter_nonmain"):
                continue

            if shortage_remaining <= ZERO:
                continue

            if policy.take_from_other_main:
                allocate_from_bucket(donors_inter_main, "inter_main")

            if shortage_remaining > ZERO:
                if sum(bucket_attempts.values()) == 0:
                    blocked_reasons.add("no_donor")
                deficit_after = shortage_remaining if shortage_remaining > ZERO else ZERO
                logger.info(
                    "WHY_NOT_FILLED %s",
                    json.dumps(
                        {
                            "sku": sku_code,
                            "target": {"warehouse": warehouse, "channel": main_channel},
                            "deficit_before": str(shortage),
                            "deficit_after": str(deficit_after),
                            "tried": bucket_attempts,
                            "blocked": sorted(blocked_reasons) if blocked_reasons else [],
                        },
                    ),
                )

    return recommendations


__all__ = [
    "MatrixRowData",
    "RecommendedMove",
    "recommend_plan_lines",
    "QUANT",
    "ZERO",
]
