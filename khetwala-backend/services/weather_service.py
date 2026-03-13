import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests
from cachetools import TTLCache
from dotenv import load_dotenv

load_dotenv()

OPENWEATHER_5DAY_URL = "https://api.openweathermap.org/data/2.5/forecast"
# Open-Meteo — free, no API key required
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_CURRENT_URL = "https://api.open-meteo.com/v1/forecast"

WEATHER_CACHE = TTLCache(maxsize=256, ttl=6 * 60 * 60)
CURRENT_WEATHER_CACHE = TTLCache(maxsize=256, ttl=30 * 60)  # 30 min for current

DISTRICT_COORDINATES = {
    "nashik": {"lat": 20.011, "lon": 73.79},
    "pune": {"lat": 18.52, "lon": 73.8567},
    "aurangabad": {"lat": 19.8762, "lon": 75.3433},
    "nagpur": {"lat": 21.1458, "lon": 79.0882},
    "solapur": {"lat": 17.6599, "lon": 75.9064},
    "kolhapur": {"lat": 16.705, "lon": 74.2433},
    "amravati": {"lat": 20.9374, "lon": 77.7796},
    "jalgaon": {"lat": 21.012, "lon": 75.563},
    "sangli": {"lat": 16.854, "lon": 74.564},
    "ahmednagar": {"lat": 19.095, "lon": 74.749},
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _round(value: float) -> float:
    return round(float(value), 3)


def _fallback_weather_features(district: str, reason: str) -> Dict[str, Any]:
    profile_shift = {
        "nashik": -1.0,
        "pune": -0.5,
        "aurangabad": 1.2,
        "nagpur": 1.8,
        "solapur": 1.5,
        "kolhapur": -1.6,
        "amravati": 1.1,
    }
    shift = profile_shift.get(district.lower(), 0.0)
    avg_temp = 33.0 + shift
    humidity = 67.0 - shift * 1.5

    return {
        "temp_min": _round(avg_temp - 4.0),
        "temp_max": _round(avg_temp + 4.5),
        "humidity": _round(humidity),
        "rainfall": _round(4.0 + max(0.0, shift * 1.2)),
        "weather_alerts": [],
        "rain_in_3days": False,
        "rain_in_7days": True if shift > 1.2 else False,
        "avg_temp_next7days": _round(avg_temp),
        "humidity_index": _round(humidity),
        "extreme_weather_flag": True if avg_temp > 36 else False,
        "source": "fallback",
        "fallback_reason": reason,
        "confidence": 0.58,
    }


def _parse_weather_features(payload: Dict[str, Any]) -> Dict[str, Any]:
    rows = payload.get("list", [])
    if not rows:
        raise ValueError("OpenWeatherMap forecast response is empty.")

    now = datetime.now(timezone.utc)
    cutoff_3d = now + timedelta(days=3)
    cutoff_7d = now + timedelta(days=7)

    temp_min = 10_000.0
    temp_max = -10_000.0
    humidities: List[float] = []
    temps: List[float] = []
    rainfall_total = 0.0
    rainfall_3d = 0.0
    rainfall_7d = 0.0
    weather_alerts = set()

    severe_terms = {
        "thunderstorm",
        "squall",
        "tornado",
        "heavy rain",
        "extreme",
    }

    for row in rows:
        dt_utc = datetime.fromtimestamp(int(row.get("dt", 0)), tz=timezone.utc)
        main = row.get("main", {})
        weather_list = row.get("weather", []) or []
        rain_data = row.get("rain", {})

        t_min = _safe_float(main.get("temp_min"), 0.0)
        t_max = _safe_float(main.get("temp_max"), 0.0)
        humidity = _safe_float(main.get("humidity"), 0.0)
        rainfall = _safe_float(rain_data.get("3h", 0.0), 0.0)

        temp_min = min(temp_min, t_min)
        temp_max = max(temp_max, t_max)
        humidities.append(humidity)
        temps.append((t_min + t_max) / 2.0)
        rainfall_total += rainfall

        if dt_utc <= cutoff_3d:
            rainfall_3d += rainfall
        if dt_utc <= cutoff_7d:
            rainfall_7d += rainfall

        for entry in weather_list:
            tag = str(entry.get("main", "")).strip().lower()
            description = str(entry.get("description", "")).strip().lower()
            for term in severe_terms:
                if term in tag or term in description:
                    weather_alerts.add(term)

    if temp_min == 10_000.0:
        temp_min = 0.0
    if temp_max == -10_000.0:
        temp_max = 0.0

    humidity_index = sum(humidities) / max(1, len(humidities))
    avg_temp_7d = sum(temps) / max(1, len(temps))
    rain_in_3days = rainfall_3d >= 8.0
    rain_in_7days = rainfall_7d >= 14.0
    extreme_weather_flag = bool(
        avg_temp_7d >= 36.5
        or temp_max >= 40.0
        or humidity_index >= 86.0
        or weather_alerts
    )

    return {
        "temp_min": _round(temp_min),
        "temp_max": _round(temp_max),
        "humidity": _round(humidity_index),
        "rainfall": _round(rainfall_total),
        "weather_alerts": sorted(weather_alerts),
        "rain_in_3days": rain_in_3days,
        "rain_in_7days": rain_in_7days,
        "avg_temp_next7days": _round(avg_temp_7d),
        "humidity_index": _round(humidity_index),
        "extreme_weather_flag": extreme_weather_flag,
        "source": "openweathermap",
        "confidence": 0.84,
    }


def _fetch_open_meteo_forecast(lat: float, lon: float) -> Dict[str, Any]:
    """Fetch 7-day forecast from Open-Meteo (free, no API key)."""
    response = requests.get(
        OPEN_METEO_FORECAST_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
            "hourly": "relativehumidity_2m,windspeed_10m",
            "current_weather": "true",
            "timezone": "Asia/Kolkata",
            "forecast_days": 7,
        },
        timeout=8.0,
    )
    response.raise_for_status()
    data = response.json()

    daily = data.get("daily", {})
    current = data.get("current_weather", {})
    hourly = data.get("hourly", {})

    temps_max = [v for v in (daily.get("temperature_2m_max") or []) if v is not None]
    temps_min = [v for v in (daily.get("temperature_2m_min") or []) if v is not None]
    precip = [v for v in (daily.get("precipitation_sum") or []) if v is not None]
    wcodes = daily.get("weathercode") or []
    humidities_h = [v for v in (hourly.get("relativehumidity_2m") or []) if v is not None]

    temp_min = min(temps_min) if temps_min else 25.0
    temp_max = max(temps_max) if temps_max else 35.0
    rainfall_total = sum(precip)
    rainfall_3d = sum(precip[:3]) if len(precip) >= 3 else sum(precip)
    rainfall_7d = sum(precip[:7]) if len(precip) >= 7 else sum(precip)
    avg_temp_7d = (sum(temps_max) + sum(temps_min)) / (2.0 * max(1, len(temps_max)))
    humidity_avg = sum(humidities_h) / max(1, len(humidities_h)) if humidities_h else 60.0

    rain_in_3days = rainfall_3d >= 8.0
    rain_in_7days = rainfall_7d >= 14.0

    # WMO weather codes: 95-99 = thunderstorm, 65-67 = heavy rain, 71-77 = snow
    weather_alerts = set()
    severe_codes = {95, 96, 99, 65, 66, 67, 75, 77}
    for code in wcodes:
        if code in severe_codes:
            if code in (95, 96, 99):
                weather_alerts.add("thunderstorm")
            elif code in (65, 66, 67):
                weather_alerts.add("heavy rain")
            elif code in (75, 77):
                weather_alerts.add("heavy snow")

    extreme_weather_flag = bool(
        avg_temp_7d >= 36.5
        or temp_max >= 40.0
        or humidity_avg >= 86.0
        or weather_alerts
    )

    return {
        "temp_min": _round(temp_min),
        "temp_max": _round(temp_max),
        "humidity": _round(humidity_avg),
        "rainfall": _round(rainfall_total),
        "weather_alerts": sorted(weather_alerts),
        "rain_in_3days": rain_in_3days,
        "rain_in_7days": rain_in_7days,
        "avg_temp_next7days": _round(avg_temp_7d),
        "humidity_index": _round(humidity_avg),
        "extreme_weather_flag": extreme_weather_flag,
        "current_temp": _safe_float(current.get("temperature"), avg_temp_7d),
        "current_windspeed": _safe_float(current.get("windspeed"), 0.0),
        "current_weathercode": current.get("weathercode", 0),
        "source": "open-meteo",
        "confidence": 0.88,
    }


