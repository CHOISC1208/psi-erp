from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool, text
import os, sys

# import パス調整
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from app.config import settings
from app.models import Base, Session  # ← Session も明示importしておく

print("DEBUG Alembic tables from Base:", list(Base.metadata.tables.keys()))

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline():
    url = settings.DATABASE_URL
    # バージョンテーブルをスキーマ配下に
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_schemas=True,
        version_table_schema=settings.DB_SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = settings.DATABASE_URL
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # ① スキーマを作成（なければ）
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {settings.DB_SCHEMA}"))
        # ② search_path をスキーマ優先に
        connection.execute(text(f"SET search_path TO {settings.DB_SCHEMA}, public"))

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_schemas=True,
            version_table_schema=settings.DB_SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()
