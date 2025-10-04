"""Endpoints exposing the global reallocation policy."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_admin_user, get_current_user, get_db
from ..services.reallocation_policy import (
    get_reallocation_policy,
    update_reallocation_policy,
)

router = APIRouter()


def _normalize_updated_by(value: str | None, fallback: str | None) -> str | None:
    if value is None:
        return fallback
    trimmed = value.strip()
    if not trimmed:
        return fallback
    return trimmed


@router.get("", response_model=schemas.ReallocationPolicyRead)
@router.get("/", response_model=schemas.ReallocationPolicyRead)
def read_reallocation_policy(
    db: DBSession = Depends(get_db),
    _: models.User = Depends(get_current_user),
) -> schemas.ReallocationPolicyRead:
    policy = get_reallocation_policy(db)
    return schemas.ReallocationPolicyRead(
        take_from_other_main=policy.take_from_other_main,
        rounding_mode=policy.rounding_mode,
        allow_overfill=policy.allow_overfill,
        fair_share_mode=policy.fair_share_mode,
        updated_at=policy.updated_at,
        updated_by=policy.updated_by,
    )


@router.put("", response_model=schemas.ReallocationPolicyRead)
@router.put("/", response_model=schemas.ReallocationPolicyRead)
def update_policy(
    payload: schemas.ReallocationPolicyWrite,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_admin_user),
) -> schemas.ReallocationPolicyRead:
    updated_by = _normalize_updated_by(payload.updated_by, current_user.username)
    policy = update_reallocation_policy(
        db,
        take_from_other_main=payload.take_from_other_main,
        rounding_mode=payload.rounding_mode,
        allow_overfill=payload.allow_overfill,
        fair_share_mode=payload.fair_share_mode,
        updated_by=updated_by,
    )
    return schemas.ReallocationPolicyRead(
        take_from_other_main=policy.take_from_other_main,
        rounding_mode=policy.rounding_mode,
        allow_overfill=policy.allow_overfill,
        fair_share_mode=policy.fair_share_mode,
        updated_at=policy.updated_at,
        updated_by=policy.updated_by,
    )
