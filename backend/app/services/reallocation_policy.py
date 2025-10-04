"""Helpers for fetching and updating the reallocation policy."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session as DBSession

from .. import models

PolicyRoundingMode = Literal["floor", "round", "ceil"]
PolicyFairShareMode = Literal["off", "equalize_ratio_closing", "equalize_ratio_start"]


@dataclass(slots=True)
class ReallocationPolicyData:
    """Representation of the persisted reallocation policy."""

    take_from_other_main: bool
    rounding_mode: PolicyRoundingMode
    allow_overfill: bool
    fair_share_mode: PolicyFairShareMode
    updated_at: datetime | None
    updated_by: str | None


def _record_to_data(record: models.ReallocationPolicy) -> ReallocationPolicyData:
    return ReallocationPolicyData(
        take_from_other_main=bool(record.take_from_other_main),
        rounding_mode=cast(PolicyRoundingMode, record.rounding_mode),
        allow_overfill=bool(record.allow_overfill),
        fair_share_mode=cast(PolicyFairShareMode, record.fair_share_mode),
        updated_at=record.updated_at,
        updated_by=record.updated_by,
    )


_DEFAULT_POLICY = ReallocationPolicyData(
    take_from_other_main=False,
    rounding_mode="floor",
    allow_overfill=False,
    fair_share_mode="off",
    updated_at=None,
    updated_by=None,
)


def _ensure_policy_record(db: DBSession) -> models.ReallocationPolicy | None:
    """Return an existing policy row creating it when the table is available."""

    bind = db.get_bind()
    if bind is None:  # pragma: no cover - defensive, sessions should always be bound
        return None

    inspector = inspect(bind)
    table = models.ReallocationPolicy.__table__
    schema = table.schema if table.schema else None

    if not inspector.has_table(table.name, schema=schema):
        return None

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
    if policy is None:
        return _DEFAULT_POLICY
    return _record_to_data(policy)


def update_reallocation_policy(
    db: DBSession,
    *,
    take_from_other_main: bool,
    rounding_mode: PolicyRoundingMode,
    allow_overfill: bool,
    fair_share_mode: PolicyFairShareMode,
    updated_by: str | None,
) -> ReallocationPolicyData:
    """Persist the reallocation policy and return the updated snapshot."""

    policy = _ensure_policy_record(db)
    if policy is None:
        raise RuntimeError("reallocation policy table is not available")
    policy.take_from_other_main = take_from_other_main
    policy.rounding_mode = rounding_mode
    policy.allow_overfill = allow_overfill
    policy.fair_share_mode = fair_share_mode
    policy.updated_by = updated_by
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return _record_to_data(policy)


__all__ = [
    "PolicyRoundingMode",
    "PolicyFairShareMode",
    "ReallocationPolicyData",
    "get_reallocation_policy",
    "update_reallocation_policy",
]
