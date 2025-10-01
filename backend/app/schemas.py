"""Pydantic schemas for API payloads."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SessionBase(BaseModel):
    """Shared attributes for session write models."""

    title: Annotated[str, Field(min_length=1, max_length=255)]
    description: str | None = None


class SessionCreate(SessionBase):
    """Schema for creating a session."""

    pass


class SessionUpdate(BaseModel):
    """Schema for updating mutable session fields."""

    title: Annotated[str, Field(min_length=1, max_length=255)] | None = None
    description: str | None = None
    is_leader: bool | None = None


class SessionRead(SessionBase):
    """Session data returned by the API."""

    #id: str
    id: UUID
    is_leader: bool
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_by_username: str | None = None
    updated_by_username: str | None = None

    model_config = {"from_attributes": True}


class DailyPSI(BaseModel):
    """Aggregated PSI metrics for a single day."""

    date: date
    stock_at_anchor: float | None = None
    inbound_qty: float | None = None
    outbound_qty: float | None = None
    channel_move: float | None = None
    net_flow: float | None = None
    stock_closing: float | None = None
    safety_stock: float | None = None
    movable_stock: float | None = None
    stdstock: float | None = None
    gap: float | None = None
    inventory_days: float | None = None


class ChannelDailyPSI(BaseModel):
    """Daily PSI metrics grouped by SKU, warehouse, and channel."""

    sku_code: str
    sku_name: str | None = None
    category_1: str | None = None
    category_2: str | None = None
    category_3: str | None = None
    fw_rank: str | None = None
    ss_rank: str | None = None
    warehouse_name: str
    channel: str
    daily: list[DailyPSI]


class PSIUploadResult(BaseModel):
    """Upload summary returned after processing a PSI CSV file."""

    rows_imported: int
    session_id: UUID
    dates: list[date]


class PSIEditEntry(BaseModel):
    """Single PSI edit submitted from the UI."""

    sku_code: str
    warehouse_name: str
    channel: str
    date: date
    inbound_qty: float | None = None
    outbound_qty: float | None = None
    safety_stock: float | None = None


class PSIEditApplyRequest(BaseModel):
    """Payload describing the edits to apply."""

    edits: list[PSIEditEntry]


class PSIEditApplyResult(BaseModel):
    """Summary response after persisting manual PSI edits."""

    applied: int
    log_entries: int
    last_edited_by: UUID | None = None
    last_edited_by_username: str | None = None
    last_edited_at: datetime | None = None


class PSIEditRead(BaseModel):
    """PSI edit entry returned by the API."""

    id: int
    session_id: UUID
    sku_code: str
    warehouse_name: str
    channel: str
    date: date
    inbound_qty: float | None = None
    outbound_qty: float | None = None
    safety_stock: float | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_by_username: str | None = None
    updated_by_username: str | None = None

    model_config = {"from_attributes": True}


class PSISessionSummary(BaseModel):
    """High-level information about the available PSI data for a session."""

    session_id: UUID
    start_date: date | None = None
    end_date: date | None = None


class PSIReportSettings(BaseModel):
    """Configuration snapshot returned with generated reports."""

    lead_time_days: int
    safety_buffer_days: float
    min_move_qty: float
    target_days_ahead: int
    priority_channels: list[str] | None = None


class PSIReportResponse(BaseModel):
    """Markdown report produced for a SKU within a session."""

    sku_code: str
    sku_name: str | None = None
    generated_at: datetime
    report_markdown: str
    settings: PSIReportSettings


class MasterRecordBase(BaseModel):
    """Shared attributes for master record write models."""

    data: dict[str, Any]


class MasterRecordCreate(MasterRecordBase):
    """Schema for creating a master record."""

    pass


class MasterRecordUpdate(BaseModel):
    """Schema for updating a master record."""

    data: dict[str, Any]


class MasterRecordRead(MasterRecordBase):
    """Master record data returned by the API."""

    id: UUID
    master_type: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WarehouseMasterBase(BaseModel):
    """Shared attributes for warehouse master payloads."""

    warehouse_name: Annotated[str, Field(min_length=1)]
    region: Annotated[str | None, Field(default=None)] = None
    main_channel: Annotated[str | None, Field(default=None)] = None


class WarehouseMasterCreate(WarehouseMasterBase):
    """Schema for creating a warehouse master record."""

    pass


class WarehouseMasterUpdate(BaseModel):
    """Schema for updating mutable warehouse master fields."""

    warehouse_name: Annotated[str, Field(min_length=1)] | None = None
    region: str | None = None
    main_channel: str | None = None


class WarehouseMasterRead(WarehouseMasterBase):
    """Warehouse metadata returned by the warehouse master endpoint."""

    model_config = {"from_attributes": True}


class PSIMetricBase(BaseModel):
    """Shared attributes for PSI metric definitions."""

    name: Annotated[str, Field(min_length=1, max_length=255)]
    is_editable: bool = False
    display_order: Annotated[int, Field(ge=0)]


class PSIMetricCreate(PSIMetricBase):
    """Schema for creating a PSI metric definition."""

    pass


class PSIMetricUpdate(BaseModel):
    """Schema for updating a PSI metric definition."""

    name: Annotated[str, Field(min_length=1, max_length=255)] | None = None
    is_editable: bool | None = None
    display_order: Annotated[int, Field(ge=0)] | None = None


class PSIMetricRead(PSIMetricBase):
    """PSI metric definition returned by the API."""

    model_config = {"from_attributes": True}


class CategoryRankParameterBase(BaseModel):
    """Shared attributes for category rank parameter payloads."""

    rank_type: Annotated[str, Field(min_length=1)]
    category_1: Annotated[str, Field(min_length=1)]
    category_2: Annotated[str, Field(min_length=1)]
    threshold: Annotated[Decimal, Field(max_digits=20, decimal_places=6)]


class CategoryRankParameterCreate(CategoryRankParameterBase):
    """Schema for creating a category rank parameter."""

    pass


class CategoryRankParameterUpdate(BaseModel):
    """Schema for updating a category rank parameter."""

    rank_type: Annotated[str, Field(min_length=1)] | None = None
    category_1: Annotated[str, Field(min_length=1)] | None = None
    category_2: Annotated[str, Field(min_length=1)] | None = None
    threshold: Annotated[Decimal, Field(max_digits=20, decimal_places=6)] | None = None


class CategoryRankParameterRead(CategoryRankParameterBase):
    """Category rank parameter returned by the API."""

    model_config = {"from_attributes": True}


class ChannelTransferBase(BaseModel):
    """Shared attributes for channel transfer write models."""

    sku_code: str
    warehouse_name: str
    transfer_date: date
    from_channel: str
    to_channel: str
    qty: float
    note: str | None = None


class ChannelTransferCreate(ChannelTransferBase):
    """Schema for creating a channel transfer."""

    session_id: UUID


class ChannelTransferUpdate(BaseModel):
    """Schema for updating a channel transfer."""

    sku_code: str | None = None
    warehouse_name: str | None = None
    transfer_date: date | None = None
    from_channel: str | None = None
    to_channel: str | None = None
    qty: float | None = None
    note: str | None = None


class ChannelTransferRead(ChannelTransferBase):
    """Channel transfer data returned by the API."""

    session_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_by_username: str | None = None
    updated_by_username: str | None = None

    model_config = {"from_attributes": True}


class MatrixRow(BaseModel):
    """Aggregated PSI metrics decorated with plan movements."""

    sku_code: str
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


TransferPlanStatus = Literal["draft", "confirmed", "applied", "cancelled"]


class TransferPlanRead(BaseModel):
    """Transfer plan metadata returned by the API."""

    plan_id: UUID
    session_id: UUID
    start_date: date
    end_date: date
    status: TransferPlanStatus

    model_config = {"from_attributes": True}


class TransferPlanLineBase(BaseModel):
    """Shared attributes for transfer plan line payloads."""

    sku_code: str
    from_warehouse: str
    from_channel: str
    to_warehouse: str
    to_channel: str
    qty: Annotated[float, Field(gt=0)]
    is_manual: bool
    reason: str | None = None


class TransferPlanLineRead(TransferPlanLineBase):
    """Transfer plan line returned by the API."""

    line_id: UUID
    plan_id: UUID

    model_config = {"from_attributes": True}


class TransferPlanLineWrite(TransferPlanLineBase):
    """Transfer plan line submitted from the client."""

    line_id: UUID | None = None
    plan_id: UUID | None = None


class TransferPlanRecommendRequest(BaseModel):
    """Payload describing the scope of a recommendation run."""

    session_id: UUID
    start: date
    end: date
    sku_codes: list[str] | None = None
    warehouses: list[str] | None = None
    channels: list[str] | None = None


class TransferPlanRecommendResponse(BaseModel):
    """Transfer plan created by the recommendation engine."""

    plan: TransferPlanRead
    lines: list[TransferPlanLineRead]


class TransferPlanLineUpsertRequest(BaseModel):
    """Payload for replacing all lines of a transfer plan."""

    lines: list[TransferPlanLineWrite]


class TransferPlanLineUpsertResponse(BaseModel):
    """Simple acknowledgement of a successful upsert operation."""

    ok: bool


class LoginRequest(BaseModel):
    """Login payload for username/password authentication."""

    username: Annotated[str, Field(min_length=1, max_length=150)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class LoginResult(BaseModel):
    """Response returned after a successful login attempt."""

    next: str = "authenticated"
    csrf_token: str | None = None


class UserProfile(BaseModel):
    """Authenticated user information."""

    id: UUID
    username: str
    is_active: bool
    is_admin: bool

    model_config = {"from_attributes": True}


class UserCreateRequest(BaseModel):
    """Payload for creating a new user."""

    username: Annotated[str, Field(min_length=1, max_length=150)]
    password: Annotated[str, Field(min_length=8, max_length=256)]


class UserCreateResult(BaseModel):
    """Response returned after successfully creating a user."""

    id: UUID
    username: str
    is_active: bool
    is_admin: bool
    created_at: datetime
