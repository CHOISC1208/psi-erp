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
    deficit_basis: str = "closing",
) -> ReallocationPolicyData:
    return ReallocationPolicyData(
        take_from_other_main=take_from_other_main,
        rounding_mode=rounding_mode,  # type: ignore[arg-type]
        allow_overfill=allow_overfill,
        fair_share_mode=fair_share_mode,  # type: ignore[arg-type]
        deficit_basis=deficit_basis,  # type: ignore[arg-type]
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
    w1_received = allocations.get(("W1", "main"), _dec(0))
    w2_received = allocations.get(("W2", "main"), _dec(0))
    closing_after = {
        "W1": _dec(100) + w1_received,
        "W2": _dec(200) + w2_received,
    }
    assert abs(closing_after["W1"] - closing_after["W2"]) <= _dec(2)
    assert w1_received + w2_received == _dec(200)
    assert w1_received >= w2_received


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


def test_fair_share_respects_deficit_basis() -> None:
    rows = [
        _make_row(
            "W1",
            "main",
            closing="110",
            std="100",
            gap="-50",
            stock_at_anchor="50",
        ),
        _make_row("W2", "main", closing="100", std="100", gap="0"),
        _make_row(
            "W1",
            "secondary",
            closing="200",
            std="0",
            gap="200",
            stock_at_anchor="200",
        ),
    ]
    warehouse_main_channels = {"W1": "main", "W2": "main"}
    closing_policy = _policy(fair_share_mode="equalize_ratio_closing", deficit_basis="closing")
    start_policy = _policy(fair_share_mode="equalize_ratio_closing", deficit_basis="start")

    closing_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=closing_policy,
    )
    start_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=start_policy,
    )

    assert closing_moves == []
    assert _collect_allocations(start_moves)[("W1", "main")] == _dec(50)


def test_deficit_basis_switches_shortage_detection() -> None:
    rows = [
        _make_row(
            "W1",
            "main",
            closing="140",
            std="120",
            gap="-40",
            stock_at_anchor="80",
        ),
        _make_row(
            "W1",
            "secondary",
            closing="160",
            std="0",
            gap="160",
            stock_at_anchor="160",
        ),
    ]
    warehouse_main_channels = {"W1": "main"}

    closing_policy = _policy(fair_share_mode="off", deficit_basis="closing")
    start_policy = _policy(fair_share_mode="off", deficit_basis="start")

    closing_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=closing_policy,
    )
    start_moves = recommend_plan_lines(
        rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=start_policy,
    )

    assert closing_moves == []
    assert len(start_moves) == 1
    move = start_moves[0]
    assert move.qty == _dec(40)
    assert move.to_channel == "main"
    assert move.from_channel == "secondary"
