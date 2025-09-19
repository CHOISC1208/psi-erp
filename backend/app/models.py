"""Database models."""
from __future__ import annotations

import uuid
from datetime import datetime, date

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import settings


class Base(DeclarativeBase):
    """Base model configured with the configured database schema."""

    __abstract__ = True

    @property
    def schema(self) -> str:
        return settings.db_schema


class SchemaMixin:
    """Mixin to ensure every table is created under the configured schema."""

    __table_args__ = {"schema": settings.db_schema or "public"}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Session(Base, SchemaMixin, TimestampMixin):
    """Collaborative PSI planning session."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(length=36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_leader: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    psi_records: Mapped[list["PSIRecord"]] = relationship(back_populates="session")


class PSIRecord(Base, SchemaMixin):
    """Daily PSI record imported from CSV."""

    __tablename__ = "psi_records"

    id: Mapped[str] = mapped_column(
        String(length=36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str | None] = mapped_column(
        String(length=36), ForeignKey(f"{settings.db_schema}.sessions.id"), nullable=True
    )
    record_date: Mapped[date] = mapped_column(Date, nullable=False)
    production: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    sales: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    reported_inventory: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped[Session | None] = relationship(back_populates="psi_records")
