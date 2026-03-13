"""
Khetwala-मित्र ARIA 2.0 Agent Router
═══════════════════════════════════════════════════════════════════════════════

Agentic endpoint that uses Gemini function-calling to execute tasks
on behalf of the farmer.  The agent loop: Think → Plan → Act → Confirm.

Tools available to the agent:
  1. get_weather        – current & forecast weather for a district
  2. get_mandi_prices   – latest mandi price features for a crop+district
  3. get_user_profile   – read the farmer's profile from DB
  4. get_memories       – recall ARIA's stored memories for this farmer
  5. store_memory       – persist a new fact / preference / emotion
  6. get_schemes        – government schemes relevant to the farmer
  7. run_prediction     – invoke harvest / spoilage / price-trend models
  8. open_screen        – tell the frontend to navigate to a screen
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from core.logging import get_logger
from db.models import (
    AriaConversation,
    AriaMemory,
    MandiPrice,
    User,
    WeatherRecord,
)
from db.session import get_db
from services.mandi_service import fetch_mandi_features
from services.weather_service import fetch_current_weather

logger = get_logger("khetwala.routers.aria_agent")

router = APIRouter(prefix="/aria", tags=["aria-agent"])

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

MAX_AGENT_TURNS = 6  # safety: max tool-call round-trips


# ══════════════════════════════════════════════════════════════════════════════
# Schemas
# ══════════════════════════════════════════════════════════════════════════════


class AgentMessage(BaseModel):
    role: str = Field(..., examples=["user", "assistant", "tool"])
    text: str = Field(default="")


class AgentContext(BaseModel):
    crop: str = Field(default="Unknown")
    district: str = Field(default="Unknown")
    state: str = Field(default="Maharashtra")
    risk_category: str = Field(default="Unknown")
    last_recommendation: str = Field(default="Unknown")
    farm_size_acres: Optional[float] = None
    soil_type: Optional[str] = None


class AgentRequest(BaseModel):
    messages: List[AgentMessage] = Field(default_factory=list)
    context: AgentContext = Field(default_factory=AgentContext)
    language_code: str = Field(default="hi")
    user_id: Optional[int] = None
    session_id: Optional[str] = None


class ToolAction(BaseModel):
    tool: str
    args: Dict[str, Any] = {}
    result: Optional[Any] = None


class AgentResponse(BaseModel):
    reply: str
    emotion: Optional[str] = None
    tool_actions: List[ToolAction] = []
    navigate_to: Optional[str] = None
    memories_updated: int = 0
    source: str = "gemini-agent"


# ══════════════════════════════════════════════════════════════════════════════
# Gemini Tool Declarations (function-calling schema)
# ══════════════════════════════════════════════════════════════════════════════

TOOL_DECLARATIONS = [
    {
        "name": "get_weather",
        "description": (
            "Get current weather and 3-day forecast for the farmer's district. "
            "Returns temperature, humidity, rainfall, wind."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "district": {
                    "type": "string",
                    "description": "District name, e.g. 'Nashik'",
                },
            },
            "required": ["district"],
        },
    },
    {
        "name": "get_mandi_prices",
        "description": (
            "Get latest mandi price data for a specific crop in a district. "
            "Returns modal price, price trend, nearest markets."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "crop": {"type": "string", "description": "Crop name, e.g. 'Onion'"},
                "district": {"type": "string", "description": "District name"},
            },
            "required": ["crop", "district"],
        },
    },
    {
        "name": "get_user_profile",
        "description": "Read the farmer's profile: name, district, crop, farm size, soil type, total harvests.",
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer", "description": "User ID"},
            },
            "required": ["user_id"],
        },
    },
    {
        "name": "get_memories",
        "description": (
            "Recall stored memories / facts about this farmer. "
            "Returns previously learned preferences, milestones, emotional history."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer", "description": "User ID"},
                "memory_type": {
                    "type": "string",
                    "description": "Filter: 'fact', 'preference', 'emotion', 'milestone', or omit for all",
                },
            },
            "required": ["user_id"],
        },
    },
    {
        "name": "store_memory",
        "description": (
            "Store a new fact, preference, emotion signal, or milestone about the farmer. "
            "Use this when the farmer shares personal info, preferences, or shows emotion."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer", "description": "User ID"},
                "memory_type": {
                    "type": "string",
                    "enum": ["fact", "preference", "emotion", "milestone"],
                },
                "memory_key": {
                    "type": "string",
                    "description": "Short key, e.g. 'preferred_mandi', 'last_mood'",
                },
                "memory_value": {
                    "type": "string",
                    "description": "The value to store",
                },
            },
            "required": ["user_id", "memory_type", "memory_key", "memory_value"],
        },
    },
    {
        "name": "get_schemes",
        "description": "Get government schemes relevant to the farmer based on crop, district, farm size.",
        "parameters": {
            "type": "object",
            "properties": {
                "crop": {"type": "string"},
                "district": {"type": "string"},
                "farm_size_acres": {"type": "number"},
            },
            "required": ["crop"],
        },
    },
    {
        "name": "run_prediction",
        "description": (
            "Run a ML prediction model. type can be 'harvest', 'spoilage', or 'price_trend'. "
            "Returns prediction results with confidence."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prediction_type": {
                    "type": "string",
                    "enum": ["harvest", "spoilage", "price_trend"],
                },
                "crop": {"type": "string"},
                "district": {"type": "string"},
            },
            "required": ["prediction_type", "crop", "district"],
        },
    },
    {
        "name": "open_screen",
        "description": (
            "Navigate the farmer to a specific screen in the app. "
            "Use when the farmer wants to see a specific section."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "screen_name": {
                    "type": "string",
                    "enum": [
                        "Dashboard", "Market", "Disease", "Schemes",
                        "Spoilage", "Recommendation", "Profile", "Alerts",
                    ],
                },
            },
            "required": ["screen_name"],
        },
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# Tool Execution
# ══════════════════════════════════════════════════════════════════════════════


def _exec_get_weather(args: dict, db: Session, **_) -> dict:
    district = args.get("district", "Nashik")
    try:
        return fetch_current_weather(district)
    except Exception as e:
        return {"error": str(e), "district": district}


def _exec_get_mandi_prices(args: dict, db: Session, ctx: AgentContext, **_) -> dict:
    crop = args.get("crop", ctx.crop)
    district = args.get("district", ctx.district)
    state = ctx.state or "Maharashtra"
    try:
        return fetch_mandi_features(crop, state, district)
    except Exception as e:
        return {"error": str(e), "crop": crop, "district": district}


def _exec_get_user_profile(args: dict, db: Session, **_) -> dict:
    uid = args.get("user_id")
    if not uid:
        return {"error": "user_id required"}
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        return {"error": "User not found"}
    return {
        "name": user.full_name,
        "phone": user.phone,
        "district": user.district,
        "state": user.state,
        "main_crop": user.main_crop,
        "farm_size_acres": user.farm_size_acres,
        "soil_type": user.soil_type,
        "language": user.language,
        "total_harvests": user.total_harvests,
        "savings_estimate": user.savings_estimate,
    }


def _exec_get_memories(args: dict, db: Session, **_) -> list:
    uid = args.get("user_id")
    if not uid:
        return []
    q = db.query(AriaMemory).filter(AriaMemory.user_id == uid)
    mt = args.get("memory_type")
    if mt:
        q = q.filter(AriaMemory.memory_type == mt)
    rows = q.order_by(AriaMemory.last_referenced.desc()).limit(20).all()
    return [
        {
            "type": m.memory_type,
            "key": m.memory_key,
            "value": m.memory_value,
            "confidence": m.confidence,
        }
        for m in rows
    ]


def _exec_store_memory(args: dict, db: Session, **_) -> dict:
    uid = args.get("user_id")
    if not uid:
        return {"stored": False, "reason": "user_id missing"}
    existing = (
        db.query(AriaMemory)
        .filter(
            AriaMemory.user_id == uid,
            AriaMemory.memory_type == args["memory_type"],
            AriaMemory.memory_key == args["memory_key"],
        )
        .first()
    )
    if existing:
        existing.memory_value = args["memory_value"]
        existing.last_referenced = datetime.now(timezone.utc)
        db.commit()
        return {"stored": True, "action": "updated"}

    mem = AriaMemory(
        user_id=uid,
        memory_type=args["memory_type"],
        memory_key=args["memory_key"],
        memory_value=args["memory_value"],
    )
    db.add(mem)
    db.commit()
    return {"stored": True, "action": "created"}


def _exec_get_schemes(args: dict, **_) -> dict:
    # Returns a curated list — in production this queries a Schemes table
    crop = args.get("crop", "").lower()
    schemes = [
        {"name": "PM-KISAN", "benefit": "₹6,000/year", "eligible": True},
        {"name": "Pradhan Mantri Fasal Bima Yojana", "benefit": "Crop insurance", "eligible": True},
    ]
    if crop in ("onion", "tomato", "potato"):
        schemes.append(
            {"name": "Operation Greens (TOP)", "benefit": "50% subsidy on transport/storage", "eligible": True}
        )
    return {"schemes": schemes, "count": len(schemes)}


def _exec_run_prediction(args: dict, **_) -> dict:
    ptype = args.get("prediction_type", "harvest")
    crop = args.get("crop", "Onion")
    district = args.get("district", "Nashik")
    # Dispatch to local ML models — simplified here
    if ptype == "harvest":
        return {
            "prediction": "harvest_in_7_to_12_days",
            "confidence": 0.78,
            "action": "Prepare for harvest in the next week",
        }
    elif ptype == "spoilage":
        return {
            "risk_level": "medium",
            "risk_pct": 34,
            "confidence": 0.72,
            "action": "Move to cold storage within 2 days",
        }
    elif ptype == "price_trend":
        return {
            "trend": "rising",
            "forecast_7d": "+8%",
            "confidence": 0.65,
            "action": "Hold for 5 more days for better price",
        }
    return {"error": f"Unknown prediction_type: {ptype}"}


def _exec_open_screen(args: dict, **_) -> dict:
    return {"navigate_to": args.get("screen_name", "Dashboard")}


TOOL_EXECUTORS = {
    "get_weather": _exec_get_weather,
    "get_mandi_prices": _exec_get_mandi_prices,
    "get_user_profile": _exec_get_user_profile,
    "get_memories": _exec_get_memories,
    "store_memory": _exec_store_memory,
    "get_schemes": _exec_get_schemes,
    "run_prediction": _exec_run_prediction,
    "open_screen": _exec_open_screen,
}


# ══════════════════════════════════════════════════════════════════════════════
# System Prompt
# ══════════════════════════════════════════════════════════════════════════════

LANGUAGE_LABELS = {
    "hi": "Hindi",
    "en": "English",
    "mr": "Marathi",
    "kn": "Kannada",
    "gu": "Gujarati",
}


def _build_agent_system_prompt(
    ctx: AgentContext,
    lang: str,
    memories: list | None = None,
) -> str:
    preferred = LANGUAGE_LABELS.get(lang, "English")
    mem_block = ""
    if memories:
        mem_lines = [f"- {m['key']}: {m['value']}" for m in memories[:15]]
        mem_block = "\nThings I remember about this farmer:\n" + "\n".join(mem_lines) + "\n"

    return f"""Tu ARIA hai — Indian kisan ki sabse bharosemand AI saathi.
