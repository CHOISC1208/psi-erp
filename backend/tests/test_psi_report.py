import sys
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_build_pivot_rows_handles_missing_inventory_days():
    from backend.app import schemas
    from backend.app.services.psi_report import build_pivot_rows

    channel = schemas.ChannelDailyPSI(
        sku_code="SKU-1",
        sku_name="Sample",
        category_1="Apparel",
        category_2="Outer",
        category_3="Coat",
        fw_rank=1,
        ss_rank=3,
        warehouse_name="WH-A",
        channel="Online",
        daily=[
            schemas.DailyPSI(
                date=date(2024, 1, 1),
                stock_at_anchor=10,
                inbound_qty=5,
                outbound_qty=3,
                net_flow=2,
                stock_closing=12,
                safety_stock=4,
                movable_stock=8,
            )
        ],
    )

    result = build_pivot_rows([channel], target_days_ahead=14)

    assert result.rows[0].inventory_days is None
    assert result.rows[0].category_1 == "Apparel"
    assert result.rows[0].fw_rank == 1
    assert result.rows[0].ss_rank == 3
