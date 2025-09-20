"""PSI (Production / Sales / Inventory) API endpoints."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import and_, delete, func, or_, select, union_all
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()

def _ensure_channel_transfer_table(db: DBSession) -> None:
    """Create the channel transfers table when migrations haven't run."""

    bind = db.get_bind()
    if bind is not None:
        models.ensure_channel_transfers_table(bind)


def _normalise_header(header: str) -> str:
    """Normalize CSV header names for lookups.

    Args:
        header: Raw header value taken from the CSV file.

    Returns:
        A lower-case header where spaces are replaced with underscores.
    """

    return header.strip().lower().replace(" ", "_")


def _parse_decimal(raw_value: str | None, column: str) -> Decimal | None:
    """Parse a decimal value from the CSV.

    Args:
        raw_value: Textual value read from the CSV file.
        column: Column name used in error reporting.

    Returns:
        A :class:`decimal.Decimal` instance or ``None`` when the cell is blank.

    Raises:
        HTTPException: Raised when the value cannot be parsed as a decimal.
    """

    if raw_value is None:
        return None

    stripped = raw_value.strip()
    if not stripped:
        return None

    try:
        return Decimal(stripped)
    except (InvalidOperation, ValueError) as exc:  # pragma: no cover - defensive safety
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid numeric value in column '{column}'",
        ) from exc


def _get_session_or_404(db: DBSession, session_id: UUID) -> models.Session:
    """Return the session or raise a 404 error.

    Args:
        db: Database session used for lookups.
        session_id: Identifier of the session to retrieve.

    Returns:
        The matching :class:`models.Session` instance.

    Raises:
        HTTPException: Raised when the session does not exist.
    """

    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


def _to_decimal(value: float | None) -> Decimal | None:
    """Convert optional floats to :class:`~decimal.Decimal` values."""

    if value is None:
        return None
    return Decimal(str(value))


def _decimal_equal(a: Decimal | None, b: Decimal | None) -> bool:
    """Return whether two optional decimals represent the same value."""

    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return a == b


@router.post("/{session_id}/upload", response_model=schemas.PSIUploadResult)
async def upload_csv_for_session(
    *,
    session_id: UUID,
    file: UploadFile = File(...),
    db: DBSession = Depends(get_db),
) -> schemas.PSIUploadResult:
    """Ingest a PSI base CSV file for a specific session.

    Args:
        session_id: Identifier of the session receiving the upload.
        file: Uploaded CSV file following the schema documented in database.md.
        db: Database session injected by FastAPI.

    Returns:
        Summary of processed rows including the affected dates.
    """

    _get_session_or_404(db, session_id)

    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:  # pragma: no cover - sanity check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid encoding") from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing header row")

    headers = [_normalise_header(header) for header in reader.fieldnames]
    header_map = dict(zip(headers, reader.fieldnames))
    required_columns = {
        "sku_code",
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
    }
    missing = required_columns - set(headers)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "CSV must contain columns: " + ", ".join(sorted(required_columns))
            ),
        )

    sku_name_key = header_map.get("sku_name")

    rows_to_insert: list[models.PSIBase] = []
    affected_dates: set[date] = set()
    rows_by_key: dict[tuple[str, str, str, date], models.PSIBase] = {}

    for raw_row in reader:
        if not raw_row or not any(raw_row.values()):
            continue

        try:
            raw_date = raw_row[header_map["date"]]
        except KeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing date (expected YYYY-MM-DD or YYYY/MM/DD)",
            ) from exc

        if raw_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing date (expected YYYY-MM-DD or YYYY/MM/DD)",
            )

        raw_date_text = raw_date.strip()
        row_date: date | None = None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                row_date = datetime.strptime(raw_date_text, fmt).date()
                break
            except ValueError:
                continue

        if row_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing date (expected YYYY-MM-DD or YYYY/MM/DD)",
            )

        sku_code_value = raw_row.get(header_map["sku_code"], "").strip()
        warehouse_value = raw_row.get(header_map["warehouse_name"], "").strip()
        channel_value = raw_row.get(header_map["channel"], "").strip()
        if not sku_code_value or not warehouse_value or not channel_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each row must include sku_code, warehouse_name, and channel.",
            )

        sku_name_value = (
            raw_row.get(sku_name_key, "").strip() if sku_name_key else ""
        ) or None

        key = (sku_code_value, warehouse_value, channel_value, row_date)

        rows_by_key[key] = models.PSIBase(
            session_id=session_id,
            sku_code=sku_code_value,
            sku_name=sku_name_value,
            warehouse_name=warehouse_value,
            channel=channel_value,
            date=row_date,
            stock_at_anchor=_parse_decimal(
                raw_row.get(header_map["stock_at_anchor"]), "stock_at_anchor"
            ),
            inbound_qty=_parse_decimal(
                raw_row.get(header_map["inbound_qty"]), "inbound_qty"
            ),
            outbound_qty=_parse_decimal(
                raw_row.get(header_map["outbound_qty"]), "outbound_qty"
            ),
            net_flow=_parse_decimal(raw_row.get(header_map["net_flow"]), "net_flow"),
            stock_closing=_parse_decimal(
                raw_row.get(header_map["stock_closing"]), "stock_closing"
            ),
            safety_stock=_parse_decimal(
                raw_row.get(header_map["safety_stock"]), "safety_stock"
            ),
            movable_stock=_parse_decimal(
                raw_row.get(header_map["movable_stock"]), "movable_stock"
            ),
        )
        affected_dates.add(row_date)

    rows_to_insert = list(rows_by_key.values())

    if not rows_to_insert:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV contained no rows")

    try:
        db.execute(
            delete(models.PSIBase)
            .where(models.PSIBase.session_id == session_id)
            .where(models.PSIBase.date.in_(affected_dates))
        )
        db.add_all(rows_to_insert)
        db.commit()
    except Exception:  # pragma: no cover - defensive transaction handling
        db.rollback()
        raise

    return schemas.PSIUploadResult(
        rows_imported=len(rows_to_insert),
        session_id=session_id,
        dates=sorted(affected_dates),
    )