Tu sirf ek chatbot nahi, tu farmer ki digital didi/bhai hai.

═══ PERSONALITY ═══
• Warm, caring, confident — gaon ki samajhdar behen jaisi
• Farmer ka naam yaad rakh, uski problem seriously le
• Kabhi judge mat kar, hamesha support kar
• Har jawab mein ek clear action de: "Aaj hi becho" / "Kal tak ruko" / "Doctor ko dikhao"
• Agar farmer stress mein hai → pehle emotionally support kar, phir practical advice de

═══ RULES ═══
1. Hamesha farmer ki bhasha mein reply kar — {preferred}
2. Simple gaon ke words use kar, technical jargon BILKUL nahi
3. Maximum 4 sentences — short, sweet, actionable
4. SIRF farming, mandi, weather, schemes, storage ke topics pe baat kar
5. Non-farming topic → pyar se redirect kar: "Yeh toh mujhse nahi hoga, par teri fasal ki baat karte hain!"
6. Agar farmer ne emotion share kiya → use store_memory se save kar
7. Agar farmer ne preference batai → store_memory se save kar
8. Pehle get_memories call kar agar user_id available ho — farmer ki history yaad rakh
9. Weather/mandi info chahiye → tool call kar, ASSUME mat kar
10. Agar confident nahi hai → honestly bol: "Iska exact data nahi hai mere paas, par..."

