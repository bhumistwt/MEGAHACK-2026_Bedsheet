"""
Khetwala Database Models
═══════════════════════════════════════════════════════════════════════════════

SQLAlchemy ORM models for all data entities.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, Float, String, DateTime, Date, Boolean, Text,
    Index, UniqueConstraint,
)
from sqlalchemy.orm import synonym

from db.session import Base


class MandiPrice(Base):
    """Historical mandi price records from Agmarknet."""
    __tablename__ = "mandi_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    commodity = Column(String(100), nullable=False, index=True)
    state = Column(String(100), nullable=False)
    district = Column(String(100), nullable=False, index=True)
    market = Column(String(200), nullable=False, index=True)
    variety = Column(String(100), nullable=True)
    arrival_date = Column(Date, nullable=False, index=True)
    min_price = Column(Float, nullable=True)
    max_price = Column(Float, nullable=True)
    modal_price = Column(Float, nullable=False)
    arrival_qty_tonnes = Column(Float, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("commodity", "market", "arrival_date", "variety",
                         name="uq_mandi_record"),
        Index("ix_mandi_crop_date", "commodity", "arrival_date"),
        Index("ix_mandi_district_date", "district", "arrival_date"),
    )


class WeatherRecord(Base):
    """Weather data from NASA POWER / OpenWeatherMap."""
    __tablename__ = "weather_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    district = Column(String(100), nullable=False, index=True)
    state = Column(String(100), nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    record_date = Column(Date, nullable=False, index=True)
    temp_min = Column(Float, nullable=True)
    temp_max = Column(Float, nullable=True)
    temp_avg = Column(Float, nullable=True)
    humidity = Column(Float, nullable=True)
    rainfall_mm = Column(Float, nullable=True)
    solar_radiation = Column(Float, nullable=True)
    wind_speed = Column(Float, nullable=True)
    source = Column(String(50), default="nasa_power")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("district", "record_date", "source", name="uq_weather_record"),
        Index("ix_weather_district_date", "district", "record_date"),
    )


class SoilProfile(Base):
    """Soil health data from Soil Health Card dataset."""
    __tablename__ = "soil_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    district = Column(String(100), nullable=False, index=True)
    state = Column(String(100), nullable=False)
    block = Column(String(100), nullable=True)
    soil_type = Column(String(100), nullable=True)
    ph = Column(Float, nullable=True)
    organic_carbon_pct = Column(Float, nullable=True)
    nitrogen_kg_ha = Column(Float, nullable=True)
    phosphorus_kg_ha = Column(Float, nullable=True)
    potassium_kg_ha = Column(Float, nullable=True)
    soil_quality_index = Column(Float, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_soil_district", "district", "state"),
    )


class NDVIRecord(Base):
    """NDVI vegetation index from Sentinel-2 satellite."""
    __tablename__ = "ndvi_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    district = Column(String(100), nullable=False, index=True)
    record_date = Column(Date, nullable=False, index=True)
    ndvi_value = Column(Float, nullable=False)
    ndvi_trend_30d = Column(Float, nullable=True)
    growth_plateau = Column(Boolean, default=False)
    source = Column(String(50), default="sentinel2")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_ndvi_district_date", "district", "record_date"),
    )


class CropMeta(Base):
    """Crop metadata — maturity, shelf life, FAO loss rates."""
    __tablename__ = "crop_meta"

    id = Column(Integer, primary_key=True, autoincrement=True)
    crop = Column(String(100), nullable=False, unique=True, index=True)
    maturity_days_min = Column(Integer, nullable=False)
    maturity_days_max = Column(Integer, nullable=False)
    shelf_life_days_open = Column(Integer, nullable=False)
    shelf_life_days_cold = Column(Integer, nullable=False)
    optimal_temp_min = Column(Float, nullable=True)
    optimal_temp_max = Column(Float, nullable=True)
    optimal_humidity_min = Column(Float, nullable=True)
    optimal_humidity_max = Column(Float, nullable=True)
    fao_post_harvest_loss_pct = Column(Float, nullable=True)
    base_price_per_quintal = Column(Float, nullable=True)
    category = Column(String(50), nullable=True)

    @property
    def shelf_life_days(self) -> int:
        return self.shelf_life_days_open

    @property
    def fao_loss_pct(self) -> float | None:
        return self.fao_post_harvest_loss_pct


class TransportRoute(Base):
    """Pre-computed transport routes between districts and mandis."""
    __tablename__ = "transport_routes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    origin_district = Column(String(100), nullable=False, index=True)
    destination_market = Column(String(200), nullable=False)
    distance_km = Column(Float, nullable=False)
    estimated_time_hours = Column(Float, nullable=True)
    road_quality = Column(String(50), nullable=True)
    fuel_cost_per_km = Column(Float, default=6.5)
    spoilage_rate_per_hour = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("origin_district", "destination_market",
                         name="uq_transport_route"),
    )

    origin = synonym("origin_district")
    destination = synonym("destination_market")
    typical_hours = synonym("estimated_time_hours")


class User(Base):
    """Registered users of Khetwala."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(15), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(200), nullable=False)
    email = Column(String(200), nullable=True)
    district = Column(String(100), nullable=True)
    state = Column(String(100), default="Maharashtra")
    main_crop = Column(String(100), nullable=True)
    farm_size_acres = Column(Float, nullable=True)
    soil_type = Column(String(100), nullable=True)
    language = Column(String(5), default="hi")
    is_active = Column(Boolean, default=True)
    total_harvests = Column(Integer, default=0)
    savings_estimate = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class PredictionLog(Base):
    """Audit log for all predictions served."""
    __tablename__ = "prediction_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    prediction_type = Column(String(50), nullable=False)
    crop = Column(String(100), nullable=False)
    district = Column(String(100), nullable=False)
    input_params = Column(Text, nullable=True)
    output_result = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    model_version = Column(String(50), nullable=True)
    data_sources_used = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AriaMemory(Base):
    __tablename__ = "aria_memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    memory_type = Column(String(30), nullable=False, index=True)
    memory_key = Column(String(200), nullable=False)
    memory_value = Column(Text, nullable=False)
    confidence = Column(Float, default=1.0)
    source = Column(String(50), default="conversation")
    last_referenced = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_aria_mem_user_type", "user_id", "memory_type"),
        UniqueConstraint("user_id", "memory_type", "memory_key", name="uq_aria_memory"),
    )


