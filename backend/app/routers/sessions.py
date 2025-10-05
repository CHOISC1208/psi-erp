# backend/app/routers/sessions.py
"""Session related API routes."""
from __future__ import annotations

import csv
import io
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, delete, func, or_, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import (
    Session as DBSession,
    aliased,
    contains_eager,
    selectinload,
)

from .. import models, schemas
from ..config import settings
from ..deps import get_current_user, get_db
from ..services.cache import invalidate_reallocation_cache

router = APIRouter()


NUMERIC_ZERO_DEFAULT = {
    "stock_at_anchor",
    "inbound_qty",
    "outbound_qty",
    "net_flow",
    "stock_closing",
    "safety_stock",
    "movable_stock",
    "std_stock",
    "stock",
}


@dataclass(frozen=True)
class DatasetDefinition:
    """Describe an editable dataset scoped to a session."""

    name: str
    label: str
    description: str
    model: type[models.PSIBase | models.PSISummaryBase]
    primary_key: tuple[str, ...]
    columns: tuple[str, ...]
    editable_columns: tuple[str, ...]
    numeric_columns: tuple[str, ...]
    date_columns: tuple[str, ...]
    read_only_columns: tuple[str, ...]
    default_order: tuple[str, ...]


PSI_BASE_COLUMNS: tuple[str, ...] = (
    "session_id",
    "sku_code",
    "sku_name",
    "category_1",
    "category_2",
    "category_3",
    "fw_rank",
    "ss_rank",
    "warehouse_name",
    "channel",
    "date",
    "stock_at_anchor",
    "inbound_qty",
    "outbound_qty",
    "net_flow",
    "stock_closing",
    "safety_stock",
    "movable_stock",
    "stdstock",
    "gap",
)

PSI_BASE_EDITABLE_COLUMNS: tuple[str, ...] = (
    "sku_name",
    "category_1",
    "category_2",
    "category_3",
    "fw_rank",
    "ss_rank",
    "stock_at_anchor",
    "inbound_qty",
    "outbound_qty",
    "safety_stock",
    "movable_stock",
)

PSI_BASE_NUMERIC_COLUMNS: tuple[str, ...] = (
    "stock_at_anchor",
    "inbound_qty",
    "outbound_qty",
    "net_flow",
    "stock_closing",
    "safety_stock",
    "movable_stock",
    "stdstock",
    "gap",
)

PSI_BASE_DATE_COLUMNS: tuple[str, ...] = ("date",)

PSI_BASE_READ_ONLY_COLUMNS: tuple[str, ...] = (
    "net_flow",
    "stock_closing",
    "stdstock",
    "gap",
)

PSI_BASE_PRIMARY_KEY: tuple[str, ...] = (
    "session_id",
    "sku_code",
    "warehouse_name",
    "channel",
    "date",
)

PSI_BASE_DEFAULT_ORDER: tuple[str, ...] = (
    "date",
    "sku_code",
    "warehouse_name",
    "channel",
)

DATASET_DEFINITIONS: dict[str, DatasetDefinition] = {
    "psi_base": DatasetDefinition(
        name="psi_base",
        label="PSI Base",
        description="Daily PSI base data scoped to a session.",
        model=models.PSIBase,
        primary_key=PSI_BASE_PRIMARY_KEY,
        columns=PSI_BASE_COLUMNS,
        editable_columns=PSI_BASE_EDITABLE_COLUMNS,
        numeric_columns=PSI_BASE_NUMERIC_COLUMNS,
        date_columns=PSI_BASE_DATE_COLUMNS,
        read_only_columns=PSI_BASE_READ_ONLY_COLUMNS,
        default_order=PSI_BASE_DEFAULT_ORDER,
    ),
    "psi_summary_base": DatasetDefinition(
        name="psi_summary_base",
        label="PSI Summary Base",
        description="Aggregated PSI summary data scoped to a session.",
        model=models.PSISummaryBase,
        primary_key=("session_id", "sku_code", "warehouse_name", "channel"),
        columns=(
            "session_id",
            "sku_code",
            "sku_name",
            "warehouse_name",
            "channel",
            "inbound_qty",
            "outbound_qty",
            "std_stock",
            "stock",
        ),
        editable_columns=("sku_name", "inbound_qty", "outbound_qty", "std_stock", "stock"),
        numeric_columns=("inbound_qty", "outbound_qty", "std_stock", "stock"),
        date_columns=(),
        read_only_columns=(),
        default_order=("sku_code", "warehouse_name", "channel"),
    ),
}


