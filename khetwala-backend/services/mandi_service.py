import math
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from cachetools import TTLCache
from dotenv import load_dotenv

load_dotenv()

AGMARKNET_URL = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"
MANDI_CACHE = TTLCache(maxsize=256, ttl=6 * 60 * 60)

DISTRICT_COORDINATES = {
    "nashik": {"lat": 20.011, "lon": 73.79},
    "pune": {"lat": 18.52, "lon": 73.8567},
    "aurangabad": {"lat": 19.8762, "lon": 75.3433},
    "nagpur": {"lat": 21.1458, "lon": 79.0882},
    "solapur": {"lat": 17.6599, "lon": 75.9064},
    "kolhapur": {"lat": 16.705, "lon": 74.2433},
    "amravati": {"lat": 20.9374, "lon": 77.7796},
}

CROP_BASE_PRICE = {
    "onion": 2100.0,
    "tomato": 1800.0,
    "wheat": 2650.0,
    "rice": 3100.0,
    "potato": 1600.0,
    "soybean": 5200.0,
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _parse_date(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    text = str(value).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _moving_average(values: List[float], window: int) -> float:
    if not values:
        return 0.0
    limit = min(len(values), window)
    subset = values[:limit]
    return round(sum(subset) / max(1, len(subset)), 3)


def _classify_momentum(today: float, past: float) -> str:
    if past <= 0:
        return "stable"
    pct_change = (today - past) / past
    if pct_change > 0.03:
        return "rising"
    if pct_change < -0.03:
        return "falling"
    return "stable"


def _classify_arrival_pressure(today_arrival: float, average_arrival: float) -> str:
    if average_arrival <= 0:
        return "normal"
    ratio = today_arrival / average_arrival
    if ratio > 1.2:
        return "high"
    if ratio < 0.8:
        return "low"
    return "normal"


def _infer_market_district(market_name: str) -> Optional[str]:
    text = market_name.lower()
    for district in DISTRICT_COORDINATES:
        if district in text:
            return district
    return None


def _distance_km(point_a: Dict[str, float], point_b: Dict[str, float]) -> float:
    lat1 = math.radians(point_a["lat"])
    lon1 = math.radians(point_a["lon"])
    lat2 = math.radians(point_b["lat"])
    lon2 = math.radians(point_b["lon"])

    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return 6371.0 * c


def _estimate_distance(district: str, market_name: str) -> float:
    district_key = district.lower()
    base = DISTRICT_COORDINATES.get(district_key)
    if not base:
        return 42.0

    target_district = _infer_market_district(market_name) or district_key
    target = DISTRICT_COORDINATES.get(target_district)
    if not target:
        return 42.0
    if target_district == district_key:
        return 28.0
    return round(min(260.0, max(28.0, _distance_km(base, target))), 3)


def _fallback_mandi_features(crop: str, district: str, reason: str) -> Dict[str, Any]:
    base = CROP_BASE_PRICE.get(crop.lower(), 2200.0)
    best_price = round(base * 1.06, 3)
    local_price = round(base * 0.98, 3)
    spread = round(best_price - local_price, 3)

    return {
        "price_7day_moving_avg": round(base, 3),
        "price_14day_moving_avg": round(base * 0.99, 3),
        "price_21day_moving_avg": round(base * 0.985, 3),
        "price_momentum": "stable",
        "arrival_pressure": "normal",
        "regional_price_spread": spread,
        "best_mandi_name": f"{district} Mandi",
        "best_mandi_price": best_price,
        "local_mandi_price": local_price,
        "transport_cost_estimate": 220.0,
        "estimated_distance_km": 28.0,
        "source": "fallback",
        "fallback_reason": reason,
        "confidence": 0.56,
    }


def _parse_and_aggregate(records: List[Dict[str, Any]], district: str) -> Dict[str, Any]:
    parsed_rows: List[Dict[str, Any]] = []
    for row in records:
        modal_price = _safe_float(row.get("modal_price"), 0.0)
        if modal_price <= 0:
            continue
        parsed_rows.append(
            {
                "market": str(row.get("market", district)).strip() or district,
                "arrival_date": _parse_date(row.get("arrival_date")),
                "modal_price": modal_price,
                "arrivals": _safe_float(row.get("arrivals"), 0.0),
            }
        )

    if not parsed_rows:
        raise ValueError("No usable mandi records after parsing.")

    parsed_rows.sort(
        key=lambda item: item["arrival_date"] or datetime.min,
        reverse=True,
    )

    modal_prices = [row["modal_price"] for row in parsed_rows]
    today_price = modal_prices[0]
    past_price = modal_prices[7] if len(modal_prices) > 7 else modal_prices[-1]
    price_momentum = _classify_momentum(today_price, past_price)

    arrivals = [row["arrivals"] for row in parsed_rows if row["arrivals"] > 0]
    today_arrival = arrivals[0] if arrivals else 0.0
    avg_arrival = sum(arrivals) / max(1, len(arrivals))
    arrival_pressure = _classify_arrival_pressure(today_arrival, avg_arrival)

    best_mandi_row = max(parsed_rows, key=lambda item: item["modal_price"])
    local_mandi_row = next(
        (row for row in parsed_rows if district.lower() in row["market"].lower()),
        parsed_rows[0],
    )

    regional_price_spread = round(max(modal_prices) - min(modal_prices), 3)
    distance_km = _estimate_distance(district=district, market_name=best_mandi_row["market"])
    transport_cost_estimate = round(distance_km * 6.2, 3)

    return {
        "price_7day_moving_avg": _moving_average(modal_prices, 7),
        "price_14day_moving_avg": _moving_average(modal_prices, 14),
        "price_21day_moving_avg": _moving_average(modal_prices, 21),
        "price_momentum": price_momentum,
        "arrival_pressure": arrival_pressure,
        "regional_price_spread": regional_price_spread,
        "best_mandi_name": best_mandi_row["market"],
        "best_mandi_price": round(best_mandi_row["modal_price"], 3),
        "local_mandi_price": round(local_mandi_row["modal_price"], 3),
        "transport_cost_estimate": transport_cost_estimate,
        "estimated_distance_km": distance_km,
        "source": "agmarknet",
        "confidence": 0.83 if len(parsed_rows) >= 10 else 0.68,
    }


def fetch_mandi_features(crop: str, state: str, district: str) -> Dict[str, Any]:
    cache_key = f"{state.lower()}::{district.lower()}::{crop.lower()}"
    if cache_key in MANDI_CACHE:
        return MANDI_CACHE[cache_key]

    api_key = os.getenv("DATAGOV_API_KEY") or os.getenv("EXPO_PUBLIC_DATA_GOV_API_KEY")
    if not api_key:
        features = _fallback_mandi_features(
            crop=crop,
            district=district,
            reason="DATAGOV_API_KEY not set.",
        )
        MANDI_CACHE[cache_key] = features
        return features

    try:
        response = requests.get(
            AGMARKNET_URL,
            params={
                "api-key": api_key,
                "format": "json",
                "limit": 120,
                "filters[state]": state,
                "filters[district]": district,
                "filters[commodity]": crop,
                "sort[arrival_date]": "desc",
            },
            timeout=4.0,
        )
        response.raise_for_status()
        records = response.json().get("records", [])
        aggregated = _parse_and_aggregate(records=records, district=district)
        MANDI_CACHE[cache_key] = aggregated
        return aggregated
    except Exception as exc:
        fallback = _fallback_mandi_features(crop=crop, district=district, reason=str(exc))
        MANDI_CACHE[cache_key] = fallback
        return fallback
