"""Utilities for cache invalidation hooks."""

from __future__ import annotations

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


def invalidate_reallocation_cache(session_id: UUID) -> None:
    """Invalidate any cached reallocation artefacts for the session.

    The real integration point for cache invalidation lives in a separate service.
    For now this helper simply logs the request so the call sites remain stable
    when wiring the final implementation.
    """

    logger.info("Reallocation cache invalidation requested", extra={"session_id": str(session_id)})