class AriaConversation(Base):
    __tablename__ = "aria_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    session_id = Column(String(64), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    emotion = Column(String(30), nullable=True)
    tool_calls = Column(Text, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_aria_conv_user_session", "user_id", "session_id"),
    )


class VoiceCallLog(Base):
    __tablename__ = "voice_call_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    call_sid = Column(String(128), nullable=False, unique=True, index=True)
    direction = Column(String(20), nullable=False, default="inbound")
    user_id = Column(Integer, nullable=True, index=True)
    phone = Column(String(20), nullable=False, index=True)
    language_code = Column(String(8), nullable=False, default="en")
    status = Column(String(30), nullable=False, default="initiated")
    feature_used = Column(String(80), nullable=True)
    escalated_to_human = Column(Boolean, default=False)
    escalation_reason = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_voice_call_user_status", "user_id", "status"),
        Index("ix_voice_call_phone_started", "phone", "started_at"),
    )


class VoiceCallTurnLog(Base):
    __tablename__ = "voice_call_turn_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    call_sid = Column(String(128), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    role = Column(String(20), nullable=False)
    transcript = Column(Text, nullable=False)
    language_code = Column(String(8), nullable=False, default="en")
    detected_intent = Column(String(80), nullable=True)
    action_taken = Column(Text, nullable=True)
    tool_payload = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_voice_turn_call_role", "call_sid", "role"),
        Index("ix_voice_turn_call_created", "call_sid", "created_at"),
    )


class CropSimulation(Base):
    __tablename__ = "crop_simulations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    crop = Column(String(100), nullable=False, index=True)
    district = Column(String(100), nullable=False)
    sowing_date = Column(Date, nullable=False)
    current_stage = Column(String(50), default="seedling")
    health_score = Column(Float, default=0.85)
    growth_day = Column(Integer, default=0)
    simulated_yield_kg = Column(Float, nullable=True)
    irrigation_log = Column(Text, nullable=True)
    weather_impact = Column(Text, nullable=True)
    whatif_results = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_sim_user_crop", "user_id", "crop"),
    )


