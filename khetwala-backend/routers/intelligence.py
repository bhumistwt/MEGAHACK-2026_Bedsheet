"""
Khetwala-मित्र Intelligence Router (v2)
═══════════════════════════════════════════════════════════════════════════════

Database-backed, ML-powered prediction endpoints.
Replaces static pipeline with real data from PostgreSQL + trained models.
"""

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from ml.price_predictor import PricePredictor
from ml.spoilage_model import SpoilageModel
from ml.harvest_model import HarvestModel
from ml.recommendation_engine import RecommendationEngine

logger = get_logger("khetwala.routers.intelligence")

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


# ══════════════════════════════════════════════════════════════════════════════
# Request Schemas
# ══════════════════════════════════════════════════════════════════════════════


class PriceForecastRequest(BaseModel):
    crop: str = Field(..., min_length=2, examples=["onion"])
    district: str = Field(..., min_length=2, examples=["nashik"])
    forecast_days: int = Field(default=7, ge=1, le=30)


class SpoilageRequest(BaseModel):
    crop: str = Field(..., min_length=2, examples=["tomato"])
    district: str = Field(..., min_length=2, examples=["pune"])
    destination_market: Optional[str] = Field(default=None, examples=["mumbai"])
    storage_type: str = Field(default="covered", examples=["open_air", "covered", "cold_storage"])
    packaging: str = Field(default="jute_bag", examples=["none", "jute_bag", "plastic_crate"])
    harvest_days_ago: int = Field(default=0, ge=0, le=60)
    quantity_kg: float = Field(default=1000.0, gt=0)


class HarvestRequest(BaseModel):
    crop: str = Field(..., min_length=2, examples=["wheat"])
    district: str = Field(..., min_length=2, examples=["nashik"])
    sowing_date: Optional[str] = Field(default=None, examples=["2024-10-15"])
    crop_age_days: Optional[int] = Field(default=None, ge=0, le=365)


class MandiRecommendRequest(BaseModel):
    crop: str = Field(..., min_length=2, examples=["onion"])
    district: str = Field(..., min_length=2, examples=["nashik"])
    quantity_quintals: float = Field(default=10.0, gt=0, le=500)
    storage_type: str = Field(default="covered")
    packaging: str = Field(default="jute_bag")
    target_mandis: Optional[List[str]] = Field(default=None)


class TrainModelRequest(BaseModel):
    crop: str = Field(..., min_length=2)
    district: Optional[str] = Field(default=None)


