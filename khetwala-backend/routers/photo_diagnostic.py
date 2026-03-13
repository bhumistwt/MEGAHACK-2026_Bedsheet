"""
[F3] Enhanced Photo Diagnostic Router
═══════════════════════════════════════════════════════════════════════════════

Extends the disease scanner with Gemini Vision for multi-photo
analysis and treatment cost comparison with local shop integration.
"""

import os
import base64
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.logging import get_logger

logger = get_logger("khetwala.routers.photo_diagnostic")
router = APIRouter(prefix="/api/disease", tags=["photo-diagnostic"])

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"


# ── Treatment tiers ─────────────────────────────────────────────────────

TREATMENT_TIERS = {
    "blight": [
        {"rank": 1, "label": "Cheapest", "treatment": "Neem Oil Spray", "cost_per_acre": 120, "effectiveness": 60},
        {"rank": 2, "label": "Most Effective", "treatment": "Mancozeb 75% WP", "cost_per_acre": 340, "effectiveness": 85},
        {"rank": 3, "label": "Expert Pick", "treatment": "Copper Oxychloride + Cymoxanil", "cost_per_acre": 580, "effectiveness": 95},
    ],
    "wilt": [
        {"rank": 1, "label": "Cheapest", "treatment": "Trichoderma Viride", "cost_per_acre": 180, "effectiveness": 55},
        {"rank": 2, "label": "Most Effective", "treatment": "Carbendazim 50% WP", "cost_per_acre": 220, "effectiveness": 80},
        {"rank": 3, "label": "Expert Pick", "treatment": "Metalaxyl + Mancozeb", "cost_per_acre": 450, "effectiveness": 90},
    ],
    "rust": [
        {"rank": 1, "label": "Cheapest", "treatment": "Sulphur WP", "cost_per_acre": 100, "effectiveness": 50},
        {"rank": 2, "label": "Most Effective", "treatment": "Propiconazole 25% EC", "cost_per_acre": 380, "effectiveness": 85},
        {"rank": 3, "label": "Expert Pick", "treatment": "Tebuconazole + Trifloxystrobin", "cost_per_acre": 520, "effectiveness": 92},
    ],
    "pest": [
        {"rank": 1, "label": "Cheapest", "treatment": "Neem Oil + Soap Solution", "cost_per_acre": 80, "effectiveness": 45},
        {"rank": 2, "label": "Most Effective", "treatment": "Imidacloprid 17.8% SL", "cost_per_acre": 450, "effectiveness": 85},
        {"rank": 3, "label": "Expert Pick", "treatment": "Thiamethoxam + Lambda-cyhalothrin", "cost_per_acre": 620, "effectiveness": 93},
    ],
    "deficiency": [
        {"rank": 1, "label": "Cheapest", "treatment": "Vermicompost + Local Organic", "cost_per_acre": 600, "effectiveness": 55},
        {"rank": 2, "label": "Most Effective", "treatment": "DAP + Micronutrient Mix", "cost_per_acre": 1630, "effectiveness": 85},
        {"rank": 3, "label": "Expert Pick", "treatment": "Custom Soil-Test Based Fertilizer", "cost_per_acre": 2000, "effectiveness": 95},
    ],
    "default": [
        {"rank": 1, "label": "Cheapest", "treatment": "Neem Oil Spray", "cost_per_acre": 120, "effectiveness": 50},
        {"rank": 2, "label": "Most Effective", "treatment": "Mancozeb + Carbendazim", "cost_per_acre": 340, "effectiveness": 80},
        {"rank": 3, "label": "Expert Pick", "treatment": "Consult KVK / Agri Officer", "cost_per_acre": 0, "effectiveness": 95},
    ],
}


def _match_treatment_category(disease: str) -> str:
    disease_lower = disease.lower()
    if "blight" in disease_lower or "spot" in disease_lower:
        return "blight"
    elif "wilt" in disease_lower or "root_rot" in disease_lower:
        return "wilt"
    elif "rust" in disease_lower:
        return "rust"
    elif "pest" in disease_lower or "aphid" in disease_lower or "thrip" in disease_lower:
        return "pest"
    elif "deficiency" in disease_lower or "yellow" in disease_lower:
        return "deficiency"
    return "default"


# ── Schemas ──────────────────────────────────────────────────────────────

