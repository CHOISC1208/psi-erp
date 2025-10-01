"""CRUD endpoints for warehouse master records."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


def _normalize_required(value: str, field_name: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail=f"{field_name} cannot be blank")
    return trimmed


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


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


@router.post("", response_model=schemas.WarehouseMasterRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=schemas.WarehouseMasterRead, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    payload: schemas.WarehouseMasterCreate, db: DBSession = Depends(get_db)
) -> schemas.WarehouseMasterRead:
    """Create a new warehouse master record."""

    warehouse_name = _normalize_required(payload.warehouse_name, "warehouse_name")
    region = _normalize_optional(payload.region)
    main_channel = _normalize_optional(payload.main_channel)

    record = models.WarehouseMaster(
        warehouse_name=warehouse_name,
        region=region,
        main_channel=main_channel,
    )

    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="warehouse already exists") from exc

    db.refresh(record)
    return record


@router.put("/{warehouse_name}", response_model=schemas.WarehouseMasterRead)
def update_warehouse(
    warehouse_name: str,
    payload: schemas.WarehouseMasterUpdate,
    db: DBSession = Depends(get_db),
) -> schemas.WarehouseMasterRead:
    """Update an existing warehouse master record."""

    record = db.get(models.WarehouseMaster, warehouse_name)
    if record is None:
        raise HTTPException(status_code=404, detail="warehouse not found")

    update_values = payload.model_dump(exclude_unset=True)

    if "warehouse_name" in update_values:
        update_values["warehouse_name"] = _normalize_required(
            update_values["warehouse_name"], "warehouse_name"
        )
    if "region" in update_values:
        update_values["region"] = _normalize_optional(update_values["region"])
    if "main_channel" in update_values:
        update_values["main_channel"] = _normalize_optional(update_values["main_channel"])

    new_name = update_values.get("warehouse_name", record.warehouse_name)
    if new_name != record.warehouse_name:
        existing = db.get(models.WarehouseMaster, new_name)
        if existing is not None:
            raise HTTPException(status_code=409, detail="warehouse already exists")

    for field, value in update_values.items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    return record


@router.delete(
    "/{warehouse_name}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_warehouse(warehouse_name: str, db: DBSession = Depends(get_db)) -> Response:
    """Remove a warehouse master record."""

    record = db.get(models.WarehouseMaster, warehouse_name)
    if record is None:
        raise HTTPException(status_code=404, detail="warehouse not found")

    db.delete(record)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
