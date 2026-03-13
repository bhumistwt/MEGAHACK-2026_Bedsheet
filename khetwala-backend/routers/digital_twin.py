"""
[F1] Crop Digital Twin Router
═══════════════════════════════════════════════════════════════════════════════

Real-time virtual crop simulation per farmer's field.
Supports what-if queries and daily health updates.
"""

import json
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from routers.auth import ensure_user_access, require_current_user
from db.models import CropSimulation, CropMeta, WeatherRecord, SoilProfile

logger = get_logger("khetwala.routers.digital_twin")

router = APIRouter(prefix="/digital-twin", tags=["digital-twin"])


# ── Schemas ──────────────────────────────────────────────────────────────

class CreateSimulationRequest(BaseModel):
    user_id: int
    crop: str = Field(..., min_length=2)
    district: str = Field(..., min_length=2)
    sowing_date: str  # ISO date
    soil_type: Optional[str] = None


class WhatIfRequest(BaseModel):
    scenario: str = Field(..., min_length=3)  # e.g. "reduce irrigation 50%"
    days_ahead: int = Field(default=7, ge=1, le=30)


class SimulationOut(BaseModel):
    id: int
    crop: str
    district: str
    sowing_date: str
    current_stage: str
    health_score: float
    growth_day: int
    simulated_yield_kg: Optional[float]
    is_active: bool

    class Config:
        from_attributes = True


# ── Growth simulation logic ──────────────────────────────────────────────

STAGE_THRESHOLDS = {
    "onion":  {"seedling": 20, "vegetative": 60, "bulbing": 100, "maturity": 130},
    "tomato": {"seedling": 15, "vegetative": 45, "flowering": 70, "maturity": 95},
    "wheat":  {"seedling": 20, "tillering": 50, "heading": 85, "maturity": 120},
    "rice":   {"seedling": 25, "vegetative": 60, "flowering": 90, "maturity": 135},
    "potato": {"seedling": 15, "vegetative": 40, "tuber_init": 70, "maturity": 105},
}

DEFAULT_YIELD_PER_ACRE = {
    "onion": 8000, "tomato": 12000, "wheat": 2000,
    "rice": 2500, "potato": 10000, "soybean": 1200,
}


def _compute_stage(crop: str, growth_day: int) -> str:
    thresholds = STAGE_THRESHOLDS.get(crop.lower(), {
        "seedling": 20, "vegetative": 55, "flowering": 80, "maturity": 110
    })
    current = "seedling"
    for stage, day_limit in thresholds.items():
        if growth_day >= day_limit:
            current = stage
    return current


def _simulate_health(crop: str, growth_day: int, weather_avg_temp: float = 30.0,
                     humidity: float = 65.0) -> float:
    """Physics-informed health score: base + weather penalty."""
    base = 0.90
    # Temperature stress
    if weather_avg_temp > 38:
        base -= 0.08
    elif weather_avg_temp < 10:
        base -= 0.05
    # Humidity stress
    if humidity > 85:
        base -= 0.04
    # Growth stage factor (younger plants more vulnerable)
    if growth_day < 20:
        base -= 0.03
    return max(0.1, min(1.0, round(base, 3)))


def _simulate_yield(crop: str, health_score: float, farm_size_acres: float = 1.0) -> float:
    base = DEFAULT_YIELD_PER_ACRE.get(crop.lower(), 5000)
    return round(base * health_score * farm_size_acres, 1)


