"""
[F4] Loss Counterfactual & Harvest Lessons Router
═══════════════════════════════════════════════════════════════════════════════

Post-harvest "what-if" analysis: tracks each harvest cycle and shows
farmers what they could have earned by selling at the optimal time/mandi.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from routers.auth import ensure_user_access, require_current_user
from db.models import HarvestCycle, MandiPrice

logger = get_logger("khetwala.routers.harvest_cycles")
router = APIRouter(prefix="/harvest-cycles", tags=["harvest-cycles"])


# ── Schemas ──────────────────────────────────────────────────────────────

class LogHarvestRequest(BaseModel):
    user_id: int
    crop: str
    district: str
    sowing_date: str
    harvest_date: str
    sale_date: str
    sale_mandi: str
    quantity_quintals: float = Field(..., gt=0)
    sale_price_per_quintal: float = Field(..., gt=0)


class LessonOut(BaseModel):
    cycle_id: int
    crop: str
    actual_revenue: float
    optimal_revenue: float
    loss_amount: float
    loss_pct: float
    lesson_summary: str


# ── Helpers ──────────────────────────────────────────────────────────────

def _find_optimal_price(db: Session, crop: str, district: str,
                        harvest_date: date, window_days: int = 14) -> tuple:
    """Find best price within ±window_days of harvest date."""
    from datetime import timedelta
    start = harvest_date - timedelta(days=window_days)
    end = harvest_date + timedelta(days=window_days)

    best = (
        db.query(MandiPrice)
        .filter(
            MandiPrice.commodity.ilike(f"%{crop}%"),
            MandiPrice.district.ilike(f"%{district}%"),
            MandiPrice.arrival_date.between(start, end),
        )
        .order_by(MandiPrice.modal_price.desc())
        .first()
    )
    if best:
        return best.modal_price, best.arrival_date
    # Fallback: synthetic optimal = 10% above actual
    return None, None


def _generate_lesson(cycle: HarvestCycle) -> str:
    """Generate a human-readable counterfactual lesson in Hindi/English."""
    if not cycle.loss_amount or cycle.loss_amount <= 0:
        return (
            f"✅ {cycle.crop}: Bahut achha! Aapne best possible time pe becha. "
            f"₹{cycle.total_revenue:,.0f} revenue — optimal tha!"
        )

    loss_pct = round((cycle.loss_amount / cycle.total_revenue) * 100, 1) if cycle.total_revenue > 0 else 0
    lessons = []

    if cycle.optimal_harvest_date and cycle.harvest_date:
        days_diff = (cycle.sale_date - cycle.optimal_harvest_date).days if cycle.sale_date and cycle.optimal_harvest_date else 0
        if days_diff > 3:
            lessons.append(
                f"Agar {abs(days_diff)} din pehle bechte toh ₹{cycle.optimal_price:,.0f}/quintal milta."
            )
        elif days_diff < -3:
            lessons.append(
                f"Harvest {abs(days_diff)} din late karna tha — market peak miss hua."
            )

    lessons.append(
        f"💡 {cycle.crop} ke liye ₹{cycle.loss_amount:,.0f} zyada mil sakta tha "
        f"({loss_pct}% of revenue). Agle baar ARIA ka price alert use karo."
    )

    return " ".join(lessons)


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/log")
def log_harvest_cycle(
    payload: LogHarvestRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Log a completed harvest cycle and compute counterfactual loss."""
    ensure_user_access(current_user, payload.user_id)
    try:
        sowing = date.fromisoformat(payload.sowing_date)
        harvest = date.fromisoformat(payload.harvest_date)
        sale = date.fromisoformat(payload.sale_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")

    total_revenue = payload.quantity_quintals * payload.sale_price_per_quintal
    optimal_price, optimal_date = _find_optimal_price(
        db, payload.crop, payload.district, harvest
    )

    # Calculate loss
    if optimal_price and optimal_price > payload.sale_price_per_quintal:
        optimal_total = payload.quantity_quintals * optimal_price
        loss = optimal_total - total_revenue
        loss_reason = {
            "type": "timing",
            "optimal_price": optimal_price,
            "price_diff": round(optimal_price - payload.sale_price_per_quintal, 2),
            "optimal_date": optimal_date.isoformat() if optimal_date else None,
        }
    else:
        optimal_price = payload.sale_price_per_quintal
        optimal_date = sale
        loss = 0.0
        loss_reason = {"type": "none", "message": "Best price achieved"}

    cycle = HarvestCycle(
        user_id=payload.user_id,
        crop=payload.crop,
        district=payload.district,
        sowing_date=sowing,
        harvest_date=harvest,
        sale_date=sale,
        sale_mandi=payload.sale_mandi,
        quantity_quintals=payload.quantity_quintals,
        sale_price_per_quintal=payload.sale_price_per_quintal,
        total_revenue=total_revenue,
        optimal_harvest_date=optimal_date,
        optimal_price=optimal_price,
        loss_amount=loss,
        loss_reason=str(loss_reason),
    )
    db.add(cycle)
    db.flush()

    # Generate lesson
    cycle.lesson_summary = _generate_lesson(cycle)
    db.commit()
    db.refresh(cycle)

    return {
        "cycle_id": cycle.id,
        "crop": cycle.crop,
        "total_revenue": total_revenue,
        "optimal_revenue": payload.quantity_quintals * optimal_price if optimal_price else total_revenue,
        "loss_amount": loss,
        "loss_pct": round((loss / total_revenue) * 100, 1) if total_revenue > 0 else 0,
        "lesson": cycle.lesson_summary,
    }


@router.get("/lessons/{user_id}")
def get_lessons(
    user_id: int,
    limit: int = 5,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get counterfactual lessons for a user's harvest cycles."""
    ensure_user_access(current_user, user_id)
    cycles = (
        db.query(HarvestCycle)
        .filter(HarvestCycle.user_id == user_id)
        .order_by(HarvestCycle.sale_date.desc())
        .limit(limit)
        .all()
    )

    total_loss = sum(c.loss_amount or 0 for c in cycles)
    lessons = []
    for c in cycles:
        optimal_rev = c.quantity_quintals * c.optimal_price if c.optimal_price else c.total_revenue
        lessons.append({
            "cycle_id": c.id,
            "crop": c.crop,
            "sale_date": c.sale_date.isoformat() if c.sale_date else None,
            "actual_revenue": c.total_revenue,
            "optimal_revenue": optimal_rev,
            "loss_amount": c.loss_amount or 0,
            "loss_pct": round(((c.loss_amount or 0) / c.total_revenue) * 100, 1) if c.total_revenue else 0,
            "lesson": c.lesson_summary,
        })

    return {
        "user_id": user_id,
        "total_cumulative_loss": total_loss,
        "lessons": lessons,
        "tip": f"Pichle {len(cycles)} cycles mein ₹{total_loss:,.0f} bach sakta tha. ARIA alerts ON karo!",
    }