def _fetch_open_meteo_current(lat: float, lon: float) -> Dict[str, Any]:
    """Fetch current weather from Open-Meteo (free, no API key)."""
    response = requests.get(
        OPEN_METEO_CURRENT_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "current_weather": "true",
            "hourly": "relativehumidity_2m,precipitation",
            "timezone": "Asia/Kolkata",
            "forecast_days": 1,
        },
        timeout=8.0,
    )
    response.raise_for_status()
    data = response.json()

    current = data.get("current_weather", {})
    hourly = data.get("hourly", {})
    humidities = [v for v in (hourly.get("relativehumidity_2m") or []) if v is not None]
    precip = [v for v in (hourly.get("precipitation") or []) if v is not None]

    # Map WMO weather codes to human-readable descriptions
    wmo_descriptions = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
        95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
    }
    wcode = current.get("weathercode", 0)
    description = wmo_descriptions.get(wcode, "Unknown")

    return {
        "temp": _safe_float(current.get("temperature"), 30.0),
        "windspeed": _safe_float(current.get("windspeed"), 0.0),
        "wind_direction": _safe_float(current.get("winddirection"), 0.0),
        "weathercode": wcode,
        "description": description,
        "humidity": _round(sum(humidities) / max(1, len(humidities))) if humidities else 60.0,
        "rain_mm": _round(sum(precip)) if precip else 0.0,
        "is_day": current.get("is_day", 1) == 1,
        "source": "open-meteo",
        "timestamp": current.get("time", datetime.now(timezone.utc).isoformat()),
    }


