"""Endpoints for the Test_Algo sandbox page."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .. import models
from ..deps import get_db
from ..services.reallocation_policy import get_reallocation_policy
from ..services.transfer_logic import MatrixRowData, recommend_plan_lines
from ..services.transfer_plans import fetch_main_channel_map

router = APIRouter()


ZERO = Decimal("0")


@dataclass(slots=True)
class _PreparedRow:
    """Normalized payload ready to be converted into ``MatrixRowData``."""

    sku_code: str
    sku_name: str | None
    warehouse_name: str
    channel: str
    stock_start: Decimal
    inbound: Decimal
    outbound: Decimal
    stock_closing: Decimal
    std_stock: Decimal

    def to_matrix_row(self) -> MatrixRowData:
        gap = self.stock_start - self.std_stock
        move = ZERO
        stock_fin = self.stock_closing + move
        return MatrixRowData(
            sku_code=self.sku_code,
            sku_name=self.sku_name,
            warehouse_name=self.warehouse_name,
            channel=self.channel,
            stock_at_anchor=self.stock_start,
            inbound_qty=self.inbound,
            outbound_qty=self.outbound,
            stock_closing=self.stock_closing,
            stdstock=self.std_stock,
            gap=gap,
            move=move,
            stock_fin=stock_fin,
        )


class MetadataWarehouse(BaseModel):
    warehouse_name: str
    main_channel: str | None = None


class MetadataResponse(BaseModel):
    warehouses: list[MetadataWarehouse]
    channels: list[str]


class TestAlgoRow(BaseModel):
    sku_code: str = Field(..., min_length=1)
    sku_name: str | None = None
    warehouse_name: str = Field(..., min_length=1)
    channel: str = Field(..., min_length=1)
    stock_start: Decimal
    inbound: Decimal
    outbound: Decimal
    stock_closing: Decimal
    std_stock: Decimal


class TestAlgoRunRequest(BaseModel):
    rows: list[TestAlgoRow]

    model_config = {"json_schema_extra": {"example": {"rows": []}}}


class RecommendedMovePayload(BaseModel):
    sku_code: str
    from_warehouse: str
    from_channel: str
    to_warehouse: str
    to_channel: str
    qty: float
    reason: str


class MatrixRowPayload(BaseModel):
    sku_code: str
    sku_name: str | None = None
    warehouse_name: str
    channel: str
    stock_at_anchor: float
    inbound_qty: float
    outbound_qty: float
    stock_closing: float
    stdstock: float
    gap: float
    move: float
    stock_fin: float


class TestAlgoRunResponse(BaseModel):
    matrix_rows: list[MatrixRowPayload]
    recommended_moves: list[RecommendedMovePayload]


def _prepare_rows(payload: Iterable[TestAlgoRow]) -> list[_PreparedRow]:
    prepared: list[_PreparedRow] = []
    for row in payload:
        prepared.append(
            _PreparedRow(
                sku_code=row.sku_code.strip(),
                sku_name=row.sku_name.strip() if row.sku_name else None,
                warehouse_name=row.warehouse_name.strip(),
                channel=row.channel.strip(),
                stock_start=row.stock_start,
                inbound=row.inbound,
                outbound=row.outbound,
                stock_closing=row.stock_closing,
                std_stock=row.std_stock,
            )
        )
    return prepared


@router.get("/metadata", response_model=MetadataResponse)
def get_metadata(db: DBSession = Depends(get_db)) -> MetadataResponse:
    """Return warehouse and channel master values for the sandbox."""

    warehouses = db.scalars(select(models.WarehouseMaster)).all()
    channels = db.scalars(select(models.ChannelMaster.channel).order_by(models.ChannelMaster.channel)).all()
    channel_list = [channel for channel in channels if channel]
    return MetadataResponse(
        warehouses=[
            MetadataWarehouse(warehouse_name=record.warehouse_name, main_channel=record.main_channel)
            for record in warehouses
        ],
        channels=channel_list,
    )


@router.post("/run", response_model=TestAlgoRunResponse)
def run_test_algo(payload: TestAlgoRunRequest, db: DBSession = Depends(get_db)) -> TestAlgoRunResponse:
    """Execute the recommendation algorithm for ad-hoc PSI rows."""

    if not payload.rows:
        raise HTTPException(status_code=422, detail="At least one row is required")

    prepared_rows = _prepare_rows(payload.rows)
    matrix_rows = [row.to_matrix_row() for row in prepared_rows]

    warehouse_names = {row.warehouse_name for row in prepared_rows}
    warehouse_main_channels = fetch_main_channel_map(db, warehouses=warehouse_names)
    policy = get_reallocation_policy(db)
    recommended = recommend_plan_lines(
        matrix_rows,
        warehouse_main_channels=warehouse_main_channels,
        policy=policy,
    )

    return TestAlgoRunResponse(
        matrix_rows=[
            MatrixRowPayload(
                sku_code=row.sku_code,
                sku_name=row.sku_name,
                warehouse_name=row.warehouse_name,
                channel=row.channel,
                stock_at_anchor=float(row.stock_at_anchor),
                inbound_qty=float(row.inbound_qty),
                outbound_qty=float(row.outbound_qty),
                stock_closing=float(row.stock_closing),
                stdstock=float(row.stdstock),
                gap=float(row.gap),
                move=float(row.move),
                stock_fin=float(row.stock_fin),
            )
            for row in matrix_rows
        ],
        recommended_moves=[
            RecommendedMovePayload(
                sku_code=move.sku_code,
                from_warehouse=move.from_warehouse,
                from_channel=move.from_channel,
                to_warehouse=move.to_warehouse,
                to_channel=move.to_channel,
                qty=float(move.qty),
                reason=move.reason,
            )
            for move in recommended
        ],
    )