@router.get("/{session_id}/daily", response_model=list[schemas.ChannelDailyPSI])
def daily_psi(
    *,
    session_id: UUID,
    sku_code: str | None = None,
    warehouse_name: str | None = None,
    channel: str | None = None,
    db: DBSession = Depends(get_db),
) -> list[schemas.ChannelDailyPSI]:
    """Return aggregated PSI metrics grouped by SKU and channel.

    Args:
        session_id: Identifier of the session whose PSI data should be aggregated.
        sku_code: Optional case-insensitive filter for SKU codes.
        warehouse_name: Optional case-insensitive filter for warehouse names.
        channel: Optional case-insensitive filter for sales channels.
        db: Database session injected by FastAPI.

    Returns:
        Aggregated PSI rows ordered by date ascending.
    """

    _get_session_or_404(db, session_id)
    _ensure_channel_transfer_table(db)

    base_alias = models.PSIBase
    edit_alias = models.PSIEdit

    transfer_incoming = (
        select(
            models.ChannelTransfer.session_id.label("session_id"),
            models.ChannelTransfer.sku_code.label("sku_code"),
            models.ChannelTransfer.warehouse_name.label("warehouse_name"),
            models.ChannelTransfer.transfer_date.label("date"),
            models.ChannelTransfer.to_channel.label("channel"),
            models.ChannelTransfer.qty.label("qty"),
        )
        .where(models.ChannelTransfer.session_id == session_id)
    )

    transfer_outgoing = (
        select(
            models.ChannelTransfer.session_id.label("session_id"),
            models.ChannelTransfer.sku_code.label("sku_code"),
            models.ChannelTransfer.warehouse_name.label("warehouse_name"),
            models.ChannelTransfer.transfer_date.label("date"),
            models.ChannelTransfer.from_channel.label("channel"),
            (-models.ChannelTransfer.qty).label("qty"),
        )
        .where(models.ChannelTransfer.session_id == session_id)
    )

    transfer_union = union_all(transfer_incoming, transfer_outgoing).subquery()

    transfer_agg = (
        select(
            transfer_union.c.session_id,
            transfer_union.c.sku_code,
            transfer_union.c.warehouse_name,
            transfer_union.c.date,
            transfer_union.c.channel,
            func.sum(transfer_union.c.qty).label("channel_move"),
        )
        .group_by(
            transfer_union.c.session_id,
            transfer_union.c.sku_code,
            transfer_union.c.warehouse_name,
            transfer_union.c.date,
            transfer_union.c.channel,
        )
        .subquery()
    )

    query = (
        select(base_alias, edit_alias, transfer_agg.c.channel_move)
        .join(
            edit_alias,
            (edit_alias.session_id == base_alias.session_id)
            & (edit_alias.sku_code == base_alias.sku_code)
            & (edit_alias.warehouse_name == base_alias.warehouse_name)
            & (edit_alias.channel == base_alias.channel)
            & (edit_alias.date == base_alias.date),
            isouter=True,
        )
        .join(
            transfer_agg,
            (transfer_agg.c.session_id == base_alias.session_id)
            & (transfer_agg.c.sku_code == base_alias.sku_code)
            & (transfer_agg.c.warehouse_name == base_alias.warehouse_name)
            & (transfer_agg.c.channel == base_alias.channel)
            & (transfer_agg.c.date == base_alias.date),
            isouter=True,
        )
        .where(base_alias.session_id == session_id)
    )

    if sku_code:
        lowered = sku_code.lower()
        query = query.where(func.lower(base_alias.sku_code).like(f"%{lowered}%"))
    if warehouse_name:
        lowered = warehouse_name.lower()
        query = query.where(
            func.lower(base_alias.warehouse_name).like(f"%{lowered}%")
        )
    if channel:
        lowered = channel.lower()
        query = query.where(func.lower(base_alias.channel).like(f"%{lowered}%"))

    query = query.order_by(
        base_alias.sku_code.asc(),
        base_alias.warehouse_name.asc(),
        base_alias.channel.asc(),
        base_alias.date.asc(),
    )

    rows = db.execute(query).all()
    if not rows:
        return []

    zero = Decimal("0")
    grouped: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {"sku_name": None, "records": []}
    )

    def _to_optional_float(value: Decimal | None) -> float | None:
        if value is None:
            return None
        return float(value)

    for base_row, edit_row, transfer_move in rows:
        key = (base_row.sku_code, base_row.warehouse_name, base_row.channel)
        bucket = grouped[key]
        bucket["sku_name"] = base_row.sku_name or bucket["sku_name"]

        inbound = (
            edit_row.inbound_qty if edit_row and edit_row.inbound_qty is not None else base_row.inbound_qty
        )
        outbound = (
            edit_row.outbound_qty if edit_row and edit_row.outbound_qty is not None else base_row.outbound_qty
        )
        safety = (
            edit_row.safety_stock if edit_row and edit_row.safety_stock is not None else base_row.safety_stock
        )

        inbound_val = inbound if inbound is not None else zero
        outbound_val = outbound if outbound is not None else zero

        channel_move_raw = transfer_move
        channel_move_val = channel_move_raw if channel_move_raw is not None else zero

        stock_anchor_raw = base_row.stock_at_anchor
        stock_anchor_for_calc = stock_anchor_raw if stock_anchor_raw is not None else zero

        has_flow_edit = bool(
            edit_row
            and (
                edit_row.inbound_qty is not None
                or edit_row.outbound_qty is not None
            )
        )

        recalc_flow = has_flow_edit or base_row.net_flow is None
        recalc_closing = has_flow_edit or base_row.stock_closing is None

        if recalc_flow:
            net_flow = inbound_val - outbound_val + channel_move_val
        else:
            net_flow = (base_row.net_flow or zero) + channel_move_val

        if recalc_closing:
            stock_closing = (
                stock_anchor_for_calc + inbound_val - outbound_val + channel_move_val
            )
        else:
            stock_closing = (base_row.stock_closing or zero) + channel_move_val

        safety_val = safety if safety is not None else zero
        recalc_movable = (
            (edit_row and edit_row.safety_stock is not None)
            or base_row.movable_stock is None
            or recalc_closing
            or channel_move_raw is not None
        )
        if recalc_movable:
            movable_stock = stock_closing - safety_val
        else:
            movable_stock = (base_row.movable_stock or zero) + channel_move_val

        bucket["records"].append(
            schemas.DailyPSI(
                date=base_row.date,
                stock_at_anchor=_to_optional_float(stock_anchor_raw),
                inbound_qty=float(inbound_val),
                outbound_qty=float(outbound_val),
                channel_move=float(channel_move_val)
                if channel_move_raw is not None
                else None,
                net_flow=float(net_flow),
                stock_closing=float(stock_closing),
                safety_stock=float(safety_val),
                movable_stock=float(movable_stock),
            )
        )

    result: list[schemas.ChannelDailyPSI] = []
    for (sku, warehouse, channel_name), values in sorted(
        grouped.items(), key=lambda item: item[0]
    ):
        daily_records = sorted(values["records"], key=lambda record: record.date)
        result.append(
            schemas.ChannelDailyPSI(
                sku_code=sku,
                sku_name=values["sku_name"],
                warehouse_name=warehouse,
                channel=channel_name,
                daily=daily_records,
            )
        )

    return result