def _session_supports_dataset(session: models.Session, dataset: str) -> bool:
    """Return whether the provided session can work with the dataset."""

    data_mode = (session.data_mode or "").lower()
    if dataset == "psi_base":
        return data_mode == "base"
    if dataset == "psi_summary_base":
        return data_mode == "summary"
    return True


def _ensure_session_supports_dataset(session: models.Session, dataset: str) -> None:
    """Raise an HTTP error when the dataset is incompatible with the session."""

    if not _session_supports_dataset(session, dataset):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"session does not support {dataset}",
        )


COLUMN_LABELS: dict[str, dict[str, str]] = {
    "psi_base": {
        "session_id": "Session ID",
        "sku_code": "SKU",
        "sku_name": "SKU name",
        "category_1": "Category 1",
        "category_2": "Category 2",
        "category_3": "Category 3",
        "fw_rank": "FW rank",
        "ss_rank": "SS rank",
        "warehouse_name": "Warehouse",
        "channel": "Channel",
        "date": "Date",
        "stock_at_anchor": "Stock at anchor",
        "inbound_qty": "Inbound qty",
        "outbound_qty": "Outbound qty",
        "net_flow": "Net flow",
        "stock_closing": "Stock closing",
        "safety_stock": "Safety stock",
        "movable_stock": "Movable stock",
        "stdstock": "Std stock",
        "gap": "Gap",
    }
}


@dataclass
class RowValidationError:
    row: int
    field: str
    message: str


def _dataset_definition_or_404(name: str) -> DatasetDefinition:
    allowed = {table.lower() for table in settings.session_editable_tables}
    if name.lower() not in allowed:
        raise HTTPException(status_code=404, detail="dataset not enabled")
    definition = DATASET_DEFINITIONS.get(name)
    if not definition:
        raise HTTPException(status_code=404, detail="dataset not found")
    return definition


def _build_dataset_metadata(definition: DatasetDefinition) -> schemas.SessionDatasetMetadata:
    labels = COLUMN_LABELS.get(definition.name, {})
    columns: list[schemas.DatasetColumnMetadata] = []
    for column in definition.columns:
        column_type: Literal["string", "number", "date"]
        if column in definition.numeric_columns:
            column_type = "number"
        elif column in definition.date_columns:
            column_type = "date"
        else:
            column_type = "string"
        columns.append(
            schemas.DatasetColumnMetadata(
                name=column,
                label=labels.get(column, column.replace("_", " ").title()),
                type=column_type,
                editable=column in definition.editable_columns,
                required=column in definition.primary_key,
                max_length=2 if column in {"fw_rank", "ss_rank"} else None,
            )
        )
    return schemas.SessionDatasetMetadata(
        name=definition.name,
        label=definition.label,
        description=definition.description,
        primary_key=list(definition.primary_key),
        columns=columns,
        read_only_columns=list(definition.read_only_columns),
        numeric_columns=list(definition.numeric_columns),
        date_columns=list(definition.date_columns),
    )


def _normalize_decimal(value: Any, column: str, *, errors: list[RowValidationError], row_index: int) -> Decimal | None:
    if value is None:
        return Decimal("0") if column in NUMERIC_ZERO_DEFAULT else None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return Decimal("0") if column in NUMERIC_ZERO_DEFAULT else None
        try:
            return Decimal(stripped)
        except InvalidOperation:
            errors.append(RowValidationError(row=row_index, field=column, message="must be a numeric value"))
            return None
    errors.append(RowValidationError(row=row_index, field=column, message="unsupported numeric type"))
    return None


def _normalize_date(value: Any, column: str, *, errors: list[RowValidationError], row_index: int) -> date | None:
    if value is None:
        errors.append(RowValidationError(row=row_index, field=column, message="date is required"))
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            parsed = datetime.strptime(value.strip(), "%Y-%m-%d").date()
            return parsed
        except ValueError:
            errors.append(RowValidationError(row=row_index, field=column, message="must use YYYY-MM-DD"))
            return None
    errors.append(RowValidationError(row=row_index, field=column, message="unsupported date type"))
    return None


def _ensure_session_exists(db: DBSession, session_id: UUID) -> models.Session:
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