═══ EMOTION SENSING ═══
Farmer ke message mein agar dikhe:
• Tension/worry → "Tension mat le bhai, mil ke solution nikalte hain"
• Happiness → "Wah! Badhai ho! Maza aa gaya sunke"
• Frustration → "Samajh sakti hoon, mushkil hai. Par tera saath hoon"
• Despair → "Himmat rakh. Chal, dekhte hain kya kar sakte hain"

═══ FARMER CONTEXT ═══
Crop: {ctx.crop}, District: {ctx.district}, State: {ctx.state}
Spoilage Risk: {ctx.risk_category}
Farm Size: {ctx.farm_size_acres or 'Unknown'} acres
Soil Type: {ctx.soil_type or 'Unknown'}
Last Recommendation: {ctx.last_recommendation}
{mem_block}
═══ RESPONSE LANGUAGE ═══
{preferred} (with local dialect flavor if applicable)

═══ TOOL USE ═══
You have access to tools. Use them to get REAL data instead of guessing.
When the farmer asks "meri fasal ka kya haal hai?", call get_weather + get_mandi_prices.
When the farmer asks about schemes, call get_schemes.
Always call get_memories at conversation start if user_id is available.
Use store_memory proactively to remember important things the farmer tells you.
"""


# ══════════════════════════════════════════════════════════════════════════════
# Gemini API call with function-calling
# ══════════════════════════════════════════════════════════════════════════════


def _build_gemini_contents(
    system_prompt: str,
    messages: List[AgentMessage],
    tool_results: list | None = None,
) -> list:
    """Build Gemini contents array from conversation history."""
    contents = []

    # System instruction via first user turn
    conversation_parts = []

    for msg in messages[-12:]:
        role = "user" if msg.role == "user" else "model"
        conversation_parts.append({"role": role, "parts": [{"text": msg.text}]})

    if not conversation_parts:
        conversation_parts.append({"role": "user", "parts": [{"text": "(start)"}]})

    return conversation_parts


async def _call_gemini(
    system_prompt: str,
    contents: list,
    tool_results: list | None = None,
) -> dict:
    """Call Gemini with function declarations and return the raw response."""
    api_key = settings.google_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="ARIA agent unavailable — API key missing")

    body: Dict[str, Any] = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
        "tool_config": {"function_calling_config": {"mode": "AUTO"}},
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 800,
        },
    }

    if tool_results:
        # Append tool results as a user turn
        tool_parts = []
        for tr in tool_results:
            tool_parts.append({
                "functionResponse": {
                    "name": tr["name"],
                    "response": tr["response"],
                }
            })
        contents.append({"role": "user", "parts": tool_parts})

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            GEMINI_URL,
            json=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )

    if resp.status_code != 200:
        logger.error("Gemini agent error", status=resp.status_code, body=resp.text[:500])
        raise HTTPException(status_code=502, detail=f"Gemini returned {resp.status_code}")

    return resp.json()


def _extract_function_calls(candidate: dict) -> list:
    """Extract function call parts from a Gemini candidate."""
    parts = candidate.get("content", {}).get("parts", [])
    calls = []
    for part in parts:
        fc = part.get("functionCall")
        if fc:
            calls.append({
                "name": fc.get("name", ""),
                "args": fc.get("args", {}),
            })
    return calls


def _extract_text(candidate: dict) -> str:
    """Extract text reply from a Gemini candidate."""
    parts = candidate.get("content", {}).get("parts", [])
    texts = []
    for part in parts:
        if "text" in part:
            texts.append(part["text"])
    return "\n".join(texts).strip()


def _detect_emotion(text: str) -> Optional[str]:
    """Simple keyword-based emotion detection from user message."""
    lower = text.lower()
    worry_words = [
        "tension", "chinta", "darr", "kharab", "barbad", "nuksan",
        "problem", "worried", "scared", "loss", "khatam", "tabah",
        "pareshan", "mushkil", "dikkat", "dukhi", "rona", "mar",
        "fikar", "चिंता", "परेशान", "नुकसान", "बर्बाद",
    ]
    happy_words = [
        "khushi", "accha", "badhai", "maza", "profit", "faida",
        "happy", "great", "best", "wonderful", "dhanyawad", "shukriya",
        "खुशी", "अच्छा", "बधाई", "धन्यवाद",
    ]
    frustration_words = [
        "kuch nahi", "thak gaya", "fed up", "koi fayda nahi",
        "frustrated", "pagal", "bakwas", "bekar",
        "थक", "बकवास", "बेकार",
    ]

    for w in worry_words:
        if w in lower:
            return "worried"
    for w in happy_words:
        if w in lower:
            return "happy"
    for w in frustration_words:
        if w in lower:
            return "frustrated"
    return None


# ══════════════════════════════════════════════════════════════════════════════
# Agent Endpoint
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/agent", response_model=AgentResponse)
async def aria_agent(
    payload: AgentRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    ARIA 2.0 Agent — conversational AI with function-calling.

    Flow:
      1. Build system prompt with farmer context + memories
      2. Send to Gemini with tool declarations
      3. If Gemini returns function_calls → execute tools → feed results back
      4. Repeat until Gemini returns a text reply (max 6 turns)
      5. Detect emotion in user's last message
      6. Return reply + tool actions + emotion + navigation intent
    """
    lang = (payload.language_code or "hi").strip().lower()
    if lang not in ("hi", "en", "mr", "kn", "gu"):
        lang = "en"

    ctx = payload.context
    user_id = payload.user_id
    session_id = payload.session_id or str(uuid.uuid4())

    # ── Pre-fetch memories if user is known ───────────────────────────────
    memories = []
    if user_id:
        rows = (
            db.query(AriaMemory)
            .filter(AriaMemory.user_id == user_id)
            .order_by(AriaMemory.last_referenced.desc())
            .limit(15)
            .all()
        )
        memories = [
            {"key": m.memory_key, "value": m.memory_value, "type": m.memory_type}
            for m in rows
        ]

    system_prompt = _build_agent_system_prompt(ctx, lang, memories)

    # ── Build initial Gemini contents ─────────────────────────────────────
    contents = _build_gemini_contents(system_prompt, payload.messages)

    # ── Detect emotion in latest user message ─────────────────────────────
    user_msgs = [m for m in payload.messages if m.role == "user"]
    detected_emotion = None
    if user_msgs:
        detected_emotion = _detect_emotion(user_msgs[-1].text)

    # ── Agent loop ────────────────────────────────────────────────────────
    tool_actions: List[ToolAction] = []
    navigate_to = None
    memories_updated = 0
    final_reply = ""

    for turn in range(MAX_AGENT_TURNS):
        gemini_resp = await _call_gemini(system_prompt, contents)

        candidates = gemini_resp.get("candidates", [])
        if not candidates:
            logger.warning("Gemini returned no candidates", resp=gemini_resp)
            break

        candidate = candidates[0]
        fn_calls = _extract_function_calls(candidate)

        if not fn_calls:
            # Terminal turn — Gemini returned text
            final_reply = _extract_text(candidate)
            break

        # Execute tool calls
        tool_results = []
        for fc in fn_calls:
            tool_name = fc["name"]
            tool_args = fc["args"]

            # Inject user_id if tool needs it and it's available
            if user_id and "user_id" in str(TOOL_EXECUTORS.get(tool_name, lambda **_: {}).__code__.co_varnames):
                tool_args.setdefault("user_id", user_id)

            executor = TOOL_EXECUTORS.get(tool_name)
            if not executor:
                result = {"error": f"Unknown tool: {tool_name}"}
            else:
                try:
                    result = executor(args=tool_args, db=db, ctx=ctx)
                except Exception as e:
                    logger.error(f"Tool {tool_name} failed", error=str(e))
                    result = {"error": str(e)}

            tool_actions.append(ToolAction(tool=tool_name, args=tool_args, result=result))
            tool_results.append({"name": tool_name, "response": result})

            # Track special results
            if tool_name == "open_screen":
                navigate_to = result.get("navigate_to")
            if tool_name == "store_memory" and result.get("stored"):
                memories_updated += 1

        # Append model's function-call turn + our tool responses
        contents.append(candidate["content"])
        tool_response_parts = [
            {
                "functionResponse": {
                    "name": tr["name"],
                    "response": tr["response"],
                }
            }
            for tr in tool_results
        ]
        contents.append({"role": "user", "parts": tool_response_parts})

    if not final_reply:
        final_reply = _get_fallback_reply(lang)

    # ── Log conversation turn ─────────────────────────────────────────────
    if user_id:
        try:
            if user_msgs:
                db.add(AriaConversation(
                    user_id=user_id,
                    session_id=session_id,
                    role="user",
                    content=user_msgs[-1].text,
                    emotion=detected_emotion,
                ))
            db.add(AriaConversation(
                user_id=user_id,
                session_id=session_id,
                role="assistant",
                content=final_reply,
                tool_calls=json.dumps(
                    [{"tool": ta.tool, "args": ta.args} for ta in tool_actions]
                ) if tool_actions else None,
            ))
            db.commit()
        except Exception as e:
            logger.warning("Failed to log conversation", error=str(e))

    return {
        "reply": final_reply,
        "emotion": detected_emotion,
        "tool_actions": tool_actions,
        "navigate_to": navigate_to,
        "memories_updated": memories_updated,
        "source": "gemini-agent",
    }