class HarvestCycle(Base):
    __tablename__ = "harvest_cycles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    crop = Column(String(100), nullable=False)
    district = Column(String(100), nullable=False)
    sowing_date = Column(Date, nullable=True)
    harvest_date = Column(Date, nullable=False)
    sale_date = Column(Date, nullable=True)
    sale_mandi = Column(String(200), nullable=True)
    quantity_quintals = Column(Float, nullable=True)
    sale_price_per_quintal = Column(Float, nullable=True)
    total_revenue = Column(Float, nullable=True)
    optimal_harvest_date = Column(Date, nullable=True)
    optimal_price = Column(Float, nullable=True)
    loss_amount = Column(Float, nullable=True)
    loss_reason = Column(Text, nullable=True)
    lesson_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_harvest_user_crop", "user_id", "crop"),
    )


class CrowdOutcome(Base):
    __tablename__ = "crowd_outcomes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    district = Column(String(100), nullable=False, index=True)
    crop = Column(String(100), nullable=False, index=True)
    harvest_week = Column(String(10), nullable=False)
    sale_price_per_quintal = Column(Float, nullable=False)
    quantity_quintals = Column(Float, nullable=True)
    days_waited_after_ready = Column(Integer, nullable=True)
    outcome_label = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_crowd_district_crop_week", "district", "crop", "harvest_week"),
    )


class ChampionScore(Base):
    __tablename__ = "champion_scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    district = Column(String(100), nullable=False, index=True)
    month = Column(String(7), nullable=False)
    yield_accuracy_score = Column(Float, default=0.0)
    price_achievement_score = Column(Float, default=0.0)
    app_contribution_score = Column(Float, default=0.0)
    total_score = Column(Float, default=0.0)
    rank = Column(Integer, nullable=True)
    badge = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_champion_user_month"),
        Index("ix_champion_district_month", "district", "month"),
    )


class CropDiaryEntry(Base):
    __tablename__ = "crop_diary_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    crop = Column(String(100), nullable=True)
    entry_date = Column(Date, nullable=False, index=True)
    text_content = Column(Text, nullable=False)
    audio_uri = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)
    season = Column(String(20), nullable=True)
    sentiment = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_diary_user_date", "user_id", "entry_date"),
    )


class KrishiScore(Base):
    __tablename__ = "krishi_scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    score = Column(Integer, default=500)
    harvest_consistency = Column(Float, default=0.0)
    market_timing = Column(Float, default=0.0)
    soil_health_trend = Column(Float, default=0.0)
    yield_history = Column(Float, default=0.0)
    app_engagement = Column(Float, default=0.0)
    breakdown = Column(Text, nullable=True)
    computed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_krishi_user", "user_id"),
    )


class InputProduct(Base):
    __tablename__ = "input_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=False, index=True)
    brand = Column(String(100), nullable=True)
    price_inr = Column(Float, nullable=False)
    unit = Column(String(30), nullable=True)
    quantity_per_acre = Column(String(50), nullable=True)
    target_diseases = Column(Text, nullable=True)
    target_deficiencies = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class LocalShop(Base):
    __tablename__ = "local_shops"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    district = Column(String(100), nullable=False, index=True)
    address = Column(Text, nullable=True)
    phone = Column(String(15), nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    products_available = Column(Text, nullable=True)
    rating = Column(Float, default=4.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class BuyerOrder(Base):
    __tablename__ = "buyer_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    buyer_name = Column(String(200), nullable=False)
    buyer_type = Column(String(50), nullable=True)
    crop = Column(String(100), nullable=False, index=True)
    quantity_quintals = Column(Float, nullable=False)
    grade = Column(String(50), nullable=True)
    price_per_quintal = Column(Float, nullable=False)
    delivery_window_start = Column(Date, nullable=True)
    delivery_window_end = Column(Date, nullable=True)
    district = Column(String(100), nullable=True, index=True)
    status = Column(String(30), default="open")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_buyer_crop_status", "crop", "status"),
    )


class FarmerExpression(Base):
    __tablename__ = "farmer_expressions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    buyer_order_id = Column(Integer, nullable=False, index=True)
    quantity_offered = Column(Float, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String(30), default="pending")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("user_id", "buyer_order_id", name="uq_farmer_expression"),
    )