def _ensure_summary_dataset_table(db: DBSession) -> None:
    bind = db.get_bind()
    if bind is not None:
        models.ensure_psi_summary_base_table(bind)


def _raise_validation_errors(errors: Iterable[RowValidationError]) -> None:
    collected = list(errors)
    if not collected:
        return
    detail = {
        "message": "Validation failed",
        "errors": [
            {"row": error.row, "field": error.field, "message": error.message}
            for error in collected
        ],
    }
    raise HTTPException(status_code=400, detail=detail)


def _parse_filters(raw_filters: str | None) -> dict[str, Any]:
    if not raw_filters:
        return {}
    try:
        parsed = json.loads(raw_filters)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive path
        raise HTTPException(status_code=400, detail="filters must be a JSON object") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="filters must be a JSON object")
    return parsed


def _serialize_psibase(row: models.PSIBase) -> schemas.PSIBaseRecord:
    return schemas.PSIBaseRecord(
        session_id=row.session_id,
        sku_code=row.sku_code,
        sku_name=row.sku_name,
        category_1=row.category_1,
        category_2=row.category_2,
        category_3=row.category_3,
        fw_rank=row.fw_rank,
        ss_rank=row.ss_rank,
        warehouse_name=row.warehouse_name,
        channel=row.channel,
        date=row.date,
        stock_at_anchor=row.stock_at_anchor,
        inbound_qty=row.inbound_qty,
        outbound_qty=row.outbound_qty,
        net_flow=row.net_flow,
        stock_closing=row.stock_closing,
        safety_stock=row.safety_stock,
        movable_stock=row.movable_stock,
        stdstock=row.stdstock,
        gap=row.gap,
        updated_at=None,
        updated_by=None,
        updated_by_username=None,
    )


def _serialize_psisummary(row: models.PSISummaryBase) -> schemas.PSISummaryBaseRecord:
    return schemas.PSISummaryBaseRecord(
        session_id=row.session_id,
        sku_code=row.sku_code,
        sku_name=row.sku_name,
        warehouse_name=row.warehouse_name,
        channel=row.channel,
        inbound_qty=row.inbound_qty,
        outbound_qty=row.outbound_qty,
        std_stock=row.std_stock,
        stock=row.stock,
        created_at=row.created_at,
        updated_at=None,
        updated_by=None,
        updated_by_username=None,
    )


def _query_dataset_rows(
    definition: DatasetDefinition,
    session_id: UUID,
    filter_values: dict[str, Any],
    page: int,
    size: int,
    db: DBSession,
    *,
    condition_builder: Callable[[UUID, dict[str, Any]], list[Any]],
    serializer: Callable[[Any], Any],
) -> tuple[int, list[Any]]:
    conditions = condition_builder(session_id, filter_values)

    base_query = select(definition.model).where(and_(*conditions))
    order_columns = [getattr(definition.model, column) for column in definition.default_order]
    query = base_query.order_by(*order_columns)

    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0

    offset = (page - 1) * size
    rows = db.scalars(query.offset(offset).limit(size)).all()

    return total, [serializer(row) for row in rows]


def _patch_session_dataset(
    definition: DatasetDefinition,
    session_id: UUID,
    rows: Iterable[Any],
    db: DBSession,
) -> int:
    if not rows:
        return 0

    validation_errors: list[RowValidationError] = []
    updates: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for index, row in enumerate(rows, start=1):
        row_session_id = getattr(row, "session_id", None)
        if row_session_id != session_id:
            validation_errors.append(
                RowValidationError(row=index, field="session_id", message="session mismatch"),
            )

        key_data: dict[str, Any] = {}
        for field in definition.primary_key:
            value = getattr(row, field, None)
            key_data[field] = value
            if value is None or (isinstance(value, str) and not value.strip()):
                validation_errors.append(
                    RowValidationError(row=index, field=field, message="is required"),
                )

        row_dict = row.model_dump(exclude_unset=True)

        for read_only in definition.read_only_columns:
            if read_only in row_dict and row_dict[read_only] is not None:
                validation_errors.append(
                    RowValidationError(row=index, field=read_only, message="field is read-only"),
                )

        update_data: dict[str, Any] = {}
        for column in definition.editable_columns:
            if column not in row_dict:
                continue
            value = row_dict[column]
            if column in definition.numeric_columns:
                normalized = _normalize_decimal(value, column, errors=validation_errors, row_index=index)
            else:
                if isinstance(value, str):
                    normalized = value.strip() or None
                else:
                    normalized = value
                if column in {"fw_rank", "ss_rank"} and normalized:
                    value_str = str(normalized)
                    if len(value_str) > 2:
                        validation_errors.append(
                            RowValidationError(
                                row=index,
                                field=column,
                                message="must be at most 2 characters",
                            ),
                        )
            update_data[column] = normalized

        updates.append((key_data, update_data))

    _raise_validation_errors(validation_errors)

    updated = 0
    post_validation: list[RowValidationError] = []

    for index, (key_data, update_values) in enumerate(updates, start=1):
        if not update_values:
            continue
        conditions = [
            getattr(definition.model, column) == key_data[column]
            for column in definition.primary_key
        ]
        stmt = update(definition.model).where(*conditions).values(**update_values)
        result = db.execute(stmt)
        if result.rowcount == 0:
            post_validation.append(
                RowValidationError(row=index, field="key", message="record not found"),
            )
        else:
            updated += int(result.rowcount)

    if post_validation:
        db.rollback()
        _raise_validation_errors(post_validation)

    db.commit()
    return updated


