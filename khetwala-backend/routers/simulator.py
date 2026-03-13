"""
[F5] Negotiation Simulator Router
═══════════════════════════════════════════════════════════════════════════════

AI-powered mandi negotiation practice game. Simulates a buyer
and lets farmers practice price negotiation with realistic scenarios.
Uses Gemini for generating buyer responses.
"""

import os
import json
import random
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.logging import get_logger

logger = get_logger("khetwala.routers.simulator")
router = APIRouter(prefix="/simulator", tags=["simulator"])

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

# ── Buyer personas ───────────────────────────────────────────────────────

BUYER_PERSONAS = {
    "tough_trader": {
        "name": "Rajesh Seth (Tough Trader)",
        "style": "aggressive",
        "initial_discount_pct": 20,
        "concession_rate": 0.3,
        "traits": "Always starts very low. Uses phrases like 'ye toh bahut zyada hai', 'doosre farmer saste de rahe hain'.",
    },
    "fair_dealer": {
        "name": "Meena Agarwal (Fair Dealer)",
        "style": "balanced",
        "initial_discount_pct": 10,
        "concession_rate": 0.5,
        "traits": "Reasonable. Checks quality. Gives fair counter-offers.",
    },
    "quality_buyer": {
        "name": "Suresh Wholesale (Quality Buyer)",
        "style": "quality-focused",
        "initial_discount_pct": 8,
        "concession_rate": 0.6,
        "traits": "Pays premium for quality. Asks about grade, moisture, freshness.",
    },
}


# ── Schemas ──────────────────────────────────────────────────────────────

class StartNegotiationRequest(BaseModel):
    crop: str
    market_price: float = Field(..., gt=0, description="Current market price per quintal")
    quantity_quintals: float = Field(default=10, gt=0)
    buyer_type: str = Field(default="tough_trader")
    language: str = Field(default="hi")


class NegotiateRoundRequest(BaseModel):
    session_id: str
    farmer_offer: float = Field(..., gt=0, description="Farmer's price per quintal")
    farmer_message: Optional[str] = None
    round_number: int = Field(default=1, ge=1)


class NegotiationResult(BaseModel):
    session_id: str
    buyer_name: str
    buyer_counter_offer: float
    buyer_message: str
    deal_status: str  # "negotiating", "deal_done", "walk_away"
    round_number: int
    score: Optional[float] = None
    tip: Optional[str] = None


# ── In-memory session store ──────────────────────────────────────────────
# In production, use Redis. For now, dict is fine for demo.
_sessions: Dict[str, Dict] = {}


def _generate_session_id() -> str:
    return f"neg_{int(datetime.now(timezone.utc).timestamp())}_{random.randint(1000, 9999)}"


def _compute_score(final_price: float, market_price: float, rounds: int) -> dict:
    """Score the negotiation performance 0-100."""
    # Price achievement: how close to market price
    price_ratio = min(final_price / market_price, 1.0) if market_price > 0 else 0.5
    price_score = price_ratio * 70  # 70 points for price

    # Efficiency: fewer rounds = better
    round_score = max(0, 30 - (rounds - 1) * 5)  # 30 points, -5 per extra round

    total = round(price_score + round_score, 1)
    grade = "A+" if total >= 90 else "A" if total >= 80 else "B" if total >= 65 else "C" if total >= 50 else "D"

    return {
        "total_score": total,
        "grade": grade,
        "price_score": round(price_score, 1),
        "efficiency_score": round_score,
    }


TIPS = [
    "Market pe jaane se pehle 3 mandis ka price check karo — leverage milega.",
    "Quality certificates dikhao (moisture %, size grade) — premium milta hai.",
    "Bulk quantity ka higher price maango — buyer ko bhi fayda hota hai transport mein.",
    "Kabhi pehla offer accept mat karo — buyer hamesha low start karta hai.",
    "Walk-away price decide karo negotiation se pehle. Usse neeche mat jao.",
    "Doosre buyer ka quote mention karo — competition create karo.",
    "Monsoon, festival season pe demand zyada hoti hai — us time negotiate karo.",
]


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/start")
def start_negotiation(payload: StartNegotiationRequest) -> Dict[str, Any]:
    """Start a new negotiation simulation session."""
    persona = BUYER_PERSONAS.get(payload.buyer_type, BUYER_PERSONAS["tough_trader"])
    session_id = _generate_session_id()

    # Buyer's first offer: market price minus persona's initial discount
    buyer_first_offer = round(
        payload.market_price * (1 - persona["initial_discount_pct"] / 100), 2
    )

    session = {
        "session_id": session_id,
        "crop": payload.crop,
        "market_price": payload.market_price,
        "quantity_quintals": payload.quantity_quintals,
        "buyer_type": payload.buyer_type,
        "persona": persona,
        "language": payload.language,
        "current_buyer_offer": buyer_first_offer,
        "rounds": 0,
        "history": [],
        "status": "negotiating",
    }
    _sessions[session_id] = session

    opening = (
        f"Namaste! Main {persona['name']}. Tumhara {payload.crop} dekha — "
        f"₹{buyer_first_offer:,.0f}/quintal dunga {payload.quantity_quintals} quintal ke liye. "
        f"Ye market rate se better hai, kya bolte ho?"
    )

    return {
        "session_id": session_id,
        "buyer_name": persona["name"],
        "buyer_opening_offer": buyer_first_offer,
        "market_price": payload.market_price,
        "buyer_message": opening,
        "tip": random.choice(TIPS),
    }


