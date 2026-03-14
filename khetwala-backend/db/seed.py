"""
Khetwala-मित्र Database Seed Data
═══════════════════════════════════════════════════════════════════════════════

Seeds CropMeta, SoilProfile, and TransportRoute with baseline data
from FAO post-harvest loss studies, ICAR soil health surveys, and
known mandi locations.
"""

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session
from db.models import (
    CropMeta,
    DealCallLog,
    DealContact,
    DealMessage,
    SoilProfile,
    TradeRecord,
    TransportRoute,
    User,
)
from passlib.context import CryptContext
from core.logging import get_logger

logger = get_logger("khetwala.seed")

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ── Demo Users ───────────────────────────────────────────────────────────────

USER_SEED = [
    {
        "phone": "9876543001", "full_name": "Prem",
        "password": "prem123456",
        "district": "Nashik", "state": "Maharashtra",
        "main_crop": "onion", "farm_size_acres": 5.0,
        "soil_type": "black", "language": "hi",
    },
    {
        "phone": "9876543002", "full_name": "Bhumi",
        "password": "bhumi123456",
        "district": "Pune", "state": "Maharashtra",
        "main_crop": "tomato", "farm_size_acres": 3.5,
        "soil_type": "red", "language": "hi",
    },
    {
        "phone": "9876543003", "full_name": "Ashwin",
        "password": "ashwin123456",
        "district": "Nagpur", "state": "Maharashtra",
        "main_crop": "wheat", "farm_size_acres": 8.0,
        "soil_type": "alluvial", "language": "en",
    },
]

# ── FAO Post-Harvest Loss + Crop Parameters ─────────────────────────────────

