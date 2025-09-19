"""baseline (sessions pre-created by SQL)

Revision ID: de5ff446f71b
Revises: 93c1ff7f769b
Create Date: 2025-09-19 14:18:11.483074

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de5ff446f71b'
down_revision: Union[str, Sequence[str], None] = '93c1ff7f769b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
