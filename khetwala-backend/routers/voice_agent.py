"""
Khetwala AI Voice Calling Agent Router
═══════════════════════════════════════════════════════════════════════════════

Provides complete phone-call based assistant for farmers:
- Inbound and outbound call handling
- Voice-to-text (telephony provider speech gather)
- Text-to-speech responses in farmer's language
- AI orchestration across project feature APIs
- Human escalation
- Full call + transcript logging for dashboard
"""

from __future__ import annotations

import json
import base64
import hashlib
import hmac
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_escape

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from core.logging import get_logger
from db.models import User, VoiceCallLog, VoiceCallTurnLog
from db.session import get_db

logger = get_logger("khetwala.routers.voice_agent")
router = APIRouter(prefix="/voice-agent", tags=["voice-agent"])

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

MAX_AGENT_TURNS = 5

SUPPORTED_LANGUAGES = {
    "en": "English",
    "hi": "Hindi",
    "kn": "Kannada",
    "mr": "Marathi",
    "gu": "Gujarati",
}

TWILIO_SPEECH_LANG = {
    "en": "en-IN",
    "hi": "hi-IN",
    "kn": "kn-IN",
    "mr": "mr-IN",
    "gu": "gu-IN",
}

GATHER_HINTS = {
    "en": "weather, market, mandi, scheme, harvest, onion, tomato, potato, soil, credit",
    "hi": "mausam, mandi, bhav, yojana, fasal, pyaz, tamatar, aloo, mitti, credit",
    "kn": "ಹವಾಮಾನ, ಮಾರುಕಟ್ಟೆ, ಬೆಲೆ, ಯೋಜನೆ, ಬೆಳೆ, ಈರುಳ್ಳಿ, ಟೊಮಾಟೊ, ಆಲೂಗಡ್ಡೆ, ಮಣ್ಣು",
    "mr": "हवामान, बाजार, भाव, योजना, पीक, कांदा, टोमॅटो, बटाटा, माती",
    "gu": "હવામાન, બજાર, ભાવ, યોજના, પાક, ડુંગળી, ટામેટા, બટાકા, માટી",
}

LANG_END_WORDS = {
    "en": {"stop", "bye", "end call", "disconnect", "quit", "exit"},
    "hi": {"band", "band karo", "bye", "ruk", "khatam", "alvida"},
    "kn": {"ನಿಲ್ಲಿಸು", "ಮುಕ್ತಾಯ", "ಬೈ", "ಕಾಲ್ ಮುಚ್ಚು"},
    "mr": {"थांब", "बंद", "बाय", "कॉल बंद"},
    "gu": {"બંધ", "બાય", "કૉલ બંધ"},
}

CATALOG_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}

TOOL_DECLARATIONS = [
    {
        "name": "call_feature_api",
        "description": (
            "Invoke any Khetwala backend feature using endpoint_key from provided catalog. "
            "Use this for weather, crop advice, price data, schemes, alerts, diary, simulator, "
            "marketplace, digital twin, IoT, blockchain, and other app actions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "endpoint_key": {
                    "type": "string",
                    "description": "Feature key from catalog",
                },
                "path_params": {
                    "type": "object",
                    "description": "Path params required by endpoint",
                },
                "query_params": {
                    "type": "object",
                    "description": "Optional query params",
                },
                "body": {
                    "type": "object",
                    "description": "Optional JSON body for POST/PUT endpoints",
                },
            },
            "required": ["endpoint_key"],
        },
    },
    {
        "name": "update_user_language",
        "description": "Update farmer preferred language code in user profile",
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer"},
                "language_code": {
                    "type": "string",
                    "enum": ["en", "hi", "kn", "mr", "gu"],
                },
            },
            "required": ["user_id", "language_code"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": "Escalate voice interaction to human operator",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"},
            },
            "required": ["reason"],
        },
    },
]


class OutboundCallRequest(BaseModel):
    to_phone: str = Field(..., min_length=10, max_length=20)
    user_id: Optional[int] = None
    language_code: Optional[str] = "en"
    initial_prompt: Optional[str] = None


class VoiceFeatureInvokeRequest(BaseModel):
    endpoint_key: str
    path_params: Dict[str, Any] = Field(default_factory=dict)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    body: Dict[str, Any] = Field(default_factory=dict)


class VoiceSimulateRequest(BaseModel):
    call_sid: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[int] = None
    language_code: str = "en"
    text: str = Field(..., min_length=1)


class VoiceSimulateResponse(BaseModel):
    reply_text: str
    language_code: str
    escalated_to_human: bool = False
    action_trace: List[Dict[str, Any]] = Field(default_factory=list)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_language(code: Optional[str]) -> str:
    safe = (code or "en").strip().lower()
    return safe if safe in SUPPORTED_LANGUAGES else "en"


def _normalize_catalog_path(path: str) -> str:
    normalized = (path or "").strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"

    prefix = _api_prefix()
    if prefix and normalized.startswith(prefix + "/"):
        normalized = normalized[len(prefix):]
    elif prefix and normalized == prefix:
        normalized = "/"

    return normalized


def _make_endpoint_key(tags: List[str], operation_id: str, method: str, path: str) -> str:
    raw_parts = [
        (tags[0] if tags else "feature"),
        operation_id or "",
        method.lower(),
        path,
    ]
    raw = ".".join([p for p in raw_parts if p])
    key = re.sub(r"[^a-z0-9]+", ".", raw.lower()).strip(".")
    return key or f"feature.{method.lower()}"