CROP_META_SEED = [
    {
        "crop": "onion",
        "maturity_days_min": 110, "maturity_days_max": 140,
        "shelf_life_days_open": 21, "shelf_life_days_cold": 90,
        "optimal_temp_min": 0.0, "optimal_temp_max": 5.0,
        "optimal_humidity_min": 65.0, "optimal_humidity_max": 70.0,
        "fao_post_harvest_loss_pct": 15.2,
        "base_price_per_quintal": 2100.0, "category": "vegetable",
    },
    {
        "crop": "tomato",
        "maturity_days_min": 80, "maturity_days_max": 110,
        "shelf_life_days_open": 7, "shelf_life_days_cold": 28,
        "optimal_temp_min": 10.0, "optimal_temp_max": 15.0,
        "optimal_humidity_min": 85.0, "optimal_humidity_max": 95.0,
        "fao_post_harvest_loss_pct": 25.3,
        "base_price_per_quintal": 1800.0, "category": "vegetable",
    },
    {
        "crop": "wheat",
        "maturity_days_min": 110, "maturity_days_max": 130,
        "shelf_life_days_open": 180, "shelf_life_days_cold": 365,
        "optimal_temp_min": 10.0, "optimal_temp_max": 20.0,
        "optimal_humidity_min": 12.0, "optimal_humidity_max": 14.0,
        "fao_post_harvest_loss_pct": 6.8,
        "base_price_per_quintal": 2650.0, "category": "cereal",
    },
    {
        "crop": "rice",
        "maturity_days_min": 120, "maturity_days_max": 150,
        "shelf_life_days_open": 180, "shelf_life_days_cold": 365,
        "optimal_temp_min": 10.0, "optimal_temp_max": 20.0,
        "optimal_humidity_min": 12.0, "optimal_humidity_max": 14.0,
        "fao_post_harvest_loss_pct": 8.1,
        "base_price_per_quintal": 3100.0, "category": "cereal",
    },
    {
        "crop": "potato",
        "maturity_days_min": 75, "maturity_days_max": 120,
        "shelf_life_days_open": 14, "shelf_life_days_cold": 120,
        "optimal_temp_min": 4.0, "optimal_temp_max": 8.0,
        "optimal_humidity_min": 90.0, "optimal_humidity_max": 95.0,
        "fao_post_harvest_loss_pct": 18.6,
        "base_price_per_quintal": 1600.0, "category": "vegetable",
    },
    {
        "crop": "soybean",
        "maturity_days_min": 90, "maturity_days_max": 120,
        "shelf_life_days_open": 150, "shelf_life_days_cold": 365,
        "optimal_temp_min": 10.0, "optimal_temp_max": 15.0,
        "optimal_humidity_min": 10.0, "optimal_humidity_max": 14.0,
        "fao_post_harvest_loss_pct": 7.2,
        "base_price_per_quintal": 5200.0, "category": "oilseed",
    },
    {
        "crop": "cotton",
        "maturity_days_min": 150, "maturity_days_max": 180,
        "shelf_life_days_open": 365, "shelf_life_days_cold": 365,
        "optimal_temp_min": 15.0, "optimal_temp_max": 25.0,
        "optimal_humidity_min": 40.0, "optimal_humidity_max": 55.0,
        "fao_post_harvest_loss_pct": 4.5,
        "base_price_per_quintal": 6800.0, "category": "fiber",
    },
    {
        "crop": "grape",
        "maturity_days_min": 120, "maturity_days_max": 150,
        "shelf_life_days_open": 3, "shelf_life_days_cold": 21,
        "optimal_temp_min": 0.0, "optimal_temp_max": 2.0,
        "optimal_humidity_min": 90.0, "optimal_humidity_max": 95.0,
        "fao_post_harvest_loss_pct": 22.0,
        "base_price_per_quintal": 4500.0, "category": "fruit",
    },
    {
        "crop": "sugarcane",
        "maturity_days_min": 270, "maturity_days_max": 365,
        "shelf_life_days_open": 3, "shelf_life_days_cold": 14,
        "optimal_temp_min": 5.0, "optimal_temp_max": 10.0,
        "optimal_humidity_min": 80.0, "optimal_humidity_max": 90.0,
        "fao_post_harvest_loss_pct": 12.0,
        "base_price_per_quintal": 310.0, "category": "cash_crop",
    },
    {
        "crop": "banana",
        "maturity_days_min": 270, "maturity_days_max": 365,
        "shelf_life_days_open": 5, "shelf_life_days_cold": 21,
        "optimal_temp_min": 13.0, "optimal_temp_max": 15.0,
        "optimal_humidity_min": 85.0, "optimal_humidity_max": 95.0,
        "fao_post_harvest_loss_pct": 20.0,
        "base_price_per_quintal": 2200.0, "category": "fruit",
    },
]

# ── Soil Health Profiles (ICAR district averages, Maharashtra) ──────────────

