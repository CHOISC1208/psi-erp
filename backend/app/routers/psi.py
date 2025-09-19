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
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


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
    for raw_row in reader:
        if not raw_row or not any(raw_row.values()):
            continue

        try:
            row_date = datetime.strptime(
                raw_row[header_map["date"]], "%Y-%m-%d"
            ).date()
        except (ValueError, KeyError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing date (expected YYYY-MM-DD)",
            ) from exc

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

        rows_to_insert.append(
            models.PSIBase(
                session_id=session_id,
                sku_code=sku_code_value,
                sku_name=sku_name_value,
                warehouse_name=warehouse_value,
                channel=channel_value,
                date=row_date,
                stock_at_anchor=_parse_decimal(raw_row.get(header_map["stock_at_anchor"]), "stock_at_anchor"),
                inbound_qty=_parse_decimal(raw_row.get(header_map["inbound_qty"]), "inbound_qty"),
                outbound_qty=_parse_decimal(raw_row.get(header_map["outbound_qty"]), "outbound_qty"),
                net_flow=_parse_decimal(raw_row.get(header_map["net_flow"]), "net_flow"),
                stock_closing=_parse_decimal(raw_row.get(header_map["stock_closing"]), "stock_closing"),
                safety_stock=_parse_decimal(raw_row.get(header_map["safety_stock"]), "safety_stock"),
                movable_stock=_parse_decimal(raw_row.get(header_map["movable_stock"]), "movable_stock"),
            )
        )
        affected_dates.add(row_date)

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

    base_alias = models.PSIBase
    edit_alias = models.PSIEdit

    query = (
        select(base_alias, edit_alias)
        .join(
            edit_alias,
            (edit_alias.session_id == base_alias.session_id)
            & (edit_alias.sku_code == base_alias.sku_code)
            & (edit_alias.warehouse_name == base_alias.warehouse_name)
            & (edit_alias.channel == base_alias.channel)
            & (edit_alias.date == base_alias.date),
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

    for base_row, edit_row in rows:
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

        stock_anchor_raw = base_row.stock_at_anchor
        stock_anchor_for_calc = stock_anchor_raw if stock_anchor_raw is not None else zero

        has_flow_edit = bool(
            edit_row
            and (
                edit_row.inbound_qty is not None
                or edit_row.outbound_qty is not None
            )
        )

        if has_flow_edit or base_row.net_flow is None:
            net_flow = inbound_val - outbound_val
        else:
            net_flow = base_row.net_flow or zero

        if has_flow_edit or base_row.stock_closing is None:
            stock_closing = stock_anchor_for_calc + inbound_val - outbound_val
        else:
            stock_closing = base_row.stock_closing or zero

        safety_val = safety if safety is not None else zero
        if (edit_row and edit_row.safety_stock is not None) or base_row.movable_stock is None:
            movable_stock = stock_closing - safety_val
        else:
            movable_stock = base_row.movable_stock or zero

        bucket["records"].append(
            schemas.DailyPSI(
                date=base_row.date,
                stock_at_anchor=_to_optional_float(stock_anchor_raw),
                inbound_qty=float(inbound_val),
                outbound_qty=float(outbound_val),
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
