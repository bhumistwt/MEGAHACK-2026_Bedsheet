"""Predict routers — harvest, mandi, spoilage, and explainability endpoints."""

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from decision_engine import combine_model_outputs
from explainability_engine import generate_explanation
from models.harvest_window_model import HarvestWindowModel
from models.price_trend_model import PriceTrendModel
from models.spoilage_risk_model import SpoilageRiskModel
from services.feature_engineering import build_features

router = APIRouter(prefix="/predict", tags=["predictions"])

# Shared model instances (initialized once at import)
price_trend_model = PriceTrendModel()
harvest_window_model = HarvestWindowModel()
spoilage_risk_model = SpoilageRiskModel()


# ── Request schemas ──────────────────────────────────────────────────────

class HarvestRequest(BaseModel):
    crop: str = Field(..., min_length=2)
    district: str = Field(..., min_length=2)
    sowing_date: str
    crop_stage: str = Field(..., min_length=2)
    soil_type: str = Field(..., min_length=2)
    state: str = Field(default="Maharashtra")


class MandiRequest(BaseModel):
    crop: str = Field(..., min_length=2)
    district: str = Field(..., min_length=2)
    quantity_quintals: float = Field(..., gt=0)
    state: str = Field(default="Maharashtra")


class SpoilageRequest(BaseModel):
    crop: str = Field(..., min_length=2)
    storage_type: str = Field(..., min_length=2)
    transit_hours: float = Field(..., ge=0, le=72)
    days_since_harvest: int = Field(..., ge=0, le=120)
    district: str = Field(..., min_length=2)
    state: str = Field(default="Maharashtra")


class ExplainRequest(BaseModel):
    crop: str = Field(..., min_length=2)
    district: str = Field(..., min_length=2)
    decision_id: str = Field(..., min_length=1)
    state: str = Field(default="Maharashtra")


# ── Shared pipeline ─────────────────────────────────────────────────────

def _default_sowing_date() -> str:
    from datetime import date, timedelta
    return (date.today() - timedelta(days=110)).isoformat()


def _run_pipeline(
    crop: str,
    district: str,
    storage_type: str,
    transit_hours: float,
    days_since_harvest: int,
    crop_stage: str,
    sowing_date: str,
    state: str,
    quantity_quintals: float = 10.0,
) -> Dict[str, Any]:
    features = build_features(
        crop=crop,
        district=district,
        storage_type=storage_type,
        transit_hours=transit_hours,
        days_since_harvest=days_since_harvest,
        crop_stage=crop_stage,
        state=state,
        quantity_quintals=quantity_quintals,
    )

    price_trend = price_trend_model.predict(features=features)
    spoilage_risk = spoilage_risk_model.predict(
        crop=crop,
        storage_type=storage_type,
        transit_hours=transit_hours,
        days_since_harvest=days_since_harvest,
        avg_temp=float(features.get("avg_temp", 32.0)),
        humidity_index=float(features.get("humidity_index", 65.0)),
        rain_in_3days=bool(features.get("rain_in_3days", False)),
    )
    harvest_window = harvest_window_model.predict(
        crop_type=crop,
        crop_stage=crop_stage,
        sowing_date=sowing_date,
        weather_features=features["weather_features"],
        price_trend=price_trend,
        spoilage_risk=spoilage_risk,
    )
    decision = combine_model_outputs(
        price_trend=price_trend,
        harvest_window=harvest_window,
        spoilage_risk=spoilage_risk,
        features=features,
    )

    return {
        "features": features,
        "price_trend": price_trend,
        "spoilage_risk": spoilage_risk,
        "harvest_window": harvest_window,
        "decision": decision,
    }


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/harvest")
def predict_harvest(payload: HarvestRequest) -> Dict[str, Any]:
    try:
        result = _run_pipeline(
            crop=payload.crop,
            district=payload.district,
            storage_type="warehouse",
            transit_hours=12,
            days_since_harvest=0,
            crop_stage=payload.crop_stage,
            sowing_date=payload.sowing_date,
            state=payload.state,
            quantity_quintals=10.0,
        )
        harvest = result["harvest_window"]
        return {
            "harvest_window": {
                "start": harvest["harvest_window_start"],
                "end": harvest["harvest_window_end"],
            },
            "recommendation": harvest["recommendation"],
            "risk_if_delayed": harvest["risk_if_delayed"],
            "confidence": harvest["confidence"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Harvest prediction failed: {exc}")


@router.post("/mandi")
def predict_mandi(payload: MandiRequest) -> Dict[str, Any]:
    try:
        result = _run_pipeline(
            crop=payload.crop,
            district=payload.district,
            storage_type="warehouse",
            transit_hours=12,
            days_since_harvest=1,
            crop_stage="harvest-ready",
            sowing_date=_default_sowing_date(),
            state=payload.state,
            quantity_quintals=payload.quantity_quintals,
        )
        features = result["features"]
        price_trend = result["price_trend"]

        return {
            "best_mandi": features["best_mandi_name"],
            "expected_price_range": price_trend["expected_price_range"],
            "transport_cost": features["transport_cost_estimate"],
            "net_profit_comparison": {
                "best_mandi": features["net_profit_best_mandi"],
                "local_mandi": features["net_profit_local"],
            },
            "price_trend": {
                "direction": price_trend["direction"],
                "confidence": price_trend["confidence"],
            },
            "confidence": price_trend["confidence"],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mandi prediction failed: {exc}")


@router.post("/spoilage")
def predict_spoilage(payload: SpoilageRequest) -> Dict[str, Any]:
    try:
        result = _run_pipeline(
            crop=payload.crop,
            district=payload.district,
            storage_type=payload.storage_type,
            transit_hours=payload.transit_hours,
            days_since_harvest=payload.days_since_harvest,
            crop_stage="post-harvest",
            sowing_date=_default_sowing_date(),
            state=payload.state,
            quantity_quintals=10.0,
        )
        spoilage = result["spoilage_risk"]
        decision = result["decision"]

        return {
            "risk_score": spoilage["risk_score"],
            "risk_category": spoilage["risk_category"],
            "risk_factors": spoilage["risk_factors"],
            "days_safe": spoilage["days_safe"],
            "preservation_actions_ranked": decision["preservation_actions"],
            "avg_temp": result["features"].get("avg_temp"),
            "confidence": round(
                (float(spoilage["confidence"]) + float(decision["overall_confidence"])) / 2.0,
                3,
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Spoilage prediction failed: {exc}")


@router.post("/explain")
def explain_recommendation(payload: ExplainRequest) -> Dict[str, Any]:
    try:
        result = _run_pipeline(
            crop=payload.crop,
            district=payload.district,
            storage_type="warehouse",
            transit_hours=12,
            days_since_harvest=2,
            crop_stage="harvest-ready",
            sowing_date=_default_sowing_date(),
            state=payload.state,
            quantity_quintals=10.0,
        )
        explanation = generate_explanation(
            decision=result["decision"],
            features=result["features"],
            price_trend=result["price_trend"],
            spoilage_risk=result["spoilage_risk"],
        )
        return {
            "weather_reason": explanation["weather_reason"],
            "market_reason": explanation["market_reason"],
            "supply_reason": explanation["supply_reason"],
            "confidence_message": explanation["confidence_message"],
            "confidence": result["decision"]["overall_confidence"],
            "decision_id": payload.decision_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Explainability failed: {exc}")