SOIL_PROFILE_SEED = [
    {"district": "nashik", "state": "Maharashtra", "soil_type": "Medium Black",
     "ph": 7.8, "organic_carbon_pct": 0.52, "nitrogen_kg_ha": 210,
     "phosphorus_kg_ha": 18.5, "potassium_kg_ha": 320, "soil_quality_index": 0.61},
    {"district": "pune", "state": "Maharashtra", "soil_type": "Laterite",
     "ph": 6.5, "organic_carbon_pct": 0.65, "nitrogen_kg_ha": 245,
     "phosphorus_kg_ha": 22.0, "potassium_kg_ha": 280, "soil_quality_index": 0.68},
    {"district": "nagpur", "state": "Maharashtra", "soil_type": "Deep Black",
     "ph": 8.1, "organic_carbon_pct": 0.48, "nitrogen_kg_ha": 195,
     "phosphorus_kg_ha": 15.0, "potassium_kg_ha": 380, "soil_quality_index": 0.58},
    {"district": "aurangabad", "state": "Maharashtra", "soil_type": "Medium Black",
     "ph": 7.9, "organic_carbon_pct": 0.42, "nitrogen_kg_ha": 180,
     "phosphorus_kg_ha": 14.0, "potassium_kg_ha": 290, "soil_quality_index": 0.52},
    {"district": "solapur", "state": "Maharashtra", "soil_type": "Shallow Black",
     "ph": 8.3, "organic_carbon_pct": 0.38, "nitrogen_kg_ha": 165,
     "phosphorus_kg_ha": 12.0, "potassium_kg_ha": 340, "soil_quality_index": 0.45},
    {"district": "kolhapur", "state": "Maharashtra", "soil_type": "Laterite",
     "ph": 6.2, "organic_carbon_pct": 0.72, "nitrogen_kg_ha": 260,
     "phosphorus_kg_ha": 25.0, "potassium_kg_ha": 310, "soil_quality_index": 0.72},
    {"district": "amravati", "state": "Maharashtra", "soil_type": "Medium Black",
     "ph": 7.6, "organic_carbon_pct": 0.45, "nitrogen_kg_ha": 190,
     "phosphorus_kg_ha": 16.0, "potassium_kg_ha": 350, "soil_quality_index": 0.55},
    {"district": "jalgaon", "state": "Maharashtra", "soil_type": "Deep Black",
     "ph": 8.0, "organic_carbon_pct": 0.50, "nitrogen_kg_ha": 200,
     "phosphorus_kg_ha": 17.0, "potassium_kg_ha": 360, "soil_quality_index": 0.57},
    {"district": "sangli", "state": "Maharashtra", "soil_type": "Medium Black",
     "ph": 7.5, "organic_carbon_pct": 0.55, "nitrogen_kg_ha": 220,
     "phosphorus_kg_ha": 20.0, "potassium_kg_ha": 300, "soil_quality_index": 0.63},
    {"district": "ahmednagar", "state": "Maharashtra", "soil_type": "Shallow Black",
     "ph": 8.2, "organic_carbon_pct": 0.40, "nitrogen_kg_ha": 175,
     "phosphorus_kg_ha": 13.0, "potassium_kg_ha": 330, "soil_quality_index": 0.48},
]

# ── Transport Routes (major mandis from key districts) ──────────────────────

TRANSPORT_SEED = [
    # Nashik
    {"origin_district": "nashik", "destination_market": "Nashik Mandi", "distance_km": 12, "estimated_time_hours": 0.5, "road_quality": "good"},
    {"origin_district": "nashik", "destination_market": "Lasalgaon Mandi", "distance_km": 35, "estimated_time_hours": 1.0, "road_quality": "good"},
    {"origin_district": "nashik", "destination_market": "Pimpalgaon Mandi", "distance_km": 28, "estimated_time_hours": 0.8, "road_quality": "moderate"},
    {"origin_district": "nashik", "destination_market": "Mumbai APMC", "distance_km": 168, "estimated_time_hours": 4.5, "road_quality": "good"},
    {"origin_district": "nashik", "destination_market": "Pune Market Yard", "distance_km": 212, "estimated_time_hours": 5.0, "road_quality": "good"},
    # Pune
    {"origin_district": "pune", "destination_market": "Pune Market Yard", "distance_km": 8, "estimated_time_hours": 0.4, "road_quality": "good"},
    {"origin_district": "pune", "destination_market": "Mumbai APMC", "distance_km": 150, "estimated_time_hours": 3.5, "road_quality": "good"},
    {"origin_district": "pune", "destination_market": "Solapur Mandi", "distance_km": 252, "estimated_time_hours": 5.5, "road_quality": "moderate"},
    # Nagpur
    {"origin_district": "nagpur", "destination_market": "Nagpur Kalamna Mandi", "distance_km": 10, "estimated_time_hours": 0.4, "road_quality": "good"},
    {"origin_district": "nagpur", "destination_market": "Amravati Mandi", "distance_km": 155, "estimated_time_hours": 3.5, "road_quality": "moderate"},
    {"origin_district": "nagpur", "destination_market": "Akola Mandi", "distance_km": 250, "estimated_time_hours": 5.0, "road_quality": "moderate"},
    # Aurangabad
    {"origin_district": "aurangabad", "destination_market": "Aurangabad Mandi", "distance_km": 8, "estimated_time_hours": 0.3, "road_quality": "good"},
    {"origin_district": "aurangabad", "destination_market": "Pune Market Yard", "distance_km": 235, "estimated_time_hours": 5.0, "road_quality": "moderate"},
    # Solapur
    {"origin_district": "solapur", "destination_market": "Solapur Mandi", "distance_km": 6, "estimated_time_hours": 0.3, "road_quality": "good"},
    {"origin_district": "solapur", "destination_market": "Pune Market Yard", "distance_km": 252, "estimated_time_hours": 5.5, "road_quality": "moderate"},
    # Kolhapur
    {"origin_district": "kolhapur", "destination_market": "Kolhapur Mandi", "distance_km": 5, "estimated_time_hours": 0.2, "road_quality": "good"},
    {"origin_district": "kolhapur", "destination_market": "Pune Market Yard", "distance_km": 230, "estimated_time_hours": 5.0, "road_quality": "moderate"},
    # Amravati
    {"origin_district": "amravati", "destination_market": "Amravati Mandi", "distance_km": 8, "estimated_time_hours": 0.3, "road_quality": "good"},
    {"origin_district": "amravati", "destination_market": "Nagpur Kalamna Mandi", "distance_km": 155, "estimated_time_hours": 3.5, "road_quality": "moderate"},
]


