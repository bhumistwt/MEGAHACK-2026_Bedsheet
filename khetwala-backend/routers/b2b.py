"""
[F13] B2B Buyer Connect Router
═══════════════════════════════════════════════════════════════════════════════

Connects farmers directly with institutional buyers (hotels, exporters,
food processors). Buyers post orders, farmers express interest.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from routers.auth import ensure_user_access, require_current_user
from db.models import BuyerOrder, FarmerExpression, User

logger = get_logger("khetwala.routers.b2b")
router = APIRouter(prefix="/b2b", tags=["b2b"])


# ── Schemas ──────────────────────────────────────────────────────────────

class CreateBuyerOrderRequest(BaseModel):
    buyer_name: str
    buyer_type: str = Field(default="retailer")  # retailer, exporter, hotel, processor
    crop: str
    quantity_quintals: float = Field(..., gt=0)
    grade: Optional[str] = "A"
    price_per_quintal: float = Field(..., gt=0)
    delivery_window_start: str  # ISO date
    delivery_window_end: str    # ISO date
    district: str


class ExpressInterestRequest(BaseModel):
    user_id: int
    buyer_order_id: int
    quantity_offered: float = Field(..., gt=0)
    message: Optional[str] = None


# ── Seed buyer orders (demo data) ───────────────────────────────────────

DEMO_BUYER_ORDERS = [
    {
        "buyer_name": "FreshBasket Exports",
        "buyer_type": "exporter",
        "crop": "onion",
        "quantity_quintals": 500,
        "grade": "A",
        "price_per_quintal": 2800,
        "delivery_window_start": "2025-02-01",
        "delivery_window_end": "2025-02-15",
        "district": "Nashik",
        "status": "open",
    },
    {
        "buyer_name": "Taj Hotel Group",
        "buyer_type": "hotel",
        "crop": "tomato",
        "quantity_quintals": 50,
        "grade": "Premium",
        "price_per_quintal": 3500,
        "delivery_window_start": "2025-01-20",
        "delivery_window_end": "2025-01-30",
        "district": "Pune",
        "status": "open",
    },
    {
        "buyer_name": "MahaFood Processors",
        "buyer_type": "processor",
        "crop": "potato",
        "quantity_quintals": 1000,
        "grade": "B+",
        "price_per_quintal": 1500,
        "delivery_window_start": "2025-03-01",
        "delivery_window_end": "2025-03-20",
        "district": "Pune",
        "status": "open",
    },
    {
        "buyer_name": "Reliance Fresh",
        "buyer_type": "retailer",
        "crop": "onion",
        "quantity_quintals": 200,
        "grade": "A",
        "price_per_quintal": 2600,
        "delivery_window_start": "2025-02-10",
        "delivery_window_end": "2025-02-28",
        "district": "Nashik",
        "status": "open",
    },
]


def _seed_buyer_orders(db: Session):
    """Seed demo buyer orders if table is empty."""
    count = db.query(BuyerOrder).count()
    if count == 0:
        for order in DEMO_BUYER_ORDERS:
            db.add(BuyerOrder(
                buyer_name=order["buyer_name"],
                buyer_type=order["buyer_type"],
                crop=order["crop"],
                quantity_quintals=order["quantity_quintals"],
                grade=order["grade"],
                price_per_quintal=order["price_per_quintal"],
                delivery_window_start=date.fromisoformat(order["delivery_window_start"]),
                delivery_window_end=date.fromisoformat(order["delivery_window_end"]),
                district=order["district"],
                status=order["status"],
            ))
        db.commit()
        logger.info(f"Seeded {len(DEMO_BUYER_ORDERS)} demo buyer orders")


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/orders")
def list_buyer_orders(
    crop: Optional[str] = None,
    district: Optional[str] = None,
    status: str = "open",
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """List available buyer orders, optionally filtered by crop/district."""
    _seed_buyer_orders(db)

    query = db.query(BuyerOrder).filter(BuyerOrder.status == status)
    if crop:
        query = query.filter(BuyerOrder.crop.ilike(f"%{crop}%"))
    if district:
        query = query.filter(BuyerOrder.district.ilike(f"%{district}%"))

    orders = query.order_by(desc(BuyerOrder.price_per_quintal)).all()

    return {
        "total": len(orders),
        "orders": [
            {
                "id": o.id,
                "buyer_name": o.buyer_name,
                "buyer_type": o.buyer_type,
                "crop": o.crop,
                "quantity_quintals": o.quantity_quintals,
                "grade": o.grade,
                "price_per_quintal": o.price_per_quintal,
                "total_value": round(o.quantity_quintals * o.price_per_quintal, 2),
                "delivery_window": {
                    "start": o.delivery_window_start.isoformat() if o.delivery_window_start else None,
                    "end": o.delivery_window_end.isoformat() if o.delivery_window_end else None,
                },
                "district": o.district,
                "status": o.status,
            }
            for o in orders
        ],
    }


@router.post("/orders")
def create_buyer_order(
    payload: CreateBuyerOrderRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Create a new buyer order."""
    try:
        start = date.fromisoformat(payload.delivery_window_start)
        end = date.fromisoformat(payload.delivery_window_end)
    except ValueError:
        raise HTTPException(400, "Invalid date format.")

    order = BuyerOrder(
        buyer_name=payload.buyer_name,
        buyer_type=payload.buyer_type,
        crop=payload.crop,
        quantity_quintals=payload.quantity_quintals,
        grade=payload.grade,
        price_per_quintal=payload.price_per_quintal,
        delivery_window_start=start,
        delivery_window_end=end,
        district=payload.district,
        status="open",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    return {
        "order_id": order.id,
        "message": f"Order created for {payload.quantity_quintals}q {payload.crop} by {payload.buyer_name}",
    }


@router.post("/express-interest")
def express_interest(
    payload: ExpressInterestRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Farmer expresses interest in a buyer order."""
    ensure_user_access(current_user, payload.user_id)
    order = db.query(BuyerOrder).filter(BuyerOrder.id == payload.buyer_order_id).first()
    if not order:
        raise HTTPException(404, "Buyer order not found")
    if order.status != "open":
        raise HTTPException(400, f"Order is {order.status}, not accepting expressions.")

    # Check duplicate
    existing = (
        db.query(FarmerExpression)
        .filter(
            FarmerExpression.user_id == payload.user_id,
            FarmerExpression.buyer_order_id == payload.buyer_order_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(400, "You have already expressed interest in this order.")

    expression = FarmerExpression(
        user_id=payload.user_id,
        buyer_order_id=payload.buyer_order_id,
        quantity_offered=payload.quantity_offered,
        message=payload.message,
        status="pending",
    )
    db.add(expression)
    db.commit()
    db.refresh(expression)

    return {
        "expression_id": expression.id,
        "order_id": order.id,
        "buyer_name": order.buyer_name,
        "quantity_offered": payload.quantity_offered,
        "message": f"Interest registered! {order.buyer_name} ko notify kiya jayega.",
        "estimated_value": round(payload.quantity_offered * order.price_per_quintal, 2),
    }


@router.get("/my-expressions/{user_id}")
def get_my_expressions(
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get all expressions of interest by a farmer."""
    ensure_user_access(current_user, user_id)
    expressions = (
        db.query(FarmerExpression)
        .filter(FarmerExpression.user_id == user_id)
        .order_by(desc(FarmerExpression.created_at))
        .all()
    )

    results = []
    for e in expressions:
        order = db.query(BuyerOrder).filter(BuyerOrder.id == e.buyer_order_id).first()
        results.append({
            "expression_id": e.id,
            "order": {
                "id": order.id if order else None,
                "buyer_name": order.buyer_name if order else "Unknown",
                "crop": order.crop if order else "Unknown",
                "price_per_quintal": order.price_per_quintal if order else 0,
            },
            "quantity_offered": e.quantity_offered,
            "status": e.status,
            "estimated_value": round(
                e.quantity_offered * (order.price_per_quintal if order else 0), 2
            ),
        })

    return {
        "user_id": user_id,
        "total": len(results),
        "expressions": results,
    }


@router.get("/order/{order_id}/expressions")
def get_order_expressions(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_current_user),
) -> Dict[str, Any]:
    """Get all farmer expressions for a buyer order (buyer view)."""
    order = db.query(BuyerOrder).filter(BuyerOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    expressions = (
        db.query(FarmerExpression)
        .filter(FarmerExpression.buyer_order_id == order_id)
        .all()
    )

    # Get farmer names
    user_ids = [e.user_id for e in expressions]
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
    user_map = {u.id: u.full_name for u in users}

    results = []
    for e in expressions:
        results.append({
            "expression_id": e.id,
            "farmer_name": user_map.get(e.user_id, "Unknown"),
            "quantity_offered": e.quantity_offered,
            "message": e.message,
            "status": e.status,
        })

    total_offered = sum(e.quantity_offered for e in expressions)

    return {
        "order_id": order_id,
        "buyer_name": order.buyer_name,
        "required_quantity": order.quantity_quintals,
        "total_offered": total_offered,
        "fulfillment_pct": round((total_offered / order.quantity_quintals) * 100, 1) if order.quantity_quintals else 0,
        "expressions": results,
    }