@lru_cache(maxsize=1)
def _feature_catalog() -> Dict[str, Dict[str, Any]]:
    from main import app as fastapi_app

    schema = fastapi_app.openapi()
    catalog: Dict[str, Dict[str, Any]] = {}
    key_counts: Dict[str, int] = {}

    for raw_path, operations in (schema.get("paths") or {}).items():
        if not isinstance(operations, dict):
            continue

        for method_name, operation in operations.items():
            method = str(method_name).upper()
            if method not in CATALOG_HTTP_METHODS:
                continue

            path = _normalize_catalog_path(str(raw_path))
            if path.startswith("/voice-agent/") or path == "/voice-agent":
                continue

            if not isinstance(operation, dict):
                continue

            tags = [str(t) for t in (operation.get("tags") or ["general"])]
            operation_id = str(operation.get("operationId") or "")
            key_base = _make_endpoint_key(tags, operation_id, method, path)
            key_counts[key_base] = key_counts.get(key_base, 0) + 1
            key = key_base if key_counts[key_base] == 1 else f"{key_base}.{key_counts[key_base]}"

            description = (
                str(operation.get("summary") or "").strip()
                or str(operation.get("description") or "").strip()
                or f"{method} {path}"
            )

            catalog[key] = {
                "method": method,
                "path": path,
                "description": description,
                "tags": tags,
                "operation_id": operation_id,
            }

    return catalog


def _api_prefix() -> str:
    return "/api/v1" if settings.is_production else ""


def _public_base_url() -> str:
    return (settings.voice_agent_public_base_url or "http://127.0.0.1:8000").rstrip("/")


def _internal_api_base_url() -> str:
    explicit = (settings.voice_agent_internal_api_base_url or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return _public_base_url()


def _compute_twilio_signature(url: str, params: Dict[str, Any], auth_token: str) -> str:
    values: List[str] = []
    for key in sorted(params.keys()):
        value = params.get(key)
        if value is None:
            continue
        values.append(f"{key}{value}")
    payload = f"{url}{''.join(values)}"
    digest = hmac.new(auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("utf-8")


def _validate_twilio_signature(request: Request, form_values: Dict[str, Any]) -> bool:
    if not settings.twilio_auth_token:
        return True

    received_signature = (request.headers.get("X-Twilio-Signature") or "").strip()
    if not received_signature:
        return False

    candidate_urls = [str(request.url)]
    public_url = f"{_public_base_url()}{request.url.path}"
    if request.url.query:
        public_url = f"{public_url}?{request.url.query}"
    candidate_urls.append(public_url)

    for url in candidate_urls:
        expected = _compute_twilio_signature(url, form_values, settings.twilio_auth_token)
        if hmac.compare_digest(expected, received_signature):
            return True
    return False


def _is_end_command(text: str, lang: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    options = LANG_END_WORDS.get(lang, LANG_END_WORDS["en"])
    return any(word in normalized for word in options)


def _lang_prompt_text(lang: str, user_name: Optional[str]) -> str:
    name = user_name or "farmer"
    prompts = {
        "en": f"Hello {name}. I am your Khetwala AI calling assistant. How can I help you today?",
        "hi": f"Namaste {name}. Main aapka Khetwala AI call sahayak hoon. Aaj aapko kis baat mein madad chahiye?",
        "kn": f"ನಮಸ್ಕಾರ {name}. ನಾನು ನಿಮ್ಮ ಖೇತ್ವಾಲಾ AI ಕರೆ ಸಹಾಯಕ. ಇಂದು ನಿಮಗೆ ಯಾವ ಸಹಾಯ ಬೇಕು?",
        "mr": f"नमस्कार {name}. मी तुमचा Khetwala AI कॉल सहाय्यक आहे. आज तुम्हाला कोणती मदत हवी आहे?",
        "gu": f"નમસ્તે {name}. હું તમારો Khetwala AI કોલ સહાયક છું. આજે તમને કઈ મદદ જોઈએ?",
    }
    return prompts.get(lang, prompts["en"])


def _build_twiml_gather(
    message: str,
    lang: str,
    call_sid: str,
    retry_count: int = 0,
    should_hangup: bool = False,
    add_human_dial: bool = False,
) -> str:
    speech_lang = TWILIO_SPEECH_LANG.get(lang, "en-IN")
    escaped = xml_escape(message)
    base = _public_base_url()
    process_url = (
        f"{base}{_api_prefix()}/voice-agent/webhook/process"
        f"?call_sid={call_sid}&retry={int(retry_count)}"
    )
    hints = xml_escape(GATHER_HINTS.get(lang, GATHER_HINTS["en"]))

    if add_human_dial and settings.voice_agent_human_operator_number:
        dial_number = xml_escape(settings.voice_agent_human_operator_number)
        return (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            "<Response>"
            f"<Say language=\"{speech_lang}\">{escaped}</Say>"
            f"<Dial>{dial_number}</Dial>"
            "</Response>"
        )

    if should_hangup:
        return (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            "<Response>"
            f"<Say language=\"{speech_lang}\">{escaped}</Say>"
            "<Hangup/>"
            "</Response>"
        )

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Response>"
        f"<Gather input=\"speech dtmf\" language=\"{speech_lang}\" timeout=\"8\" speechTimeout=\"auto\" actionOnEmptyResult=\"true\" hints=\"{hints}\" action=\"{xml_escape(process_url)}\" method=\"POST\">"
        f"<Say language=\"{speech_lang}\">{escaped}</Say>"
        "</Gather>"
        f"<Redirect method=\"POST\">{xml_escape(process_url)}</Redirect>"
        "</Response>"
    )


def _extract_user_id(phone: str, db: Session) -> Optional[int]:
    normalized = (phone or "").replace("+", "").strip()
    if not normalized:
        return None

    user = db.query(User).filter(User.phone == normalized).first()
    if user:
        return user.id

    if normalized.startswith("91") and len(normalized) > 10:
        user = db.query(User).filter(User.phone == normalized[-10:]).first()
        if user:
            return user.id
    return None


def _resolve_language(user: Optional[User], requested: Optional[str]) -> str:
    if requested:
        return _normalize_language(requested)
    if user and user.language:
        return _normalize_language(user.language)
    return "en"


def _upsert_call_log(
    db: Session,
    call_sid: str,
    direction: str,
    phone: str,
    user_id: Optional[int],
    language_code: str,
    status: str,
) -> VoiceCallLog:
    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
    if call:
        call.status = status
        if user_id and not call.user_id:
            call.user_id = user_id
        if phone and not call.phone:
            call.phone = phone
        call.language_code = language_code
        call.updated_at = _now()
        db.commit()
        db.refresh(call)
        return call

    call = VoiceCallLog(
        call_sid=call_sid,
        direction=direction,
        phone=phone,
        user_id=user_id,
        language_code=language_code,
        status=status,
        started_at=_now(),
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    return call


def _append_turn(
    db: Session,
    *,
    call_sid: str,
    user_id: Optional[int],
    role: str,
    transcript: str,
    language_code: str,
    detected_intent: Optional[str] = None,
    action_taken: Optional[dict] = None,
    tool_payload: Optional[dict] = None,
) -> None:
    row = VoiceCallTurnLog(
        call_sid=call_sid,
        user_id=user_id,
        role=role,
        transcript=(transcript or "").strip()[:4000],
        language_code=language_code,
        detected_intent=(detected_intent or "")[:80] if detected_intent else None,
        action_taken=json.dumps(action_taken or {}, ensure_ascii=False) if action_taken else None,
        tool_payload=json.dumps(tool_payload or {}, ensure_ascii=False) if tool_payload else None,
    )
    db.add(row)
    db.commit()


def _voice_system_prompt(lang: str, user: Optional[User]) -> str:
    user_ctx = {
        "name": user.full_name if user else "Unknown",
        "district": user.district if user else "Unknown",
        "state": user.state if user else "Maharashtra",
        "main_crop": user.main_crop if user else "Unknown",
        "farm_size_acres": user.farm_size_acres if user else None,
        "soil_type": user.soil_type if user else None,
        "language": user.language if user else lang,
    }

    feature_endpoints = _feature_catalog()
    endpoint_catalog = "\n".join(
        [
            f"- {k}: {v['method']} {v['path']} ({v['description']})"
            for k, v in sorted(feature_endpoints.items())
        ]
    )

    return (
        "You are Khetwala AI Voice Calling Agent for farmers. "
        "You must use real backend APIs through call_feature_api tool and avoid hallucination.\n"
        f"Reply language MUST be {SUPPORTED_LANGUAGES.get(lang, 'English')} (code: {lang}).\n"
        "Keep response conversational and short for voice calls (max 3 sentences).\n"
        "If request is unsafe/unknown/unavailable, ask one clarifying question or escalate_to_human.\n"
        "If the farmer asks for operator/support person, always call escalate_to_human.\n"
        f"Farmer profile: {json.dumps(user_ctx, ensure_ascii=False)}\n"
        "Available endpoint keys:\n"
        f"{endpoint_catalog}\n"
    )


def _build_gemini_conversation(messages: List[Dict[str, str]]) -> list:
    conversation = []
    for item in messages[-12:]:
        role = "user" if item.get("role") == "user" else "model"
        conversation.append({"role": role, "parts": [{"text": item.get("text", "")} ]})
    if not conversation:
        conversation.append({"role": "user", "parts": [{"text": "start"}]})
    return conversation


async def _call_gemini(system_prompt: str, contents: list) -> dict:
    if not settings.google_api_key:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY missing for voice agent")

    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
        "tool_config": {"function_calling_config": {"mode": "AUTO"}},
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 700,
        },
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            GEMINI_URL,
            json=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": settings.google_api_key,
            },
        )

    if resp.status_code != 200:
        logger.error("Voice Gemini API error", status=resp.status_code, body=resp.text[:500])
        raise HTTPException(status_code=502, detail=f"Gemini returned {resp.status_code}")

    return resp.json()


