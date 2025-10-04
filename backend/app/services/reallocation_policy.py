"""Helpers for fetching and updating the reallocation policy."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .. import models

PolicyRoundingMode = Literal["floor", "round", "ceil"]


@dataclass(slots=True)
class ReallocationPolicyData:
    """Representation of the persisted reallocation policy."""

    take_from_other_main: bool
    rounding_mode: PolicyRoundingMode
    allow_overfill: bool
    updated_at: datetime | None
    updated_by: str | None


def _record_to_data(record: models.ReallocationPolicy) -> ReallocationPolicyData:
    return ReallocationPolicyData(
        take_from_other_main=bool(record.take_from_other_main),
        rounding_mode=cast(PolicyRoundingMode, record.rounding_mode),
        allow_overfill=bool(record.allow_overfill),
        updated_at=record.updated_at,
        updated_by=record.updated_by,
    )


def _ensure_policy_record(db: DBSession) -> models.ReallocationPolicy:
    policy = db.execute(
        select(models.ReallocationPolicy).order_by(models.ReallocationPolicy.id).limit(1)
    ).scalar_one_or_none()
    if policy is not None:
        return policy

    policy = models.ReallocationPolicy(id=1)
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


def get_reallocation_policy(db: DBSession) -> ReallocationPolicyData:
    """Return the current reallocation policy creating it if missing."""

    policy = _ensure_policy_record(db)
    return _record_to_data(policy)


def update_reallocation_policy(
    db: DBSession,
    *,
    take_from_other_main: bool,
    rounding_mode: PolicyRoundingMode,
    allow_overfill: bool,
    updated_by: str | None,
) -> ReallocationPolicyData:
    """Persist the reallocation policy and return the updated snapshot."""

    policy = _ensure_policy_record(db)
    policy.take_from_other_main = take_from_other_main
    policy.rounding_mode = rounding_mode
    policy.allow_overfill = allow_overfill
    policy.updated_by = updated_by
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return _record_to_data(policy)


__all__ = [
    "PolicyRoundingMode",
    "ReallocationPolicyData",
    "get_reallocation_policy",
    "update_reallocation_policy",
]