@router.post("/negotiate")
async def negotiate_round(payload: NegotiateRoundRequest) -> Dict[str, Any]:
    """Process one round of negotiation."""
    session = _sessions.get(payload.session_id)
    if not session:
        raise HTTPException(404, "Session not found. Start a new negotiation.")
    if session["status"] != "negotiating":
        raise HTTPException(400, f"Session already ended: {session['status']}")

    persona = session["persona"]
    market_price = session["market_price"]
    current_buyer_offer = session["current_buyer_offer"]
    farmer_offer = payload.farmer_offer
    round_num = payload.round_number

    # Record round
    session["rounds"] = round_num
    session["history"].append({
        "round": round_num,
        "farmer_offer": farmer_offer,
        "farmer_message": payload.farmer_message,
    })

    # Decision logic
    concession = persona["concession_rate"]
    gap = farmer_offer - current_buyer_offer

    if farmer_offer <= current_buyer_offer:
        # Farmer accepted or went below buyer's offer
        final_price = current_buyer_offer
        session["status"] = "deal_done"
        score = _compute_score(final_price, market_price, round_num)
        return {
            "session_id": payload.session_id,
            "buyer_name": persona["name"],
            "buyer_counter_offer": final_price,
            "buyer_message": f"Done! ₹{final_price:,.0f}/quintal pe deal pakka! Maal kal bhejo.",
            "deal_status": "deal_done",
            "round_number": round_num,
            "final_price": final_price,
            "total_value": round(final_price * session["quantity_quintals"], 2),
            **score,
            "tip": "Next time thoda aur hold karo — buyer ready tha aur dene ke liye!",
        }

    # Buyer concedes partially
    new_buyer_offer = round(current_buyer_offer + (gap * concession), 2)

    # Cap at market price
    if new_buyer_offer >= market_price:
        new_buyer_offer = market_price
        session["status"] = "deal_done"
        score = _compute_score(new_buyer_offer, market_price, round_num)
        return {
            "session_id": payload.session_id,
            "buyer_name": persona["name"],
            "buyer_counter_offer": new_buyer_offer,
            "buyer_message": f"Theek hai bhai, ₹{new_buyer_offer:,.0f}/quintal — final price. Market rate pe de raha hun, isse zyada nahi hoga.",
            "deal_status": "deal_done",
            "round_number": round_num,
            "final_price": new_buyer_offer,
            "total_value": round(new_buyer_offer * session["quantity_quintals"], 2),
            **score,
            "tip": "Excellent! Market price achieve kiya — real negotiation mein bhi aisa karo!",
        }

    # Walk away if too many rounds
    if round_num >= 6:
        session["status"] = "walk_away"
        score = _compute_score(new_buyer_offer, market_price, round_num)
        return {
            "session_id": payload.session_id,
            "buyer_name": persona["name"],
            "buyer_counter_offer": new_buyer_offer,
            "buyer_message": "Bahut ho gaya. Mera time waste mat karo. Doosre seller se le lunga.",
            "deal_status": "walk_away",
            "round_number": round_num,
            "last_offer": new_buyer_offer,
            **score,
            "tip": "Too many rounds! Real mein buyer chala jaata. 3-4 rounds mein deal close karo.",
        }

    session["current_buyer_offer"] = new_buyer_offer

    # Generate buyer response
    responses = {
        "aggressive": [
            f"₹{new_buyer_offer:,.0f} se ek paisa zyada nahi. Doosre farmer saste de rahe hain.",
            f"Bhai, ₹{new_buyer_offer:,.0f} final. Quality wagairah theek hai toh done.",
            f"Hmm... ₹{new_buyer_offer:,.0f} tak aa sakta hun. Isse zyada loss hoga mera.",
        ],
        "balanced": [
            f"Theek hai, ₹{new_buyer_offer:,.0f} pe consider kar sakta hun. Quality kaisi hai?",
            f"₹{new_buyer_offer:,.0f} — ye fair price hai, market ke hisaab se.",
            f"Chalo ₹{new_buyer_offer:,.0f} pe try karte hain. Transport meri taraf se.",
        ],
        "quality-focused": [
            f"Grade-A hai toh ₹{new_buyer_offer:,.0f} de sakta hun. Certificate dikhao.",
            f"₹{new_buyer_offer:,.0f} premium quality ke liye. Moisture level check karunga.",
            f"Quality achhi hai toh ₹{new_buyer_offer:,.0f} no problem. Sorting karwa ke lao.",
        ],
    }

    style = persona["style"]
    msg_pool = responses.get(style, responses["balanced"])
    buyer_message = random.choice(msg_pool)

    return {
        "session_id": payload.session_id,
        "buyer_name": persona["name"],
        "buyer_counter_offer": new_buyer_offer,
        "buyer_message": buyer_message,
        "deal_status": "negotiating",
        "round_number": round_num,
        "gap_remaining": round(farmer_offer - new_buyer_offer, 2),
        "tip": random.choice(TIPS),
    }


@router.get("/tips")
def get_negotiation_tips() -> Dict[str, Any]:
    """Get negotiation tips and strategies."""
    return {
        "tips": TIPS,
        "strategies": [
            {"name": "Anchoring", "desc": "Pehla offer hamesha market se thoda upar rakho — buyer wahan se neeche aayega."},
            {"name": "BATNA", "desc": "Doosra buyer ready rakho. 'Mere paas aur bhi offer hai' — ye powerful hai."},
            {"name": "Quality Premium", "desc": "Grading, sorting, packaging karo — 10-15% zyada milta hai."},
            {"name": "Timing", "desc": "Subah mandis mein demand zyada hoti hai. 6-8 AM best time."},
            {"name": "Silence", "desc": "Buyer ke offer ke baad chup raho — usually wo khud price badhata hai."},
        ],
        "buyer_types": list(BUYER_PERSONAS.keys()),
    }