def _extract_function_calls(candidate: dict) -> list:
    parts = candidate.get("content", {}).get("parts", [])
    calls = []
    for part in parts:
        fc = part.get("functionCall")
        if fc:
            calls.append({"name": fc.get("name"), "args": fc.get("args", {})})
    return calls


def _extract_text(candidate: dict) -> str:
    parts = candidate.get("content", {}).get("parts", [])
    lines = [p.get("text", "") for p in parts if "text" in p]
    return "\n".join(lines).strip()


def _find_endpoint_key_by_path(path: str, method: str = "GET") -> Optional[str]:
    target_path = (path or "").strip()
    target_method = (method or "GET").upper()
    for key, meta in _feature_catalog().items():
        if meta.get("path") == target_path and str(meta.get("method", "")).upper() == target_method:
            return key
    return None


def _text_contains_any(text: str, options: List[str]) -> bool:
    source = (text or "").lower()
    return any(token in source for token in options)


def _local_no_llm_reply(lang: str, text: str) -> str:
    replies = {
        "en": "I can help with weather, mandi prices, schemes, soil health, and credit score. Please say one of these clearly.",
        "hi": "Main mausam, mandi bhav, schemes, mitti health aur credit score mein madad kar sakta hoon. Inmein se koi ek clear boliye.",
        "kn": "ನಾನು ಹವಾಮಾನ, ಮಾರುಕಟ್ಟೆ ಬೆಲೆ, ಯೋಜನೆಗಳು, ಮಣ್ಣಿನ ಆರೋಗ್ಯ ಮತ್ತು ಕ್ರೆಡಿಟ್ ಸ್ಕೋರ್ ಬಗ್ಗೆ ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ಒಂದನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಹೇಳಿ.",
        "mr": "मी हवामान, बाजारभाव, योजना, माती आरोग्य आणि क्रेडिट स्कोअरमध्ये मदत करू शकतो. यातलं एक स्पष्ट सांगा.",
        "gu": "હું હવામાન, બજાર ભાવ, યોજનાઓ, માટી આરોગ્ય અને ક્રેડિટ સ્કોરમાં મદદ કરી શકું છું. કૃપા કરીને એક સ્પષ્ટ કહો.",
    }
    return replies.get(lang, replies["en"])


