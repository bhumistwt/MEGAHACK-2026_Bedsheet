"""
[F14] SMS Fallback Gateway Router
═══════════════════════════════════════════════════════════════════════════════

Parses incoming SMS from farmers and returns advisories via SMS format.
Supports keyword-based queries: PRICE <crop>, WEATHER <district>,
HARVEST <crop>, DISEASE <crop>, SCHEME.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.logging import get_logger

logger = get_logger("khetwala.routers.sms")
router = APIRouter(prefix="/sms", tags=["sms"])


# ── SMS command patterns ─────────────────────────────────────────────────

SMS_COMMANDS = {
    "PRICE": {
        "pattern": "PRICE <crop>",
        "example": "PRICE ONION",
        "description": "Get current mandi prices for a crop",
    },
    "WEATHER": {
        "pattern": "WEATHER <district>",
        "example": "WEATHER NASHIK",
        "description": "Get weather forecast for your district",
    },
    "HARVEST": {
        "pattern": "HARVEST <crop>",
        "example": "HARVEST TOMATO",
        "description": "Get harvest timing recommendation",
    },
    "DISEASE": {
        "pattern": "DISEASE <crop> <symptom>",
        "example": "DISEASE TOMATO YELLOW LEAF",
        "description": "Get disease identification help",
    },
    "SCHEME": {
        "pattern": "SCHEME",
        "example": "SCHEME",
        "description": "Get relevant government schemes",
    },
    "HELP": {
        "pattern": "HELP",
        "example": "HELP",
        "description": "Get list of available commands",
    },
    "SCORE": {
        "pattern": "SCORE",
        "example": "SCORE",
        "description": "Get your Krishi Credit Score",
    },
}


# ── SMS formatter ────────────────────────────────────────────────────────

def format_sms_response(data: Dict, max_chars: int = 160) -> str:
    """Format response for SMS (≤160 chars per segment)."""
    text = data.get("text", "")
    if len(text) <= max_chars:
        return text
    # Truncate with continuation marker
    return text[:max_chars - 3] + "..."


# ── Schemas ──────────────────────────────────────────────────────────────

class IncomingSMS(BaseModel):
    sender: str = Field(..., min_length=10)
    body: str = Field(..., min_length=1)
    timestamp: Optional[str] = None


class SMSResponse(BaseModel):
    recipient: str
    body: str
    segments: int


# ── Command handlers ─────────────────────────────────────────────────────

def _handle_price(args: str) -> str:
    crop = args.strip().upper() if args else "ONION"
    # In production, this would call the market router
    prices = {
        "ONION": "₹2,200-2,800/q",
        "TOMATO": "₹1,800-3,200/q",
        "POTATO": "₹1,200-1,600/q",
        "WHEAT": "₹2,100-2,300/q",
        "RICE": "₹2,000-2,400/q",
        "SOYBEAN": "₹4,500-5,000/q",
    }
    price = prices.get(crop, "Data unavailable")

    return (
        f"KHETWALA PRICE\n"
        f"{crop}: {price}\n"
        f"Nashik Mandi: ₹2,500/q\n"
        f"Lasalgaon: ₹2,700/q\n"
        f"Updated: {datetime.now().strftime('%d-%b %H:%M')}\n"
        f"Reply HELP for more"
    )


def _handle_weather(args: str) -> str:
    district = args.strip().title() if args else "Nashik"
    return (
        f"KHETWALA WEATHER\n"
        f"{district}: 28-35°C\n"
        f"Humidity: 45-65%\n"
        f"Rain: No rain expected\n"
        f"Spray Window: Tomorrow 6-9AM\n"
        f"Updated: {datetime.now().strftime('%d-%b')}"
    )


def _handle_harvest(args: str) -> str:
    crop = args.strip().title() if args else "Onion"
    return (
        f"KHETWALA HARVEST\n"
        f"{crop} Advisory:\n"
        f"Best window: Next 5-7 days\n"
        f"Spoilage Risk: LOW\n"
        f"Best Mandi: Lasalgaon\n"
        f"Tip: Morning harvest, avoid rain"
    )


def _handle_disease(args: str) -> str:
    parts = args.strip().split() if args else ["crop"]
    crop = parts[0].title() if parts else "Crop"
    symptom = " ".join(parts[1:]) if len(parts) > 1 else "unknown"
    return (
        f"KHETWALA DISEASE\n"
        f"{crop}: Possible {symptom}\n"
        f"Treatment:\n"
        f"1. Neem oil spray ₹120/acre\n"
        f"2. Mancozeb ₹340/acre\n"
        f"App download for photo scan"
    )


def _handle_scheme() -> str:
    return (
        f"KHETWALA SCHEMES\n"
        f"1. PM-KISAN: ₹6000/yr\n"
        f"2. PMFBY: Crop Insurance\n"
        f"3. KCC: Low-interest loan\n"
        f"4. Soil Health Card: Free\n"
        f"Reply SCHEME <name> for details"
    )


def _handle_score() -> str:
    return (
        f"KHETWALA SCORE\n"
        f"Krishi Score: 620/850\n"
        f"Tier: Good ⭐\n"
        f"Loan Eligible: Yes\n"
        f"Improve: Log harvest data\n"
        f"App: khetwala.app/score"
    )


def _handle_help() -> str:
    return (
        f"KHETWALA COMMANDS\n"
        f"PRICE <crop>\n"
        f"WEATHER <district>\n"
        f"HARVEST <crop>\n"
        f"DISEASE <crop> <sign>\n"
        f"SCHEME\n"
        f"SCORE\n"
        f"Example: PRICE ONION"
    )


COMMAND_HANDLERS = {
    "PRICE": _handle_price,
    "WEATHER": _handle_weather,
    "HARVEST": _handle_harvest,
    "DISEASE": _handle_disease,
    "SCHEME": lambda args: _handle_scheme(),
    "SCORE": lambda args: _handle_score(),
    "HELP": lambda args: _handle_help(),
}


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/webhook")
def process_incoming_sms(
    payload: IncomingSMS,
) -> Dict[str, Any]:
    """Process an incoming SMS and return a response."""
    body = payload.body.strip().upper()
    parts = body.split(maxsplit=1)
    command = parts[0] if parts else "HELP"
    args = parts[1] if len(parts) > 1 else ""

    handler = COMMAND_HANDLERS.get(command, COMMAND_HANDLERS["HELP"])

    try:
        if command in ("SCHEME", "SCORE", "HELP"):
            response_text = handler(args)
        else:
            response_text = handler(args)
    except Exception as e:
        logger.error(f"SMS processing error: {e}")
        response_text = (
            "KHETWALA ERROR\n"
            "Request process nahi hua.\n"
            "Reply HELP for commands."
        )

    # Calculate segments
    segments = (len(response_text) + 159) // 160

    return {
        "recipient": payload.sender,
        "body": response_text,
        "segments": segments,
        "command_parsed": command,
        "args": args,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/commands")
def list_sms_commands() -> Dict[str, Any]:
    """List all available SMS commands."""
    return {
        "commands": SMS_COMMANDS,
        "max_sms_length": 160,
        "help_text": "Send any command to KHETWALA number. Example: PRICE ONION",
    }
