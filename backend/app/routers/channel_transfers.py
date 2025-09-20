"""Channel transfer API routes."""
from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


def _get_transfer_or_404(
    db: DBSession,
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
) -> models.ChannelTransfer:
    transfer = db.get(
        models.ChannelTransfer,
        (session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel),
    )
    if transfer is None:
        raise HTTPException(status_code=404, detail="channel transfer not found")
    return transfer


@router.get("", response_model=list[schemas.ChannelTransferRead])
@router.get("/", response_model=list[schemas.ChannelTransferRead])
def list_channel_transfers(
    *,
    session_id: UUID | None = None,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: DBSession = Depends(get_db),
) -> list[schemas.ChannelTransferRead]:
    """List channel transfer records matching the provided filters."""

    query = select(models.ChannelTransfer)

    if session_id is not None:
        query = query.where(models.ChannelTransfer.session_id == session_id)
    if sku_code:
        lowered = sku_code.lower()
        query = query.where(func.lower(models.ChannelTransfer.sku_code).like(f"%{lowered}%"))
    if warehouse_name:
        lowered = warehouse_name.lower()
        query = query.where(
            func.lower(models.ChannelTransfer.warehouse_name).like(f"%{lowered}%")
        )

    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    if start_date is not None:
        query = query.where(models.ChannelTransfer.transfer_date >= start_date)
    if end_date is not None:
        query = query.where(models.ChannelTransfer.transfer_date <= end_date)

    query = query.order_by(
        models.ChannelTransfer.transfer_date.asc(),
        models.ChannelTransfer.sku_code.asc(),
        models.ChannelTransfer.warehouse_name.asc(),
        models.ChannelTransfer.from_channel.asc(),
        models.ChannelTransfer.to_channel.asc(),
    )

    return list(db.scalars(query))


@router.post("", response_model=schemas.ChannelTransferRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=schemas.ChannelTransferRead, status_code=status.HTTP_201_CREATED)
def create_channel_transfer(
    payload: schemas.ChannelTransferCreate, db: DBSession = Depends(get_db)
) -> schemas.ChannelTransferRead:
    """Create a new channel transfer entry."""

    session = db.get(models.Session, payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    if payload.from_channel == payload.to_channel:
        raise HTTPException(status_code=400, detail="from_channel and to_channel must differ")

    transfer = models.ChannelTransfer(**payload.model_dump())
    db.add(transfer)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="channel transfer already exists") from exc

    db.refresh(transfer)
    return transfer


@router.put(
    "/{session_id}/{sku_code}/{warehouse_name}/{transfer_date}/{from_channel}/{to_channel}",
    response_model=schemas.ChannelTransferRead,
)
def update_channel_transfer(
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
    payload: schemas.ChannelTransferUpdate,
    db: DBSession = Depends(get_db),
) -> schemas.ChannelTransferRead:
    """Update an existing channel transfer entry."""

    transfer = _get_transfer_or_404(
        db,
        session_id=session_id,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        transfer_date=transfer_date,
        from_channel=from_channel,
        to_channel=to_channel,
    )

    update_values = payload.model_dump(exclude_unset=True)

    if "from_channel" in update_values and "to_channel" in update_values:
        if update_values["from_channel"] == update_values["to_channel"]:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )
    elif "from_channel" in update_values:
        if update_values["from_channel"] == transfer.to_channel:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )
    elif "to_channel" in update_values:
        if transfer.from_channel == update_values["to_channel"]:
            raise HTTPException(
                status_code=400, detail="from_channel and to_channel must differ"
            )

    for field, value in update_values.items():
        setattr(transfer, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="channel transfer already exists") from exc

    db.refresh(transfer)
    return transfer


@router.delete(
    "/{session_id}/{sku_code}/{warehouse_name}/{transfer_date}/{from_channel}/{to_channel}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_channel_transfer(
    *,
    session_id: UUID,
    sku_code: str,
    warehouse_name: str,
    transfer_date: date,
    from_channel: str,
    to_channel: str,
    db: DBSession = Depends(get_db),
) -> Response:
    """Remove a channel transfer entry."""

    transfer = _get_transfer_or_404(
        db,
        session_id=session_id,
        sku_code=sku_code,
        warehouse_name=warehouse_name,
        transfer_date=transfer_date,
        from_channel=from_channel,
        to_channel=to_channel,
    )

    db.delete(transfer)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