def _speakable_response_text(lang: str, endpoint_key: Optional[str], payload: Any) -> str:
    if not isinstance(payload, dict):
        return str(payload)[:420]

    if endpoint_key and "/weather/current/" in endpoint_key:
        temp = payload.get("temp")
        desc = payload.get("description")
        district = payload.get("district")
        rain = payload.get("rain_mm")
        templates = {
            "en": f"Current weather in {district} is {desc}. Temperature is {temp} degree and rain is {rain} millimeter.",
            "hi": f"{district} ka mausam {desc} hai. Temperature {temp} degree hai aur barish {rain} millimeter hai.",
            "kn": f"{district}ನಲ್ಲಿ ಈಗ {desc} ಇದೆ. ತಾಪಮಾನ {temp} ಡಿಗ್ರಿ ಮತ್ತು ಮಳೆ {rain} ಮಿಲಿಮೀಟರ್.",
            "mr": f"{district} मध्ये हवामान {desc} आहे. तापमान {temp} अंश आणि पाऊस {rain} मि.मी. आहे.",
            "gu": f"{district}માં હાલ હવામાન {desc} છે. તાપમાન {temp} ડિગ્રી અને વરસાદ {rain} મીલીમીટર છે.",
        }
        return templates.get(lang, templates["en"])[:420]

    if endpoint_key and "/market/prices/live" in endpoint_key:
        templates = {
            "en": "Live mandi prices are available now. Please tell me the crop name for exact rates.",
            "hi": "Live mandi bhav available hain. Exact rate ke liye crop ka naam boliye.",
            "kn": "ಲೈವ್ ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು ಲಭ್ಯವಿವೆ. ನಿಖರ ದರಕ್ಕಾಗಿ ಬೆಳೆ ಹೆಸರನ್ನು ಹೇಳಿ.",
            "mr": "लाईव्ह बाजारभाव उपलब्ध आहेत. अचूक दरासाठी पिकाचं नाव सांगा.",
            "gu": "લાઇવ બજાર ભાવ ઉપલબ્ધ છે. ચોક્કસ દર માટે પાકનું નામ કહો.",
        }
        return templates.get(lang, templates["en"])

    if endpoint_key and "/api/schemes" in endpoint_key:
        schemes = payload.get("schemes") if isinstance(payload.get("schemes"), list) else []
        count = len(schemes)
        templates = {
            "en": f"I found {count} relevant government schemes. I can explain each one, starting with PM Kisan.",
            "hi": f"Maine {count} sarkari schemes dhoondi hain. Main ek ek karke samjha sakta hoon, PM Kisan se shuru karun?",
            "kn": f"ನನಗೆ {count} ಸರ್ಕಾರದ ಯೋಜನೆಗಳು ಸಿಕ್ಕಿವೆ. ಒಂದೊಂದಾಗಿ ವಿವರಿಸುತ್ತೇನೆ, PM Kisan ನಿಂದ ಆರಂಭಿಸಲೇ?",
            "mr": f"मला {count} सरकारी योजना मिळाल्या. मी एकेक करून सांगतो, PM Kisan पासून सुरू करू का?",
            "gu": f"મને {count} સરકારી યોજનાઓ મળી છે. હું એક પછી એક સમજાવી શકું છું, PM Kisan થી શરૂ કરું?",
        }
        return templates.get(lang, templates["en"])

    return json.dumps(payload, ensure_ascii=False)[:420]


async def _run_voice_agent_without_llm(
    *,
    user_query: str,
    user: Optional[User],
    language_code: str,
) -> Dict[str, Any]:
    query = (user_query or "").strip()
    query_lower = query.lower()
    district = (user.district if user and user.district else "nashik").strip().lower()
    uid = user.id if user else None

    endpoint_key = None
    invoke_payload: Dict[str, Any] = {}

    if _text_contains_any(query_lower, ["weather", "mausam", "ಬಿಸಿಲು", "ಹವಾಮಾನ", "मौसम", "हवामान", "વાતાવરણ", "बारिश", "rain"]):
        endpoint_key = _find_endpoint_key_by_path("/api/weather/current/{district}", "GET")
        if endpoint_key:
            invoke_payload = {"endpoint_key": endpoint_key, "path_params": {"district": district}}

    elif _text_contains_any(query_lower, ["mandi", "price", "bhav", "भाव", "ಬೆಲೆ", "भाव", "ભાવ", "market"]):
        endpoint_key = _find_endpoint_key_by_path("/market/prices/live", "GET")
        if endpoint_key:
            invoke_payload = {"endpoint_key": endpoint_key}

    elif _text_contains_any(query_lower, ["scheme", "yojana", "योजना", "ಯೋಜನೆ", "યોજના", "subsidy"]):
        endpoint_key = _find_endpoint_key_by_path("/api/schemes", "GET")
        if endpoint_key:
            invoke_payload = {"endpoint_key": endpoint_key}

    elif _text_contains_any(query_lower, ["soil", "mitti", "ಮಣ್ಣು", "માટી", "मिट्टी"]):
        endpoint_key = _find_endpoint_key_by_path("/api/soil/health/{district}", "GET")
        if endpoint_key:
            invoke_payload = {"endpoint_key": endpoint_key, "path_params": {"district": district}}

    elif uid and _text_contains_any(query_lower, ["credit", "score", "ಸ್ಕೋರ್", "સ્કોર", "स्कोर"]):
        endpoint_key = _find_endpoint_key_by_path("/farmer/credit-score/{user_id}", "GET")
        if endpoint_key:
            invoke_payload = {"endpoint_key": endpoint_key, "path_params": {"user_id": uid}}

    if endpoint_key:
        result = await _invoke_feature_api(invoke_payload)
        if result.get("ok"):
            response = result.get("response")
            reply_text = _speakable_response_text(language_code, endpoint_key, response)
            return {
                "reply_text": reply_text,
                "actions": [{"tool": "local_fallback_api", "args": invoke_payload, "result": {"ok": True}}],
                "escalate_reason": None,
                "feature_used": endpoint_key,
            }

    return {
        "reply_text": _local_no_llm_reply(language_code, query),
        "actions": [{"tool": "local_fallback_help", "args": {"query": query}, "result": {"ok": True}}],
        "escalate_reason": None,
        "feature_used": endpoint_key,
    }