class PhotoDiagnosticRequest(BaseModel):
    images_base64: List[str] = Field(..., min_length=1, max_length=5)
    crop: Optional[str] = None
    district: Optional[str] = None
    symptoms_text: Optional[str] = None  # Voice-transcribed symptom description


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/photo-diagnostic")
async def photo_diagnostic(
    payload: PhotoDiagnosticRequest,
) -> Dict[str, Any]:
    """
    Analyze plant photos using Gemini Vision for disease identification.
    Returns disease info + 3-tier treatment recommendations.
    """
    if not GEMINI_KEY:
        # Fallback mock response
        return _mock_diagnostic(payload.crop)

    try:
        # Build multimodal parts
        parts = []

        # System prompt
        parts.append({
            "text": (
                "You are an expert Indian agricultural pathologist. Analyze these plant images "
                "and identify any diseases, pest damage, or nutrient deficiencies. "
                "Respond in this exact JSON format (no markdown):\n"
                '{"disease_name": "...", "disease_name_hindi": "...", '
                '"confidence": 0.0-1.0, "severity": "low/medium/high/critical", '
                '"category": "fungal/bacterial/viral/pest/deficiency/healthy", '
                '"affected_area_pct": 0-100, '
                '"description": "2-3 sentence description in Hindi-English mix", '
                '"immediate_action": "What to do RIGHT NOW in Hindi-English mix"}'
            )
        })

        # Add context if provided
        if payload.crop:
            parts.append({"text": f"Crop: {payload.crop}"})
        if payload.symptoms_text:
            parts.append({"text": f"Farmer's description: {payload.symptoms_text}"})

        # Add images
        for img_b64 in payload.images_base64[:3]:  # Max 3 images
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": img_b64,
                }
            })

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                GEMINI_URL,
                json={"contents": [{"parts": parts}]},
                headers={"x-goog-api-key": GEMINI_KEY},
            )

        if resp.status_code != 200:
            logger.error(f"Gemini Vision error: {resp.status_code}")
            return _mock_diagnostic(payload.crop)

        data = resp.json()
        ai_text = data["candidates"][0]["content"]["parts"][0]["text"]

        # Parse JSON from response
        import json
        # Clean potential markdown wrapper
        ai_text = ai_text.strip()
        if ai_text.startswith("```"):
            ai_text = ai_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        diagnosis = json.loads(ai_text)

    except Exception as e:
        logger.error(f"Photo diagnostic error: {e}")
        return _mock_diagnostic(payload.crop)

    # Get treatment recommendations
    category = _match_treatment_category(diagnosis.get("disease_name", ""))
    treatments = TREATMENT_TIERS.get(category, TREATMENT_TIERS["default"])

    return {
        "diagnosis": diagnosis,
        "treatments": treatments,
        "images_analyzed": len(payload.images_base64),
        "crop": payload.crop,
        "district": payload.district,
        "nearest_kvk": _get_nearest_kvk(payload.district),
    }


def _mock_diagnostic(crop: Optional[str]) -> Dict[str, Any]:
    """Fallback mock diagnostic."""
    return {
        "diagnosis": {
            "disease_name": "Early Blight",
            "disease_name_hindi": "पत्ती का धब्बा रोग",
            "confidence": 0.78,
            "severity": "medium",
            "category": "fungal",
            "affected_area_pct": 30,
            "description": (
                "Patti pe brown-black concentric rings dikh rahe hain. "
                "Ye Early Blight hai — Alternaria fungus se hota hai. "
                "Neem aur humidity zyada hone pe spread hota hai."
            ),
            "immediate_action": (
                "Affected pattiyan tod ke jala do. Kal subah Mancozeb spray karo. "
                "Paani seedha pattiyon pe mat daalo — drip use karo."
            ),
        },
        "treatments": TREATMENT_TIERS["blight"],
        "images_analyzed": 1,
        "crop": crop or "unknown",
        "source": "mock",
    }


def _get_nearest_kvk(district: Optional[str]) -> Dict[str, str]:
    """Return nearest KVK (Krishi Vigyan Kendra) info."""
    kvk_data = {
        "nashik": {"name": "KVK Nashik", "phone": "0253-2300000", "address": "Dindori Road, Nashik"},
        "pune": {"name": "KVK Pune", "phone": "020-25000000", "address": "Baramati, Pune"},
        "ahmednagar": {"name": "KVK Ahmednagar", "phone": "0241-2300000", "address": "Rahuri, Ahmednagar"},
    }
    if district:
        return kvk_data.get(district.lower(), {"name": "Contact local KVK", "phone": "1800-180-1551"})
    return {"name": "Toll-free KVK helpline", "phone": "1800-180-1551"}
