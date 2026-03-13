"""
Blockchain Trust Layer Router
═══════════════════════════════════════════════════════════════════════════════

Endpoints for the blockchain trust enforcement layer:
  • Recommendation Proofs   → anchor AI outputs on Polygon
  • Trade Agreements        → immutable farmer-buyer deals
  • Settlement / Escrow     → lock / release / penalise funds
  • Dashboard stats         → farmer-friendly deal overview

All blockchain complexity is hidden from farmers.
Farmers see only: Deal Confirmed / Payment Locked / Money Released
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from db.models import TradeRecord
from routers.auth import ensure_user_access, require_current_user
from services.blockchain_service import (
    anchor_recommendation_proof,
    apply_penalty,
    cancel_trade,
    confirm_delivery,
    create_trade,
    get_blockchain_stats,
    get_trade_status,
    get_user_proofs,
    get_user_trades,
    lock_escrow,
    refund_escrow,
    release_escrow,
)

logger = get_logger("khetwala.routers.blockchain")
router = APIRouter(prefix="/blockchain", tags=["blockchain"])


def _require_trade_participant(db: Session, trade_id: int, current_user_id: int) -> TradeRecord:
    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    if int(current_user_id) not in {int(trade.seller_id), int(trade.buyer_id)}:
        raise HTTPException(status_code=403, detail="Forbidden for requested trade")
    return trade


# ═══════════════════════════════════════════════════════════════════════════════
# Request / Response Schemas
# ═══════════════════════════════════════════════════════════════════════════════


class AnchorProofRequest(BaseModel):
    user_id: int
    crop: str
    region: str
    input_data: Dict[str, Any] = Field(
        ..., description="The raw input data sent to the AI model"
    )
    output_data: Dict[str, Any] = Field(
        ..., description="The AI recommendation output"
    )
    model_version: str = "1.0.0"


class CreateTradeRequest(BaseModel):
    seller_id: int
    buyer_id: int
    crop: str
    quantity_kg: float = Field(..., gt=0)
    price_per_kg: float = Field(..., gt=0)
    quality_grade: str = "A"
    delivery_deadline: Optional[str] = None  # ISO datetime
    penalty_rate: float = Field(default=5.0, ge=0, le=100)


class TradeActionRequest(BaseModel):
    trade_id: int


class SettlementActionRequest(BaseModel):
    trade_id: int


# ═══════════════════════════════════════════════════════════════════════════════
# Recommendation Proof Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/proof/anchor")
def api_anchor_proof(
    req: AnchorProofRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """
    Anchor an AI recommendation proof on Polygon.

    The input and output data are hashed (SHA-256) and the hashes
    are stored on-chain. No sensitive data touches the blockchain.
    """
    try:
        ensure_user_access(current_user, req.user_id)
        result = anchor_recommendation_proof(
            user_id=req.user_id,
            crop=req.crop,
            region=req.region,
            input_data=req.input_data,
            output_data=req.output_data,
            model_version=req.model_version,
            db=db,
        )
        return {"success": True, "proof": result}
    except Exception as exc:
        logger.error(f"Proof anchoring failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/proof/list")
def api_list_proofs(
    user_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """List all recommendation proofs for a user."""
    ensure_user_access(current_user, user_id)
    proofs = get_user_proofs(user_id, db)
    return {"success": True, "proofs": proofs, "count": len(proofs)}


# ═══════════════════════════════════════════════════════════════════════════════
# Trade Agreement Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/trade/create")
def api_create_trade(
    req: CreateTradeRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """
    Create a trade agreement between farmer (seller) and buyer.

    On success, the trade is anchored on Polygon and the farmer
    sees "Deal Confirmed ✅".
    """
    try:
        ensure_user_access(current_user, req.seller_id)
        deadline = None
        if req.delivery_deadline:
            deadline = datetime.fromisoformat(req.delivery_deadline)

        result = create_trade(
            seller_id=req.seller_id,
            buyer_id=req.buyer_id,
            crop=req.crop,
            quantity_kg=req.quantity_kg,
            price_per_kg=req.price_per_kg,
            quality_grade=req.quality_grade,
            delivery_deadline=deadline,
            penalty_rate=req.penalty_rate,
            db=db,
        )
        return {"success": True, "trade": result}
    except Exception as exc:
        logger.error(f"Trade creation failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/trade/confirm-delivery")
def api_confirm_delivery(
    req: TradeActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Mark a trade as delivered."""
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = confirm_delivery(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "trade": result}


@router.post("/trade/cancel")
def api_cancel_trade(
    req: TradeActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Cancel a trade agreement."""
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = cancel_trade(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "trade": result}


@router.get("/trade/status")
def api_trade_status(
    trade_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get farmer-friendly trade status with settlement info."""
    _require_trade_participant(db, trade_id, current_user.id)
    result = get_trade_status(trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return {"success": True, "trade": result}


@router.get("/trade/list")
def api_list_trades(
    user_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """List all trades for a user (as seller or buyer)."""
    ensure_user_access(current_user, user_id)
    trades = get_user_trades(user_id, db)
    return {"success": True, "trades": trades, "count": len(trades)}


# ═══════════════════════════════════════════════════════════════════════════════
# Settlement / Escrow Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/settlement/lock")
def api_lock_escrow(
    req: SettlementActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """
    Lock funds in escrow for a trade.
    Farmer sees: "Payment Locked 🔒"
    """
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = lock_escrow(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "settlement": result}


@router.post("/settlement/release")
def api_release_escrow(
    req: SettlementActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """
    Release escrowed funds to seller after delivery.
    Farmer sees: "Money Released 💰"
    """
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = release_escrow(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "settlement": result}


@router.post("/settlement/penalty")
def api_apply_penalty(
    req: SettlementActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Apply penalty on trade default."""
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = apply_penalty(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "settlement": result}


@router.post("/settlement/refund")
def api_refund_escrow(
    req: SettlementActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Full refund of escrowed funds."""
    _require_trade_participant(db, req.trade_id, current_user.id)
    result = refund_escrow(req.trade_id, db)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "settlement": result}


# ═══════════════════════════════════════════════════════════════════════════════
# Dashboard / Stats
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/stats")
def api_blockchain_stats(
    user_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """
    Blockchain dashboard stats for a user.

    Returns counts of proofs, trades, settlements,
    total transaction volume, and network status.
    """
    ensure_user_access(current_user, user_id)
    stats = get_blockchain_stats(user_id, db)
    return {"success": True, "stats": stats}
