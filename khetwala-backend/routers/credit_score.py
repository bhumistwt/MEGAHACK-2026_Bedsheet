"""
[F10] Krishi Credit Score Router
═══════════════════════════════════════════════════════════════════════════════

Computes a farmer's creditworthiness score (0-850) based on
harvest consistency, market timing, soil health, yield history,
and app engagement. Updated weekly via APScheduler.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from routers.auth import ensure_user_access, require_current_user
from db.models import (
    KrishiScore, HarvestCycle, CropDiaryEntry,
    SoilProfile, User,
)

logger = get_logger("khetwala.routers.credit_score")
router = APIRouter(prefix="/farmer", tags=["credit-score"])


# ── Score computation logic ──────────────────────────────────────────────

MAX_SCORE = 850
COMPONENT_WEIGHTS = {
    "harvest_consistency": 0.25,
    "market_timing": 0.25,
    "soil_health_trend": 0.15,
    "yield_history": 0.20,
    "app_engagement": 0.15,
}


def compute_krishi_score(user_id: int, db: Session) -> Dict[str, Any]:
    """Compute Krishi Credit Score for a farmer."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {"error": "User not found"}

    # 1. Harvest consistency (do they harvest regularly?)
    cycles = db.query(HarvestCycle).filter(HarvestCycle.user_id == user_id).all()
    if cycles:
        # Consistency = number of cycles / expected cycles
        consistency = min(1.0, len(cycles) / 4)  # Expect 4+ cycles for max
    else:
        consistency = 0.2  # Minimum for app users

    # 2. Market timing (ratio of actual vs optimal price)
    if cycles:
        ratios = []
        for c in cycles:
            if c.optimal_price and c.sale_price_per_quintal:
                ratios.append(min(c.sale_price_per_quintal / c.optimal_price, 1.0))
        market_timing = sum(ratios) / len(ratios) if ratios else 0.5
    else:
        market_timing = 0.3

    # 3. Soil health trend
    district = user.district or "Nashik"
    soil = (
        db.query(SoilProfile)
        .filter(SoilProfile.district.ilike(f"%{district}%"))
        .first()
    )
    if soil and soil.soil_quality_index:
        soil_health = min(1.0, soil.soil_quality_index)
    else:
        soil_health = 0.5

    # 4. Yield history (based on loss minimization)
    if cycles:
        total_rev = sum(c.total_revenue or 0 for c in cycles)
        total_loss = sum(c.loss_amount or 0 for c in cycles)
        yield_history = min(1.0, 1.0 - (total_loss / total_rev)) if total_rev > 0 else 0.5
    else:
        yield_history = 0.3

    # 5. App engagement (diary entries, profile completeness)
    diary_count = db.query(func.count(CropDiaryEntry.id)).filter(
        CropDiaryEntry.user_id == user_id
    ).scalar() or 0

    engagement_factors = 0.0
    engagement_factors += min(0.3, diary_count * 0.02)  # Up to 30% from diary
    engagement_factors += 0.2 if user.main_crop else 0
    engagement_factors += 0.2 if user.district else 0
    engagement_factors += 0.15 if user.farm_size_acres else 0
    engagement_factors += 0.15 if user.soil_type else 0
    app_engagement = min(1.0, engagement_factors)

    # Weighted score
    raw = (
        consistency * COMPONENT_WEIGHTS["harvest_consistency"]
        + market_timing * COMPONENT_WEIGHTS["market_timing"]
        + soil_health * COMPONENT_WEIGHTS["soil_health_trend"]
        + yield_history * COMPONENT_WEIGHTS["yield_history"]
        + app_engagement * COMPONENT_WEIGHTS["app_engagement"]
    )
    final_score = round(raw * MAX_SCORE)

    breakdown = {
        "harvest_consistency": round(consistency * 100, 1),
        "market_timing": round(market_timing * 100, 1),
        "soil_health_trend": round(soil_health * 100, 1),
        "yield_history": round(yield_history * 100, 1),
        "app_engagement": round(app_engagement * 100, 1),
    }

    return {
        "user_id": user_id,
        "score": final_score,
        "max_score": MAX_SCORE,
        "harvest_consistency": round(consistency, 3),
        "market_timing": round(market_timing, 3),
        "soil_health_trend": round(soil_health, 3),
        "yield_history": round(yield_history, 3),
        "app_engagement": round(app_engagement, 3),
        "breakdown": breakdown,
    }