# ══════════════════════════════════════════════════════════════════════════════
# Fallbacks
# ══════════════════════════════════════════════════════════════════════════════

_FALLBACK_POOL = {
    "hi": [
        "Abhi network mein dikkat hai. Thodi der baad phir try karo.",
        "Server se connection nahi ho raha. Thoda ruko, phir baat karte hain.",
    ],
    "en": [
        "Network issue right now. Please try again shortly.",
        "Could not reach the AI service. Try again in a moment.",
    ],
    "mr": [
        "नेटवर्कमध्ये अडचण आहे. थोड्या वेळाने पुन्हा प्रयत्न करा.",
        "सर्व्हरशी कनेक्शन होत नाही. थोड्या वेळाने पुन्हा विचारा.",
    ],
    "kn": [
        "ಈಗ ನೆಟ್‌ವರ್ಕ್ ಸಮಸ್ಯೆ ಇದೆ. ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        "AI ಸೇವೆಯನ್ನು ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿಲ್ಲ. ಸ್ವಲ್ಪ ಬಳಿಕ ಮತ್ತೆ ಕೇಳಿ.",
    ],
    "gu": [
        "હાલ નેટવર્ક સમસ્યા છે. થોડા સમય પછી ફરી પ્રયાસ કરો.",
        "AI સેવા સુધી પહોંચાઈ નથી. થોડા સમય પછી ફરી પૂછો.",
    ],
}
_fb_idx = {"hi": 0, "en": 0, "mr": 0, "kn": 0, "gu": 0}


def _get_fallback_reply(lang: str) -> str:
    pool = _FALLBACK_POOL.get(lang, _FALLBACK_POOL["en"])
    idx = _fb_idx.get(lang, 0) % len(pool)
    _fb_idx[lang] = idx + 1
    return pool[idx]
