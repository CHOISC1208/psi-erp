"""Pydantic schemas for API payloads."""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field


class SessionBase(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=255)]
    description: str | None = None


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=255)] | None = None
    description: str | None = None
    is_leader: bool | None = None


class SessionRead(SessionBase):
    id: str
    is_leader: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DailyPSI(BaseModel):
    date: date
    production: float
    sales: float
    net_change: float
    projected_inventory: float
    reported_inventory: float | None = None


class PSIUploadResult(BaseModel):
    rows_imported: int
    session_id: str | None
    dates: list[date]
