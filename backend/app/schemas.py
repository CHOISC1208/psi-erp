"""Pydantic schemas for API payloads."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID
from typing import Annotated

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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DailyPSI(BaseModel):
    """Aggregated PSI metrics for a single day."""

    date: date
    stock_at_anchor: float | None = None
    inbound_qty: float | None = None
    outbound_qty: float | None = None
    net_flow: float | None = None
    stock_closing: float | None = None
    safety_stock: float | None = None
    movable_stock: float | None = None


class PSIUploadResult(BaseModel):
    """Upload summary returned after processing a PSI CSV file."""

    rows_imported: int
    session_id: str
    dates: list[date]
