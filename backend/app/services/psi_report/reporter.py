"""Markdown report builder for PSI insights."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Sequence

from .analysis import StockoutRisk
from .config import Settings
from .data import PivotRow
from .transfer import TransferSuggestion


@dataclass(slots=True)
class WarehouseCoverage:
    warehouse_name: str
    first_stockout: date | None
    coverage_start: date | None
    coverage_end: date | None
    coverage_reason: str | None
    transfer_summary: list[tuple[str, str, float]]


def _format_date(value: date | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%Y-%m-%d")


def _format_quantity(value: float) -> str:
    return f"{value:,.0f}" if abs(value) >= 1 else f"{value:,.2f}"


def _normalise_warehouse_name(value: str | None) -> str:
    if value is None:
        return "未設定倉庫"
    stripped = value.strip()
    return stripped or "未設定倉庫"


def _warehouse_transfer_summary(
    transfers: Sequence[TransferSuggestion], warehouse: str | None
) -> list[tuple[str, str, float]]:
    grouped: dict[tuple[str, str], float] = defaultdict(float)
    for transfer in transfers:
        if transfer.warehouse_name != warehouse:
            continue
        grouped[(transfer.from_channel, transfer.to_channel)] += transfer.quantity
    summary: list[tuple[str, str, float]] = []
    for (from_channel, to_channel), qty in sorted(grouped.items(), key=lambda item: (-item[1], item[0])):
        summary.append((from_channel, to_channel, qty))
    return summary


def _coverage_reason(row: StockoutRisk) -> str:
    if row.total_surplus <= row.total_deficit:
        return "余剰不足（移動では不足量を満たせません）"
    return "総在庫不足（全チャネル合計がマイナス）"


def _compute_warehouse_coverage(
    warehouse: str | None,
    sku_code: str,
    risks: Sequence[StockoutRisk],
    transfers: Sequence[TransferSuggestion],
) -> WarehouseCoverage:
    relevant = sorted(
        (row for row in risks if row.warehouse_name == warehouse and row.sku_code == sku_code),
        key=lambda item: item.date,
    )
    first = next((row for row in relevant if row.has_deficit), None)
    display_name = _normalise_warehouse_name(warehouse)

    if first is None:
        return WarehouseCoverage(
            warehouse_name=display_name,
            first_stockout=None,
            coverage_start=None,
            coverage_end=None,
            coverage_reason=None,
            transfer_summary=_warehouse_transfer_summary(transfers, warehouse),
        )

    coverage_start = first.date if first.can_fully_cover else None
    coverage_end = first.date if first.can_fully_cover else None
    reason = None

    if first.can_fully_cover:
        last_covered = first.date
        for row in relevant:
            if row.date < first.date or not row.has_deficit:
                continue
            if not row.can_fully_cover:
                reason = _coverage_reason(row)
                break
            gap = (row.date - last_covered).days
            if gap > 1:
                reason = "不足日が連続していないため逐次移動でのカバーが困難です"
                break
            coverage_end = row.date
            last_covered = row.date
        if reason is None and coverage_start is not None and coverage_end is not None:
            max_deficit_date = max((row.date for row in relevant if row.has_deficit), default=coverage_end)
            if coverage_end < max_deficit_date:
                trailing = next(
                    (row for row in relevant if row.date > coverage_end and row.has_deficit),
                    None,
                )
                if trailing is not None:
                    reason = _coverage_reason(trailing)
    else:
        reason = _coverage_reason(first)

    return WarehouseCoverage(
        warehouse_name=display_name,
        first_stockout=first.date,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        coverage_reason=reason,
        transfer_summary=_warehouse_transfer_summary(transfers, warehouse),
    )


def _risk_table_rows(risks: Sequence[StockoutRisk], limit: int) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in risks:
        if not row.has_deficit:
            continue
        rows.append(
            [
                _format_date(row.date),
                _normalise_warehouse_name(row.warehouse_name),
                _format_quantity(row.total_stock),
                _format_quantity(row.total_deficit),
                _format_quantity(row.total_surplus),
                "○" if row.can_fully_cover else "×",
            ]
        )
        if len(rows) >= limit:
            break
    return rows


def _transfer_table_rows(transfers: Sequence[TransferSuggestion], limit: int) -> list[list[str]]:
    rows: list[list[str]] = []
    for transfer in transfers[:limit]:
        rows.append(
            [
                transfer.date.strftime("%Y-%m-%d"),
                _normalise_warehouse_name(transfer.warehouse_name),
                f"{transfer.from_channel} → {transfer.to_channel}",
                _format_quantity(transfer.quantity),
            ]
        )
    return rows


def _render_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    if not rows:
        return ["(該当なし)"]
    header_line = " | ".join(headers)
    separator = " | ".join(["---"] * len(headers))
    lines = [f"| {header_line} |", f"| {separator} |"]
    for row in rows:
        lines.append(f"| {' | '.join(row)} |")
    return lines


def build_summary_md(
    risks: Sequence[StockoutRisk],
    transfers: Sequence[TransferSuggestion],
    rows: Sequence[PivotRow],
    cfg: Settings,
    *,
    generated_at: datetime,
) -> str:
    if not rows:
        return "# 在庫移動レポート\n\n対象データが見つかりませんでした。"

    sku_code = rows[0].sku_code
    sku_name = rows[0].sku_name
    start_date = min(row.date for row in rows)
    end_date = max(row.date for row in rows)
    warehouses = sorted(
        {row.warehouse_name for row in rows}, key=_normalise_warehouse_name
    )

    lines: list[str] = []
    lines.append(f"# 在庫移動レポート — SKU: {sku_code}")
    if sku_name:
        lines.append(f"**商品名**: {sku_name}")
    lines.append(f"**対象期間**: {_format_date(start_date)} 〜 {_format_date(end_date)}")
    lines.append(
        "**生成日時**: " + generated_at.strftime("%Y-%m-%d %H:%M")
    )
    lines.append(
        f"**設定**: LT={cfg.lead_time_days}日 / 安全在庫バッファ={cfg.safety_buffer_days}日 / 最小移動={cfg.min_move_qty} / 先読み={cfg.target_days_ahead}日"
    )
    if cfg.priority_channels:
        lines.append("**優先チャネル**: " + ", ".join(cfg.priority_channels))
    lines.append("")

    lines.append("## 倉庫別ハイライト")
    for warehouse in warehouses:
        coverage = _compute_warehouse_coverage(warehouse, sku_code, risks, transfers)
        lines.append(f"### {coverage.warehouse_name}")
        lines.append(f"- 初回欠品日: {_format_date(coverage.first_stockout)}")
        lines.append(
            f"- 移動で賄える期間: {_format_date(coverage.coverage_start)} 〜 {_format_date(coverage.coverage_end)}"
        )
        if coverage.coverage_reason:
            lines.append(f"- 賄えない理由: {coverage.coverage_reason}")
        summary_lines = coverage.transfer_summary
        if summary_lines:
            lines.append("- 推奨移動合計:")
            for from_channel, to_channel, qty in summary_lines:
                lines.append(
                    f"  - {from_channel} → {to_channel}: {_format_quantity(qty)}"
                )
        else:
            lines.append("- 推奨移動合計: (提案なし)")
        lines.append("")

    lines.append("## 欠品リスク一覧 (上位10件)")
    risk_rows = _risk_table_rows(risks, limit=10)
    lines.extend(_render_table(["日付", "倉庫", "総在庫", "不足合計", "余剰合計", "移動で解消"], risk_rows))
    lines.append("")

    lines.append("## 移動提案一覧 (上位10件)")
    transfer_rows = _transfer_table_rows(transfers, limit=10)
    lines.extend(_render_table(["移動日", "倉庫", "移動方向", "数量"], transfer_rows))
    lines.append("")

    lines.append("## 担当者向けアクション")
    actionable_transfers = len(transfers)
    actionable_warehouses = sum(1 for warehouse in warehouses if any(t.warehouse_name == warehouse for t in transfers))
    if actionable_transfers:
        lines.append(f"- チャネル移動を {actionable_transfers} 件確認し、倉庫担当へ共有してください。")
    else:
        lines.append("- 現時点で移動提案はありません。欠品動向をモニタリングしてください。")
    lines.append(
        "- 在庫バランスを確認し、補充計画や入荷前倒しが可能か検討してください。"
    )
    if actionable_warehouses:
        lines.append(f"- 特に {actionable_warehouses} 倉庫で不足が顕在化しています。現場と連携し対応状況を追跡してください。")

    return "\n".join(lines)