def _render_path(path_template: str, path_params: Dict[str, Any]) -> str:
    rendered = path_template
    for key, value in (path_params or {}).items():
        rendered = rendered.replace("{" + str(key) + "}", str(value))
    return rendered


async def _invoke_feature_api(args: Dict[str, Any]) -> Dict[str, Any]:
    feature_endpoints = _feature_catalog()
    endpoint_key = args.get("endpoint_key")
    if endpoint_key not in feature_endpoints:
        return {
            "ok": False,
            "error": f"Unsupported endpoint_key: {endpoint_key}",
            "supported_keys": sorted(feature_endpoints.keys()),
        }

    meta = feature_endpoints[endpoint_key]
    method = meta["method"].upper()
    path = _render_path(meta["path"], args.get("path_params") or {})
    query_params = args.get("query_params") or {}
    body = args.get("body") or {}

    if "{" in path or "}" in path:
        return {
            "ok": False,
            "error": "Missing required path_params",
            "path": path,
        }

    url = f"{_internal_api_base_url()}{_api_prefix()}{path}"
    timeout = float(settings.voice_agent_feature_timeout_seconds or 12)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method=method,
                url=url,
                params=query_params,
                json=body if method in ("POST", "PUT", "PATCH") else None,
            )

        payload: Any
        if resp.headers.get("content-type", "").lower().startswith("application/json"):
            payload = resp.json()
        else:
            payload = resp.text[:2000]

        return {
            "ok": resp.status_code < 400,
            "status_code": resp.status_code,
            "endpoint_key": endpoint_key,
            "path": path,
            "method": method,
            "response": payload,
        }
    except Exception as exc:
        logger.error("Voice feature API call failed", endpoint_key=endpoint_key, error=str(exc))
        return {
            "ok": False,
            "status_code": 500,
            "endpoint_key": endpoint_key,
            "error": str(exc),
        }


def _update_user_language(db: Session, user_id: int, language_code: str) -> Dict[str, Any]:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {"ok": False, "error": "user not found"}

    lang = _normalize_language(language_code)
    user.language = lang
    db.commit()
    db.refresh(user)
    return {"ok": True, "user_id": user.id, "language": user.language}


def _escalation_message(lang: str) -> str:
    messages = {
        "en": "Connecting you to a human operator now.",
        "hi": "Abhi aapko human operator se jod raha hoon.",
        "kn": "ಈಗ ನಿಮ್ಮನ್ನು ಮಾನವ ಸಹಾಯಕರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ.",
        "mr": "आता तुम्हाला मानव ऑपरेटरशी जोडत आहे.",
        "gu": "હવે તમને માનવ ઓપરેટર સાથે જોડું છું.",
    }
    return messages.get(lang, messages["en"])


async def _run_voice_agent_turn(
    *,
    user_query: str,
    call_sid: str,
    user: Optional[User],
    language_code: str,
    db: Session,
) -> Dict[str, Any]:
    if not settings.google_api_key:
        return await _run_voice_agent_without_llm(
            user_query=user_query,
            user=user,
            language_code=language_code,
        )

    system_prompt = _voice_system_prompt(language_code, user)
    contents = _build_gemini_conversation([{"role": "user", "text": user_query}])

    actions: List[Dict[str, Any]] = []
    final_reply = ""
    escalate_reason: Optional[str] = None
    last_feature_key: Optional[str] = None

    for _ in range(MAX_AGENT_TURNS):
        gemini_resp = await _call_gemini(system_prompt, contents)
        candidates = gemini_resp.get("candidates", [])
        if not candidates:
            break

        candidate = candidates[0]
        fn_calls = _extract_function_calls(candidate)

        if not fn_calls:
            final_reply = _extract_text(candidate)
            break

        tool_results = []
        for call in fn_calls:
            name = call.get("name")
            args = call.get("args") or {}

            if name == "call_feature_api":
                if user and "user_id" in json.dumps(args):
                    pass
                result = await _invoke_feature_api(args)
                last_feature_key = args.get("endpoint_key") or last_feature_key
            elif name == "update_user_language":
                uid = args.get("user_id") or (user.id if user else None)
                if uid is None:
                    result = {"ok": False, "error": "user_id missing"}
                else:
                    result = _update_user_language(db, int(uid), str(args.get("language_code", language_code)))
            elif name == "escalate_to_human":
                escalate_reason = str(args.get("reason") or "Requested by AI")
                result = {"ok": True, "escalated": True, "reason": escalate_reason}
            else:
                result = {"ok": False, "error": f"Unknown tool: {name}"}

            actions.append({"tool": name, "args": args, "result": result})
            tool_results.append({"name": name, "response": result})

        contents.append(candidate.get("content", {}))
        contents.append(
            {
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": tr["name"], "response": tr["response"]}}
                    for tr in tool_results
                ],
            }
        )

        if escalate_reason:
            break

    if not final_reply:
        fallback = {
            "en": "I could not fetch complete data right now. Please try once more.",
            "hi": "Abhi poora data nahi mil pa raha hai. Kripya ek baar phir puchiye.",
            "kn": "ಈಗ ಸಂಪೂರ್ಣ ಮಾಹಿತಿ ದೊರಕಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕೇಳಿ.",
            "mr": "आता पूर्ण माहिती मिळाली नाही. कृपया पुन्हा विचारा.",
            "gu": "હમણાં સંપૂર્ણ માહિતી મળી નથી. કૃપા કરીને ફરી પૂછો.",
        }
        final_reply = fallback.get(language_code, fallback["en"])
        if not escalate_reason and settings.voice_agent_human_operator_number:
            escalate_reason = "Unable to resolve request automatically"

    return {
        "reply_text": final_reply,
        "actions": actions,
        "escalate_reason": escalate_reason,
        "feature_used": last_feature_key,
    }


