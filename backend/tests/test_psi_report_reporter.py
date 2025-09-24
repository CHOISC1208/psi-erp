import sys
from datetime import date, datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app import schemas
from backend.app.services.psi_report import (
    PivotRow,
    Settings,
    build_summary_md,
    detect_stockout_risk,
    suggest_channel_transfers,
)


def test_build_summary_md_handles_missing_warehouse_name() -> None:
    cfg = Settings()
    rows = [
        PivotRow(
            sku_code="SKU-001",
            sku_name="Sample",
            warehouse_name=None,
            channel="EC",
            date=date(2024, 1, 1),
            stock_closing=-5.0,
            inbound_qty=0.0,
            outbound_qty=5.0,
            channel_move=0.0,
            safety_stock=0.0,
            inventory_days=None,
        ),
        PivotRow(
            sku_code="SKU-001",
            sku_name="Sample",
            warehouse_name=None,
            channel="店舗",
            date=date(2024, 1, 1),
            stock_closing=10.0,
            inbound_qty=0.0,
            outbound_qty=0.0,
            channel_move=0.0,
            safety_stock=0.0,
            inventory_days=None,
        ),
    ]

    risks = detect_stockout_risk(rows, cfg)
    transfers = suggest_channel_transfers(rows, cfg)
    report = build_summary_md(
        risks,
        transfers,
        rows,
        cfg,
        generated_at=datetime(2024, 1, 2, 9, 30, tzinfo=timezone.utc),
    )

    assert "### 未設定倉庫" in report
    assert "| 2024-01-01 | 未設定倉庫 |" in report


def test_channel_daily_psi_accepts_missing_warehouse_name() -> None:
    channel = schemas.ChannelDailyPSI(
        sku_code="SKU-001",
        sku_name="Sample",
        warehouse_name=None,
        channel="EC",
        daily=[
            schemas.DailyPSI(
                date=date(2024, 1, 1),
                stock_closing=5.0,
            )
        ],
    )

    assert channel.warehouse_name is None