class FullAdvisoryRequest(BaseModel):
    """Combined request for complete farmer advisory."""
    crop: str = Field(..., min_length=2, examples=["onion"])
    district: str = Field(..., min_length=2, examples=["nashik"])
    quantity_quintals: float = Field(default=10.0, gt=0)
    sowing_date: Optional[str] = Field(default=None)
    storage_type: str = Field(default="covered")
    packaging: str = Field(default="jute_bag")


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/price-forecast")
def price_forecast(
    payload: PriceForecastRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    7-15 day price forecast for a commodity in a district.
    Uses XGBoost model trained on Agmarknet historical data.
    Falls back to statistical forecast if model isn't trained.
    """
    try:
        predictor = PricePredictor(db)
        result = predictor.predict(
            commodity=payload.crop,
            district=payload.district,
            forecast_days=payload.forecast_days,
        )
        return result
    except Exception as exc:
        logger.error(f"Price forecast error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Price forecast failed: {exc}")


@router.post("/spoilage-risk")
def spoilage_risk(
    payload: SpoilageRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Post-harvest spoilage risk assessment.
    Combines crop biology, weather, transit, and storage factors.
    """
    try:
        model = SpoilageModel(db)
        result = model.predict(
            commodity=payload.crop,
            district=payload.district,
            destination_market=payload.destination_market,
            storage_type=payload.storage_type,
            packaging=payload.packaging,
            harvest_days_ago=payload.harvest_days_ago,
            quantity_kg=payload.quantity_kg,
        )
        return result
    except Exception as exc:
        logger.error(f"Spoilage prediction error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Spoilage prediction failed: {exc}")


@router.post("/harvest-window")
def harvest_window(
    payload: HarvestRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Optimal harvest timing recommendation.
    Uses maturity calendar, NDVI satellite data, weather, and price signals.
    """
    try:
        model = HarvestModel(db)
        result = model.predict(
            commodity=payload.crop,
            district=payload.district,
            sowing_date=payload.sowing_date,
            crop_age_days=payload.crop_age_days,
        )
        return result
    except Exception as exc:
        logger.error(f"Harvest prediction error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Harvest prediction failed: {exc}")


@router.post("/mandi-recommend")
def mandi_recommend(
    payload: MandiRecommendRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Ranked mandi recommendations by predicted net profit.
    Formula: Net Profit = (Price × Qty) - Transport - Spoilage Loss
    """
    try:
        engine = RecommendationEngine(db)
        result = engine.recommend(
            commodity=payload.crop,
            origin_district=payload.district,
            quantity_quintals=payload.quantity_quintals,
            storage_type=payload.storage_type,
            packaging=payload.packaging,
            target_mandis=payload.target_mandis,
        )
        return result
    except Exception as exc:
        logger.error(f"Mandi recommendation error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {exc}")


@router.post("/full-advisory")
def full_advisory(
    payload: FullAdvisoryRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Complete farmer advisory combining ALL intelligence signals.
    Single endpoint for the mobile app dashboard.

    Returns: price forecast, spoilage risk, harvest timing, mandi rankings.
    """
    try:
        # Run all models
        predictor = PricePredictor(db)
        spoilage = SpoilageModel(db)
        harvest = HarvestModel(db)
        recommender = RecommendationEngine(db)

        price_result = predictor.predict(
            commodity=payload.crop,
            district=payload.district,
            forecast_days=7,
        )

        spoilage_result = spoilage.predict(
            commodity=payload.crop,
            district=payload.district,
            storage_type=payload.storage_type,
            packaging=payload.packaging,
        )

        harvest_result = harvest.predict(
            commodity=payload.crop,
            district=payload.district,
            sowing_date=payload.sowing_date,
        )

        mandi_result = recommender.quick_recommend(
            commodity=payload.crop,
            district=payload.district,
            quantity_quintals=payload.quantity_quintals,
        )

        # Compose unified advisory
        return {
            "crop": payload.crop,
            "district": payload.district,
            "generated_at": date.today().isoformat(),
            "price_intelligence": {
                "current_price": price_result.get("current_price"),
                "direction": price_result.get("direction"),
                "pct_change": price_result.get("pct_change_forecast"),
                "forecast_7d": price_result.get("forecasts", [])[:3],  # Top 3 days
                "confidence": price_result.get("confidence"),
            },
            "spoilage_risk": {
                "risk_level": spoilage_result.get("risk_level"),
                "loss_pct": spoilage_result.get("spoilage_pct"),
                "shelf_life_remaining": spoilage_result.get("shelf_life_remaining_days"),
                "top_recommendation": (
                    spoilage_result.get("recommendations", [""])[0]
                ),
            },
            "harvest_advisory": {
                "action": harvest_result.get("action"),
                "wait_days": harvest_result.get("wait_days"),
                "reasoning": harvest_result.get("reasoning"),
                "priority": harvest_result.get("priority"),
            },
            "mandi_rankings": mandi_result.get("top_mandis", []),
            "best_mandi": mandi_result.get("best"),
            "summary": _generate_summary(
                price_result, spoilage_result, harvest_result, mandi_result
            ),
        }
    except Exception as exc:
        logger.error(f"Full advisory error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Advisory generation failed: {exc}")


@router.post("/train-model")
def train_price_model(
    payload: TrainModelRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Train/retrain the price prediction model for a commodity.
    Requires sufficient historical data in the database.
    """
    try:
        predictor = PricePredictor(db)
        result = predictor.train(
            commodity=payload.crop,
            district=payload.district,
        )
        return result
    except Exception as exc:
        logger.error(f"Model training error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Training failed: {exc}")


@router.get("/etl-status")
def etl_status() -> Dict[str, Any]:
    """Get the status of ETL pipelines and last sync times."""
    try:
        from etl.scheduler import ETLScheduler
        scheduler = ETLScheduler.__new__(ETLScheduler)
        return scheduler.get_status()
    except Exception:
        return {"status": "scheduler_not_initialized"}


@router.get("/data-status")
def data_status(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get counts of data in all tables — useful for health monitoring."""
    from db.models import MandiPrice, WeatherRecord, SoilProfile, NDVIRecord, CropMeta, TransportRoute
    from sqlalchemy import func

    return {
        "mandi_prices": db.query(func.count(MandiPrice.id)).scalar(),
        "weather_records": db.query(func.count(WeatherRecord.id)).scalar(),
        "soil_profiles": db.query(func.count(SoilProfile.id)).scalar(),
        "ndvi_records": db.query(func.count(NDVIRecord.id)).scalar(),
        "crop_meta": db.query(func.count(CropMeta.id)).scalar(),
        "transport_routes": db.query(func.count(TransportRoute.id)).scalar(),
    }


def _generate_summary(
    price: Dict, spoilage: Dict, harvest: Dict, mandi: Dict
) -> str:
    """Generate one-line summary for farmer dashboard."""
    parts = []

    action = harvest.get("action", "")
    if action == "harvest_now":
        parts.append("🟢 Harvest now")
    elif action == "urgent_harvest":
        parts.append("🔴 Harvest urgently")
    elif action == "wait":
        wait = harvest.get("wait_days", 0)
        parts.append(f"🟡 Wait {wait} days")

    direction = price.get("direction", "stable")
    if direction == "rising":
        parts.append("📈 Prices rising")
    elif direction == "falling":
        parts.append("📉 Prices falling")

    risk = spoilage.get("risk_level", "")
    if risk in ("High", "Critical"):
        parts.append(f"⚠️ {risk} spoilage risk")

    best = mandi.get("best", "")
    if best:
        parts.append(f"🏪 Best: {best}")

    return " | ".join(parts) if parts else "Advisory generated"