def _mark_escalation(db: Session, call_sid: str, reason: str) -> None:
    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
    if not call:
        return
    call.escalated_to_human = True
    call.escalation_reason = reason[:1000]
    call.status = "escalated"
    call.updated_at = _now()
    db.commit()


def _complete_call(db: Session, call_sid: str, status: str, duration: Optional[int] = None) -> None:
    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
    if not call:
        return

    call.status = status
    call.ended_at = _now()
    if duration is not None:
        call.duration_seconds = duration
    call.updated_at = _now()
    db.commit()


@router.get("/feature-catalog")
def list_voice_feature_catalog() -> Dict[str, Any]:
    feature_endpoints = _feature_catalog()
    return {
        "total_features": len(feature_endpoints),
        "features": feature_endpoints,
        "languages": SUPPORTED_LANGUAGES,
    }


@router.post("/invoke-feature")
async def invoke_feature_direct(payload: VoiceFeatureInvokeRequest) -> Dict[str, Any]:
    return await _invoke_feature_api(payload.model_dump())


@router.post("/simulate", response_model=VoiceSimulateResponse)
async def simulate_voice_turn(payload: VoiceSimulateRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    language_code = _normalize_language(payload.language_code)
    user = db.query(User).filter(User.id == payload.user_id).first() if payload.user_id else None

    _upsert_call_log(
        db=db,
        call_sid=payload.call_sid,
        direction="simulated",
        phone=(user.phone if user else "simulated"),
        user_id=(user.id if user else None),
        language_code=language_code,
        status="active",
    )

    _append_turn(
        db,
        call_sid=payload.call_sid,
        user_id=(user.id if user else None),
        role="user",
        transcript=payload.text,
        language_code=language_code,
    )

    result = await _run_voice_agent_turn(
        user_query=payload.text,
        call_sid=payload.call_sid,
        user=user,
        language_code=language_code,
        db=db,
    )

    _append_turn(
        db,
        call_sid=payload.call_sid,
        user_id=(user.id if user else None),
        role="assistant",
        transcript=result["reply_text"],
        language_code=language_code,
        action_taken={
            "feature_used": result.get("feature_used"),
            "escalate": bool(result.get("escalate_reason")),
        },
        tool_payload={"actions": result.get("actions", [])},
    )

    if result.get("escalate_reason"):
        _mark_escalation(db, payload.call_sid, result["escalate_reason"])

    return {
        "reply_text": result["reply_text"],
        "language_code": language_code,
        "escalated_to_human": bool(result.get("escalate_reason")),
        "action_trace": result.get("actions", []),
    }


@router.post("/call/outbound")
async def start_outbound_call(payload: OutboundCallRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    if not settings.twilio_account_sid or not settings.twilio_auth_token or not settings.twilio_phone_number:
        raise HTTPException(status_code=503, detail="Twilio credentials not configured")

    user = db.query(User).filter(User.id == payload.user_id).first() if payload.user_id else None
    language_code = _resolve_language(user, payload.language_code)

    provisional_sid = f"out-{uuid.uuid4().hex[:18]}"
    _upsert_call_log(
        db=db,
        call_sid=provisional_sid,
        direction="outbound",
        phone=payload.to_phone,
        user_id=(user.id if user else None),
        language_code=language_code,
        status="queued",
    )

    incoming_url = f"{_public_base_url()}{_api_prefix()}/voice-agent/webhook/incoming"
    callback_url = f"{_public_base_url()}{_api_prefix()}/voice-agent/webhook/status"

    params = {
        "To": payload.to_phone,
        "From": settings.twilio_phone_number,
        "Url": f"{incoming_url}?lang={language_code}",
        "Method": "POST",
        "StatusCallback": callback_url,
        "StatusCallbackMethod": "POST",
        "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
    }

    twilio_url = (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{settings.twilio_account_sid}/Calls.json"
    )

    async with httpx.AsyncClient(timeout=20.0, auth=(settings.twilio_account_sid, settings.twilio_auth_token)) as client:
        resp = await client.post(twilio_url, data=params)

    if resp.status_code >= 400:
        logger.error("Twilio outbound call failed", status=resp.status_code, body=resp.text[:300])
        raise HTTPException(status_code=502, detail=f"Twilio outbound call failed: {resp.status_code}")

    twilio_data = resp.json()
    call_sid = twilio_data.get("sid", provisional_sid)

    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == provisional_sid).first()
    if call:
        call.call_sid = call_sid
        call.status = twilio_data.get("status", "initiated")
        call.updated_at = _now()
        db.commit()

    return {
        "ok": True,
        "call_sid": call_sid,
        "status": twilio_data.get("status"),
        "to": payload.to_phone,
        "language_code": language_code,
    }


@router.post("/webhook/incoming")
async def twilio_incoming_webhook(
    request: Request,
    CallSid: str = Form(default=""),
    From: str = Form(default=""),
    Direction: str = Form(default="inbound"),
    lang: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    form_payload = dict(await request.form())
    if not _validate_twilio_signature(request, form_payload):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    call_sid = (CallSid or f"in-{uuid.uuid4().hex[:18]}").strip()
    user_id = _extract_user_id(From, db)
    user = db.query(User).filter(User.id == user_id).first() if user_id else None
    language_code = _resolve_language(user, lang)

    _upsert_call_log(
        db=db,
        call_sid=call_sid,
        direction=(Direction or "inbound"),
        phone=From or "unknown",
        user_id=user_id,
        language_code=language_code,
        status="active",
    )

    greeting = _lang_prompt_text(language_code, user.full_name if user else None)
    twiml = _build_twiml_gather(greeting, language_code, call_sid)

    return Response(content=twiml, media_type="application/xml")


@router.post("/webhook/process")
async def twilio_process_speech(
    request: Request,
    call_sid: str = Query(..., min_length=3),
    retry: int = Query(default=0, ge=0, le=5),
    SpeechResult: str = Form(default=""),
    UnstableSpeechResult: Optional[str] = Form(default=None),
    Digits: Optional[str] = Form(default=None),
    Confidence: Optional[str] = Form(default=None),
    From: str = Form(default=""),
    db: Session = Depends(get_db),
):
    form_payload = dict(await request.form())
    if not _validate_twilio_signature(request, form_payload):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    user = db.query(User).filter(User.id == call.user_id).first() if call.user_id else None
    lang = _resolve_language(user, call.language_code)
    spoken_text = (SpeechResult or "").strip()

    logger.info(
        "Voice STT payload received",
        call_sid=call_sid,
        retry=retry,
        speech_present=bool(spoken_text),
        unstable_present=bool((UnstableSpeechResult or "").strip()),
        digits=Digits,
        confidence=Confidence,
    )

    if Digits and not spoken_text:
        spoken_text = "operator" if Digits == "0" else Digits

    if not spoken_text:
        retry_text = {
            "en": "I could not hear you. Please say your question again.",
            "hi": "Mujhe awaaz clear nahi mili. Kripya apna sawal phir boliye.",
            "kn": "ನಿಮ್ಮ ಧ್ವನಿ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಮತ್ತೆ ಹೇಳಿ.",
            "mr": "तुमचा आवाज स्पष्ट आला नाही. कृपया प्रश्न पुन्हा सांगा.",
            "gu": "તમારો અવાજ સ્પષ્ટ આવ્યો નહીં. કૃપા કરીને તમારો પ્રશ્ન ફરી કહો.",
        }

        max_retries = int(settings.voice_agent_max_silence_retries or 2)
        if retry >= max_retries:
            fail_text = {
                "en": "I still could not hear you. Please call again, or press zero for operator next time.",
                "hi": "Abhi bhi awaaz clear nahi mili. Kripya dobara call kijiye, ya operator ke liye zero dabaiye.",
                "kn": "ಇನ್ನೂ ನಿಮ್ಮ ಧ್ವನಿ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕರೆ ಮಾಡಿ ಅಥವಾ ಆಪರೇಟರ್‌ಗಾಗಿ ಶೂನ್ಯ ಒತ್ತಿರಿ.",
                "mr": "आवाज अजून स्पष्ट आला नाही. कृपया पुन्हा कॉल करा, किंवा ऑपरेटरसाठी शून्य दाबा.",
                "gu": "હજુ અવાજ સ્પષ્ટ મળ્યો નથી. કૃપા કરીને ફરી કોલ કરો, અથવા ઓપરેટર માટે શૂન્ય દબાવો.",
            }
            if settings.voice_agent_human_operator_number:
                _mark_escalation(db, call_sid, "No speech captured after retries")
                return Response(
                    content=_build_twiml_gather(
                        fail_text.get(lang, fail_text["en"]),
                        lang,
                        call_sid,
                        retry_count=retry,
                        add_human_dial=True,
                    ),
                    media_type="application/xml",
                )

            _complete_call(db, call_sid, "no-input")
            return Response(
                content=_build_twiml_gather(
                    fail_text.get(lang, fail_text["en"]),
                    lang,
                    call_sid,
                    retry_count=retry,
                    should_hangup=True,
                ),
                media_type="application/xml",
            )

        return Response(
            content=_build_twiml_gather(
                retry_text.get(lang, retry_text["en"]),
                lang,
                call_sid,
                retry_count=retry + 1,
            ),
            media_type="application/xml",
        )

    _append_turn(
        db,
        call_sid=call_sid,
        user_id=call.user_id,
        role="user",
        transcript=spoken_text,
        language_code=lang,
        action_taken={"confidence": Confidence},
    )

    if _is_end_command(spoken_text, lang):
        bye_text = {
            "en": "Thank you. Goodbye.",
            "hi": "Dhanyavaad. Namaste.",
            "kn": "ಧನ್ಯವಾದಗಳು. ವಿದಾಯ.",
            "mr": "धन्यवाद. नमस्कार.",
            "gu": "આભાર. અલવિદા.",
        }
        _complete_call(db, call_sid, "completed")
        return Response(
            content=_build_twiml_gather(bye_text.get(lang, bye_text["en"]), lang, call_sid, should_hangup=True),
            media_type="application/xml",
        )

    result = await _run_voice_agent_turn(
        user_query=spoken_text,
        call_sid=call_sid,
        user=user,
        language_code=lang,
        db=db,
    )

    call.feature_used = result.get("feature_used")
    call.summary = (result.get("reply_text") or "")[:1500]
    call.updated_at = _now()
    db.commit()

    _append_turn(
        db,
        call_sid=call_sid,
        user_id=call.user_id,
        role="assistant",
        transcript=result.get("reply_text") or "",
        language_code=lang,
        detected_intent="voice_query",
        action_taken={
            "feature_used": result.get("feature_used"),
            "escalate": bool(result.get("escalate_reason")),
        },
        tool_payload={"actions": result.get("actions", [])},
    )

    if result.get("escalate_reason"):
        _mark_escalation(db, call_sid, str(result["escalate_reason"]))
        message = _escalation_message(lang)
        return Response(
            content=_build_twiml_gather(message, lang, call_sid, add_human_dial=True),
            media_type="application/xml",
        )

    return Response(
        content=_build_twiml_gather(
            result.get("reply_text") or "",
            lang,
            call_sid,
            retry_count=0,
        ),
        media_type="application/xml",
    )


@router.post("/webhook/status")
async def twilio_status_webhook(
    request: Request,
    CallSid: str = Form(default=""),
    CallStatus: str = Form(default=""),
    CallDuration: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    form_payload = dict(await request.form())
    if not _validate_twilio_signature(request, form_payload):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    call_sid = (CallSid or "").strip()
    if not call_sid:
        return {"ok": False, "reason": "missing CallSid"}

    duration = None
    if CallDuration and str(CallDuration).isdigit():
        duration = int(CallDuration)

    status = (CallStatus or "").strip().lower() or "unknown"
    if status in {"completed", "busy", "failed", "no-answer", "canceled"}:
        _complete_call(db, call_sid, status, duration)
    else:
        call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
        if call:
            call.status = status
            call.updated_at = _now()
            db.commit()

    return {"ok": True, "call_sid": call_sid, "status": status, "duration": duration}


@router.get("/dashboard/calls")
def list_voice_calls(
    limit: int = Query(default=50, ge=1, le=500),
    status: Optional[str] = Query(default=None),
    user_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = db.query(VoiceCallLog)
    if status:
        query = query.filter(VoiceCallLog.status == status)
    if user_id is not None:
        query = query.filter(VoiceCallLog.user_id == user_id)

    rows = query.order_by(VoiceCallLog.started_at.desc()).limit(limit).all()
    return {
        "count": len(rows),
        "calls": [
            {
                "call_sid": r.call_sid,
                "direction": r.direction,
                "user_id": r.user_id,
                "phone": r.phone,
                "language_code": r.language_code,
                "status": r.status,
                "feature_used": r.feature_used,
                "escalated_to_human": r.escalated_to_human,
                "escalation_reason": r.escalation_reason,
                "summary": r.summary,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "ended_at": r.ended_at.isoformat() if r.ended_at else None,
                "duration_seconds": r.duration_seconds,
            }
            for r in rows
        ],
    }


@router.get("/dashboard/overview")
def get_voice_dashboard_overview(db: Session = Depends(get_db)) -> Dict[str, Any]:
    total_calls = db.query(VoiceCallLog).count()
    active_calls = db.query(VoiceCallLog).filter(VoiceCallLog.status == "active").count()
    escalated_calls = (
        db.query(VoiceCallLog)
        .filter(VoiceCallLog.escalated_to_human.is_(True))
        .count()
    )
    total_turns = db.query(VoiceCallTurnLog).count()
    user_queries = db.query(VoiceCallTurnLog).filter(VoiceCallTurnLog.role == "user").count()
    assistant_responses = (
        db.query(VoiceCallTurnLog)
        .filter(VoiceCallTurnLog.role == "assistant")
        .count()
    )

    return {
        "total_calls": total_calls,
        "active_calls": active_calls,
        "escalated_calls": escalated_calls,
        "total_turns": total_turns,
        "user_queries": user_queries,
        "assistant_responses": assistant_responses,
    }


@router.get("/dashboard/calls/{call_sid}")
def get_voice_call_detail(call_sid: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    call = db.query(VoiceCallLog).filter(VoiceCallLog.call_sid == call_sid).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    turns = (
        db.query(VoiceCallTurnLog)
        .filter(VoiceCallTurnLog.call_sid == call_sid)
        .order_by(VoiceCallTurnLog.created_at.asc())
        .all()
    )

    return {
        "call": {
            "call_sid": call.call_sid,
            "direction": call.direction,
            "user_id": call.user_id,
            "phone": call.phone,
            "language_code": call.language_code,
            "status": call.status,
            "feature_used": call.feature_used,
            "escalated_to_human": call.escalated_to_human,
            "escalation_reason": call.escalation_reason,
            "summary": call.summary,
            "started_at": call.started_at.isoformat() if call.started_at else None,
            "ended_at": call.ended_at.isoformat() if call.ended_at else None,
            "duration_seconds": call.duration_seconds,
        },
        "turns": [
            {
                "role": t.role,
                "transcript": t.transcript,
                "language_code": t.language_code,
                "detected_intent": t.detected_intent,
                "action_taken": json.loads(t.action_taken) if t.action_taken else None,
                "tool_payload": json.loads(t.tool_payload) if t.tool_payload else None,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in turns
        ],
    }