def _score_tier(score: int) -> Dict[str, str]:
    """Get tier info for a credit score."""
    if score >= 750:
        return {"tier": "Excellent", "color": "#1B5E20", "emoji": "🏆", "loan_eligible": True}
    elif score >= 650:
        return {"tier": "Good", "color": "#388E3C", "emoji": "⭐", "loan_eligible": True}
    elif score >= 500:
        return {"tier": "Fair", "color": "#FFA726", "emoji": "📊", "loan_eligible": True}
    elif score >= 350:
        return {"tier": "Building", "color": "#FF7043", "emoji": "🌱", "loan_eligible": False}
    else:
        return {"tier": "New", "color": "#78909C", "emoji": "👋", "loan_eligible": False}


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/credit-score/{user_id}")
def get_credit_score(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get the Krishi Credit Score for a farmer."""
    ensure_user_access(current_user, user_id)
    # Check if recently computed score exists
    existing = (
        db.query(KrishiScore)
        .filter(KrishiScore.user_id == user_id)
        .order_by(KrishiScore.computed_at.desc())
        .first()
    )

    if existing:
        tier = _score_tier(existing.score)
        return {
            "user_id": user_id,
            "score": existing.score,
            "max_score": MAX_SCORE,
            **tier,
            "breakdown": {
                "harvest_consistency": round((existing.harvest_consistency or 0) * 100, 1),
                "market_timing": round((existing.market_timing or 0) * 100, 1),
                "soil_health_trend": round((existing.soil_health_trend or 0) * 100, 1),
                "yield_history": round((existing.yield_history or 0) * 100, 1),
                "app_engagement": round((existing.app_engagement or 0) * 100, 1),
            },
            "computed_at": existing.computed_at.isoformat() if existing.computed_at else None,
            "tips": _get_improvement_tips(existing),
        }

    # Compute fresh
    data = compute_krishi_score(user_id, db)
    if "error" in data:
        raise HTTPException(404, data["error"])

    # Save
    ks = KrishiScore(
        user_id=user_id,
        score=data["score"],
        harvest_consistency=data["harvest_consistency"],
        market_timing=data["market_timing"],
        soil_health_trend=data["soil_health_trend"],
        yield_history=data["yield_history"],
        app_engagement=data["app_engagement"],
        breakdown=str(data["breakdown"]),
        computed_at=datetime.now(timezone.utc),
    )
    db.add(ks)
    db.commit()

    tier = _score_tier(data["score"])
    return {
        **data,
        **tier,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "tips": _get_improvement_tips_from_data(data),
    }


@router.post("/credit-score/refresh/{user_id}")
def refresh_credit_score(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Force recompute the Krishi Credit Score."""
    ensure_user_access(current_user, user_id)
    data = compute_krishi_score(user_id, db)
    if "error" in data:
        raise HTTPException(404, data["error"])

    existing = (
        db.query(KrishiScore)
        .filter(KrishiScore.user_id == user_id)
        .first()
    )
    if existing:
        existing.score = data["score"]
        existing.harvest_consistency = data["harvest_consistency"]
        existing.market_timing = data["market_timing"]
        existing.soil_health_trend = data["soil_health_trend"]
        existing.yield_history = data["yield_history"]
        existing.app_engagement = data["app_engagement"]
        existing.breakdown = str(data["breakdown"])
        existing.computed_at = datetime.now(timezone.utc)
    else:
        ks = KrishiScore(
            user_id=user_id,
            score=data["score"],
            harvest_consistency=data["harvest_consistency"],
            market_timing=data["market_timing"],
            soil_health_trend=data["soil_health_trend"],
            yield_history=data["yield_history"],
            app_engagement=data["app_engagement"],
            breakdown=str(data["breakdown"]),
            computed_at=datetime.now(timezone.utc),
        )
        db.add(ks)

    db.commit()

    tier = _score_tier(data["score"])
    return {
        **data,
        **tier,
        "refreshed": True,
    }


def _get_improvement_tips(ks: KrishiScore) -> list:
    """Generate personalized tips to improve score."""
    tips = []
    if (ks.harvest_consistency or 0) < 0.6:
        tips.append("🌾 Regular harvest log karo — consistency score badhega.")
    if (ks.market_timing or 0) < 0.7:
        tips.append("📊 ARIA ke price alerts follow karo — market timing improve hogi.")
    if (ks.app_engagement or 0) < 0.5:
        tips.append("📝 Crop diary daily likho — engagement score badhega.")
    if (ks.soil_health_trend or 0) < 0.6:
        tips.append("🌱 Soil health card update karo — soil score improve hoga.")
    if not tips:
        tips.append("🏆 Great score! Keep logging and following ARIA's advice.")
    return tips


def _get_improvement_tips_from_data(data: dict) -> list:
    """Generate tips from raw computed data."""
    tips = []
    if data.get("harvest_consistency", 0) < 0.6:
        tips.append("🌾 Regular harvest log karo — consistency score badhega.")
    if data.get("market_timing", 0) < 0.7:
        tips.append("📊 ARIA ke price alerts follow karo — market timing improve hogi.")
    if data.get("app_engagement", 0) < 0.5:
        tips.append("📝 Crop diary daily likho — engagement score badhega.")
    if data.get("soil_health_trend", 0) < 0.6:
        tips.append("🌱 Soil health card update karo — soil score improve hoga.")
    if not tips:
        tips.append("🏆 Great score! Keep logging and following ARIA's advice.")
    return tips
