"""
[F6] Crowd Intelligence Router
═══════════════════════════════════════════════════════════════════════════════

Aggregates anonymized outcomes from all farmers in a district
to provide crowd-sourced market intelligence.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from routers.auth import require_current_user
from db.models import CrowdOutcome

logger = get_logger("khetwala.routers.community")
router = APIRouter(prefix="/community", tags=["community"])


# ── Schemas ──────────────────────────────────────────────────────────────

class SubmitOutcomeRequest(BaseModel):
    district: str
    crop: str
    harvest_week: str = Field(..., pattern=r"^\d{4}-W\d{2}$")  # e.g. "2026-W09"
    sale_price_per_quintal: float = Field(..., gt=0)
    quantity_quintals: float = Field(..., gt=0)
    days_waited_after_ready: int = Field(default=0, ge=0)
    outcome_label: Optional[str] = None  # "profit", "break_even", "loss"


# ── Helpers ──────────────────────────────────────────────────────────────

def _classify_outcome(price: float, avg_price: float) -> str:
    ratio = price / avg_price if avg_price > 0 else 1.0
    if ratio >= 1.05:
        return "above_average"
    elif ratio >= 0.95:
        return "average"
    else:
        return "below_average"


def _generate_insight(stats: dict) -> str:
    """Generate human-readable crowd insight."""
    crop = stats.get("crop", "crop")
    district = stats.get("district", "area")
    avg_price = stats.get("avg_price", 0)
    max_price = stats.get("max_price", 0)
    best_wait = stats.get("best_wait_days", 0)
    total_farmers = stats.get("total_reports", 0)

    if best_wait > 3:
        wait_advice = f"Jo farmers {best_wait} din wait kiye, unko ₹{max_price:,.0f}/q mila — {int((max_price-avg_price)/avg_price*100)}% zyada."
    else:
        wait_advice = "Jaldi bechne wale farmers ne bhi achha price paaya."

    return (
        f"📊 {district} mein {crop}: {total_farmers} farmers ka data. "
        f"Average price ₹{avg_price:,.0f}/q, best ₹{max_price:,.0f}/q. "
        f"{wait_advice}"
    )


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/submit-outcome")
def submit_outcome(
    payload: SubmitOutcomeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Submit an anonymized harvest outcome for crowd intelligence."""
    # Compute label if not provided
    label = payload.outcome_label
    if not label:
        avg = db.query(func.avg(CrowdOutcome.sale_price_per_quintal)).filter(
            CrowdOutcome.crop.ilike(f"%{payload.crop}%"),
            CrowdOutcome.district.ilike(f"%{payload.district}%"),
        ).scalar()
        label = _classify_outcome(payload.sale_price_per_quintal, avg or payload.sale_price_per_quintal)

    outcome = CrowdOutcome(
        district=payload.district,
        crop=payload.crop,
        harvest_week=payload.harvest_week,
        sale_price_per_quintal=payload.sale_price_per_quintal,
        quantity_quintals=payload.quantity_quintals,
        days_waited_after_ready=payload.days_waited_after_ready,
        outcome_label=label,
    )
    db.add(outcome)
    db.commit()
    db.refresh(outcome)

    return {
        "id": outcome.id,
        "label": label,
        "message": "Outcome recorded. Your data helps other farmers!",
    }


@router.get("/insights/{district}/{crop}")
def get_crowd_insights(
    district: str,
    crop: str,
    weeks: int = 4,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get aggregated crowd intelligence for a crop in a district."""
    outcomes = (
        db.query(CrowdOutcome)
        .filter(
            CrowdOutcome.district.ilike(f"%{district}%"),
            CrowdOutcome.crop.ilike(f"%{crop}%"),
        )
        .order_by(CrowdOutcome.created_at.desc())
        .limit(200)
        .all()
    )

    if not outcomes:
        return {
            "district": district,
            "crop": crop,
            "total_reports": 0,
            "message": "Abhi koi data nahi hai. Pehle farmer bano jo apna outcome share kare!",
            "insights": [],
        }

    prices = [o.sale_price_per_quintal for o in outcomes]
    quantities = [o.quantity_quintals for o in outcomes]
    wait_days = [o.days_waited_after_ready for o in outcomes]

    avg_price = sum(prices) / len(prices)
    max_price = max(prices)
    min_price = min(prices)
    total_qty = sum(quantities)
    avg_wait = sum(wait_days) / len(wait_days) if wait_days else 0

    # Find optimal wait days (correlation analysis)
    # Group by wait days and find which wait duration gave best prices
    wait_price_map = {}
    for o in outcomes:
        d = o.days_waited_after_ready
        if d not in wait_price_map:
            wait_price_map[d] = []
        wait_price_map[d].append(o.sale_price_per_quintal)

    best_wait = 0
    best_wait_price = 0
    for d, prices_list in wait_price_map.items():
        avg_p = sum(prices_list) / len(prices_list)
        if avg_p > best_wait_price:
            best_wait_price = avg_p
            best_wait = d

    # Weekly breakdown
    week_data = {}
    for o in outcomes:
        w = o.harvest_week
        if w not in week_data:
            week_data[w] = {"prices": [], "count": 0}
        week_data[w]["prices"].append(o.sale_price_per_quintal)
        week_data[w]["count"] += 1

    weekly_summary = []
    for w, data in sorted(week_data.items(), reverse=True)[:weeks]:
        wp = data["prices"]
        weekly_summary.append({
            "week": w,
            "avg_price": round(sum(wp) / len(wp), 2),
            "max_price": max(wp),
            "reports": data["count"],
        })

    stats = {
        "crop": crop,
        "district": district,
        "avg_price": round(avg_price, 2),
        "max_price": max_price,
        "min_price": min_price,
        "best_wait_days": best_wait,
        "total_reports": len(outcomes),
    }

    return {
        "district": district,
        "crop": crop,
        "total_reports": len(outcomes),
        "price_stats": {
            "average": round(avg_price, 2),
            "maximum": max_price,
            "minimum": min_price,
            "total_quantity_quintals": round(total_qty, 2),
        },
        "timing_stats": {
            "avg_wait_days": round(avg_wait, 1),
            "best_wait_days": best_wait,
            "best_wait_avg_price": round(best_wait_price, 2),
        },
        "weekly_breakdown": weekly_summary,
        "insight": _generate_insight(stats),
        "outcome_distribution": {
            "above_average": len([o for o in outcomes if o.outcome_label == "above_average"]),
            "average": len([o for o in outcomes if o.outcome_label == "average"]),
            "below_average": len([o for o in outcomes if o.outcome_label == "below_average"]),
        },
    }
