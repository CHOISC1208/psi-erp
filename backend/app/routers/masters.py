"""CRUD endpoints for master data records."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()

ALLOWED_MASTER_TYPES = {"products", "customers", "suppliers"}


def _validate_master_type(master_type: str) -> str:
    if master_type not in ALLOWED_MASTER_TYPES:
        raise HTTPException(status_code=404, detail="master not found")
    return master_type


def _get_master_record_or_404(
    db: DBSession, record_id: str, master_type: str
) -> models.MasterRecord:
    try:
        UUID(record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="record not found") from exc

    record = db.get(models.MasterRecord, record_id)
    if record is None or record.master_type != master_type:
        raise HTTPException(status_code=404, detail="record not found")
    return record


@router.get("/{master_type}", response_model=list[schemas.MasterRecordRead])
def list_master_records(
    master_type: str, db: DBSession = Depends(get_db)
) -> list[schemas.MasterRecordRead]:
    validated_master = _validate_master_type(master_type)
    query = (
        select(models.MasterRecord)
        .where(models.MasterRecord.master_type == validated_master)
        .order_by(models.MasterRecord.created_at.desc())
    )
    return db.scalars(query).all()


@router.post(
    "/{master_type}",
    response_model=schemas.MasterRecordRead,
    status_code=status.HTTP_201_CREATED,
)
def create_master_record(
    master_type: str,
    payload: schemas.MasterRecordCreate,
    db: DBSession = Depends(get_db),
) -> schemas.MasterRecordRead:
    validated_master = _validate_master_type(master_type)
    record = models.MasterRecord(master_type=validated_master, data=payload.data)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/{master_type}/{record_id}", response_model=schemas.MasterRecordRead)
def update_master_record(
    master_type: str,
    record_id: str,
    payload: schemas.MasterRecordUpdate,
    db: DBSession = Depends(get_db),
) -> schemas.MasterRecordRead:
    validated_master = _validate_master_type(master_type)
    record = _get_master_record_or_404(db, record_id, validated_master)
    record.data = payload.data
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.delete(
    "/{master_type}/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_master_record(
    master_type: str, record_id: str, db: DBSession = Depends(get_db)
) -> Response:
    validated_master = _validate_master_type(master_type)
    record = _get_master_record_or_404(db, record_id, validated_master)
    db.delete(record)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
