from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from psycopg2 import errorcodes
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


def _normalize_rank_type(value: str) -> str:
    normalized = _normalize_required(value, "rank_type")
    if len(normalized) > 2:
        raise HTTPException(
            status_code=422,
            detail="rank_type must be at most 2 characters",
        )
    return normalized


def _get_record_or_404(
    db: DBSession, rank_type: str, category_1: str, category_2: str
) -> models.CategoryRankParameter:
    record = db.get(models.CategoryRankParameter, (rank_type, category_1, category_2))
    if record is None:
        raise HTTPException(status_code=404, detail="rank parameter not found")
    return record


def _handle_integrity_error(db: DBSession, exc: IntegrityError) -> None:
    """Convert integrity constraint violations into helpful API errors."""

    db.rollback()

    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint_name = getattr(diag, "constraint_name", "") if diag is not None else ""
    pgcode = getattr(orig, "pgcode", "")

    if constraint_name in {"pk_category_rank_parameters"} or pgcode == errorcodes.UNIQUE_VIOLATION:
        raise HTTPException(status_code=409, detail="rank parameter already exists") from exc

    if constraint_name in {
        "ck_category_rank_parameters_rank_type",
        "ck_category_rank_parameters_rank_type_length",
    } or pgcode == errorcodes.CHECK_VIOLATION:
        raise HTTPException(
            status_code=422,
            detail="rank_type must be at most 2 characters",
        ) from exc

    raise HTTPException(status_code=400, detail="Invalid rank parameter data") from exc


@router.get("", response_model=list[schemas.CategoryRankParameterRead])
@router.get("/", response_model=list[schemas.CategoryRankParameterRead])
def list_rank_parameters(
    db: DBSession = Depends(get_db),
) -> list[schemas.CategoryRankParameterRead]:
    query = select(models.CategoryRankParameter).order_by(
        models.CategoryRankParameter.rank_type.asc(),
        models.CategoryRankParameter.category_1.asc(),
        models.CategoryRankParameter.category_2.asc(),
    )
    return list(db.scalars(query))


@router.post(
    "",
    response_model=schemas.CategoryRankParameterRead,
    status_code=status.HTTP_201_CREATED,
)
@router.post(
    "/",
    response_model=schemas.CategoryRankParameterRead,
    status_code=status.HTTP_201_CREATED,
)
def create_rank_parameter(
    payload: schemas.CategoryRankParameterCreate, db: DBSession = Depends(get_db)
) -> schemas.CategoryRankParameterRead:
    rank_type = _normalize_rank_type(payload.rank_type)
    category_1 = _normalize_required(payload.category_1, "category_1")
    category_2 = _normalize_required(payload.category_2, "category_2")

    record = models.CategoryRankParameter(
        rank_type=rank_type,
        category_1=category_1,
        category_2=category_2,
        threshold=Decimal(payload.threshold),
    )

    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        _handle_integrity_error(db, exc)

    db.refresh(record)
    return record


@router.put(
    "/{rank_type}/{category_1}/{category_2}",
    response_model=schemas.CategoryRankParameterRead,
)
def update_rank_parameter(
    rank_type: str,
    category_1: str,
    category_2: str,
    payload: schemas.CategoryRankParameterUpdate,
    db: DBSession = Depends(get_db),
) -> schemas.CategoryRankParameterRead:
    record = _get_record_or_404(db, rank_type, category_1, category_2)

    update_values = payload.model_dump(exclude_unset=True)
    if "rank_type" in update_values:
        update_values["rank_type"] = _normalize_rank_type(update_values["rank_type"])
    if "category_1" in update_values:
        update_values["category_1"] = _normalize_required(update_values["category_1"], "category_1")
    if "category_2" in update_values:
        update_values["category_2"] = _normalize_required(update_values["category_2"], "category_2")

    new_rank_type = update_values.get("rank_type", record.rank_type)
    new_category_1 = update_values.get("category_1", record.category_1)
    new_category_2 = update_values.get("category_2", record.category_2)

    if (new_rank_type, new_category_1, new_category_2) != (
        record.rank_type,
        record.category_1,
        record.category_2,
    ):
        existing = db.get(
            models.CategoryRankParameter,
            (new_rank_type, new_category_1, new_category_2),
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail="rank parameter already exists")

    for field, value in update_values.items():
        if field == "threshold" and value is not None:
            setattr(record, field, Decimal(value))
        else:
            setattr(record, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        _handle_integrity_error(db, exc)
    db.refresh(record)
    return record


@router.delete(
    "/{rank_type}/{category_1}/{category_2}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_rank_parameter(
    rank_type: str,
    category_1: str,
    category_2: str,
    db: DBSession = Depends(get_db),
) -> Response:
    record = _get_record_or_404(db, rank_type, category_1, category_2)
    db.delete(record)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