def _run_whatif(sim: CropSimulation, scenario: str, days_ahead: int) -> Dict[str, Any]:
    """Simulate a what-if scenario against current simulation state."""
    scenario_lower = scenario.lower()
    current_health = sim.health_score or 0.85
    current_yield = sim.simulated_yield_kg or 5000

    if "reduce irrigation" in scenario_lower or "kam paani" in scenario_lower:
        health_impact = -0.06 * (days_ahead / 7)
        yield_impact = -0.08 * (days_ahead / 7)
        recommendation = ("Irrigation 50% kam karne se {days} din mein health {hp}% "
                          "aur yield {yp}% gir sakti hai. Agar paani ki kami hai toh "
                          "drip irrigation try karo — 30% paani bachega aur health "
                          "stable rahegi.")
    elif "extra fertilizer" in scenario_lower or "zyada khad" in scenario_lower:
        health_impact = 0.03
        yield_impact = 0.05
        recommendation = ("Extra fertilizer se yield {yp}% badhegi lekin over-use se "
                          "soil quality kharab ho sakti hai. Soil test karo pehle.")
    elif "delay harvest" in scenario_lower or "late harvest" in scenario_lower:
        health_impact = -0.04 * (days_ahead / 7)
        yield_impact = -0.10 * (days_ahead / 7)
        recommendation = ("{days} din late harvest se spoilage risk badhega aur "
                          "yield {yp}% gir sakti hai. Best window miss mat karo.")
    else:
        health_impact = -0.02
        yield_impact = -0.03
        recommendation = ("Is scenario mein thoda risk hai. ARIA se baat karo "
                          "detail analysis ke liye.")

    new_health = max(0.1, min(1.0, round(current_health + health_impact, 3)))
    new_yield = max(0, round(current_yield * (1 + yield_impact), 1))

    return {
        "scenario": scenario,
        "days_simulated": days_ahead,
        "current": {"health_score": current_health, "yield_kg": current_yield},
        "projected": {"health_score": new_health, "yield_kg": new_yield},
        "health_change_pct": round(health_impact * 100, 1),
        "yield_change_pct": round(yield_impact * 100, 1),
        "recommendation": recommendation.format(
            days=days_ahead,
            hp=abs(round(health_impact * 100, 1)),
            yp=abs(round(yield_impact * 100, 1)),
        ),
    }


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/create")
def create_simulation(
    payload: CreateSimulationRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Create a new crop simulation for a farmer's field."""
    ensure_user_access(current_user, payload.user_id)
    try:
        sowing = date.fromisoformat(payload.sowing_date)
    except ValueError:
        raise HTTPException(400, "Invalid sowing_date format. Use YYYY-MM-DD.")

    growth_day = max(0, (date.today() - sowing).days)
    crop_lower = payload.crop.lower()
    stage = _compute_stage(crop_lower, growth_day)
    health = _simulate_health(crop_lower, growth_day)
    est_yield = _simulate_yield(crop_lower, health)

    sim = CropSimulation(
        user_id=payload.user_id,
        crop=payload.crop,
        district=payload.district,
        sowing_date=sowing,
        current_stage=stage,
        health_score=health,
        growth_day=growth_day,
        simulated_yield_kg=est_yield,
        is_active=True,
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)

    return {
        "simulation_id": sim.id,
        "crop": sim.crop,
        "stage": sim.current_stage,
        "health_score": sim.health_score,
        "growth_day": sim.growth_day,
        "estimated_yield_kg": sim.simulated_yield_kg,
        "message": f"Digital twin created for {sim.crop} — {stage} stage, day {growth_day}",
    }


@router.get("/{user_id}")
def get_simulations(
    user_id: int,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get all crop simulations for a user."""
    ensure_user_access(current_user, user_id)
    query = db.query(CropSimulation).filter(CropSimulation.user_id == user_id)
    if active_only:
        query = query.filter(CropSimulation.is_active == True)
    sims = query.order_by(CropSimulation.created_at.desc()).all()

    results = []
    for sim in sims:
        # Re-simulate with current date
        growth_day = max(0, (date.today() - sim.sowing_date).days)
        stage = _compute_stage(sim.crop.lower(), growth_day)
        health = _simulate_health(sim.crop.lower(), growth_day)
        est_yield = _simulate_yield(sim.crop.lower(), health)

        sim.growth_day = growth_day
        sim.current_stage = stage
        sim.health_score = health
        sim.simulated_yield_kg = est_yield
        db.commit()

        results.append({
            "id": sim.id,
            "crop": sim.crop,
            "district": sim.district,
            "sowing_date": sim.sowing_date.isoformat(),
            "current_stage": stage,
            "health_score": health,
            "growth_day": growth_day,
            "estimated_yield_kg": est_yield,
            "is_active": sim.is_active,
        })

    return {"user_id": user_id, "simulations": results}


@router.post("/{simulation_id}/whatif")
def whatif_query(
    simulation_id: int,
    payload: WhatIfRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Run a what-if scenario against an existing simulation."""
    sim = db.query(CropSimulation).filter(CropSimulation.id == simulation_id).first()
    if not sim:
        raise HTTPException(404, "Simulation not found")
    ensure_user_access(current_user, sim.user_id)

    result = _run_whatif(sim, payload.scenario, payload.days_ahead)

    # Store result
    sim.whatif_results = json.dumps(result)
    db.commit()

    return result


@router.delete("/{simulation_id}")
def delete_simulation(
    simulation_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, str]:
    """Deactivate a simulation."""
    sim = db.query(CropSimulation).filter(CropSimulation.id == simulation_id).first()
    if not sim:
        raise HTTPException(404, "Simulation not found")
    ensure_user_access(current_user, sim.user_id)
    sim.is_active = False
    db.commit()
    return {"message": "Simulation deactivated"}
