from typing import Any, Dict

from services.mandi_service import fetch_mandi_features
from services.weather_service import fetch_weather_features

SHELF_LIFE_DAYS = {
    "onion": 30,
    "tomato": 7,
    "wheat": 180,
    "rice": 180,
    "potato": 60,
}

CROP_MATURITY_DAYS = {
    "onion": 125,
    "tomato": 95,
    "wheat": 120,
    "rice": 135,
    "potato": 105,
    "soybean": 110,
}

SPOILAGE_SUSCEPTIBILITY = {
    "onion": "medium",
    "tomato": "high",
    "wheat": "low",
    "rice": "low",
    "potato": "medium",
    "soybean": "medium",
}


def _normalize_crop_key(crop: str) -> str:
    return crop.strip().lower()


def _round(value: float) -> float:
    return round(float(value), 3)


def build_features(
    crop: str,
    district: str,
    storage_type: str,
    transit_hours: float,
    days_since_harvest: int,
    crop_stage: str,
    state: str = "Maharashtra",
    quantity_quintals: float = 10.0,
) -> Dict[str, Any]:
    crop_key = _normalize_crop_key(crop)
    safe_transit = max(1.0, min(48.0, float(transit_hours)))
    safe_days_since_harvest = max(0, int(days_since_harvest))
    safe_qty_quintals = max(0.1, float(quantity_quintals))

    weather_raw = fetch_weather_features(district=district, state=state)
    mandi_raw = fetch_mandi_features(crop=crop, state=state, district=district)

    avg_temp = float(weather_raw.get("avg_temp_next7days", 32.0))
    humidity_index = float(weather_raw.get("humidity_index", 65.0))
    extreme_weather_flag = bool(weather_raw.get("extreme_weather_flag", False))

    best_mandi_price = float(mandi_raw.get("best_mandi_price", 0.0))
    local_mandi_price = float(mandi_raw.get("local_mandi_price", best_mandi_price))
    transport_cost_estimate = float(mandi_raw.get("transport_cost_estimate", 220.0))
    distance_km = float(mandi_raw.get("estimated_distance_km", 28.0))

    transit_factor = 1.0 + max(0.0, safe_transit - 12.0) * 0.01
    transport_cost_estimate = _round(transport_cost_estimate * transit_factor)

    quantity_kg = safe_qty_quintals * 100.0
    gross_best = best_mandi_price * quantity_kg
    gross_local = local_mandi_price * quantity_kg
    net_profit_best = _round(gross_best - transport_cost_estimate * safe_qty_quintals)
    net_profit_local = _round(gross_local)

    shelf_life_for_crop = SHELF_LIFE_DAYS.get(crop_key, 30)
    maturity_days_for_crop = CROP_MATURITY_DAYS.get(crop_key, 110)
    susceptibility = SPOILAGE_SUSCEPTIBILITY.get(crop_key, "medium")

    if susceptibility == "high":
        optimal_harvest_window_days = 2
    elif susceptibility == "low":
        optimal_harvest_window_days = 6
    else:
        optimal_harvest_window_days = 4

    weather_features = {
        "rain_in_3days": bool(weather_raw.get("rain_in_3days", False)),
        "rain_in_7days": bool(weather_raw.get("rain_in_7days", False)),
        "avg_temp": _round(avg_temp),
        "humidity_index": _round(humidity_index),
        "extreme_weather_flag": extreme_weather_flag,
    }

    market_features = {
        "price_momentum": str(mandi_raw.get("price_momentum", "stable")),
        "price_7d_avg": _round(float(mandi_raw.get("price_7day_moving_avg", 0.0))),
        "price_14d_avg": _round(float(mandi_raw.get("price_14day_moving_avg", 0.0))),
        "price_21d_avg": _round(float(mandi_raw.get("price_21day_moving_avg", 0.0))),
        "arrival_pressure": str(mandi_raw.get("arrival_pressure", "normal")),
        "best_mandi_name": str(mandi_raw.get("best_mandi_name", f"{district} Mandi")),
        "best_mandi_price": _round(best_mandi_price),
        "local_mandi_price": _round(local_mandi_price),
        "regional_price_spread": _round(float(mandi_raw.get("regional_price_spread", 0.0))),
        "transport_cost_estimate": _round(transport_cost_estimate),
        "estimated_distance_km": _round(distance_km),
        "net_profit_best_mandi": net_profit_best,
        "net_profit_local": net_profit_local,
    }

    crop_features = {
        "shelf_life_days": SHELF_LIFE_DAYS,
        "shelf_life_crop_days": shelf_life_for_crop,
        "spoilage_susceptibility": susceptibility,
        "crop_maturity_days": CROP_MATURITY_DAYS,
        "crop_maturity_for_crop": maturity_days_for_crop,
        "optimal_harvest_window_days": optimal_harvest_window_days,
    }

    weather_confidence = float(weather_raw.get("confidence", 0.58))
    mandi_confidence = float(mandi_raw.get("confidence", 0.56))
    data_confidence = _round((weather_confidence + mandi_confidence) / 2.0)

    return {
        "crop": crop,
        "district": district,
        "state": state,
        "storage_type": storage_type,
        "transit_hours": safe_transit,
        "days_since_harvest": safe_days_since_harvest,
        "crop_stage": crop_stage,
        "quantity_quintals": safe_qty_quintals,
        "data_confidence": data_confidence,
        "weather_source": weather_raw.get("source", "fallback"),
        "mandi_source": mandi_raw.get("source", "fallback"),
        "weather_features": weather_features,
        "market_features": market_features,
        "crop_features": crop_features,
        **weather_features,
        **market_features,
        **{
            "shelf_life_crop_days": shelf_life_for_crop,
            "spoilage_susceptibility": susceptibility,
            "crop_maturity_for_crop": maturity_days_for_crop,
            "optimal_harvest_window_days": optimal_harvest_window_days,
        },
    }
