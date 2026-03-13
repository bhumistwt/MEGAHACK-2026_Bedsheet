"""
Khetwala-मित्र API Routers
═══════════════════════════════════════════════════════════════════════════════

FastAPI router modules for all API endpoints.
"""

from routers.predict import router as predict_router
from routers.weather import router as weather_router
from routers.market import router as market_router
from routers.disease import router as disease_router
from routers.schemes import router as schemes_router

__all__ = [
    "predict_router",
    "weather_router",
    "market_router",
    "disease_router",
    "schemes_router",
]
