"""
Khetwala Backend — Production FastAPI Application
═══════════════════════════════════════════════════════════════════════════════

AI-powered post-harvest advisory system for Indian farmers.
Provides APIs for harvest timing, mandi prices, spoilage risk,
disease detection, and government schemes.
"""

import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Core modules
from core.config import settings
from core.exceptions import register_exception_handlers
from core.logging import get_logger, setup_logging
from core.middleware import setup_middleware

# Routers
from routers.predict import router as predict_router
from routers.weather import router as weather_router
from routers.market import router as market_router
from routers.disease import router as disease_router
from routers.schemes import router as schemes_router
from routers.intelligence import router as intelligence_router
from routers.auth import router as auth_router
from routers.aria import router as aria_router
from routers.aria_memory import router as aria_memory_router
from routers.aria_agent import router as aria_agent_router
from routers.digital_twin import router as digital_twin_router
from routers.harvest_cycles import router as harvest_cycles_router
from routers.simulator import router as simulator_router
from routers.community import router as community_router
from routers.diary import router as diary_router
from routers.credit_score import router as credit_score_router
from routers.marketplace import router as marketplace_router
from routers.policy_risk import router as policy_risk_router
from routers.b2b import router as b2b_router
from routers.sms import router as sms_router
from routers.iot import router as iot_router
from routers.photo_diagnostic import router as photo_diagnostic_router
from routers.soil_health import router as soil_health_router
from routers.blockchain import router as blockchain_router
from routers.deal_communication import router as deal_communication_router
from routers.voice_agent import router as voice_agent_router
from routers.telemetry import router as telemetry_router

# Database & ETL
from db.session import init_db
from db.seed import run_all_seeds
from etl.scheduler import ETLScheduler
from sqlalchemy import text

# Initialize logging
setup_logging()
logger = get_logger("khetwala.main")


# ═══════════════════════════════════════════════════════════════════════════════
# Application Lifespan
# ═══════════════════════════════════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown hooks."""
    logger.info(
        "Khetwala API starting",
        environment=settings.environment,
        host=settings.api_host,
        port=settings.api_port,
    )

    # Log API status
    api_status = settings.get_api_status()
    for service, status in api_status.items():
        emoji = "✅" if status == "active" else "⚠️"
        logger.info(f"   {service.capitalize()}: {emoji} {status}")

    # ─── Database Initialization ──────────────────────────────────────────
    try:
        logger.info("Initializing database...")
        init_db()
        logger.info("✅ Database tables created/verified")

        # Seed baseline data (crops, soil profiles, transport routes)
        from db.session import SessionLocal
        seed_db = SessionLocal()
        try:
            run_all_seeds(seed_db)
            logger.info("✅ Seed data loaded")
        finally:
            seed_db.close()
    except Exception as exc:
        logger.error(f"⚠️ Database init failed: {exc}. Running without DB.",
                      exc_info=True)

    # ─── ETL Scheduler ────────────────────────────────────────────────────
    etl_scheduler = None
    if settings.etl_enabled:
        try:
            etl_scheduler = ETLScheduler()
            etl_scheduler.start()
            logger.info("✅ ETL scheduler started")

            # Run initial sync if tables are empty
            await etl_scheduler.run_initial_sync()
            logger.info("✅ Initial ETL sync complete")
        except Exception as exc:
            logger.warning(f"⚠️ ETL scheduler failed to start: {exc}",
                           exc_info=True)

    yield

    # ─── Shutdown ─────────────────────────────────────────────────────────
    if etl_scheduler:
        etl_scheduler.stop()
        logger.info("ETL scheduler stopped")

    logger.info("Khetwala API shutting down")


