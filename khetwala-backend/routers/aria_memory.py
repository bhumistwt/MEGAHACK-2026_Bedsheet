"""
Khetwala-मित्र ARIA Memory Router
═══════════════════════════════════════════════════════════════════════════════

CRUD endpoints for ARIA's persistent memory — lets ARIA recall facts,
preferences, emotional signals, and milestones across conversations.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.models import AriaMemory
from db.session import get_db

logger = get_logger("khetwala.routers.aria_memory")

router = APIRouter(prefix="/aria/memory", tags=["aria-memory"])


# ══════════════════════════════════════════════════════════════════════════════
# Request / Response Schemas
# ══════════════════════════════════════════════════════════════════════════════


class MemoryCreate(BaseModel):
    memory_type: str = Field(
        ...,
        examples=["fact", "preference", "emotion", "milestone"],
        description="Category: fact | preference | emotion | milestone",
    )
    memory_key: str = Field(
        ...,
        examples=["main_crop", "preferred_mandi", "last_mood"],
        max_length=200,
    )
    memory_value: str = Field(
        ...,
        examples=["Onion", "Lasalgaon", "worried_about_rain"],
    )
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: str = Field(default="conversation")


class MemoryUpdate(BaseModel):
    memory_value: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class MemoryOut(BaseModel):
    id: int
    user_id: int
    memory_type: str
    memory_key: str
    memory_value: str
    confidence: float
    source: str
    last_referenced: str
    created_at: str

    class Config:
        from_attributes = True


def _mem_to_dict(m: AriaMemory) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "memory_type": m.memory_type,
        "memory_key": m.memory_key,
        "memory_value": m.memory_value,
        "confidence": m.confidence,
        "source": m.source,
        "last_referenced": m.last_referenced.isoformat() if m.last_referenced else "",
        "created_at": m.created_at.isoformat() if m.created_at else "",
    }


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/{user_id}", response_model=List[MemoryOut])
def get_memories(
    user_id: int,
    memory_type: Optional[str] = Query(None, description="Filter by type"),
    db: Session = Depends(get_db),
) -> List[dict]:
    """Retrieve all (or filtered) memories for a user."""
    query = db.query(AriaMemory).filter(AriaMemory.user_id == user_id)
    if memory_type:
        query = query.filter(AriaMemory.memory_type == memory_type)
    memories = query.order_by(AriaMemory.last_referenced.desc()).all()
    return [_mem_to_dict(m) for m in memories]


@router.post("/{user_id}", response_model=MemoryOut)
def upsert_memory(
    user_id: int,
    payload: MemoryCreate,
    db: Session = Depends(get_db),
) -> dict:
    """
    Insert or update a memory (upsert on user_id + type + key).
    If the same key already exists, the value and confidence are updated.
    """
    existing = (
        db.query(AriaMemory)
        .filter(
            AriaMemory.user_id == user_id,
            AriaMemory.memory_type == payload.memory_type,
            AriaMemory.memory_key == payload.memory_key,
        )
        .first()
    )

    if existing:
        existing.memory_value = payload.memory_value
        existing.confidence = payload.confidence
        existing.source = payload.source
        existing.last_referenced = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        logger.info("Memory updated", user_id=user_id, key=payload.memory_key)
        return _mem_to_dict(existing)

    new_mem = AriaMemory(
        user_id=user_id,
        memory_type=payload.memory_type,
        memory_key=payload.memory_key,
        memory_value=payload.memory_value,
        confidence=payload.confidence,
        source=payload.source,
    )
    db.add(new_mem)
    db.commit()
    db.refresh(new_mem)
    logger.info("Memory created", user_id=user_id, key=payload.memory_key)
    return _mem_to_dict(new_mem)


@router.delete("/{user_id}/{memory_id}")
def delete_memory(
    user_id: int,
    memory_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Delete a specific memory belonging to a user."""
    mem = (
        db.query(AriaMemory)
        .filter(AriaMemory.id == memory_id, AriaMemory.user_id == user_id)
        .first()
    )
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(mem)
    db.commit()
    logger.info("Memory deleted", user_id=user_id, memory_id=memory_id)
    return {"deleted": True, "id": memory_id}


@router.delete("/{user_id}")
def clear_memories(
    user_id: int,
    memory_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Clear all memories for a user (optionally filtered by type)."""
    query = db.query(AriaMemory).filter(AriaMemory.user_id == user_id)
    if memory_type:
        query = query.filter(AriaMemory.memory_type == memory_type)
    count = query.delete(synchronize_session="fetch")
    db.commit()
    logger.info("Memories cleared", user_id=user_id, count=count)
    return {"deleted_count": count, "user_id": user_id}