def fetch_current_weather(district: str) -> Dict[str, Any]:
    """Fetch real-time current weather for a district. Always succeeds."""
    cache_key = f"current::{district.lower()}"
    if cache_key in CURRENT_WEATHER_CACHE:
        return CURRENT_WEATHER_CACHE[cache_key]

    coordinates = DISTRICT_COORDINATES.get(district.lower())
    if not coordinates:
        return {
            "temp": 32.0, "humidity": 60.0, "rain_mm": 0.0,
            "description": "Data unavailable", "windspeed": 0.0,
            "source": "fallback", "district": district,
        }

    try:
        result = _fetch_open_meteo_current(coordinates["lat"], coordinates["lon"])
        result["district"] = district
        CURRENT_WEATHER_CACHE[cache_key] = result
        return result
    except Exception as exc:
        return {
            "temp": 32.0, "humidity": 60.0, "rain_mm": 0.0,
            "description": "Data unavailable", "windspeed": 0.0,
            "source": "fallback", "error": str(exc), "district": district,
        }


def fetch_weather_features(district: str, state: str = "Maharashtra") -> Dict[str, Any]:
    cache_key = f"{state.lower()}::{district.lower()}"
    if cache_key in WEATHER_CACHE:
        return WEATHER_CACHE[cache_key]

    coordinates = DISTRICT_COORDINATES.get(district.lower())
    if not coordinates:
        features = _fallback_weather_features(
            district=district,
            reason="Unknown district coordinates. Using climatology fallback.",
        )
        WEATHER_CACHE[cache_key] = features
        return features

    # Primary: Open-Meteo (free, no API key required)
    try:
        parsed = _fetch_open_meteo_forecast(coordinates["lat"], coordinates["lon"])
        WEATHER_CACHE[cache_key] = parsed
        return parsed
    except Exception as meteo_exc:
        pass  # fall through to OpenWeatherMap

    # Secondary: OpenWeatherMap (requires API key)
    api_key = os.getenv("OPENWEATHER_API_KEY") or os.getenv("EXPO_PUBLIC_OPENWEATHER_API_KEY")
    if api_key and api_key not in ("your_openweather_key", "your_openweathermap_api_key_here"):
        try:
            response = requests.get(
                OPENWEATHER_5DAY_URL,
                params={
                    "lat": coordinates["lat"],
                    "lon": coordinates["lon"],
                    "appid": api_key,
                    "units": "metric",
                },
                timeout=4.0,
            )
            response.raise_for_status()
            parsed = _parse_weather_features(response.json())
            WEATHER_CACHE[cache_key] = parsed
            return parsed
        except Exception:
            pass

    # Final fallback: climatology
    fallback = _fallback_weather_features(district=district, reason=str(meteo_exc))
    WEATHER_CACHE[cache_key] = fallback
    return fallback
