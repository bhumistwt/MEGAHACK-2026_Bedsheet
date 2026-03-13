"""
Khetwala-मित्र ARIA Chat Router
═══════════════════════════════════════════════════════════════════════════════

Proxies chat requests to Google Gemini API for the ARIA voice assistant.
This ensures the API key is securely used server-side and avoids
client-side env-variable loading issues in Expo Go.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import settings
from core.logging import get_logger

import httpx

logger = get_logger("khetwala.routers.aria")

router = APIRouter(prefix="/aria", tags=["aria"])

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

LANGUAGE_LABELS = {
    "hi": "Hindi",
    "en": "English",
    "mr": "Marathi",
    "kn": "Kannada",
    "gu": "Gujarati",
}


# ══════════════════════════════════════════════════════════════════════════════
# Request / Response Schemas
# ══════════════════════════════════════════════════════════════════════════════


class ChatMessage(BaseModel):
    role: str = Field(..., examples=["user", "assistant"])
    text: str = Field(..., examples=["Mera pyaz kab bechun?"])


class AriaContext(BaseModel):
    crop: str = Field(default="Unknown")
    district: str = Field(default="Unknown")
    risk_category: str = Field(default="Unknown")
    last_recommendation: str = Field(default="Unknown")
    negotiate_intent: bool = Field(default=False)
    negotiate_crop: str = Field(default="Unknown")


class AriaChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(default_factory=list)
    context: AriaContext = Field(default_factory=AriaContext)
    language_code: str = Field(default="hi", examples=["hi", "en", "mr", "kn", "gu"])


class AriaChatResponse(BaseModel):
    reply: str
    source: str = "gemini"


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════


def _normalize_language(code: str) -> str:
    safe = (code or "en").strip().lower()
    return safe if safe in ("hi", "en", "mr", "kn", "gu") else "en"


def _build_system_prompt(ctx: AriaContext, lang: str) -> str:
    preferred = LANGUAGE_LABELS.get(lang, "English")

    negotiate_section = ""
    if getattr(ctx, "negotiate_intent", False):
        crop = getattr(ctx, "negotiate_crop", ctx.crop)
        negotiate_section = (
            "\n\nFarmer is asking about NEGOTIATION / PRICING strategy.\n"
            f"Crop being negotiated: {crop}\n"
            "Give actionable bargaining tips:\n"
            "- Current fair market range (approx MSP or mandi avg)\n"
            "- Best time of day to sell at mandi\n"
            "- Quality factors that increase price\n"
            "- How to counter lowball offers\n"
            "- Suggest the Negotiation Simulator for practice\n"
        )

    return (
        "Tu ARIA hai — ek AI assistant jo sirf Indian farmers ki madad karta hai.\n"
        "Rules:\n"
        "1. Hamesha usi bhasha mein jawab de jo farmer ne use ki\n"
        "2. Simple words use kar — gaon ka kisan samjhe aise\n"
        "3. Kabhi technical jargon mat use kar\n"
        "4. Maximum 3 sentences mein jawab de\n"
        "5. Hamesha ek clear action ke saath khatam kar: 'Aaj hi becho' ya 'Kal tak ruko' ya 'Doctor ko dikhao'\n"
        "6. Sirf farming, mandi prices, weather, govt schemes ke baare mein baat kar\n"
        "7. Agar koi aur topic aaye → 'Yeh mujhe nahi pata, kheti ke baare mein puchho' bol de\n\n"
        f"Farmer ka current data:\n"
        f"Crop: {ctx.crop}, District: {ctx.district}, "
        f"Spoilage Risk: {ctx.risk_category}, "
        f"Last Recommendation: {ctx.last_recommendation}\n\n"
        f"{negotiate_section}"
        f"Reply language preference: {preferred}."
    )


# ══════════════════════════════════════════════════════════════════════════════
# Endpoint
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/chat", response_model=AriaChatResponse)
async def aria_chat(payload: AriaChatRequest) -> Dict[str, Any]:
    """
    Send a chat message to ARIA and get a response via Google Gemini.
    """
    lang = _normalize_language(payload.language_code)
    api_key = settings.google_api_key

    if not api_key:
        logger.error("GOOGLE_API_KEY is not configured on the backend")
        raise HTTPException(status_code=503, detail="ARIA service unavailable — API key missing")

    system_prompt = _build_system_prompt(payload.context, lang)

    # Build conversation text from last 10 messages
    conversation_lines = []
    for msg in (payload.messages or [])[-10:]:
        role_label = "ARIA" if msg.role == "assistant" else "Farmer"
        conversation_lines.append(f"{role_label}: {msg.text}")
    conversation_text = "\n".join(conversation_lines)

    full_prompt = f"{system_prompt}\n\nConversation so far:\n{conversation_text}\n\nARIA:"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                GEMINI_URL,
                json={
                    "contents": [{"parts": [{"text": full_prompt}]}],
                    "generationConfig": {
                        "temperature": 0.35,
                        "maxOutputTokens": 500,
                    },
                },
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
            )

        if resp.status_code != 200:
            logger.error(
                "Gemini API error",
                status=resp.status_code,
                body=resp.text[:500],
            )
            raise HTTPException(
                status_code=502,
                detail=f"Gemini returned {resp.status_code}",
            )

        data = resp.json()
        reply_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )

        if not reply_text:
            logger.warning("Gemini returned empty content", response=data)
            raise HTTPException(status_code=502, detail="Gemini returned empty response")

        return {"reply": reply_text, "source": "gemini"}

    except httpx.HTTPError as exc:
        logger.error("Gemini network error", error=str(exc))
        raise HTTPException(status_code=502, detail=f"Gemini network error: {exc}")
