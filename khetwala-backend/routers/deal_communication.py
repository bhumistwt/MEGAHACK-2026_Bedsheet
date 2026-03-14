from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.models import (
    DealCallLog,
    DealConnectionRequest,
    DealContact,
    DealMessage,
    TradeRecord,
    User,
)
from db.session import get_db
from routers.auth import require_current_user

logger = get_logger("khetwala.routers.deal_communication")
router = APIRouter(prefix="/deal-comm", tags=["deal-communication"])


class ConnectionRequestCreate(BaseModel):
    trade_id: int
    receiver_id: Optional[int] = None


class ConnectionRequestRespond(BaseModel):
    request_id: int
    action: str = Field(..., pattern="^(accept|reject)$")


class MessageSendRequest(BaseModel):
    trade_id: int
    message_text: str = Field(..., min_length=1, max_length=5000)


class MessageReadRequest(BaseModel):
    trade_id: Optional[int] = None
    message_ids: Optional[List[int]] = None


class StartCallRequest(BaseModel):
    trade_id: int
    call_type: str = Field(..., pattern="^(audio|video)$")


class EndCallRequest(BaseModel):
    room_id: str


def _normalize_pair(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def _load_trade_for_user(db: Session, trade_id: int, user_id: int) -> TradeRecord:
    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    if int(user_id) not in {int(trade.seller_id), int(trade.buyer_id)}:
        raise HTTPException(status_code=403, detail="Forbidden for requested trade")
    return trade


def _get_counterparty_id(trade: TradeRecord, user_id: int) -> int:
    if int(trade.seller_id) == int(user_id):
        return int(trade.buyer_id)
    return int(trade.seller_id)


def _has_contact(db: Session, user_a_id: int, user_b_id: int) -> bool:
    a, b = _normalize_pair(int(user_a_id), int(user_b_id))
    contact = db.query(DealContact).filter(
        and_(DealContact.user_a_id == a, DealContact.user_b_id == b)
    ).first()
    return contact is not None


def _get_user_public(user: Optional[User], fallback_id: int) -> Dict[str, Any]:
    if not user:
        return {"id": fallback_id, "full_name": f"User {fallback_id}"}
    return {"id": user.id, "full_name": user.full_name}


@router.post("/connections/request")
def create_connection_request(
    req: ConnectionRequestCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    trade = _load_trade_for_user(db, req.trade_id, current_user.id)
    counterparty_id = _get_counterparty_id(trade, current_user.id)
    receiver_id = int(req.receiver_id) if req.receiver_id is not None else counterparty_id

    if receiver_id != counterparty_id:
        raise HTTPException(status_code=400, detail="Receiver must be trade counterparty")

    if _has_contact(db, current_user.id, receiver_id):
        return {"success": True, "already_connected": True}

    existing_pending = db.query(DealConnectionRequest).filter(
        DealConnectionRequest.trade_id == req.trade_id,
        DealConnectionRequest.status == "pending",
        or_(
            and_(
                DealConnectionRequest.requester_id == int(current_user.id),
                DealConnectionRequest.receiver_id == receiver_id,
            ),
            and_(
                DealConnectionRequest.requester_id == receiver_id,
                DealConnectionRequest.receiver_id == int(current_user.id),
            ),
        ),
    ).first()

    if existing_pending:
        return {
            "success": True,
            "request": {
                "id": existing_pending.id,
                "status": existing_pending.status,
                "trade_id": existing_pending.trade_id,
                "requester_id": existing_pending.requester_id,
                "receiver_id": existing_pending.receiver_id,
            },
        }

    conn_request = DealConnectionRequest(
        requester_id=int(current_user.id),
        receiver_id=receiver_id,
        trade_id=req.trade_id,
        status="pending",
    )
    db.add(conn_request)
    db.commit()
    db.refresh(conn_request)

    return {
        "success": True,
        "request": {
            "id": conn_request.id,
            "status": conn_request.status,
            "trade_id": conn_request.trade_id,
            "requester_id": conn_request.requester_id,
            "receiver_id": conn_request.receiver_id,
        },
    }


@router.post("/connections/respond")
def respond_connection_request(
    req: ConnectionRequestRespond,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    conn_request = db.query(DealConnectionRequest).filter(
        DealConnectionRequest.id == req.request_id
    ).first()

    if not conn_request:
        raise HTTPException(status_code=404, detail="Connection request not found")

    if int(conn_request.receiver_id) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Only receiver can respond")

    if conn_request.status != "pending":
        return {"success": True, "status": conn_request.status}

    conn_request.status = "accepted" if req.action == "accept" else "rejected"
    conn_request.responded_at = datetime.now(timezone.utc)

    contact_created = False
    if req.action == "accept":
        a, b = _normalize_pair(conn_request.requester_id, conn_request.receiver_id)
        existing_contact = db.query(DealContact).filter(
            DealContact.user_a_id == a,
            DealContact.user_b_id == b,
        ).first()
        if not existing_contact:
            db.add(
                DealContact(
                    user_a_id=a,
                    user_b_id=b,
                    created_from_request_id=conn_request.id,
                )
            )
            contact_created = True

    db.commit()

    return {
        "success": True,
        "status": conn_request.status,
        "contact_created": contact_created,
    }


@router.get("/connections/list")
def list_contacts(
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    contacts = db.query(DealContact).filter(
        or_(DealContact.user_a_id == int(current_user.id), DealContact.user_b_id == int(current_user.id))
    ).order_by(DealContact.created_at.desc()).all()

    result: List[Dict[str, Any]] = []
    for contact in contacts:
        counterpart_id = contact.user_b_id if int(contact.user_a_id) == int(current_user.id) else contact.user_a_id
        user_row = db.query(User).filter(User.id == counterpart_id).first()
        result.append(
            {
                "contact_id": contact.id,
                "counterpart": _get_user_public(user_row, counterpart_id),
                "created_at": contact.created_at.isoformat() if contact.created_at else None,
            }
        )

    return {"success": True, "contacts": result, "count": len(result)}


@router.get("/connections/pending")
def list_pending_requests(
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    incoming = db.query(DealConnectionRequest).filter(
        DealConnectionRequest.receiver_id == int(current_user.id),
        DealConnectionRequest.status == "pending",
    ).order_by(DealConnectionRequest.created_at.desc()).all()

    outgoing = db.query(DealConnectionRequest).filter(
        DealConnectionRequest.requester_id == int(current_user.id),
        DealConnectionRequest.status == "pending",
    ).order_by(DealConnectionRequest.created_at.desc()).all()

    def _map_request(item: DealConnectionRequest) -> Dict[str, Any]:
        requester = db.query(User).filter(User.id == item.requester_id).first()
        receiver = db.query(User).filter(User.id == item.receiver_id).first()
        return {
            "request_id": item.id,
            "trade_id": item.trade_id,
            "status": item.status,
            "requester": _get_user_public(requester, item.requester_id),
            "receiver": _get_user_public(receiver, item.receiver_id),
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }

    return {
        "success": True,
        "incoming": [_map_request(row) for row in incoming],
        "outgoing": [_map_request(row) for row in outgoing],
    }


@router.post("/messages/send")
def send_message(
    req: MessageSendRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    trade = _load_trade_for_user(db, req.trade_id, current_user.id)
    receiver_id = _get_counterparty_id(trade, current_user.id)

    if not _has_contact(db, current_user.id, receiver_id):
        raise HTTPException(status_code=403, detail="Connection is required before messaging")

    message = DealMessage(
        trade_id=req.trade_id,
        sender_id=int(current_user.id),
        receiver_id=receiver_id,
        message_text=req.message_text.strip(),
        status="sent",
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    return {
        "success": True,
        "message": {
            "id": message.id,
            "trade_id": message.trade_id,
            "sender_id": message.sender_id,
            "receiver_id": message.receiver_id,
            "message_text": message.message_text,
            "status": message.status,
            "sent_at": message.sent_at.isoformat() if message.sent_at else None,
        },
    }


@router.get("/messages/list")
def list_messages(
    trade_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    _load_trade_for_user(db, trade_id, current_user.id)

    messages = db.query(DealMessage).filter(
        DealMessage.trade_id == trade_id
    ).order_by(DealMessage.sent_at.asc()).limit(500).all()

    payload = [
        {
            "id": row.id,
            "trade_id": row.trade_id,
            "sender_id": row.sender_id,
            "receiver_id": row.receiver_id,
            "message_text": row.message_text,
            "status": row.status,
            "sent_at": row.sent_at.isoformat() if row.sent_at else None,
            "delivered_at": row.delivered_at.isoformat() if row.delivered_at else None,
            "read_at": row.read_at.isoformat() if row.read_at else None,
        }
        for row in messages
    ]

    return {"success": True, "messages": payload, "count": len(payload)}


@router.post("/messages/mark-read")
def mark_messages_read(
    req: MessageReadRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)

    query = db.query(DealMessage).filter(DealMessage.receiver_id == int(current_user.id))

    if req.trade_id is not None:
        _load_trade_for_user(db, req.trade_id, current_user.id)
        query = query.filter(DealMessage.trade_id == req.trade_id)

    if req.message_ids:
        query = query.filter(DealMessage.id.in_(req.message_ids))

    unread_messages = query.filter(DealMessage.status != "read").all()

    for message in unread_messages:
        message.status = "read"
        message.read_at = now

    db.commit()

    return {"success": True, "updated": len(unread_messages)}


@router.post("/calls/start")
def start_call(
    req: StartCallRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    trade = _load_trade_for_user(db, req.trade_id, current_user.id)
    receiver_id = _get_counterparty_id(trade, current_user.id)

    if not _has_contact(db, current_user.id, receiver_id):
        raise HTTPException(status_code=403, detail="Connection is required before calling")

    room_id = f"deal-{req.trade_id}-{int(datetime.now(timezone.utc).timestamp())}-{uuid4().hex[:8]}"
    room_url = f"https://meet.jit.si/{room_id}"

    call = DealCallLog(
        trade_id=req.trade_id,
        caller_id=int(current_user.id),
        receiver_id=receiver_id,
        call_type=req.call_type,
        call_status="initiated",
        room_id=room_id,
        room_url=room_url,
    )

    db.add(call)
    db.commit()
    db.refresh(call)

    return {
        "success": True,
        "call": {
            "id": call.id,
            "trade_id": call.trade_id,
            "caller_id": call.caller_id,
            "receiver_id": call.receiver_id,
            "call_type": call.call_type,
            "call_status": call.call_status,
            "room_id": call.room_id,
            "room_url": call.room_url,
            "started_at": call.started_at.isoformat() if call.started_at else None,
        },
    }


@router.post("/calls/end")
def end_call(
    req: EndCallRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    call = db.query(DealCallLog).filter(DealCallLog.room_id == req.room_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if int(current_user.id) not in {int(call.caller_id), int(call.receiver_id)}:
        raise HTTPException(status_code=403, detail="Forbidden for requested call")

    if call.call_status == "ended":
        return {"success": True, "call": {"room_id": call.room_id, "call_status": call.call_status}}

    now = datetime.now(timezone.utc)
    call.ended_at = now
    call.call_status = "ended"

    if call.started_at:
        call.duration_seconds = max(0, int((now - call.started_at).total_seconds()))

    db.commit()

    return {
        "success": True,
        "call": {
            "room_id": call.room_id,
            "call_status": call.call_status,
            "ended_at": call.ended_at.isoformat() if call.ended_at else None,
            "duration_seconds": call.duration_seconds,
        },
    }


@router.get("/calls/list")
def list_calls(
    trade_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    _load_trade_for_user(db, trade_id, current_user.id)

    calls = db.query(DealCallLog).filter(
        DealCallLog.trade_id == trade_id
    ).order_by(DealCallLog.started_at.desc()).limit(100).all()

    payload = [
        {
            "id": row.id,
            "trade_id": row.trade_id,
            "caller_id": row.caller_id,
            "receiver_id": row.receiver_id,
            "call_type": row.call_type,
            "call_status": row.call_status,
            "room_id": row.room_id,
            "room_url": row.room_url,
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "ended_at": row.ended_at.isoformat() if row.ended_at else None,
            "duration_seconds": row.duration_seconds,
        }
        for row in calls
    ]

    return {"success": True, "calls": payload, "count": len(payload)}