def seed_crop_meta(db: Session) -> int:
    """Seed CropMeta table. Returns count of inserted rows."""
    count = 0
    for item in CROP_META_SEED:
        exists = db.query(CropMeta).filter(CropMeta.crop == item["crop"]).first()
        if not exists:
            db.add(CropMeta(**item))
            count += 1
    db.commit()
    logger.info(f"Seeded {count} crop metadata records")
    return count


def seed_soil_profiles(db: Session) -> int:
    """Seed SoilProfile table."""
    count = 0
    for item in SOIL_PROFILE_SEED:
        exists = db.query(SoilProfile).filter(
            SoilProfile.district == item["district"]
        ).first()
        if not exists:
            db.add(SoilProfile(**item))
            count += 1
    db.commit()
    logger.info(f"Seeded {count} soil profile records")
    return count


def seed_transport_routes(db: Session) -> int:
    """Seed TransportRoute table."""
    count = 0
    for item in TRANSPORT_SEED:
        item.setdefault("fuel_cost_per_km", 6.5)
        item.setdefault("spoilage_rate_per_hour", 0.3)
        exists = db.query(TransportRoute).filter(
            TransportRoute.origin_district == item["origin_district"],
            TransportRoute.destination_market == item["destination_market"],
        ).first()
        if not exists:
            db.add(TransportRoute(**item))
            count += 1
    db.commit()
    logger.info(f"Seeded {count} transport route records")
    return count


def seed_users(db: Session) -> int:
    """Seed demo user accounts: Prem, Bhumi, Ashwin."""
    count = 0
    for item in USER_SEED:
        exists = db.query(User).filter(User.phone == item["phone"]).first()
        if not exists:
            user_data = {k: v for k, v in item.items() if k != "password"}
            user_data["password_hash"] = pwd_context.hash(item["password"])
            db.add(User(**user_data))
            count += 1
    db.commit()
    logger.info(f"Seeded {count} demo user accounts")
    return count


