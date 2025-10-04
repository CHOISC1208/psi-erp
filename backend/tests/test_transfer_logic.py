"""Tests covering the fair-share transfer allocation logic."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

import pytest

from backend.app.services.reallocation_policy import ReallocationPolicyData
from backend.app.services.transfer_logic import MatrixRowData, recommend_plan_lines


def _dec(value: str | int | float) -> Decimal:
    return Decimal(str(value))


def _make_row(
    warehouse: str,
    channel: str,
    *,
    closing: str | int | float,
    std: str | int | float,
    gap: str | int | float,
    stock_at_anchor: str | int | float | None = None,
) -> MatrixRowData:
    anchor = stock_at_anchor if stock_at_anchor is not None else closing
    return MatrixRowData(
        sku_code="SKU-1",
        sku_name=None,
        warehouse_name=warehouse,
        channel=channel,
        stock_at_anchor=_dec(anchor),
        inbound_qty=_dec(0),
        outbound_qty=_dec(0),
        stock_closing=_dec(closing),
        stdstock=_dec(std),
        gap=_dec(gap),
        move=_dec(0),
        stock_fin=_dec(0),
    )


def _policy(
    *,
    fair_share_mode: str,
    rounding_mode: str = "floor",
    take_from_other_main: bool = False,
    allow_overfill: bool = False,
) -> ReallocationPolicyData:
    return ReallocationPolicyData(
        take_from_other_main=take_from_other_main,
        rounding_mode=rounding_mode,  # type: ignore[arg-type]
        allow_overfill=allow_overfill,
        fair_share_mode=fair_share_mode,  # type: ignore[arg-type]
        updated_at=None,
        updated_by=None,
    )


def _collect_allocations(moves):
    totals: dict[tuple[str, str], Decimal] = defaultdict(lambda: _dec(0))
    for move in moves:
        totals[(move.to_warehouse, move.to_channel)] += move.qty
    return totals


def test_equalize_ratio_closing_balances_closing_levels() -> None:
    rows = [
        _make_row("W1", "main", closing="100", std="300", gap="-200"),
        _make_row("W2", "main", closing="200", std="300", gap="-100"),
        _make_row("W2", "secondary", closing="200", std="0", gap="100", stock_at_anchor="200"),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_closing"),
    )

    allocations = _collect_allocations(moves)
    assert allocations[("W1", "main")] == _dec(100)
    closing_after = {"W1": _dec(100) + allocations[("W1", "main")], "W2": _dec(200)}
    assert abs(closing_after["W1"] - closing_after["W2"]) <= _dec(1)


def test_allow_overfill_false_caps_at_std() -> None:
    rows = [
        _make_row("W1", "main", closing="200", std="300", gap="-100"),
        _make_row("W2", "main", closing="200", std="300", gap="-100"),
        _make_row("W1", "secondary", closing="250", std="0", gap="200", stock_at_anchor="250"),
        _make_row("W2", "secondary", closing="250", std="0", gap="200", stock_at_anchor="250"),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_closing"),
    )

    allocations = _collect_allocations(moves)
    final_closing = {
        "W1": _dec(200) + allocations[("W1", "main")],
        "W2": _dec(200) + allocations[("W2", "main")],
    }
    assert final_closing["W1"] <= _dec(300)
    assert final_closing["W2"] <= _dec(300)


def test_equalize_ratio_start_prefers_lower_start_ratio() -> None:
    rows = [
        _make_row("W1", "main", closing="120", std="300", gap="-180", stock_at_anchor="280"),
        _make_row("W2", "main", closing="120", std="300", gap="-180", stock_at_anchor="60"),
        _make_row("W1", "secondary", closing="200", std="0", gap="50", stock_at_anchor="200"),
        _make_row("W2", "secondary", closing="200", std="0", gap="50", stock_at_anchor="200"),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_start"),
    )

    allocations = _collect_allocations(moves)
    assert allocations[("W2", "main")] >= allocations[("W1", "main")]


def test_main_donors_ignored_when_policy_disallows() -> None:
    rows = [
        _make_row("W1", "main", closing="100", std="300", gap="-200"),
        _make_row("W2", "main", closing="400", std="300", gap="100"),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_closing", take_from_other_main=False),
    )

    assert moves == []


def test_rounding_mode_affects_integer_allocation() -> None:
    rows = [
        _make_row("W1", "main", closing="90", std="100", gap="-10"),
        _make_row("W2", "main", closing="90", std="100", gap="-10"),
        _make_row("W3", "secondary", closing="50", std="0", gap="1", stock_at_anchor="50"),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    floor_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_closing", rounding_mode="floor"),
    )
    ceil_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=_policy(fair_share_mode="equalize_ratio_closing", rounding_mode="ceil"),
    )

    floor_allocations = _collect_allocations(floor_moves)
    ceil_allocations = _collect_allocations(ceil_moves)
    assert floor_allocations[("W1", "main")] == _dec(1)
    assert floor_allocations[("W2", "main")] == _dec(0)
    assert ceil_allocations[("W1", "main")] == _dec(0)
    assert ceil_allocations[("W2", "main")] == _dec(1)