def _delete_session_dataset(
    definition: DatasetDefinition,
    session_id: UUID,
    rows: Iterable[Any],
    db: DBSession,
) -> int:
    if not rows:
        return 0

    errors: list[RowValidationError] = []
    keys: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=1):
        row_session_id = getattr(row, "session_id", None)
        if row_session_id != session_id:
            errors.append(
                RowValidationError(row=index, field="session_id", message="session mismatch"),
            )

        key_data: dict[str, Any] = {}
        for field in definition.primary_key:
            value = getattr(row, field, None)
            key_data[field] = value
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(RowValidationError(row=index, field=field, message="is required"))
        keys.append(key_data)

    _raise_validation_errors(errors)

    deleted = 0
    missing: list[RowValidationError] = []

    for index, key_data in enumerate(keys, start=1):
        conditions = [
            getattr(definition.model, column) == key_data[column]
            for column in definition.primary_key
        ]
        stmt = delete(definition.model).where(*conditions).execution_options(
            synchronize_session=False
        )
        result = db.execute(stmt)
        if result.rowcount == 0:
            missing.append(RowValidationError(row=index, field="key", message="record not found"))
        else:
            deleted += int(result.rowcount)

    if missing:
        db.rollback()
        _raise_validation_errors(missing)

    db.commit()
    return deleted


def _format_csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _parse_filter_date_value(value: Any, key: str) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"filters.{key} must use YYYY-MM-DD format",
            ) from exc
    raise HTTPException(status_code=400, detail=f"filters.{key} must be a string")


def _build_psibase_conditions(session_id: UUID, filter_values: dict[str, Any]) -> list[Any]:
    conditions: list[Any] = [models.PSIBase.session_id == session_id]

    sku_code = filter_values.get("sku_code")
    if isinstance(sku_code, str) and sku_code.strip():
        lowered = f"%{sku_code.strip().lower()}%"
        conditions.append(func.lower(models.PSIBase.sku_code).like(lowered))

    warehouse_name = filter_values.get("warehouse_name")
    if isinstance(warehouse_name, str) and warehouse_name.strip():
        lowered = f"%{warehouse_name.strip().lower()}%"
        conditions.append(func.lower(models.PSIBase.warehouse_name).like(lowered))

    channel = filter_values.get("channel")
    if isinstance(channel, str) and channel.strip():
        lowered = f"%{channel.strip().lower()}%"
        conditions.append(func.lower(models.PSIBase.channel).like(lowered))

    fw_rank = filter_values.get("fw_rank")
    if isinstance(fw_rank, str) and fw_rank.strip():
        conditions.append(func.lower(models.PSIBase.fw_rank).like(f"%{fw_rank.strip().lower()}%"))

    ss_rank = filter_values.get("ss_rank")
    if isinstance(ss_rank, str) and ss_rank.strip():
        conditions.append(func.lower(models.PSIBase.ss_rank).like(f"%{ss_rank.strip().lower()}%"))

    exact_date = _parse_filter_date_value(filter_values.get("date"), "date")
    if exact_date is not None:
        conditions.append(models.PSIBase.date == exact_date)

    start_date = _parse_filter_date_value(
        filter_values.get("date_start") or filter_values.get("start"),
        "date_start",
    )
    if start_date is not None:
        conditions.append(models.PSIBase.date >= start_date)

    end_date = _parse_filter_date_value(
        filter_values.get("date_end") or filter_values.get("end"),
        "date_end",
    )
    if end_date is not None:
        conditions.append(models.PSIBase.date <= end_date)

    return conditions


