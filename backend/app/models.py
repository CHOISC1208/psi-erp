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
    Index,
    Integer,
    JSON,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    inspect,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import settings


AUTO_INCREMENT_PK = Integer().with_variant(BigInteger, "postgresql")


def _qualified(table: str, column: str = "id") -> str:
    """Return a fully qualified table reference respecting the schema."""

    schema = settings.db_schema.strip()
    if schema:
        return f"{schema}.{table}.{column}"
    return f"{table}.{column}"


class Base(DeclarativeBase):
    """Declarative base that is aware of the configured schema."""

    __abstract__ = True

    @property
    def schema(self) -> str:
        """Return the active database schema."""

        return settings.db_schema


class SchemaMixin:
    """Mixin ensuring tables are created within the configured schema."""

    _schema = settings.db_schema.strip() if settings.db_schema else ""
    __table_args__ = {"schema": _schema} if _schema else {}


class TimestampMixin:
    """Mixin providing ``created_at`` and ``updated_at`` columns."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UserTrackingMixin:
    """Mixin providing audit user relationships."""

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey(_qualified("users")), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey(_qualified("users")), nullable=True
    )


class User(Base, SchemaMixin):
    """Application user able to sign into the dashboard."""

    __tablename__ = "users"
    __table_args__ = (
        Index("idx_users_username", "username", unique=True),
        SchemaMixin.__table_args__ if SchemaMixin.__table_args__ else {},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=func.true()
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Session(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
    """Represents a collaborative PSI planning session.

    Attributes:
        id: Primary key identifier backed by UUID values.
        title: Session title shown to users.
        description: Optional free-form narrative for the session.
        is_leader: Flag indicating whether this session is the active leader.
    """

    __tablename__ = "sessions"

    __table_args__ = (
        Index("idx_sessions_created_by", "created_by"),
        Index("idx_sessions_updated_by", "updated_by"),
        SchemaMixin.__table_args__ if SchemaMixin.__table_args__ else {},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_leader: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    data_type: Mapped[str] = mapped_column(String(length=16), default="base", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey(_qualified("users")), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey(_qualified("users")), nullable=True
    )

    psi_base_records: Mapped[list["PSIBase"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    psi_summary_records: Mapped[list["PSISummaryBase"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    psi_edits: Mapped[list["PSIEdit"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    channel_transfers: Mapped[list["ChannelTransfer"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    transfer_plans: Mapped[list["TransferPlan"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    created_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="Session.created_by",
        lazy="selectin",
    )
    updated_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="Session.updated_by",
        lazy="selectin",
    )


class MasterRecord(Base, SchemaMixin, TimestampMixin):
    """Generic master data record stored as flexible JSON payloads."""

    __tablename__ = "master_records"

    id: Mapped[str] = mapped_column(
        String(length=36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    master_type: Mapped[str] = mapped_column(String(length=64), index=True, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


class ChannelMaster(Base, SchemaMixin):
    """Sales channel master data shared across warehouses."""

    __tablename__ = "channel_master"

    channel: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)


class WarehouseMaster(Base, SchemaMixin):
    """Warehouse definitions enriched with metadata such as main channel."""

    __tablename__ = "warehouse_master"
    __table_args__ = (
        Index("idx_warehouse_master_main_channel", "main_channel"),
        SchemaMixin.__table_args__,
    )

    warehouse_name: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    region: Mapped[str | None] = mapped_column(Text, nullable=True)
    main_channel: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey(
            _qualified("channel_master", "channel"),
            ondelete="SET NULL",
            onupdate="CASCADE",
        ),
        nullable=True,
    )


class ReallocationPolicy(Base, SchemaMixin):
    """Global configuration controlling the reallocation algorithm."""

    __tablename__ = "reallocation_policy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    take_from_other_main: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    rounding_mode: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'floor'")
    )
    allow_overfill: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    fair_share_mode: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'off'"), default="off"
    )
    deficit_basis: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'closing'"), default="closing"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)


class CategoryRankParameter(Base, SchemaMixin):
    """Threshold configuration used to derive rank classifications per category."""

    __tablename__ = "category_rank_parameters"

    __table_args__ = (
        PrimaryKeyConstraint("rank_type", "category_1", "category_2", name="pk_category_rank_parameters"),
        SchemaMixin.__table_args__,
    )

    rank_type: Mapped[str] = mapped_column(Text, nullable=False)
    category_1: Mapped[str] = mapped_column(Text, nullable=False)
    category_2: Mapped[str] = mapped_column(Text, nullable=False)
    threshold: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)


class PSIMetricDefinition(Base, SchemaMixin):
    """Definition of metrics displayed on the PSI table."""

    __tablename__ = "psi_metrics_master"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    is_editable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)


class PSIBase(Base, SchemaMixin):
    """Immutable PSI base data imported from operational systems.

    Attributes match the ``psi.psi_base`` table as described in ``docs/database.md``.
    """

    __tablename__ = "psi_base"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
            "date",
            name="uq_psibase_key",
        ),
        Index(
            "idx_psibase_lookup",
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
            "date",
        ),
        Index("idx_psi_base_fw_rank", "fw_rank"),
        Index("idx_psi_base_ss_rank", "ss_rank"),
        SchemaMixin.__table_args__,
    )

    id: Mapped[int] = mapped_column(AUTO_INCREMENT_PK, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    sku_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_1: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_2: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_3: Mapped[str | None] = mapped_column(Text, nullable=True)
    fw_rank: Mapped[str | None] = mapped_column(String(2), nullable=True)
    ss_rank: Mapped[str | None] = mapped_column(String(2), nullable=True)
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
    stdstock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    gap: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped[Session] = relationship(back_populates="psi_base_records")


class PSISummaryBase(Base, SchemaMixin):
    """Summary PSI data imported for sessions without daily records."""

    __tablename__ = "psi_summary_base"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
            name="uq_psi_summary_base_key",
        ),
        Index(
            "idx_psi_summary_base_lookup",
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
        ),
        SchemaMixin.__table_args__,
    )

    id: Mapped[int] = mapped_column(AUTO_INCREMENT_PK, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    sku_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    warehouse_name: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    inbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    outbound_qty: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    std_stock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    stock: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped[Session] = relationship(back_populates="psi_summary_records")


class PSIEdit(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
    """Editable PSI overrides entered via the UI.

    When an edited value is ``NULL`` the corresponding base value should be used.
    """

    __tablename__ = "psi_edits"
    __table_args__ = SchemaMixin.__table_args__ | {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(AUTO_INCREMENT_PK, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
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
    created_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="PSIEdit.created_by",
        lazy="selectin",
    )
    updated_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="PSIEdit.updated_by",
        lazy="selectin",
    )


class PSIEditLog(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
    """Audit log entry capturing each manual PSI edit."""

    __tablename__ = "psi_edit_log"
    __table_args__ = SchemaMixin.__table_args__ | {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(AUTO_INCREMENT_PK, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
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
    edited_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey(_qualified("users")), nullable=True
    )


class ChannelTransfer(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
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
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
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
    created_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="ChannelTransfer.created_by",
        lazy="selectin",
    )
    updated_by_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys="ChannelTransfer.updated_by",
        lazy="selectin",
    )


class TransferPlan(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
    """Stock transfer plan generated by the recommendation engine."""

    __tablename__ = "transfer_plan"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("sessions"), ondelete="CASCADE"),
        nullable=False,
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")

    session: Mapped[Session] = relationship(back_populates="transfer_plans")
    lines: Mapped[list["TransferPlanLine"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )


class TransferPlanLine(Base, SchemaMixin, TimestampMixin, UserTrackingMixin):
    """Individual stock move within a transfer plan."""

    __tablename__ = "transfer_plan_line"

    line_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(_qualified("transfer_plan", "plan_id"), ondelete="CASCADE"),
        nullable=False,
    )
    sku_code: Mapped[str] = mapped_column(Text, nullable=False)
    from_warehouse: Mapped[str] = mapped_column(Text, nullable=False)
    from_channel: Mapped[str] = mapped_column(Text, nullable=False)
    to_warehouse: Mapped[str] = mapped_column(Text, nullable=False)
    to_channel: Mapped[str] = mapped_column(Text, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    plan: Mapped[TransferPlan] = relationship(back_populates="lines")


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


def channel_transfer_table_exists(bind: Engine | Connection) -> bool:
    """Return whether the channel transfer table is available on the bind."""

    inspector = inspect(bind)
    schema = settings.db_schema or "public"

    if bind.dialect.name == "sqlite":
        return inspector.has_table("channel_transfers")

    return inspector.has_table("channel_transfers", schema=schema)


def ensure_psi_summary_base_table(bind: Engine | Connection) -> None:
    """Create the PSI summary base table when migrations haven't run."""

    table = PSISummaryBase.__table__
    table.create(bind=bind, checkfirst=True)