def seed_demo_trades(db: Session) -> int:
    """Seed demo trade records so the deals dashboard has usable content."""
    users = {
        user.phone: user
        for user in db.query(User).filter(User.phone.in_([item["phone"] for item in USER_SEED])).all()
    }
    if len(users) < 3:
        logger.warning("Skipping trade seed because demo users are incomplete")
        return 0

    demo_trades = [
        {
            "seller_id": users["9876543001"].id,
            "buyer_id": users["9876543002"].id,
            "crop": "onion",
            "quantity_kg": 1200.0,
            "price_per_kg": 24.5,
            "quality_grade": "A",
            "status": "confirmed",
            "penalty_rate": 2.5,
            "delivery_deadline": datetime.now(timezone.utc) + timedelta(days=2),
        },
        {
            "seller_id": users["9876543003"].id,
            "buyer_id": users["9876543001"].id,
            "crop": "wheat",
            "quantity_kg": 2200.0,
            "price_per_kg": 28.0,
            "quality_grade": "B",
            "status": "created",
            "penalty_rate": 1.8,
            "delivery_deadline": datetime.now(timezone.utc) + timedelta(days=5),
        },
    ]

    inserted = 0
    for item in demo_trades:
        existing = db.query(TradeRecord).filter(
            TradeRecord.seller_id == item["seller_id"],
            TradeRecord.buyer_id == item["buyer_id"],
            TradeRecord.crop == item["crop"],
        ).first()
        if existing:
            continue

        total_amount = float(item["quantity_kg"]) * float(item["price_per_kg"])
        db.add(
            TradeRecord(
                seller_id=item["seller_id"],
                buyer_id=item["buyer_id"],
                crop=item["crop"],
                quantity_kg=item["quantity_kg"],
                price_per_kg=item["price_per_kg"],
                total_amount=total_amount,
                quality_grade=item["quality_grade"],
                status=item["status"],
                penalty_rate=item["penalty_rate"],
                delivery_deadline=item["delivery_deadline"],
            )
        )
        inserted += 1

    db.commit()
    logger.info(f"Seeded {inserted} demo trade records")
    return inserted


def seed_demo_communications(db: Session) -> int:
    """Seed one connected trade thread so chat/call actions can be demonstrated."""
    trade = db.query(TradeRecord).filter(
        TradeRecord.crop == "onion",
        TradeRecord.status == "confirmed",
    ).order_by(TradeRecord.id.asc()).first()

    if not trade:
        logger.warning("Skipping communication seed because no confirmed demo trade exists")
        return 0

    user_a_id, user_b_id = sorted([int(trade.seller_id), int(trade.buyer_id)])
    inserted = 0

    existing_contact = db.query(DealContact).filter(
        DealContact.user_a_id == user_a_id,
        DealContact.user_b_id == user_b_id,
    ).first()
    if not existing_contact:
        existing_contact = DealContact(user_a_id=user_a_id, user_b_id=user_b_id)
        db.add(existing_contact)
        db.flush()
        inserted += 1

    existing_message = db.query(DealMessage).filter(
        DealMessage.trade_id == trade.id,
        DealMessage.sender_id == trade.seller_id,
        DealMessage.receiver_id == trade.buyer_id,
    ).first()
    if not existing_message:
        db.add(
            DealMessage(
                trade_id=trade.id,
                sender_id=trade.seller_id,
                receiver_id=trade.buyer_id,
                message_text="Crop is sorted and packing is done. We can confirm dispatch today.",
                status="read",
                delivered_at=datetime.now(timezone.utc),
                read_at=datetime.now(timezone.utc),
            )
        )
        inserted += 1

    existing_call = db.query(DealCallLog).filter(
        DealCallLog.trade_id == trade.id,
        DealCallLog.caller_id == trade.seller_id,
        DealCallLog.receiver_id == trade.buyer_id,
    ).first()
    if not existing_call:
        started_at = datetime.now(timezone.utc) - timedelta(minutes=18)
        db.add(
            DealCallLog(
                trade_id=trade.id,
                caller_id=trade.seller_id,
                receiver_id=trade.buyer_id,
                call_type="audio",
                call_status="ended",
                room_id=f"demo-trade-{trade.id}-audio",
                room_url=f"https://meet.jit.si/demo-trade-{trade.id}-audio",
                started_at=started_at,
                ended_at=started_at + timedelta(minutes=4),
                duration_seconds=240,
            )
        )
        inserted += 1

    db.commit()
    logger.info(f"Seeded {inserted} demo communication records")
    return inserted


def run_all_seeds(db: Session) -> dict:
    """Run all seed operations."""
    results = {
        "users": seed_users(db),
        "trades": seed_demo_trades(db),
        "communications": seed_demo_communications(db),
        "crop_meta": seed_crop_meta(db),
        "soil_profiles": seed_soil_profiles(db),
        "transport_routes": seed_transport_routes(db),
    }
    logger.info("Database seeding complete", **results)
    return results
