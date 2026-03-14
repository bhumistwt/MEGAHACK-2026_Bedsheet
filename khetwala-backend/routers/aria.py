"""
Khetwala-मित्र ARIA Chat Router
═══════════════════════════════════════════════════════════════════════════════

Provides backend ARIA chat and transcription using the configured LLM provider.
This keeps API keys server-side and avoids frontend key requirements.
"""

import base64
import binascii
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.logging import get_logger
from services.llm_service import chat_completion, transcribe_audio

logger = get_logger("khetwala.routers.aria")

router = APIRouter(prefix="/aria", tags=["aria"])

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
    source: str = "llm"
    language_code: str = "en"


class AriaTranscriptionRequest(BaseModel):
    audio_base64: str
    mime_type: str = Field(default='audio/mp4')
    language_code: str = Field(default='hi', examples=['hi', 'en', 'mr', 'kn', 'gu'])
    file_name: str = Field(default='aria-input.m4a')


class AriaTranscriptionResponse(BaseModel):
    transcript: str
    source: str = 'groq'
    language_code: str = 'en'


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════


def _normalize_language(code: str) -> str:
    safe = (code or "en").strip().lower()
    return safe if safe in ("hi", "en", "mr", "kn", "gu") else "en"


def _detect_language_from_text(text: str, fallback: str = "en") -> str:
    sample = (text or "").strip()
    if not sample:
        return _normalize_language(fallback)

    devanagari = sum(1 for ch in sample if "\u0900" <= ch <= "\u097F")
    gujarati = sum(1 for ch in sample if "\u0A80" <= ch <= "\u0AFF")
    kannada = sum(1 for ch in sample if "\u0C80" <= ch <= "\u0CFF")
    latin = sum(1 for ch in sample if ("a" <= ch.lower() <= "z"))

    if kannada > 0 and kannada >= max(devanagari, gujarati):
        return "kn"
    if gujarati > 0 and gujarati >= max(devanagari, kannada):
        return "gu"

    if devanagari > 0:
        marathi_tokens = ["आहे", "नाही", "काय", "माझ", "कापणी", "पाऊस"]
        if any(token in sample for token in marathi_tokens):
            return "mr"
        return "hi"

    if latin > 0:
        lowered = sample.lower()
        english_tokens = ["weather", "market", "price", "scheme", "harvest", "help", "today"]
        if any(token in lowered for token in english_tokens):
            return "en"

    return _normalize_language(fallback)


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


def _local_aria_fallback(lang: str, ctx: AriaContext) -> str:
    crop = ctx.crop if ctx.crop and ctx.crop != "Unknown" else None
    district = ctx.district if ctx.district and ctx.district != "Unknown" else None

    hints = {
        "en": (
            f"I can still help you right now. Please share your crop, district, and today’s concern"
            f"{f' (for {crop} in {district})' if crop and district else ''}, and I will give a clear next step."
        ),
        "hi": (
            f"Main abhi bhi madad kar sakta hoon. Aap apni fasal, district aur aaj ki dikkat bataiye"
            f"{f' ({district} mein {crop} ke liye)' if crop and district else ''}, main turant seedha agla step bataunga."
        ),
        "mr": (
            f"मी आत्ताही मदत करू शकतो. तुमचं पीक, जिल्हा आणि आजची समस्या सांगा"
            f"{f' ({district} मधील {crop} साठी)' if crop and district else ''}, मी लगेच स्पष्ट पुढचा उपाय देतो."
        ),
        "kn": (
            f"ನಾನು ಈಗಲೂ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದು. ನಿಮ್ಮ ಬೆಳೆ, ಜಿಲ್ಲೆ ಮತ್ತು ಇಂದಿನ ಸಮಸ್ಯೆ ಹೇಳಿ"
            f"{f' ({district}ನಲ್ಲಿ {crop}ಗಾಗಿ)' if crop and district else ''}, ನಾನು ತಕ್ಷಣ ಸ್ಪಷ್ಟ ಮುಂದಿನ ಹೆಜ್ಜೆ ಹೇಳುತ್ತೇನೆ."
        ),
        "gu": (
            f"હું અત્યારે પણ મદદ કરી શકું છું. તમારો પાક, જિલ્લો અને આજની સમસ્યા કહો"
            f"{f' ({district}માં {crop} માટે)' if crop and district else ''}, હું તરત જ સ્પષ્ટ આગળનું પગલું કહું છું."
        ),
    }
    return hints.get(lang, hints["en"])


# ══════════════════════════════════════════════════════════════════════════════
# Endpoint
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/chat", response_model=AriaChatResponse)
async def aria_chat(payload: AriaChatRequest) -> Dict[str, Any]:
    """
    Send a chat message to ARIA and get a response via Google Gemini.
    """
    requested_lang = _normalize_language(payload.language_code)
    last_user_text = ""
    for msg in reversed(payload.messages or []):
        if msg.role == "user" and (msg.text or "").strip():
            last_user_text = msg.text
            break
    lang = _detect_language_from_text(last_user_text, requested_lang)
    system_prompt = _build_system_prompt(payload.context, lang)
    messages = [
        {
            'role': 'assistant' if msg.role == 'assistant' else 'user',
            'content': msg.text,
        }
        for msg in (payload.messages or [])[-10:]
        if (msg.text or '').strip()
    ]

    try:
        completion = await chat_completion(
            system_prompt=system_prompt,
            messages=messages,
            temperature=0.35,
            max_output_tokens=500,
        )
        reply_text = (completion.get('content') or '').strip()
        if not reply_text:
            return {
                "reply": _local_aria_fallback(lang, payload.context),
                "source": "fallback",
                "language_code": lang,
            }
        return {
            'reply': reply_text,
            'source': completion.get('provider', 'llm'),
            'language_code': lang,
        }
    except HTTPException as exc:
        logger.error('ARIA chat provider error', error=str(exc.detail))
        return {
            "reply": _local_aria_fallback(lang, payload.context),
            "source": "fallback",
            "language_code": lang,
        }


@router.post('/transcribe', response_model=AriaTranscriptionResponse)
async def aria_transcribe(payload: AriaTranscriptionRequest) -> Dict[str, str]:
    lang = _normalize_language(payload.language_code)
    try:
        audio_bytes = base64.b64decode(payload.audio_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail='Invalid audio payload') from exc

    if not audio_bytes:
        raise HTTPException(status_code=400, detail='Audio payload is empty')

    transcript = await transcribe_audio(
        audio_bytes=audio_bytes,
        file_name=payload.file_name,
        mime_type=payload.mime_type,
        language_code=lang,
    )

    return {
        'transcript': transcript.get('text', ''),
        'source': transcript.get('provider', 'groq'),
        'language_code': lang,
    }
