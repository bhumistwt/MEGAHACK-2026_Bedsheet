"""Government schemes router — uses Google Gemini to fetch real scheme information."""

import json
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/schemes", tags=["schemes"])

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

FALLBACK_SCHEMES = [
    {
        "name": "PM-KISAN सम्मान निधि",
        "benefit_amount": "₹6,000 प्रति वर्ष",
        "eligibility": "सभी छोटे और सीमांत किसान जिनके पास 2 हेक्टेयर तक ज़मीन है",
        "how_to_apply": "pmkisan.gov.in पर आधार से रजिस्टर करें",
        "deadline": "2025-03-31",
        "scheme_type": "subsidy",
    },
    {
        "name": "प्रधानमंत्री फसल बीमा योजना (PMFBY)",
        "benefit_amount": "फसल नुकसान का 80% तक coverage",
        "eligibility": "सभी किसान — खरीफ और रबी फसलों के लिए",
        "how_to_apply": "नज़दीकी बैंक या CSC सेंटर पर apply करें",
        "deadline": "2025-04-15",
        "scheme_type": "insurance",
    },
    {
        "name": "Kisan Credit Card (KCC)",
        "benefit_amount": "₹3 लाख तक 4% ब्याज पर लोन",
        "eligibility": "सभी किसान — PM-KISAN लाभार्थी प्राथमिकता पर",
        "how_to_apply": "अपने बैंक ब्रांच में KCC application form भरें",
        "deadline": None,
        "scheme_type": "loan",
    },
    {
        "name": "MSP — न्यूनतम समर्थन मूल्य",
        "benefit_amount": "₹2,275/quintal (गेहूं 2024-25)",
        "eligibility": "सभी किसान जो सरकारी मंडी में बेचते हैं",
        "how_to_apply": "नज़दीकी APMC मंडी में MSP पर बिक्री करें",
        "deadline": None,
        "scheme_type": "msp",
    },
]


@router.get("")
async def get_schemes(
    crop: str = Query("Onion", min_length=2),
    state: str = Query("Maharashtra", min_length=2),
) -> Dict[str, Any]:
    """Fetch government schemes using Gemini AI, with fallback to static data."""
    if not GOOGLE_API_KEY:
        return {
            "schemes": FALLBACK_SCHEMES,
            "source": "fallback",
            "reason": "GOOGLE_API_KEY not configured",
        }

    prompt = (
        f"List 4 real active Indian government schemes for a {crop} "
        f"farmer in {state} in 2024-25. Return ONLY a JSON array:\n"
        '[{"name": "string", "benefit_amount": "string (e.g. ₹6,000 per year)", '
        '"eligibility": "string (one line, simple Hindi or English)", '
        '"how_to_apply": "string (one line)", '
        '"deadline": "string | null", '
        '"scheme_type": "subsidy | insurance | loan | msp"}]\n'
        "Use only real, active schemes. No markdown, just JSON."
    )

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                GEMINI_URL,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 800},
                },
                headers={"x-goog-api-key": GOOGLE_API_KEY},
            )
            response.raise_for_status()
            data = response.json()

        content = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        json_match = re.search(r"\[[\s\S]*\]", content)
        if json_match:
            schemes = json.loads(json_match.group())
            if isinstance(schemes, list) and len(schemes) > 0:
                return {"schemes": schemes, "source": "gemini"}

        return {"schemes": FALLBACK_SCHEMES, "source": "fallback", "reason": "Could not parse AI response"}

    except Exception as exc:
        return {
            "schemes": FALLBACK_SCHEMES,
            "source": "fallback",
            "reason": str(exc),
        }
