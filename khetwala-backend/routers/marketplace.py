"""
[F11] Input Marketplace Router
═══════════════════════════════════════════════════════════════════════════════

AI-recommended input products (seeds, fertilizers, pesticides)
with local shop discovery. Recommends based on detected disease
or soil deficiency.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from db.models import InputProduct, LocalShop

logger = get_logger("khetwala.routers.marketplace")
router = APIRouter(prefix="/marketplace", tags=["marketplace"])


# ── Seed data (loaded on first request if DB empty) ──────────────────────

DEFAULT_PRODUCTS = [
    {"name": "Mancozeb 75% WP", "category": "fungicide", "brand": "Indofil",
     "price_inr": 340, "unit": "500g", "quantity_per_acre": 2.0,
     "target_diseases": "['early_blight', 'late_blight', 'leaf_spot']",
     "target_deficiencies": "[]",
     "description": "Broad-spectrum fungicide for blight and leaf spot diseases."},
    {"name": "Neem Oil Extract", "category": "organic_pesticide", "brand": "Godrej Agrovet",
     "price_inr": 120, "unit": "500ml", "quantity_per_acre": 1.0,
     "target_diseases": "['aphids', 'whitefly', 'mealybug']",
     "target_deficiencies": "[]",
     "description": "Organic pest control — safe for pollinators."},
    {"name": "DAP 18-46-0", "category": "fertilizer", "brand": "IFFCO",
     "price_inr": 1350, "unit": "50kg", "quantity_per_acre": 1.0,
     "target_diseases": "[]",
     "target_deficiencies": "['phosphorus', 'nitrogen']",
     "description": "Diammonium phosphate — basal fertilizer for most crops."},
    {"name": "Urea 46-0-0", "category": "fertilizer", "brand": "NFL",
     "price_inr": 267, "unit": "45kg", "quantity_per_acre": 1.0,
     "target_diseases": "[]",
     "target_deficiencies": "['nitrogen']",
     "description": "High-nitrogen fertilizer for vegetative growth."},
    {"name": "Potash MOP 0-0-60", "category": "fertilizer", "brand": "IPL",
     "price_inr": 900, "unit": "50kg", "quantity_per_acre": 0.5,
     "target_diseases": "[]",
     "target_deficiencies": "['potassium']",
     "description": "Muriate of Potash — improves crop quality and disease resistance."},
    {"name": "Carbendazim 50% WP", "category": "fungicide", "brand": "BASF",
     "price_inr": 220, "unit": "250g", "quantity_per_acre": 1.5,
     "target_diseases": "['wilt', 'root_rot', 'powdery_mildew']",
     "target_deficiencies": "[]",
     "description": "Systemic fungicide for soil-borne diseases."},
    {"name": "Imidacloprid 17.8% SL", "category": "insecticide", "brand": "Bayer",
     "price_inr": 450, "unit": "250ml", "quantity_per_acre": 1.0,
     "target_diseases": "['aphids', 'thrips', 'jassids']",
     "target_deficiencies": "[]",
     "description": "Systemic insecticide for sucking pests."},
    {"name": "Vermicompost", "category": "organic_fertilizer", "brand": "Local",
     "price_inr": 600, "unit": "50kg", "quantity_per_acre": 4.0,
     "target_diseases": "[]",
     "target_deficiencies": "['organic_carbon', 'nitrogen', 'phosphorus']",
     "description": "Organic manure — improves soil structure and microbial activity."},
    {"name": "Trichoderma Viride", "category": "bio_fungicide", "brand": "Multiplex",
     "price_inr": 180, "unit": "1kg", "quantity_per_acre": 2.0,
     "target_diseases": "['root_rot', 'wilt', 'damping_off']",
     "target_deficiencies": "[]",
     "description": "Bio-control agent — eco-friendly soil treatment."},
    {"name": "Micronutrient Mix", "category": "fertilizer", "brand": "Coromandel",
     "price_inr": 280, "unit": "1kg", "quantity_per_acre": 1.0,
     "target_diseases": "[]",
     "target_deficiencies": "['zinc', 'iron', 'boron', 'manganese']",
     "description": "Corrects micronutrient deficiencies — prevents yellowing and poor fruiting."},
]

DEFAULT_SHOPS = [
    {"name": "Krishi Seva Kendra", "district": "Nashik", "address": "Main Road, Nashik",
     "phone": "9876543210", "lat": 20.0, "lon": 73.78,
     "products_available": "['fungicide', 'fertilizer', 'insecticide']", "rating": 4.5},
    {"name": "Agro World", "district": "Nashik", "address": "Peth Road, Nashik",
     "phone": "9876543211", "lat": 20.01, "lon": 73.79,
     "products_available": "['organic_pesticide', 'bio_fungicide', 'organic_fertilizer']", "rating": 4.2},
    {"name": "Farmer's Choice", "district": "Pune", "address": "Shivaji Nagar, Pune",
     "phone": "9876543212", "lat": 18.53, "lon": 73.85,
     "products_available": "['fertilizer', 'fungicide', 'insecticide']", "rating": 4.0},
]


def _seed_products(db: Session):
    """Seed default products if table is empty."""
    count = db.query(InputProduct).count()
    if count == 0:
        for p in DEFAULT_PRODUCTS:
            db.add(InputProduct(**p))
        for s in DEFAULT_SHOPS:
            db.add(LocalShop(**s))
        db.commit()
        logger.info(f"Seeded {len(DEFAULT_PRODUCTS)} products and {len(DEFAULT_SHOPS)} shops")


# ── Schemas ──────────────────────────────────────────────────────────────

class SearchProductsRequest(BaseModel):
    disease: Optional[str] = None
    deficiency: Optional[str] = None
    category: Optional[str] = None  # fertilizer, fungicide, insecticide, etc.
    budget_max: Optional[float] = None
    district: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/products")
def list_products(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """List all available input products."""
    _seed_products(db)
    query = db.query(InputProduct)
    if category:
        query = query.filter(InputProduct.category.ilike(f"%{category}%"))
    products = query.all()

    return {
        "total": len(products),
        "products": [
            {
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "brand": p.brand,
                "price_inr": p.price_inr,
                "unit": p.unit,
                "quantity_per_acre": p.quantity_per_acre,
                "description": p.description,
            }
            for p in products
        ],
    }


@router.post("/recommend")
def recommend_products(
    payload: SearchProductsRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """AI-recommended products based on disease/deficiency detection."""
    _seed_products(db)

    products = db.query(InputProduct).all()
    recommendations = []

    for p in products:
        score = 0
        reasons = []

        # Match disease
        if payload.disease and payload.disease.lower() in (p.target_diseases or "").lower():
            score += 3
            reasons.append(f"Targets {payload.disease}")

        # Match deficiency
        if payload.deficiency and payload.deficiency.lower() in (p.target_deficiencies or "").lower():
            score += 3
            reasons.append(f"Corrects {payload.deficiency} deficiency")

        # Match category
        if payload.category and payload.category.lower() in (p.category or "").lower():
            score += 2
            reasons.append(f"Category match: {payload.category}")

        # Budget filter
        if payload.budget_max and p.price_inr > payload.budget_max:
            continue

        if score > 0:
            recommendations.append({
                "product": {
                    "id": p.id,
                    "name": p.name,
                    "category": p.category,
                    "brand": p.brand,
                    "price_inr": p.price_inr,
                    "unit": p.unit,
                    "quantity_per_acre": p.quantity_per_acre,
                    "description": p.description,
                },
                "relevance_score": score,
                "reasons": reasons,
                "cost_per_acre": round(p.price_inr * p.quantity_per_acre, 2),
            })

    recommendations.sort(key=lambda x: -x["relevance_score"])

    # Find nearby shops
    shops = []
    if payload.district:
        shops_query = (
            db.query(LocalShop)
            .filter(LocalShop.district.ilike(f"%{payload.district}%"))
            .order_by(LocalShop.rating.desc())
            .limit(5)
            .all()
        )
        shops = [
            {
                "id": s.id,
                "name": s.name,
                "address": s.address,
                "phone": s.phone,
                "rating": s.rating,
                "lat": s.lat,
                "lon": s.lon,
            }
            for s in shops_query
        ]

    return {
        "recommendations": recommendations[:5],
        "nearby_shops": shops,
        "search_criteria": {
            "disease": payload.disease,
            "deficiency": payload.deficiency,
            "category": payload.category,
            "budget_max": payload.budget_max,
        },
    }


@router.get("/shops/{district}")
def get_shops(
    district: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get local agri-input shops in a district."""
    _seed_products(db)
    shops = (
        db.query(LocalShop)
        .filter(LocalShop.district.ilike(f"%{district}%"))
        .order_by(LocalShop.rating.desc())
        .all()
    )

    return {
        "district": district,
        "total": len(shops),
        "shops": [
            {
                "id": s.id,
                "name": s.name,
                "address": s.address,
                "phone": s.phone,
                "rating": s.rating,
                "lat": s.lat,
                "lon": s.lon,
                "products": s.products_available,
            }
            for s in shops
        ],
    }
