"""CRUD API for PSI metric definitions."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


def _get_metric_or_404(db: DBSession, name: str) -> models.PSIMetricDefinition:
    metric = db.get(models.PSIMetricDefinition, name)
    if metric is None:
        raise HTTPException(status_code=404, detail="metric not found")
    return metric


@router.get("/", response_model=list[schemas.PSIMetricRead])
def list_metrics(db: DBSession = Depends(get_db)) -> list[schemas.PSIMetricRead]:
    query = select(models.PSIMetricDefinition).order_by(
        models.PSIMetricDefinition.display_order.asc(),
        models.PSIMetricDefinition.name.asc(),
    )
    return list(db.scalars(query))


@router.post(
    "/",
    response_model=schemas.PSIMetricRead,
    status_code=status.HTTP_201_CREATED,
)
def create_metric(
    payload: schemas.PSIMetricCreate, db: DBSession = Depends(get_db)
) -> schemas.PSIMetricRead:
    existing = db.get(models.PSIMetricDefinition, payload.name)
    if existing is not None:
        raise HTTPException(status_code=409, detail="metric already exists")

    metric = models.PSIMetricDefinition(**payload.model_dump())
    db.add(metric)
    db.commit()
    db.refresh(metric)
    return metric


@router.put("/{metric_name}", response_model=schemas.PSIMetricRead)
def update_metric(
    metric_name: str,
    payload: schemas.PSIMetricUpdate,
    db: DBSession = Depends(get_db),
) -> schemas.PSIMetricRead:
    metric = _get_metric_or_404(db, metric_name)
    update_values = payload.model_dump(exclude_unset=True)

    new_name = update_values.get("name")
    if new_name and new_name != metric_name:
        existing = db.get(models.PSIMetricDefinition, new_name)
        if existing is not None:
            raise HTTPException(status_code=409, detail="metric already exists")

    for field, value in update_values.items():
        setattr(metric, field, value)

    db.commit()
    db.refresh(metric)
    return metric


@router.delete(
    "/{metric_name}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_metric(metric_name: str, db: DBSession = Depends(get_db)) -> Response:
    metric = _get_metric_or_404(db, metric_name)
    db.delete(metric)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
