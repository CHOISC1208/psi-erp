from __future__ import annotations
"""Greedy channel transfer suggestions for PSI reports."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

from .config import Settings
from .data import PivotRow

@dataclass(frozen=True, slots=True)
class TransferSuggestion:
    date: date
    sku_code: str
    sku_name: str | None
    warehouse_name: str
    from_channel: str
    to_channel: str
    quantity: float


def _priority_key(channel: str, priority: list[str] | None) -> tuple[int, str]:
    if priority is None:
        return (0, channel)
    lowered = channel.lower()
    if lowered in priority:
        return (priority.index(lowered), channel)
    return (len(priority), channel)


def _average_outbound(rows: Iterable[PivotRow]) -> float:
    total = 0.0
    count = 0
    for row in rows:
        if row.outbound_qty > 0:
            total += row.outbound_qty
            count += 1
    if count == 0:
        return 0.0
    return total / count


def suggest_channel_transfers(rows: Iterable[PivotRow], cfg: Settings) -> list[TransferSuggestion]:
    grouped: dict[tuple[str, str], list[PivotRow]] = defaultdict(list)
    for row in rows:
        grouped[(row.sku_code, row.warehouse_name)].append(row)

    suggestions: list[TransferSuggestion] = []

    for (sku_code, warehouse_name), entries in grouped.items():
        entries.sort(key=lambda item: (item.date, item.channel))
        channels = sorted({row.channel for row in entries})
        if len(channels) < 2:
            continue

        rows_by_channel_date: dict[tuple[str, date], PivotRow] = {
            (row.channel, row.date): row for row in entries
        }
        dates = sorted({row.date for row in entries})
        outbound_by_channel = {
            channel: _average_outbound(row for row in entries if row.channel == channel)
            for channel in channels
        }

        for current_date in dates:
            stocks: dict[str, float] = {}
            for channel in channels:
                row = rows_by_channel_date.get((channel, current_date))
                stocks[channel] = row.stock_closing if row else 0.0

            deficits = [channel for channel in channels if stocks[channel] < 0]
            if not deficits:
                continue

            surpluses = [channel for channel in channels if stocks[channel] > 0]
            if not surpluses:
                continue

            deficits.sort(
                key=lambda channel: (
                    _priority_key(channel, cfg.priority_channels),
                    stocks[channel],
                )
            )
            surpluses.sort(key=lambda channel: stocks[channel], reverse=True)

            buffer_by_channel = {
                channel: outbound_by_channel[channel] * cfg.safety_buffer_days
                for channel in channels
            }

            planned: dict[tuple[str, str], float] = defaultdict(float)

            for deficit_channel in deficits:
                need = abs(stocks[deficit_channel])
                if need <= 0:
                    continue
                for surplus_channel in surpluses:
                    if surplus_channel == deficit_channel:
                        continue
                    available = max(0.0, stocks[surplus_channel] - buffer_by_channel[surplus_channel])
                    if available <= 0:
                        continue
                    move_qty = min(available, need)
                    if move_qty < cfg.min_move_qty:
                        continue
                    stocks[surplus_channel] -= move_qty
                    stocks[deficit_channel] += move_qty
                    need -= move_qty
                    planned[(surplus_channel, deficit_channel)] += move_qty
                    if need <= 0:
                        break

            if not planned:
                continue

            effective_date = current_date
            if cfg.lead_time_days > 0:
                shifted = current_date - timedelta(days=cfg.lead_time_days)
                earliest_date = dates[0]
                if shifted >= earliest_date:
                    effective_date = shifted

            for (from_channel, to_channel), qty in planned.items():
                suggestions.append(
                    TransferSuggestion(
                        date=effective_date,
                        sku_code=sku_code,
                        sku_name=entries[0].sku_name,
                        warehouse_name=warehouse_name,
                        from_channel=from_channel,
                        to_channel=to_channel,
                        quantity=qty,
                    )
                )

    suggestions.sort(key=lambda item: (item.date, item.warehouse_name, item.from_channel, item.to_channel))
    return suggestions