# ═══════════════════════════════════════════════════════════════════════════════
# Application Factory
# ═══════════════════════════════════════════════════════════════════════════════


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title="Khetwala API",
        description=(
            "AI-powered post-harvest advisory system for Indian farmers.\n\n"
            "## Features\n"
            "- 🌾 **Harvest Timing**: Optimal harvest window predictions\n"
            "- 📊 **Mandi Prices**: Real-time market price intelligence\n"
            "- 📦 **Spoilage Risk**: Storage and transit risk assessment\n"
            "- 🔬 **Disease Detection**: AI-powered crop disease scanning\n"
            "- 🏛️ **Government Schemes**: Relevant scheme recommendations\n"
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.is_development else None,
        redoc_url="/redoc" if settings.is_development else None,
        openapi_url="/openapi.json" if settings.is_development else "/api/v1/openapi.json",
    )

    # ─── CORS Configuration ───────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    # ─── Register Middleware ──────────────────────────────────────────────────
    setup_middleware(app)

    # ─── Register Exception Handlers ──────────────────────────────────────────
    register_exception_handlers(app)

    # ─── Register Routers ─────────────────────────────────────────────────────
    api_prefix = "/api/v1" if settings.is_production else ""

    app.include_router(auth_router, prefix=api_prefix)
    app.include_router(aria_router, prefix=api_prefix)
    app.include_router(aria_memory_router, prefix=api_prefix)
    app.include_router(aria_agent_router, prefix=api_prefix)
    app.include_router(predict_router, prefix=api_prefix)
    app.include_router(intelligence_router, prefix=api_prefix)
    app.include_router(weather_router, prefix=api_prefix)
    app.include_router(market_router, prefix=api_prefix)
    app.include_router(disease_router, prefix=api_prefix)
    app.include_router(schemes_router, prefix=api_prefix)
    app.include_router(digital_twin_router, prefix=api_prefix)
    app.include_router(harvest_cycles_router, prefix=api_prefix)
    app.include_router(simulator_router, prefix=api_prefix)
    app.include_router(community_router, prefix=api_prefix)
    app.include_router(diary_router, prefix=api_prefix)
    app.include_router(credit_score_router, prefix=api_prefix)
    app.include_router(marketplace_router, prefix=api_prefix)
    app.include_router(policy_risk_router, prefix=api_prefix)
    app.include_router(b2b_router, prefix=api_prefix)
    app.include_router(sms_router, prefix=api_prefix)
    app.include_router(iot_router, prefix=api_prefix)
    app.include_router(photo_diagnostic_router, prefix=api_prefix)
    app.include_router(soil_health_router, prefix=api_prefix)
    app.include_router(blockchain_router, prefix=api_prefix)
    app.include_router(deal_communication_router, prefix=api_prefix)
    app.include_router(voice_agent_router, prefix=api_prefix)
    app.include_router(telemetry_router, prefix=api_prefix)

    return app


# Create application instance
app = create_app()


# ═══════════════════════════════════════════════════════════════════════════════
# Root Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@app.get("/", tags=["status"])
def root() -> Dict[str, str]:
    """Root endpoint with API information."""
    return {
        "name": "Khetwala API",
        "version": "1.0.0",
        "status": "running",
        "environment": settings.environment,
        "docs": "/docs" if settings.is_development else "disabled",
    }


@app.get("/health", tags=["status"])
def health_check() -> Dict[str, Any]:
    """
    Health check endpoint for monitoring and load balancers.

    Returns service status and configuration state.
    """
    # Check DB connectivity
    db_status = "unknown"
    try:
        from db.session import SessionLocal
        test_db = SessionLocal()
        test_db.execute(text("SELECT 1"))
        test_db.close()
        db_status = "connected"
    except Exception:
        db_status = "disconnected"

    services = settings.get_api_status()
    services["database"] = db_status

    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
        "environment": settings.environment,
        "services": services,
    }


@app.get("/ready", tags=["status"])
def readiness_check() -> Dict[str, Any]:
    """
    Readiness check for Kubernetes/container orchestration.

    Returns ready status when the application is ready to receive traffic.
    """
    return {
        "ready": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Development Server Entry Point
# ═══════════════════════════════════════════════════════════════════════════════


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )
