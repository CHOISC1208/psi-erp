"""Read-only endpoints for warehouse master records."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


@router.get("", response_model=list[schemas.WarehouseMasterRead])
@router.get("/", response_model=list[schemas.WarehouseMasterRead])
def list_warehouses(db: DBSession = Depends(get_db)) -> list[schemas.WarehouseMasterRead]:
    """Return all warehouses ordered by name."""

    query = select(models.WarehouseMaster).order_by(models.WarehouseMaster.warehouse_name.asc())
    return db.scalars(query).all()


@router.get("/{warehouse_name}", response_model=schemas.WarehouseMasterRead)
def get_warehouse(
    warehouse_name: str, db: DBSession = Depends(get_db)
) -> schemas.WarehouseMasterRead:
    """Return a single warehouse or raise 404 when missing."""

    record = db.get(models.WarehouseMaster, warehouse_name)
    if record is None:
        raise HTTPException(status_code=404, detail="warehouse not found")
    return record
