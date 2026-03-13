"""
Khetwala-मित्र Error Handling
═══════════════════════════════════════════════════════════════════════════════

Centralized exception handling with structured error responses.
Provides consistent error formats for API consumers.
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.logging import get_logger

logger = get_logger("khetwala.errors")


# ═══════════════════════════════════════════════════════════════════════════════
# Error Response Models
# ═══════════════════════════════════════════════════════════════════════════════


class ErrorDetail(BaseModel):
    """Detailed error information."""

    code: str
    message: str
    field: Optional[str] = None


class ErrorResponse(BaseModel):
    """Standardized error response format."""

    success: bool = False
    error: str
    error_code: str
    details: Optional[list[ErrorDetail]] = None
    request_id: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════════
# Custom Exceptions
# ═══════════════════════════════════════════════════════════════════════════════


class KhetwalaException(Exception):
    """Base exception for Khetwala-मित्र application."""

    def __init__(
        self,
        message: str,
        error_code: str = "INTERNAL_ERROR",
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        details: Optional[list[ErrorDetail]] = None,
    ):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class ValidationError(KhetwalaException):
    """Raised when input validation fails."""

    def __init__(self, message: str, field: Optional[str] = None):
        details = [ErrorDetail(code="VALIDATION_ERROR", message=message, field=field)] if field else None
        super().__init__(
            message=message,
            error_code="VALIDATION_ERROR",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


class ExternalAPIError(KhetwalaException):
    """Raised when an external API call fails."""

    def __init__(self, service: str, message: str):
        super().__init__(
            message=f"{service} service error: {message}",
            error_code="EXTERNAL_API_ERROR",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )


class ServiceUnavailableError(KhetwalaException):
    """Raised when a required service is unavailable."""

    def __init__(self, service: str, reason: str = "Service not configured"):
        super().__init__(
            message=f"{service}: {reason}",
            error_code="SERVICE_UNAVAILABLE",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class RateLimitExceededError(KhetwalaException):
    """Raised when rate limit is exceeded."""

    def __init__(self):
        super().__init__(
            message="Rate limit exceeded. Please try again later.",
            error_code="RATE_LIMIT_EXCEEDED",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        )


class NotFoundError(KhetwalaException):
    """Raised when a resource is not found."""

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"{resource} '{identifier}' not found",
            error_code="NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Exception Handlers
# ═══════════════════════════════════════════════════════════════════════════════


async def khetwala_exception_handler(
    request: Request, exc: KhetwalaException
) -> JSONResponse:
    """Handle Khetwala-मित्र custom exceptions."""
    logger.warning(
        "Application error",
        error_code=exc.error_code,
        message=exc.message,
        path=str(request.url.path),
    )

    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.message,
            error_code=exc.error_code,
            details=exc.details,
        ).model_dump(),
    )


async def http_exception_handler(
    request: Request, exc: HTTPException
) -> JSONResponse:
    """Handle FastAPI HTTPException."""
    logger.warning(
        "HTTP error",
        status_code=exc.status_code,
        detail=exc.detail,
        path=str(request.url.path),
    )

    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=str(exc.detail),
            error_code=f"HTTP_{exc.status_code}",
        ).model_dump(),
    )


async def validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Handle Pydantic validation errors."""
    from pydantic import ValidationError as PydanticValidationError

    if isinstance(exc, PydanticValidationError):
        details = [
            ErrorDetail(
                code="VALIDATION_ERROR",
                message=str(err.get("msg", "Invalid value")),
                field=".".join(str(loc) for loc in err.get("loc", [])),
            )
            for err in exc.errors()
        ]

        logger.warning(
            "Validation error",
            errors=len(details),
            path=str(request.url.path),
        )

        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                error="Validation failed",
                error_code="VALIDATION_ERROR",
                details=details,
            ).model_dump(),
        )

    # Fallback for other validation errors
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ErrorResponse(
            error=str(exc),
            error_code="VALIDATION_ERROR",
        ).model_dump(),
    )


async def generic_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Handle unexpected exceptions."""
    logger.exception(
        "Unhandled exception",
        error_type=type(exc).__name__,
        path=str(request.url.path),
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error="An unexpected error occurred. Please try again later.",
            error_code="INTERNAL_ERROR",
        ).model_dump(),
    )


def register_exception_handlers(app) -> None:
    """Register all exception handlers with the FastAPI app."""
    from pydantic import ValidationError as PydanticValidationError

    app.add_exception_handler(KhetwalaException, khetwala_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(PydanticValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
