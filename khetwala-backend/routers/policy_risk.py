"""
[F12] Policy Risk Alerts Router
═══════════════════════════════════════════════════════════════════════════════

Monitors government policies, MSP changes, export bans, and tariff
updates that affect commodity prices. Generates actionable alerts.
"""

import os
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logging import get_logger

logger = get_logger("khetwala.routers.policy_risk")
router = APIRouter(prefix="/market", tags=["policy-risk"])

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"


# ── MSP data (2024-25 Kharif & Rabi) ────────────────────────────────────

MSP_DATA = {
    "paddy_common": {"msp_2024": 2300, "msp_2023": 2183, "change_pct": 5.4},
    "paddy_grade_a": {"msp_2024": 2320, "msp_2023": 2203, "change_pct": 5.3},
    "wheat": {"msp_2024": 2275, "msp_2023": 2125, "change_pct": 7.1},
    "jowar": {"msp_2024": 3371, "msp_2023": 3180, "change_pct": 6.0},
    "bajra": {"msp_2024": 2625, "msp_2023": 2500, "change_pct": 5.0},
    "maize": {"msp_2024": 2225, "msp_2023": 2090, "change_pct": 6.5},
    "tur_dal": {"msp_2024": 7550, "msp_2023": 7000, "change_pct": 7.9},
    "moong": {"msp_2024": 8682, "msp_2023": 8558, "change_pct": 1.4},
    "urad": {"msp_2024": 7400, "msp_2023": 6950, "change_pct": 6.5},
    "groundnut": {"msp_2024": 6783, "msp_2023": 6377, "change_pct": 6.4},
    "soybean": {"msp_2024": 4892, "msp_2023": 4600, "change_pct": 6.3},
    "cotton": {"msp_2024": 7121, "msp_2023": 6620, "change_pct": 7.6},
    "sugarcane": {"msp_2024": 340, "msp_2023": 315, "change_pct": 7.9},
    "onion": {"msp_2024": None, "msp_2023": None, "change_pct": None,
              "note": "No MSP for onion. Market-driven pricing."},
    "tomato": {"msp_2024": None, "msp_2023": None, "change_pct": None,
               "note": "No MSP for tomato. Highly volatile market pricing."},
    "potato": {"msp_2024": None, "msp_2023": None, "change_pct": None,
               "note": "No MSP for potato. Storage and timing critical."},
}


# ── Known policy events (updated manually or via ETL) ────────────────────

