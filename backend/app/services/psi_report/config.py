"""Configuration models for PSI report generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


def _normalise_priority_channels(priority: Iterable[str] | None) -> list[str] | None:
    if priority is None:
        return None
    seen: set[str] = set()
    ordered: list[str] = []
    for channel in priority:
        normalised = channel.strip()
        if not normalised:
            continue
        lowered = normalised.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        ordered.append(lowered)
    return ordered or None


@dataclass(slots=True)
class Settings:
    """Runtime tunables for the PSI report pipeline."""

    lead_time_days: int = 2
    safety_buffer_days: float = 0.0
    min_move_qty: float = 0.0
    target_days_ahead: int = 14
    priority_channels: list[str] | None = field(default=None, repr=False)

    def __post_init__(self) -> None:  # pragma: no cover - defensive validation
        if self.lead_time_days < 0:
            raise ValueError("lead_time_days must be >= 0")
        if self.safety_buffer_days < 0:
            raise ValueError("safety_buffer_days must be >= 0")
        if self.min_move_qty < 0:
            raise ValueError("min_move_qty must be >= 0")
        if self.target_days_ahead <= 0:
            raise ValueError("target_days_ahead must be > 0")
        self.priority_channels = _normalise_priority_channels(self.priority_channels)