class StorageReading(Base):
    __tablename__ = "storage_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    device_id = Column(String(100), nullable=False, index=True)
    temperature = Column(Float, nullable=False)
    humidity = Column(Float, nullable=False)
    crop = Column(String(100), nullable=True)
    alert_triggered = Column(Boolean, default=False)
    reading_time = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_storage_user_device", "user_id", "device_id"),
    )


class ProofRecord(Base):
    __tablename__ = "proof_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    crop = Column(String(100), nullable=False)
    region = Column(String(100), nullable=False)
    input_hash = Column(String(66), nullable=False)
    output_hash = Column(String(66), nullable=False)
    model_version = Column(String(50), nullable=False)
    tx_hash = Column(String(66), nullable=True, unique=True)
    block_number = Column(Integer, nullable=True)
    status = Column(String(20), default="pending")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_proof_user_crop", "user_id", "crop"),
    )


class TradeRecord(Base):
    __tablename__ = "trade_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    seller_id = Column(Integer, nullable=False, index=True)
    buyer_id = Column(Integer, nullable=False, index=True)
    crop = Column(String(100), nullable=False)
    quantity_kg = Column(Float, nullable=False)
    price_per_kg = Column(Float, nullable=False)
    total_amount = Column(Float, nullable=False)
    quality_grade = Column(String(10), nullable=True)
    delivery_deadline = Column(DateTime, nullable=True)
    penalty_rate = Column(Float, default=0.0)
    status = Column(String(30), default="created")
    contract_trade_id = Column(Integer, nullable=True)
    tx_hash = Column(String(66), nullable=True)
    block_number = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_trade_seller_buyer", "seller_id", "buyer_id"),
    )


class SettlementRecord(Base):
    __tablename__ = "settlement_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_id = Column(Integer, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="INR")
    status = Column(String(30), default="pending")
    escrow_tx_hash = Column(String(66), nullable=True)
    release_tx_hash = Column(String(66), nullable=True)
    block_number = Column(Integer, nullable=True)
    penalty_amount = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_settlement_trade", "trade_id"),
    )


class DealConnectionRequest(Base):
    __tablename__ = "deal_connection_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    requester_id = Column(Integer, nullable=False, index=True)
    receiver_id = Column(Integer, nullable=False, index=True)
    trade_id = Column(Integer, nullable=True, index=True)
    status = Column(String(20), default="pending", index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    responded_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("requester_id", "receiver_id", "trade_id", name="uq_deal_connection_request"),
        Index("ix_deal_conn_request_users", "requester_id", "receiver_id"),
    )


class DealContact(Base):
    __tablename__ = "deal_contacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_a_id = Column(Integer, nullable=False, index=True)
    user_b_id = Column(Integer, nullable=False, index=True)
    created_from_request_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_deal_contact_pair"),
        Index("ix_deal_contact_pair", "user_a_id", "user_b_id"),
    )


class DealMessage(Base):
    __tablename__ = "deal_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_id = Column(Integer, nullable=False, index=True)
    sender_id = Column(Integer, nullable=False, index=True)
    receiver_id = Column(Integer, nullable=False, index=True)
    message_text = Column(Text, nullable=False)
    status = Column(String(20), default="sent", index=True)
    sent_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    delivered_at = Column(DateTime, nullable=True)
    read_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_deal_msg_trade_sent", "trade_id", "sent_at"),
        Index("ix_deal_msg_receiver_status", "receiver_id", "status"),
    )


class DealCallLog(Base):
    __tablename__ = "deal_call_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trade_id = Column(Integer, nullable=False, index=True)
    caller_id = Column(Integer, nullable=False, index=True)
    receiver_id = Column(Integer, nullable=False, index=True)
    call_type = Column(String(10), nullable=False, index=True)  # audio | video
    call_status = Column(String(20), default="initiated", index=True)
    room_id = Column(String(120), nullable=False, unique=True, index=True)
    room_url = Column(Text, nullable=False)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_deal_call_trade_started", "trade_id", "started_at"),
        Index("ix_deal_call_caller_receiver", "caller_id", "receiver_id"),
    )
