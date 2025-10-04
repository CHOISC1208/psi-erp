"""Core algorithms supporting transfer plan recommendations."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from typing import Iterable

from .reallocation_policy import (
    PolicyFairShareMode,
    PolicyRoundingMode,
    ReallocationPolicyData,
)

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


@dataclass(slots=True)
class _FairShareReceiver:
    warehouse: str
    channel: str
    state: _CellState
    base: Decimal
    std: Decimal
    shortage: Decimal
    max_receivable: Decimal | None

    def key(self) -> tuple[str, str]:
        return (self.warehouse, self.channel)


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
        if policy.fair_share_mode != "off":
            _recommend_fair_share(
                sku_code,
                cells,
                warehouse_main_channels,
                policy,
                recommendations,
            )
            continue

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


def _recommend_fair_share(
    sku_code: str,
    cells: dict[tuple[str, str], _CellState],
    warehouse_main_channels: dict[str, str],
    policy: ReallocationPolicyData,
    recommendations: list[RecommendedMove],
) -> None:
    receivers: list[_FairShareReceiver] = []
    for warehouse, main_channel in warehouse_main_channels.items():
        state = cells.get((warehouse, main_channel))
        if state is None:
            continue
        shortage = ZERO - state.gap if state.gap < ZERO else ZERO
        if shortage <= ZERO:
            continue
        std_value = state.stdstock if state.stdstock > ZERO else ZERO
        if std_value <= ZERO:
            continue
        if policy.fair_share_mode == "equalize_ratio_start":
            base_value = state.stock_at_anchor
        else:
            base_value = state.stock_closing
        if base_value < ZERO:
            base_value = ZERO
        max_receivable: Decimal | None = None
        if not policy.allow_overfill:
            capacity = state.remaining_capacity()
            if capacity <= ZERO:
                continue
            max_receivable = capacity
        receivers.append(
            _FairShareReceiver(
                warehouse=warehouse,
                channel=main_channel,
                state=state,
                base=base_value,
                std=std_value,
                shortage=shortage,
                max_receivable=max_receivable,
            )
        )

    if not receivers:
        return

    donors_nonmain: list[tuple[tuple[str, str], _CellState]] = []
    donors_inter_main: list[tuple[tuple[str, str], _CellState]] = []
    total_available = ZERO

    for key, state in cells.items():
        available = state.available_surplus()
        if available <= ZERO:
            continue
        warehouse, channel = key
        main_channel = warehouse_main_channels.get(warehouse)
        if main_channel == channel:
            if policy.take_from_other_main:
                donors_inter_main.append((key, state))
                total_available += available
        else:
            donors_nonmain.append((key, state))
            total_available += available

    donors_nonmain.sort(key=lambda item: item[1].available_surplus(), reverse=True)
    donors_inter_main.sort(key=lambda item: item[1].available_surplus(), reverse=True)

    donors_intra_by_warehouse: dict[str, list[tuple[tuple[str, str], _CellState]]] = {}
    for donor in donors_nonmain:
        donors_intra_by_warehouse.setdefault(donor[0][0], []).append(donor)

    for donors in donors_intra_by_warehouse.values():
        donors.sort(key=lambda item: item[1].available_surplus(), reverse=True)

    if total_available <= ZERO:
        _log_fair_share_outcome(
            sku_code,
            policy.fair_share_mode,
            Decimal("0"),
            receivers,
            {receiver.key(): ZERO for receiver in receivers},
            {receiver.key(): ZERO for receiver in receivers},
            {bucket: ZERO for bucket in _BUCKET_REASON},
            {receiver.key(): {bucket: 0 for bucket in _BUCKET_REASON} for receiver in receivers},
        )
        for receiver in receivers:
            logger.info(
                "WHY_NOT_FILLED %s",
                json.dumps(
                    {
                        "sku": sku_code,
                        "mode": "fair_share",
                        "target": {
                            "warehouse": receiver.warehouse,
                            "channel": receiver.channel,
                        },
                        "deficit_before": str(receiver.shortage),
                        "deficit_after": str(receiver.shortage),
                        "tried": {bucket: 0 for bucket in _BUCKET_REASON},
                        "blocked": ["no_donor"],
                    }
                ),
            )
        return

    if not policy.allow_overfill:
        capacity_total = sum(
            receiver.max_receivable or ZERO for receiver in receivers
        )
        if capacity_total <= ZERO:
            return
        effective_total = min(total_available, capacity_total)
    else:
        effective_total = total_available

    donor_units = sum(
        donor_state.available_surplus().quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
        for _, donor_state in donors_nonmain
    )
    if policy.take_from_other_main:
        donor_units += sum(
            donor_state.available_surplus().quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
            for _, donor_state in donors_inter_main
        )

    if not policy.allow_overfill:
        capacity_units = sum(
            (receiver.max_receivable or ZERO).quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
            for receiver in receivers
        )
        donor_units = min(donor_units, capacity_units)

    available_units = min(
        effective_total.quantize(MOVE_UNIT, rounding=ROUND_FLOOR),
        donor_units,
    )

    ratio_values = [
        (receiver.base / receiver.std) if receiver.std > ZERO else ZERO
        for receiver in receivers
    ]
    min_ratio = min(ratio_values) if ratio_values else ZERO
    if min_ratio < ZERO:
        min_ratio = ZERO

    def needs_for_lambda(lambda_value: Decimal) -> tuple[Decimal, list[Decimal]]:
        needs: list[Decimal] = []
        total = ZERO
        for receiver in receivers:
            std_value = receiver.std
            if std_value <= ZERO:
                needs.append(ZERO)
                continue
            target = std_value * lambda_value
            if not policy.allow_overfill:
                target = min(target, std_value)
            need = target - receiver.base
            if need <= ZERO:
                needs.append(ZERO)
                continue
            if receiver.max_receivable is not None and need > receiver.max_receivable:
                need = receiver.max_receivable
            need = need if need > ZERO else ZERO
            needs.append(need)
            total += need
        return total, needs

    if effective_total <= ZERO:
        lambda_value = Decimal(min_ratio)
        needs = [ZERO for _ in receivers]
    else:
        high = max(Decimal(min_ratio), Decimal("1"))
        if high <= Decimal(min_ratio):
            high = Decimal(min_ratio) + QUANT
        total_high, _ = needs_for_lambda(high)
        iterations = 0
        while total_high + QUANT < effective_total and iterations < 32:
            high *= Decimal("2")
            total_high, _ = needs_for_lambda(high)
            iterations += 1
            if high > Decimal("1000"):
                break

        low = Decimal(min_ratio)
        for _ in range(60):
            mid = (low + high) / Decimal("2")
            total_mid, _ = needs_for_lambda(mid)
            if total_mid + QUANT < effective_total:
                low = mid
            else:
                high = mid

        lambda_value = high
        _, needs = needs_for_lambda(lambda_value)

    plans = []
    for receiver, need in zip(receivers, needs):
        if need <= ZERO:
            plans.append(ZERO)
            continue
        if receiver.max_receivable is not None and need > receiver.max_receivable:
            need = receiver.max_receivable
        plans.append(need)

    rounded_plans: list[Decimal] = []
    for receiver, need in zip(receivers, plans):
        qty = _round_quantity(need, policy.rounding_mode)
        if receiver.max_receivable is not None:
            cap = receiver.max_receivable.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
            if qty > cap:
                qty = cap
        rounded_plans.append(qty)

    plan_total = sum(rounded_plans)
    diff = available_units - plan_total
    indices_sorted = sorted(
        range(len(receivers)), key=lambda idx: plans[idx], reverse=True
    )

    def apply_adjustment(delta: Decimal) -> None:
        remaining = delta
        for idx in indices_sorted:
            if remaining == ZERO:
                break
            receiver = receivers[idx]
            cap = (
                receiver.max_receivable.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
                if receiver.max_receivable is not None
                else None
            )
            if delta > ZERO:
                while remaining > ZERO:
                    if cap is not None and rounded_plans[idx] >= cap:
                        break
                    rounded_plans[idx] += MOVE_UNIT
                    remaining -= MOVE_UNIT
                    if remaining <= ZERO:
                        break
            else:
                while remaining < ZERO and rounded_plans[idx] > ZERO:
                    rounded_plans[idx] -= MOVE_UNIT
                    remaining += MOVE_UNIT
                    if remaining >= ZERO:
                        break

    if diff > ZERO:
        apply_adjustment(diff)
    elif diff < ZERO:
        apply_adjustment(diff)

    remaining_plan: dict[tuple[str, str], Decimal] = {}
    allocated: dict[tuple[str, str], Decimal] = {}
    for receiver, qty in zip(receivers, rounded_plans):
        key = receiver.key()
        remaining_plan[key] = qty if qty > ZERO else ZERO
        allocated[key] = ZERO

    bucket_usage_qty = {bucket: ZERO for bucket in _BUCKET_REASON}
    bucket_attempts: dict[tuple[str, str], dict[str, int]] = {
        receiver.key(): {bucket: 0 for bucket in _BUCKET_REASON}
        for receiver in receivers
    }

    receiver_order = sorted(
        receivers,
        key=lambda receiver: (receiver.base / receiver.std) if receiver.std > ZERO else ZERO,
    )

    remaining_total = sum(remaining_plan.values())

    def next_receiver_with_need() -> _FairShareReceiver | None:
        for receiver in receiver_order:
            if remaining_plan[receiver.key()] > ZERO:
                return receiver
        return None

    def commit_move(
        donor_key: tuple[str, str],
        donor_state: _CellState,
        receiver: _FairShareReceiver,
        qty: Decimal,
        bucket: str,
    ) -> None:
        nonlocal remaining_total
        donor_state.allocate(qty)
        receiver.state.receive(qty)
        key = receiver.key()
        remaining_plan[key] -= qty
        if remaining_plan[key] < ZERO:
            remaining_plan[key] = ZERO
        allocated[key] += qty
        remaining_total -= qty
        if remaining_total < ZERO:
            remaining_total = ZERO
        bucket_usage_qty[bucket] += qty
        recommendations.append(
            RecommendedMove(
                sku_code=sku_code,
                from_warehouse=donor_key[0],
                from_channel=donor_key[1],
                to_warehouse=receiver.warehouse,
                to_channel=receiver.channel,
                qty=qty,
                reason=_BUCKET_REASON[bucket],
            )
        )
        logger.info(
            "MOVE_DECISION %s",
            json.dumps(
                {
                    "sku": sku_code,
                    "mode": "fair_share",
                    "from": {"warehouse": donor_key[0], "channel": donor_key[1]},
                    "to": {
                        "warehouse": receiver.warehouse,
                        "channel": receiver.channel,
                    },
                    "qty": str(qty),
                    "reason": bucket,
                }
            ),
        )

    # Intra-warehouse allocation
    for receiver in receiver_order:
        key = receiver.key()
        donors = donors_intra_by_warehouse.get(receiver.warehouse, [])
        for donor_key, donor_state in donors:
            if remaining_plan[key] <= ZERO or remaining_total <= ZERO:
                break
            available = donor_state.available_surplus()
            if available <= ZERO:
                continue
            bucket_attempts[key]["intra_nonmain"] += 1
            qty = min(available, remaining_plan[key])
            if not policy.allow_overfill:
                receiver_room = receiver.state.remaining_capacity()
                qty = min(qty, receiver_room)
            qty = qty.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
            if qty <= ZERO:
                continue
            commit_move(donor_key, donor_state, receiver, qty, "intra_nonmain")

    if remaining_total > ZERO:
        for donor_key, donor_state in donors_nonmain:
            while donor_state.available_surplus() > ZERO and remaining_total > ZERO:
                receiver = next_receiver_with_need()
                if receiver is None:
                    break
                key = receiver.key()
                bucket_attempts[key]["inter_nonmain"] += 1
                qty = min(donor_state.available_surplus(), remaining_plan[key])
                if not policy.allow_overfill:
                    receiver_room = receiver.state.remaining_capacity()
                    qty = min(qty, receiver_room)
                qty = qty.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
                if qty <= ZERO:
                    break
                commit_move(donor_key, donor_state, receiver, qty, "inter_nonmain")

    if remaining_total > ZERO and policy.take_from_other_main:
        for donor_key, donor_state in donors_inter_main:
            while donor_state.available_surplus() > ZERO and remaining_total > ZERO:
                receiver = next_receiver_with_need()
                if receiver is None:
                    break
                key = receiver.key()
                bucket_attempts[key]["inter_main"] += 1
                qty = min(donor_state.available_surplus(), remaining_plan[key])
                if not policy.allow_overfill:
                    receiver_room = receiver.state.remaining_capacity()
                    qty = min(qty, receiver_room)
                qty = qty.quantize(MOVE_UNIT, rounding=ROUND_FLOOR)
                if qty <= ZERO:
                    break
                commit_move(donor_key, donor_state, receiver, qty, "inter_main")

    for receiver in receivers:
        key = receiver.key()
        remaining = remaining_plan[key]
        if remaining > ZERO:
            blocked: list[str] = []
            if not policy.allow_overfill and receiver.state.remaining_capacity() <= ZERO:
                blocked.append("overfill")
            blocked.append("no_donor")
            logger.info(
                "WHY_NOT_FILLED %s",
                json.dumps(
                    {
                        "sku": sku_code,
                        "mode": "fair_share",
                        "target": {
                            "warehouse": receiver.warehouse,
                            "channel": receiver.channel,
                        },
                        "deficit_before": str(receiver.shortage),
                        "deficit_after": str(remaining),
                        "tried": bucket_attempts[key],
                        "blocked": sorted(set(blocked)),
                    }
                ),
            )

    _log_fair_share_outcome(
        sku_code,
        policy.fair_share_mode,
        lambda_value,
        receivers,
        remaining_plan,
        allocated,
        bucket_usage_qty,
        bucket_attempts,
    )


def _log_fair_share_outcome(
    sku_code: str,
    mode: PolicyFairShareMode,
    lambda_value: Decimal,
    receivers: list[_FairShareReceiver],
    remaining_plan: dict[tuple[str, str], Decimal],
    allocated: dict[tuple[str, str], Decimal],
    bucket_usage_qty: dict[str, Decimal],
    bucket_attempts: dict[tuple[str, str], dict[str, int]],
) -> None:
    debug_payload = {
        "mode": mode,
        "lambda": str(lambda_value),
        "per_main_alloc": {
            f"{receiver.warehouse}:{receiver.channel}": {
                "planned": str((allocated[receiver.key()] + remaining_plan[receiver.key()])),
                "allocated": str(allocated[receiver.key()]),
                "remaining": str(remaining_plan[receiver.key()]),
                "attempts": bucket_attempts[receiver.key()],
            }
            for receiver in receivers
        },
        "donor_usage_breakdown": {bucket: str(qty) for bucket, qty in bucket_usage_qty.items()},
        "leftover_demand": str(sum(remaining_plan.values())),
    }
    logger.info(
        "FAIR_SHARE %s",
        json.dumps({"sku": sku_code, "fair_share_debug": debug_payload}),
    )
