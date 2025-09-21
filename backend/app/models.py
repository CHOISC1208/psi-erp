"""Database models for the PSI ERP backend."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import settings


class Base(DeclarativeBase):
    """Declarative base that is aware of the configured schema."""

    __abstract__ = True

    @property
    def schema(self) -> str:
        """Return the active database schema."""

        return settings.db_schema


class SchemaMixin:
    """Mixin ensuring tables are created within the configured schema."""

    __table_args__ = {"schema": settings.db_schema or "public"}


class TimestampMixin:
    """Mixin providing ``created_at`` and ``updated_at`` columns."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Session(Base, SchemaMixin, TimestampMixin):
    """Represents a collaborative PSI planning session.

    Attributes:
        id: Primary key identifier backed by UUID values.
        title: Session title shown to users.
        description: Optional free-form narrative for the session.
        is_leader: Flag indicating whether this session is the active leader.
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_leader: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    psi_base_records: Mapped[list["PSIBase"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    psi_edits: Mapped[list["PSIEdit"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    channel_transfers: Mapped[list["ChannelTransfer"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class MasterRecord(Base, SchemaMixin, TimestampMixin):
    """Generic master data record stored as flexible JSON payloads."""

    __tablename__ = "master_records"

    id: Mapped[str] = mapped_column(
        String(length=36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    master_type: Mapped[str] = mapped_column(String(length=64), index=True, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class PSIBase(Base, SchemaMixin):
    """Immutable PSI base data imported from operational systems.

    Attributes match the ``psi.psi_base`` table as described in ``docs/database.md``.
    """

    __tablename__ = "psi_base"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{settings.db_schema}.sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    sku_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    warehouse_name: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    stock_at_anchor: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    inbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    outbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    net_flow: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    stock_closing: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    safety_stock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    movable_stock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped[Session] = relationship(back_populates="psi_base_records")


class PSIEdit(Base, SchemaMixin, TimestampMixin):
    """Editable PSI overrides entered via the UI.

    When an edited value is ``NULL`` the corresponding base value should be used.
    """

    __tablename__ = "psi_edits"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{settings.db_schema}.sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    warehouse_name: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    inbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    outbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    safety_stock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))

    session: Mapped[Session] = relationship(back_populates="psi_edits")


class PSIEditLog(Base, SchemaMixin):
    """Audit log entry capturing each manual PSI edit."""

    __tablename__ = "psi_edit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{settings.db_schema}.sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    warehouse_name: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    new_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    edited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    edited_by: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChannelTransfer(Base, SchemaMixin, TimestampMixin):
    """Represents stock movement between sales channels within a warehouse."""

    __tablename__ = "channel_transfers"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "transfer_date",
            "from_channel",
            "to_channel",
            name="uq_channel_transfers_key",
        ),
        {"schema": settings.db_schema or "public"},
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{settings.db_schema}.sessions.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    warehouse_name: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    transfer_date: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    from_channel: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    to_channel: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped[Session] = relationship(back_populates="channel_transfers")


def ensure_channel_transfers_table(bind: Engine | Connection) -> None:
    """Create the channel transfers table when it does not exist.

    The application historically operated without the ``channel_transfers``
    table.  Newer builds expect the table to be present which can trigger
    ``UndefinedTable`` errors when the database has not been migrated yet.
    Using ``checkfirst`` keeps the call idempotent while ensuring we can
    safely execute queries relying on the table.
    """

    table = ChannelTransfer.__table__
    table.create(bind=bind, checkfirst=True)