POLICY_EVENTS = [
    {
        "id": "export_ban_onion_2024",
        "commodity": "onion",
        "event_type": "export_ban",
        "title": "Onion Export Ban Extended",
        "description": "Government extended onion export ban to control domestic prices. Expect 15-20% price drop in wholesale markets.",
        "impact": "negative",
        "severity": "high",
        "date": "2024-03-15",
        "recommendation": "Hold stock if possible. Prices may recover after ban lifts. Consider cold storage.",
    },
    {
        "id": "msp_hike_wheat_2024",
        "commodity": "wheat",
        "event_type": "msp_change",
        "title": "Wheat MSP Increased by 7.1%",
        "description": "MSP for wheat raised to ₹2,275/quintal for 2024-25 season. Positive for wheat farmers.",
        "impact": "positive",
        "severity": "medium",
        "date": "2024-07-01",
        "recommendation": "Sell at government procurement centers to get MSP. Register on e-NAM.",
    },
    {
        "id": "import_duty_edible_oil",
        "commodity": "soybean",
        "event_type": "tariff_change",
        "title": "Import Duty on Edible Oil Raised",
        "description": "Import duty on crude palm oil and soybean oil increased. Domestic soybean prices expected to rise.",
        "impact": "positive",
        "severity": "medium",
        "date": "2024-09-14",
        "recommendation": "Good time to sell soybean. Prices trending up due to import duty hike.",
    },
    {
        "id": "buffer_stock_tomato",
        "commodity": "tomato",
        "event_type": "government_intervention",
        "title": "Government to Release Tomato Buffer Stock",
        "description": "NAFED to release 10,000 MT tomato buffer stock to control retail prices.",
        "impact": "negative",
        "severity": "medium",
        "date": "2024-06-20",
        "recommendation": "Sell current stock quickly before buffer release depresses prices further.",
    },
    {
        "id": "pm_kisan_installment",
        "commodity": "all",
        "event_type": "subsidy",
        "title": "PM-KISAN 17th Installment Released",
        "description": "₹2,000 PM-KISAN installment credited. Check your bank account.",
        "impact": "positive",
        "severity": "low",
        "date": "2024-06-18",
        "recommendation": "Use PM-KISAN funds for quality inputs. Invest in next season preparation.",
    },
]


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/policy-risk/{commodity}")
async def get_policy_risk(
    commodity: str,
) -> Dict[str, Any]:
    """Get policy risk alerts for a specific commodity."""
    commodity_lower = commodity.lower().strip()

    # MSP info
    msp_info = None
    for key, data in MSP_DATA.items():
        if commodity_lower in key:
            msp_info = {"commodity": key, **data}
            break

    # Relevant policy events
    relevant_events = [
        e for e in POLICY_EVENTS
        if commodity_lower in e["commodity"].lower() or e["commodity"] == "all"
    ]

    # Risk assessment
    negative_events = [e for e in relevant_events if e["impact"] == "negative"]
    positive_events = [e for e in relevant_events if e["impact"] == "positive"]

    if len(negative_events) > len(positive_events):
        risk_level = "high"
        risk_summary = f"⚠️ {commodity} ke liye {len(negative_events)} negative policy alerts hain. Careful selling strategy rakho."
    elif len(positive_events) > 0:
        risk_level = "low"
        risk_summary = f"✅ {commodity} ke liye positive policy environment hai. Good time to sell."
    else:
        risk_level = "moderate"
        risk_summary = f"📊 {commodity} ke liye koi major policy change nahi hai. Normal market conditions."

    # Try Gemini for latest analysis
    ai_analysis = None
    if GEMINI_KEY:
        try:
            ai_analysis = await _get_gemini_analysis(commodity)
        except Exception as e:
            logger.warning(f"Gemini analysis failed: {e}")

    return {
        "commodity": commodity,
        "risk_level": risk_level,
        "risk_summary": risk_summary,
        "msp_info": msp_info,
        "policy_events": relevant_events,
        "positive_count": len(positive_events),
        "negative_count": len(negative_events),
        "ai_analysis": ai_analysis,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/msp/{commodity}")
def get_msp(commodity: str) -> Dict[str, Any]:
    """Get MSP (Minimum Support Price) for a commodity."""
    commodity_lower = commodity.lower().strip()
    for key, data in MSP_DATA.items():
        if commodity_lower in key:
            return {"commodity": key, **data}
    return {
        "commodity": commodity,
        "msp_2024": None,
        "message": "MSP data not available for this commodity.",
    }


@router.get("/policy-alerts")
def get_all_alerts(
    impact: Optional[str] = None,
) -> Dict[str, Any]:
    """Get all recent policy alerts, optionally filtered by impact."""
    events = POLICY_EVENTS
    if impact:
        events = [e for e in events if e["impact"] == impact]
    return {
        "total": len(events),
        "alerts": events,
    }


async def _get_gemini_analysis(commodity: str) -> Optional[str]:
    """Use Gemini to generate policy impact analysis."""
    prompt = (
        f"As an Indian agricultural policy expert, analyze the current policy "
        f"environment for {commodity} in India. Consider: export/import policies, "
        f"MSP changes, buffer stock operations, and subsidy programs. "
        f"Give a 2-3 sentence actionable advice for small farmers in Hindi-English mix. "
        f"Focus on what they should DO right now."
    )
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            GEMINI_URL,
            json={"contents": [{"parts": [{"text": prompt}]}]},
            headers={"x-goog-api-key": GEMINI_KEY},
        )
        if resp.status_code == 200:
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
    return None