@router.get("/{session_id}/summary", response_model=schemas.PSISessionSummary)
def session_summary(session_id: UUID, db: DBSession = Depends(get_db)) -> schemas.PSISessionSummary:
    """Return date range information for the specified session."""

    _get_session_or_404(db, session_id)

    min_date, max_date = db.execute(
        select(func.min(models.PSIBase.date), func.max(models.PSIBase.date))
        .where(models.PSIBase.session_id == session_id)
    ).one()

    return schemas.PSISessionSummary(
        session_id=session_id,
        start_date=min_date,
        end_date=max_date,
    )


@router.post("/{session_id}/edits/apply", response_model=schemas.PSIEditApplyResult)
def apply_edits(
    *, session_id: UUID, payload: schemas.PSIEditApplyRequest, db: DBSession = Depends(get_db)
) -> schemas.PSIEditApplyResult:
    """Persist manual PSI overrides and record the audit log."""

    _get_session_or_404(db, session_id)

    if not payload.edits:
        return schemas.PSIEditApplyResult(applied=0, log_entries=0)

    conditions = [
        and_(
            models.PSIEdit.sku_code == edit.sku_code,
            models.PSIEdit.warehouse_name == edit.warehouse_name,
            models.PSIEdit.channel == edit.channel,
            models.PSIEdit.date == edit.date,
        )
        for edit in payload.edits
    ]

    existing_rows: list[models.PSIEdit] = []
    if conditions:
        query = (
            select(models.PSIEdit)
            .where(models.PSIEdit.session_id == session_id)
            .where(or_(*conditions))
        )
        existing_rows = list(db.scalars(query))

    existing_map: dict[
        tuple[str, str, str, date], models.PSIEdit | None
    ] = {
        (row.sku_code, row.warehouse_name, row.channel, row.date): row for row in existing_rows
    }

    logs: list[models.PSIEditLog] = []
    applied_count = 0

    for edit in payload.edits:
        key = (edit.sku_code, edit.warehouse_name, edit.channel, edit.date)
        current = existing_map.get(key)

        new_values = {
            "inbound_qty": _to_decimal(edit.inbound_qty),
            "outbound_qty": _to_decimal(edit.outbound_qty),
            "safety_stock": _to_decimal(edit.safety_stock),
        }

        if current is None:
            if all(value is None for value in new_values.values()):
                continue

            current = models.PSIEdit(
                session_id=session_id,
                sku_code=edit.sku_code,
                warehouse_name=edit.warehouse_name,
                channel=edit.channel,
                date=edit.date,
                **new_values,
            )
            db.add(current)
            existing_map[key] = current
            applied_count += 1

            for field, new_value in new_values.items():
                if new_value is None:
                    continue
                logs.append(
                    models.PSIEditLog(
                        session_id=session_id,
                        sku_code=edit.sku_code,
                        warehouse_name=edit.warehouse_name,
                        channel=edit.channel,
                        date=edit.date,
                        field=field,
                        old_value=None,
                        new_value=new_value,
                        edited_by=None,
                    )
                )
            continue

        if all(value is None for value in new_values.values()):
            had_values = False
            for field in new_values:
                old_value = getattr(current, field)
                if _decimal_equal(old_value, None):
                    continue
                had_values = True
                logs.append(
                    models.PSIEditLog(
                        session_id=session_id,
                        sku_code=edit.sku_code,
                        warehouse_name=edit.warehouse_name,
                        channel=edit.channel,
                        date=edit.date,
                        field=field,
                        old_value=old_value,
                        new_value=None,
                        edited_by=None,
                    )
                )
            if had_values:
                applied_count += 1
            db.delete(current)
            existing_map[key] = None
            continue

        changed = False
        for field, new_value in new_values.items():
            old_value = getattr(current, field)
            if _decimal_equal(old_value, new_value):
                continue
            setattr(current, field, new_value)
            logs.append(
                models.PSIEditLog(
                    session_id=session_id,
                    sku_code=edit.sku_code,
                    warehouse_name=edit.warehouse_name,
                    channel=edit.channel,
                    date=edit.date,
                    field=field,
                    old_value=old_value,
                    new_value=new_value,
                    edited_by=None,
                )
            )
            changed = True

        if changed:
            applied_count += 1
            if all(getattr(current, field) is None for field in new_values):
                db.delete(current)
                existing_map[key] = None

    if logs:
        db.add_all(logs)
    db.commit()

    return schemas.PSIEditApplyResult(applied=applied_count, log_entries=len(logs))
