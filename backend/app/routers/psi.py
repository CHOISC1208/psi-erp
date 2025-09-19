"""PSI (Production / Sales / Inventory) API endpoints."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


def _normalise_header(header: str) -> str:
    return header.strip().lower().replace(" ", "_")


@router.post("/upload", response_model=schemas.PSIUploadResult)
async def upload_csv(
    *,
    file: UploadFile = File(...),
    session_id: str | None = None,
    db: DBSession = Depends(get_db),
) -> schemas.PSIUploadResult:
    if session_id is not None and db.get(models.Session, session_id) is None:
        raise HTTPException(status_code=404, detail="session not found")

    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:  # pragma: no cover - sanity check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid encoding") from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing header row")

    headers = [_normalise_header(h) for h in reader.fieldnames]
    header_map = dict(zip(headers, reader.fieldnames))
    required = {"date", "production", "sales"}
    if not required.issubset(set(headers)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSV must contain columns: {', '.join(sorted(required))}",
        )

    rows_to_insert: list[models.PSIRecord] = []
    seen_dates: set[date] = set()
    for raw in reader:
        if not any(raw.values()):
            continue
        try:
            record_date = datetime.strptime(raw[header_map["date"]], "%Y-%m-%d").date()
        except (ValueError, KeyError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing date (YYYY-MM-DD)",
            ) from exc

        def parse_decimal(column: str) -> float:
            value = raw.get(header_map[column], "0").strip()
            if not value:
                return 0.0
            try:
                return float(value)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid numeric value in column '{column}'",
                ) from exc

        production = parse_decimal("production")
        sales = parse_decimal("sales")
        reported_inventory = None
        if "inventory" in header_map:
            inv_raw = raw.get(header_map["inventory"], "").strip()
            if inv_raw:
                try:
                    reported_inventory = float(inv_raw)
                except ValueError as exc:  # pragma: no cover
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid numeric value in column 'inventory'",
                    ) from exc

        rows_to_insert.append(
            models.PSIRecord(
                session_id=session_id,
                record_date=record_date,
                production=production,
                sales=sales,
                reported_inventory=reported_inventory,
            )
        )
        seen_dates.add(record_date)

    if not rows_to_insert:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV contained no rows")

    with db.begin():
        if session_id is not None:
            db.execute(
                delete(models.PSIRecord)
                .where(models.PSIRecord.session_id == session_id)
                .where(models.PSIRecord.record_date.in_(seen_dates))
            )
        db.add_all(rows_to_insert)

    return schemas.PSIUploadResult(
        rows_imported=len(rows_to_insert),
        session_id=session_id,
        dates=sorted(seen_dates),
    )


@router.get("/daily", response_model=list[schemas.DailyPSI])
def daily_psi(
    *,
    session_id: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    starting_inventory: float = 0,
    db: DBSession = Depends(get_db),
) -> list[schemas.DailyPSI]:
    query = select(models.PSIRecord)
    if session_id is not None:
        query = query.where(models.PSIRecord.session_id == session_id)
    if start_date is not None:
        query = query.where(models.PSIRecord.record_date >= start_date)
    if end_date is not None:
        query = query.where(models.PSIRecord.record_date <= end_date)
    query = query.order_by(models.PSIRecord.record_date.asc())

    records = db.scalars(query).all()
    aggregates: dict[date, dict[str, float | None]] = defaultdict(
        lambda: {"production": 0.0, "sales": 0.0, "reported_inventory": None}
    )
    for record in records:
        bucket = aggregates[record.record_date]
        bucket["production"] += float(record.production)
        bucket["sales"] += float(record.sales)
        if record.reported_inventory is not None:
            bucket["reported_inventory"] = float(record.reported_inventory)

    inventory_cursor = starting_inventory
    results: list[schemas.DailyPSI] = []
    for record_date in sorted(aggregates.keys()):
        production = aggregates[record_date]["production"] or 0.0
        sales = aggregates[record_date]["sales"] or 0.0
        net_change = production - sales
        inventory_cursor = inventory_cursor + net_change
        results.append(
            schemas.DailyPSI(
                date=record_date,
                production=round(production, 2),
                sales=round(sales, 2),
                net_change=round(net_change, 2),
                projected_inventory=round(inventory_cursor, 2),
                reported_inventory=aggregates[record_date]["reported_inventory"],
            )
        )

    return results
