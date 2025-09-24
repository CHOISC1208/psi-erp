"""Utilities for generating PSI markdown reports."""

from .config import Settings
from .data import PivotRow, build_pivot_rows
from .analysis import detect_stockout_risk, first_stockout_date
from .transfer import suggest_channel_transfers
from .reporter import build_summary_md

__all__ = [
    "Settings",
    "PivotRow",
    "build_pivot_rows",
    "detect_stockout_risk",
    "first_stockout_date",
    "suggest_channel_transfers",
    "build_summary_md",
]
