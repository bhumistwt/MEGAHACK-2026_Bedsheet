"""
Khetwala-मित्र Logging Configuration
═══════════════════════════════════════════════════════════════════════════════

Production-grade structured logging with support for both human-readable
and JSON formats. Uses structlog for structured logging capabilities.
"""

import logging
import sys
from typing import Any, Dict

import structlog
from structlog.types import Processor

from core.config import settings


def setup_logging() -> None:
    """Configure structured logging for the application."""

    # Determine log level
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    # Configure shared processors
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if settings.log_json_format or settings.is_production:
        # JSON format for production
        renderer = structlog.processors.JSONRenderer()
    else:
        # Human-readable format for development
        # Disable colors on Windows to avoid colorama recursive-write crashes
        import os
        use_colors = os.name != "nt" and not os.environ.get("NO_COLOR")
        renderer = structlog.dev.ConsoleRenderer(
            colors=use_colors,
            exception_formatter=structlog.dev.plain_traceback,
        )

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Configure standard library logging
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=renderer,
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)

    # Set levels for noisy libraries
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str = "khetwala") -> structlog.BoundLogger:
    """Get a configured logger instance."""
    return structlog.get_logger(name)


class RequestLogger:
    """Middleware-compatible request logger."""

    def __init__(self):
        self.logger = get_logger("khetwala.request")

    def log_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        client_ip: str = "unknown",
        extra: Dict[str, Any] = None,
    ) -> None:
        """Log an HTTP request with structured data."""
        log_data = {
            "method": method,
            "path": path,
            "status_code": status_code,
            "duration_ms": round(duration_ms, 2),
            "client_ip": client_ip,
            **(extra or {}),
        }

        if status_code >= 500:
            self.logger.error("Request failed", **log_data)
        elif status_code >= 400:
            self.logger.warning("Request error", **log_data)
        else:
            self.logger.info("Request completed", **log_data)


# Initialize logging on module import
setup_logging()
logger = get_logger()
request_logger = RequestLogger()
