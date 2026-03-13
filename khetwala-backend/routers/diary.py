"""
[F9] Crop Diary Router
═══════════════════════════════════════════════════════════════════════════════

Voice-first crop diary that lets farmers log daily observations
via text or audio URI. Auto-tagging via keyword extraction.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from db.models import CropDiaryEntry
from routers.auth import ensure_user_access, require_current_user

logger = get_logger("khetwala.routers.diary")
router = APIRouter(prefix="/diary", tags=["diary"])


# ── Auto-tagging keywords ───────────────────────────────────────────────

TAG_KEYWORDS = {
    "irrigation": ["paani", "water", "sinchai", "irrigation", "drip", "flood"],
    "fertilizer": ["khad", "fertilizer", "urea", "dap", "potash", "npk", "compost"],
    "pesticide": ["keetnashak", "pesticide", "spray", "dawai", "fungicide", "insecticide"],
    "disease": ["bimari", "disease", "rog", "spot", "blight", "rust", "wilt", "infection"],
    "weather": ["baarish", "rain", "dhoop", "sun", "garmi", "sardi", "cold", "hawa", "wind", "storm"],
    "harvest": ["katai", "harvest", "tod", "cut", "ripe", "pakka", "yield"],
    "market": ["mandi", "market", "bech", "sell", "price", "daam", "rate"],
    "sowing": ["buwai", "sowing", "seed", "beej"],
    "growth": ["badh", "growth", "patta", "leaf", "phool", "flower", "phal", "fruit"],
    "soil": ["mitti", "soil", "zameen", "land"],
    "labor": ["majdoor", "labor", "kaam", "work"],
    "cost": ["kharcha", "cost", "paisa", "money", "invest"],
}

SENTIMENT_KEYWORDS = {
    "positive": ["achha", "good", "great", "badhiya", "healthy", "profit", "faayda", "shandar"],
    "negative": ["kharab", "bad", "worst", "nuksaan", "loss", "problem", "tension", "kamzor"],
    "neutral": [],
}


def _auto_tag(text: str) -> List[str]:
    """Extract tags from diary entry text."""
    text_lower = text.lower()
    tags = []
    for tag, keywords in TAG_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                tags.append(tag)
                break
    return tags


def _detect_sentiment(text: str) -> str:
    """Simple keyword-based sentiment detection."""
    text_lower = text.lower()
    pos_count = sum(1 for kw in SENTIMENT_KEYWORDS["positive"] if kw in text_lower)
    neg_count = sum(1 for kw in SENTIMENT_KEYWORDS["negative"] if kw in text_lower)
    if pos_count > neg_count:
        return "positive"
    elif neg_count > pos_count:
        return "negative"
    return "neutral"


# ── Schemas ──────────────────────────────────────────────────────────────

class CreateDiaryEntryRequest(BaseModel):
    user_id: int
    crop: str
    text_content: str = Field(..., min_length=3)
    audio_uri: Optional[str] = None
    season: Optional[str] = None
    entry_date: Optional[str] = None  # ISO date, defaults to today


class UpdateDiaryEntryRequest(BaseModel):
    text_content: Optional[str] = None
    tags: Optional[List[str]] = None


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/create")
def create_diary_entry(
    payload: CreateDiaryEntryRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Create a new crop diary entry with auto-tagging."""
    ensure_user_access(current_user, payload.user_id)
    entry_date_val = date.today()
    if payload.entry_date:
        try:
            entry_date_val = date.fromisoformat(payload.entry_date)
        except ValueError:
            raise HTTPException(400, "Invalid entry_date format. Use YYYY-MM-DD.")

    tags = _auto_tag(payload.text_content)
    sentiment = _detect_sentiment(payload.text_content)

    entry = CropDiaryEntry(
        user_id=payload.user_id,
        crop=payload.crop,
        entry_date=entry_date_val,
        text_content=payload.text_content,
        audio_uri=payload.audio_uri,
        tags=str(tags),
        season=payload.season or _detect_season(entry_date_val),
        sentiment=sentiment,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    return {
        "entry_id": entry.id,
        "date": entry.entry_date.isoformat(),
        "crop": entry.crop,
        "tags": tags,
        "sentiment": sentiment,
        "message": f"Diary entry saved! {len(tags)} tags auto-detected.",
    }


@router.get("/entries/{user_id}")
def get_diary_entries(
    user_id: int,
    crop: Optional[str] = None,
    season: Optional[str] = None,
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get diary entries for a user, optionally filtered by crop/season."""
    ensure_user_access(current_user, user_id)
    query = db.query(CropDiaryEntry).filter(CropDiaryEntry.user_id == user_id)
    if crop:
        query = query.filter(CropDiaryEntry.crop.ilike(f"%{crop}%"))
    if season:
        query = query.filter(CropDiaryEntry.season == season)

    entries = query.order_by(CropDiaryEntry.entry_date.desc()).limit(limit).all()

    results = []
    for e in entries:
        results.append({
            "id": e.id,
            "date": e.entry_date.isoformat(),
            "crop": e.crop,
            "text": e.text_content,
            "audio_uri": e.audio_uri,
            "tags": _parse_tags(e.tags),
            "season": e.season,
            "sentiment": e.sentiment,
        })

    # Compute tag distribution
    all_tags = []
    for e in entries:
        all_tags.extend(_parse_tags(e.tags))
    tag_counts = {}
    for t in all_tags:
        tag_counts[t] = tag_counts.get(t, 0) + 1

    return {
        "user_id": user_id,
        "total_entries": len(results),
        "entries": results,
        "tag_distribution": tag_counts,
    }


@router.put("/entries/{entry_id}")
def update_diary_entry(
    entry_id: int,
    payload: UpdateDiaryEntryRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Update an existing diary entry."""
    entry = db.query(CropDiaryEntry).filter(CropDiaryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Diary entry not found")
    ensure_user_access(current_user, entry.user_id)

    if payload.text_content:
        entry.text_content = payload.text_content
        entry.tags = str(_auto_tag(payload.text_content))
        entry.sentiment = _detect_sentiment(payload.text_content)

    if payload.tags is not None:
        entry.tags = str(payload.tags)

    db.commit()
    db.refresh(entry)

    return {
        "entry_id": entry.id,
        "updated": True,
        "tags": _parse_tags(entry.tags),
        "sentiment": entry.sentiment,
    }


@router.delete("/entries/{entry_id}")
def delete_diary_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, str]:
    """Delete a diary entry."""
    entry = db.query(CropDiaryEntry).filter(CropDiaryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Diary entry not found")
    ensure_user_access(current_user, entry.user_id)
    db.delete(entry)
    db.commit()
    return {"message": "Entry deleted"}


@router.get("/summary/{user_id}")
def get_diary_summary(
    user_id: int,
    crop: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get a summary of diary entries with patterns and insights."""
    ensure_user_access(current_user, user_id)
    query = db.query(CropDiaryEntry).filter(CropDiaryEntry.user_id == user_id)
    if crop:
        query = query.filter(CropDiaryEntry.crop.ilike(f"%{crop}%"))

    entries = query.order_by(CropDiaryEntry.entry_date.desc()).all()

    if not entries:
        return {"user_id": user_id, "message": "No diary entries yet. Start logging!"}

    # Sentiment trend
    sentiments = [e.sentiment for e in entries]
    pos = sentiments.count("positive")
    neg = sentiments.count("negative")
    neu = sentiments.count("neutral")

    # Most common tags
    all_tags = []
    for e in entries:
        all_tags.extend(_parse_tags(e.tags))
    tag_counts = {}
    for t in all_tags:
        tag_counts[t] = tag_counts.get(t, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: -x[1])[:5]

    # Season distribution
    season_counts = {}
    for e in entries:
        s = e.season or "unknown"
        season_counts[s] = season_counts.get(s, 0) + 1

    return {
        "user_id": user_id,
        "total_entries": len(entries),
        "sentiment_distribution": {"positive": pos, "negative": neg, "neutral": neu},
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "season_distribution": season_counts,
        "first_entry": entries[-1].entry_date.isoformat() if entries else None,
        "latest_entry": entries[0].entry_date.isoformat() if entries else None,
        "insight": _generate_diary_insight(pos, neg, top_tags, len(entries)),
    }


# ── Utility helpers ──────────────────────────────────────────────────────

def _detect_season(d: date) -> str:
    month = d.month
    if month in (6, 7, 8, 9):
        return "kharif"
    elif month in (10, 11, 12, 1, 2):
        return "rabi"
    else:
        return "zaid"


def _parse_tags(tags_str: Optional[str]) -> List[str]:
    if not tags_str:
        return []
    try:
        import ast
        return ast.literal_eval(tags_str)
    except (ValueError, SyntaxError):
        return []


def _generate_diary_insight(pos: int, neg: int, top_tags: list, total: int) -> str:
    if total < 3:
        return "Aur diary entries likho — 7 din baad patterns dikhenge!"
    mood = "positive" if pos > neg else "mixed" if pos == neg else "challenging"
    tag_str = ", ".join(t for t, _ in top_tags[:3])
    return (
        f"📝 {total} entries mein overall mood {mood} hai. "
        f"Top activities: {tag_str}. "
        f"Daily entries likho — ARIA ko better advice dene mein help hogi."
    )