def _build_psisummary_conditions(session_id: UUID, filter_values: dict[str, Any]) -> list[Any]:
    conditions: list[Any] = [models.PSISummaryBase.session_id == session_id]

    sku_code = filter_values.get("sku_code")
    if isinstance(sku_code, str) and sku_code.strip():
        lowered = f"%{sku_code.strip().lower()}%"
        conditions.append(func.lower(models.PSISummaryBase.sku_code).like(lowered))

    warehouse_name = filter_values.get("warehouse_name")
    if isinstance(warehouse_name, str) and warehouse_name.strip():
        lowered = f"%{warehouse_name.strip().lower()}%"
        conditions.append(func.lower(models.PSISummaryBase.warehouse_name).like(lowered))

    channel = filter_values.get("channel")
    if isinstance(channel, str) and channel.strip():
        lowered = f"%{channel.strip().lower()}%"
        conditions.append(func.lower(models.PSISummaryBase.channel).like(lowered))

    return conditions

# ---- collection（/sessions と /sessions/ の両方を許容） ----
@router.get(
    "",
    response_model=list[schemas.SessionRead],
    response_model_exclude_none=True,
)
@router.get(
    "/",
    response_model=list[schemas.SessionRead],
    response_model_exclude_none=True,
)
def list_sessions(
    search: str | None = None,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[schemas.SessionRead]:
    """セッション一覧を返す。"""
    _ = current_user
    stmt = select(models.Session).order_by(models.Session.created_at.desc())
    join_users = bool(search)
    stmt, creator_alias, updater_alias = _with_audit_options(stmt, join_users=join_users)

    if search:
        lowered = f"%{search.lower()}%"
        conditions = [
            func.lower(models.Session.title).like(lowered),
            func.lower(models.Session.description).like(lowered),
        ]
        if creator_alias is not None:
            conditions.append(func.lower(creator_alias.username).like(lowered))
        if updater_alias is not None:
            conditions.append(func.lower(updater_alias.username).like(lowered))
        stmt = stmt.where(or_(*conditions))

    sessions = db.scalars(stmt).unique().all()
    return [_serialize_session(session) for session in sessions]


@router.post(
    "",
    response_model=schemas.SessionRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
@router.post(
    "/",
    response_model=schemas.SessionRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
def create_session(
    payload: schemas.SessionCreate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """新しいセッションを作成。"""
    session = models.Session(
        title=payload.title,
        description=payload.description,
        data_mode=payload.data_mode.value,
    )
    session.created_by = current_user.id
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


# ---- static path は dynamic path より前に置く！ ----
@router.get(
    "/leader",
    response_model=Optional[schemas.SessionRead],
    response_model_exclude_none=True,
)
def get_leader_session(
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> Optional[schemas.SessionRead]:
    """
    現在のリーダーセッションを返す。無ければ null を返す。
    """
    _ = current_user
    stmt = (
        select(models.Session)
        .where(models.Session.is_leader.is_(True))
        .order_by(models.Session.updated_at.desc())
        .limit(1)
    )
    stmt, _, _ = _with_audit_options(stmt, join_users=False)
    session = db.scalars(stmt).first()
    if session is None:
        return None
    return _serialize_session(session)


# ---- item ----
def _get_session_or_404(db: DBSession, session_id: UUID) -> models.Session:
    stmt = select(models.Session).where(models.Session.id == session_id).limit(1)
    stmt, _, _ = _with_audit_options(stmt, join_users=False)
    session = db.scalars(stmt).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.get(
    "/{session_id}/datasets",
    response_model=list[schemas.SessionDatasetMetadata],
    response_model_exclude_none=True,
)
def list_session_datasets(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[schemas.SessionDatasetMetadata]:
    """Return the datasets available for editing within the session."""

    _ = current_user
    session = _ensure_session_exists(db, session_id)

    metadata: list[schemas.SessionDatasetMetadata] = []
    for table in settings.session_editable_tables:
        key = table.lower()
        definition = DATASET_DEFINITIONS.get(key)
        if not definition:
            continue
        if not _session_supports_dataset(session, key):
            continue
        metadata.append(_build_dataset_metadata(definition))
    return metadata


@router.get(
    "/{session_id}/psi_base",
    response_model=schemas.PSIBasePage,
    response_model_exclude_none=True,
)
def list_session_psi_base(
    session_id: UUID,
    filters: str | None = Query(default=None, description="JSON encoded filter object"),
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=500),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.PSIBasePage:
    """Return paginated psi_base rows scoped to the session."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    filter_values = _parse_filters(filters)
    total, rows = _query_dataset_rows(
        definition,
        session_id,
        filter_values,
        page,
        size,
        db,
        condition_builder=_build_psibase_conditions,
        serializer=_serialize_psibase,
    )

    return schemas.PSIBasePage(page=page, size=size, total=total, rows=rows)


@router.patch(
    "/{session_id}/psi_base",
    response_model=dict[str, int],
)
def patch_session_psi_base(
    session_id: UUID,
    payload: schemas.PSIBasePatchRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, int]:
    """Apply bulk updates to psi_base rows."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    updated = _patch_session_dataset(definition, session_id, payload.rows, db)
    if updated:
        invalidate_reallocation_cache(session_id)

    return {"updated": updated}


@router.delete(
    "/{session_id}/psi_base",
    response_model=dict[str, int],
)
def delete_session_psi_base(
    session_id: UUID,
    payload: schemas.PSIBaseDeleteRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, int]:
    """Delete psi_base rows in bulk."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    deleted = _delete_session_dataset(definition, session_id, payload.rows, db)
    if deleted:
        invalidate_reallocation_cache(session_id)

    return {"deleted": deleted}


@router.get(
    "/{session_id}/psi_summary_base",
    response_model=schemas.PSISummaryBasePage,
    response_model_exclude_none=True,
)
def list_session_psi_summary_base(
    session_id: UUID,
    filters: str | None = Query(default=None, description="JSON encoded filter object"),
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=500),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.PSISummaryBasePage:
    """Return paginated psi_summary_base rows scoped to the session."""

    _ = current_user
    _ensure_summary_dataset_table(db)
    definition = _dataset_definition_or_404("psi_summary_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_summary_base")

    filter_values = _parse_filters(filters)
    total, rows = _query_dataset_rows(
        definition,
        session_id,
        filter_values,
        page,
        size,
        db,
        condition_builder=_build_psisummary_conditions,
        serializer=_serialize_psisummary,
    )

    return schemas.PSISummaryBasePage(page=page, size=size, total=total, rows=rows)


@router.patch(
    "/{session_id}/psi_summary_base",
    response_model=dict[str, int],
)
def patch_session_psi_summary_base(
    session_id: UUID,
    payload: schemas.PSISummaryBasePatchRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, int]:
    """Apply bulk updates to psi_summary_base rows."""

    _ = current_user
    _ensure_summary_dataset_table(db)
    definition = _dataset_definition_or_404("psi_summary_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_summary_base")

    updated = _patch_session_dataset(definition, session_id, payload.rows, db)
    if updated:
        invalidate_reallocation_cache(session_id)

    return {"updated": updated}


@router.delete(
    "/{session_id}/psi_summary_base",
    response_model=dict[str, int],
)
def delete_session_psi_summary_base(
    session_id: UUID,
    payload: schemas.PSISummaryBaseDeleteRequest,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, int]:
    """Delete psi_summary_base rows in bulk."""

    _ = current_user
    _ensure_summary_dataset_table(db)
    definition = _dataset_definition_or_404("psi_summary_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_summary_base")

    deleted = _delete_session_dataset(definition, session_id, payload.rows, db)
    if deleted:
        invalidate_reallocation_cache(session_id)

    return {"deleted": deleted}


@router.get(
    "/{session_id}/psi_base/export",
    response_class=StreamingResponse,
)
def export_session_psi_base(
    session_id: UUID,
    filters: str | None = Query(default=None, description="JSON encoded filter object"),
    all: bool = Query(default=False, description="Export all matching rows"),
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=1000),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream psi_base rows as CSV."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    filter_values = _parse_filters(filters)
    conditions = _build_psibase_conditions(session_id, filter_values)

    query = select(models.PSIBase).where(and_(*conditions))
    order_columns = [getattr(models.PSIBase, column) for column in definition.default_order]
    query = query.order_by(*order_columns)

    if not all:
        offset = (page - 1) * size
        query = query.offset(offset).limit(size)

    rows = db.scalars(query).all()
    columns = definition.columns

    def row_iterator():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(columns)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        for row in rows:
            writer.writerow([_format_csv_value(getattr(row, column)) for column in columns])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    filename = f"psi_base_{session_id}.csv"
    response = StreamingResponse(row_iterator(), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response


@router.get(
    "/{session_id}/psi_base/template",
    response_class=StreamingResponse,
)
def download_psi_base_template(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> StreamingResponse:
    """Provide a CSV template for psi_base uploads."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(definition.columns)
    sample_row = []
    for column in definition.columns:
        if column == "session_id":
            sample_row.append(str(session_id))
        elif column in definition.date_columns:
            sample_row.append("YYYY-MM-DD")
        elif column in definition.numeric_columns:
            sample_row.append("0")
        else:
            sample_row.append(column.upper())
    writer.writerow(sample_row)
    output.seek(0)

    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=psi_base_template_{session_id}.csv"
    return response


@router.post(
    "/{session_id}/psi_base/import",
    response_model=schemas.PSIBaseImportResponse,
)
async def import_session_psi_base(
    session_id: UUID,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|upsert)$"),
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.PSIBaseImportResponse:
    """Import psi_base rows from a CSV upload."""

    _ = current_user
    definition = _dataset_definition_or_404("psi_base")
    session = _ensure_session_exists(db, session_id)
    _ensure_session_supports_dataset(session, "psi_base")

    content = await file.read()
    try:
        text_data = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail="Uploaded file must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text_data))
    header = reader.fieldnames or []
    expected_columns = set(definition.columns)
    unknown_columns = [column for column in header if column not in expected_columns]
    if unknown_columns:
        raise HTTPException(
            status_code=400,
            detail={"message": "Unknown columns in CSV", "columns": unknown_columns},
        )

    missing_columns = [column for column in definition.primary_key if column not in header]
    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail={"message": "Missing required columns", "columns": missing_columns},
        )

    rows_to_import: list[dict[str, Any]] = []
    errors: list[RowValidationError] = []
    seen_keys: set[tuple[Any, ...]] = set()

    for index, raw_row in enumerate(reader, start=2):
        row_dict = {key: raw_row.get(key) for key in header}
        row_errors: list[RowValidationError] = []

        for field in definition.primary_key:
            value = row_dict.get(field)
            if value is None or not str(value).strip():
                row_errors.append(RowValidationError(row=index, field=field, message="is required"))

        if row_dict.get("session_id") not in {None, ""} and str(row_dict.get("session_id")).strip() != str(session_id):
            row_errors.append(RowValidationError(row=index, field="session_id", message="session mismatch"))

        normalized_row: dict[str, Any] = {column: None for column in definition.columns}
        normalized_row["session_id"] = session_id

        for column in definition.columns:
            raw_value = row_dict.get(column)
            if column == "session_id":
                continue
            if column in definition.numeric_columns:
                normalized_value = _normalize_decimal(raw_value, column, errors=row_errors, row_index=index)
            elif column in definition.date_columns:
                normalized_value = _normalize_date(
                    raw_value, column, errors=row_errors, row_index=index
                )
            else:
                normalized_value = raw_value.strip() if isinstance(raw_value, str) else raw_value
                if isinstance(normalized_value, str):
                    normalized_value = normalized_value or None
                if column in {"fw_rank", "ss_rank"} and normalized_value and len(str(normalized_value)) > 2:
                    row_errors.append(
                        RowValidationError(row=index, field=column, message="must be at most 2 characters"),
                    )
            normalized_row[column] = normalized_value

        key_tuple = tuple(
            normalized_row[field] if field != "session_id" else session_id
            for field in definition.primary_key
        )
        if key_tuple in seen_keys:
            row_errors.append(RowValidationError(row=index, field="key", message="duplicate row in file"))
        else:
            seen_keys.add(key_tuple)

        if row_errors:
            errors.extend(row_errors)
            continue

        rows_to_import.append(normalized_row)

    _raise_validation_errors(errors)

    if not rows_to_import:
        return schemas.PSIBaseImportResponse(added=0, updated=0, deleted=0, warnings=[])

    mode_normalized = mode.lower()
    added = 0
    updated = 0
    deleted = 0

    if mode_normalized == "replace":
        existing_count = db.scalar(
            select(func.count()).where(models.PSIBase.session_id == session_id)
        ) or 0
        db.execute(delete(models.PSIBase).where(models.PSIBase.session_id == session_id))
        db.execute(insert(models.PSIBase), rows_to_import)
        deleted = int(existing_count)
        added = len(rows_to_import)
    else:  # upsert
        key_expr = tuple_(
            models.PSIBase.session_id,
            models.PSIBase.sku_code,
            models.PSIBase.warehouse_name,
            models.PSIBase.channel,
            models.PSIBase.date,
        )
        key_values = [
            (
                session_id,
                row["sku_code"],
                row["warehouse_name"],
                row["channel"],
                row["date"],
            )
            for row in rows_to_import
        ]
        existing_keys: set[tuple[Any, ...]] = set()
        if key_values:
            existing_keys = {
                tuple(row)
                for row in db.execute(
                    select(key_expr).where(
                        models.PSIBase.session_id == session_id,
                        key_expr.in_(key_values),
                    )
                )
            }
        added = len(rows_to_import)
        updated = len(existing_keys)
        if updated:
            added -= updated
        insert_stmt = insert(models.PSIBase).values(rows_to_import)
        update_columns = {
            column: getattr(insert_stmt.excluded, column)
            for column in definition.editable_columns
        }
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=list(definition.primary_key),
            set_=update_columns,
        )
        db.execute(upsert_stmt)

    db.commit()
    invalidate_reallocation_cache(session_id)

    return schemas.PSIBaseImportResponse(added=added, updated=updated, deleted=deleted, warnings=[])


@router.get(
    "/{session_id}",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def get_session(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """セッション詳細を取得。"""
    _ = current_user
    session = _get_session_or_404(db, session_id)
    return _serialize_session(session)


@router.put(
    "/{session_id}",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def update_session(
    session_id: UUID,
    payload: schemas.SessionUpdate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """セッションを更新。"""
    session = _get_session_or_404(db, session_id)
    payload_dict = payload.model_dump(exclude_unset=True)
    if "data_mode" in payload_dict and payload_dict["data_mode"] is not None:
        if payload_dict["data_mode"].value != session.data_mode:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="data_mode cannot be modified after session creation.",
            )
        payload_dict.pop("data_mode", None)
    for field, value in payload_dict.items():
        setattr(session, field, value)
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,  # 204 はボディ無し
)
def delete_session(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> Response:
    """セッションを削除。"""
    _ = current_user
    session = _get_session_or_404(db, session_id)
    db.delete(session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{session_id}/leader",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def set_leader(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """指定セッションをリーダーに設定（他はすべて False）。"""
    _ = current_user

    # 全ての is_leader を False に
    db.execute(update(models.Session).values(is_leader=False))

    session = _get_session_or_404(db, session_id)
    session.is_leader = True
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


def _with_audit_options(stmt, *, join_users: bool):
    creator_alias = None
    updater_alias = None

    if join_users:
        creator_alias = aliased(models.User)
        updater_alias = aliased(models.User)
        stmt = stmt.outerjoin(creator_alias, models.Session.created_by == creator_alias.id)
        stmt = stmt.outerjoin(updater_alias, models.Session.updated_by == updater_alias.id)
        stmt = stmt.options(
            contains_eager(models.Session.created_by_user, alias=creator_alias),
            contains_eager(models.Session.updated_by_user, alias=updater_alias),
        )
        return stmt, creator_alias, updater_alias

    stmt = stmt.options(
        selectinload(models.Session.created_by_user),
        selectinload(models.Session.updated_by_user),
    )
    return stmt, creator_alias, updater_alias


def _refresh_audit_relationships(db: DBSession, session: models.Session) -> None:
    db.refresh(session, attribute_names=["created_by_user", "updated_by_user"])


def _serialize_session(session: models.Session) -> schemas.SessionRead:
    data = schemas.SessionRead.model_validate(session, from_attributes=True)
    data.created_by_username = (
        session.created_by_user.username if session.created_by_user else None
    )
    data.updated_by_username = (
        session.updated_by_user.username if session.updated_by_user else None
    )
    data.data_type = schemas.SessionDataType(session.data_mode)
    if not settings.audit_metadata_enabled:
        data.created_by = None
        data.updated_by = None
    return data
