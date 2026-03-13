"""Weather router — exposes weather data for frontend consumption."""

from typing import Any, Dict

from fastapi import APIRouter

from services.weather_service import fetch_weather_features, fetch_current_weather

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/current/{district}")
def get_current_weather(district: str) -> Dict[str, Any]:
    """Return real-time current weather for a district (Open-Meteo, no API key)."""
    return fetch_current_weather(district=district)


@router.get("/{district}")
def get_weather(district: str, state: str = "Maharashtra") -> Dict[str, Any]:
    """Return weather features for a district. Always succeeds (has built-in fallback)."""
    features = fetch_weather_features(district=district, state=state)

    # Also fetch current conditions
    current = fetch_current_weather(district=district)

    # Build frontend-friendly alert
    temp = float(features.get("avg_temp_next7days", 32))
    rain_3d = bool(features.get("rain_in_3days", False))
    extreme = bool(features.get("extreme_weather_flag", False))

    alerts = []
    if rain_3d:
        alerts.append({
            "type": "rain",
            "urgency": 1,
            "color": "red",
            "message": "कल बारिश आने वाली है! आज ही फसल काटें — खुले में रखी फसल खराब हो सकती है।",
        })
    if temp > 38:
        alerts.append({
            "type": "heat",
            "urgency": 2,
            "color": "orange",
            "message": f"तेज गर्मी ({round(temp)}°C) — आज stored फसल चेक करें। Spoilage risk बढ़ गया है।",
        })
    if extreme and not rain_3d and temp <= 38:
        alerts.append({
            "type": "extreme",
            "urgency": 2,
            "color": "orange",
            "message": "Extreme weather alert — फसल की सुरक्षा का ध्यान रखें।",
        })
    if not alerts:
        alerts.append({
            "type": "clear",
            "urgency": 10,
            "color": "green",
            "message": "अगले 5 दिन मौसम ठीक है। फसल के लिए सुरक्षित समय।",
        })

    return {
        "district": district,
        "state": state,
        "temp_min": features.get("temp_min"),
        "temp_max": features.get("temp_max"),
        "avg_temp": features.get("avg_temp_next7days"),
        "humidity": features.get("humidity"),
        "rainfall_mm": features.get("rainfall"),
        "rain_in_3days": rain_3d,
        "rain_in_7days": features.get("rain_in_7days"),
        "extreme_weather": extreme,
        "alerts": alerts,
        "source": features.get("source", "fallback"),
        "confidence": features.get("confidence", 0.58),
        "current": {
            "temp": current.get("temp"),
            "humidity": current.get("humidity"),
            "rain_mm": current.get("rain_mm", 0),
            "windspeed": current.get("windspeed", 0),
            "description": current.get("description", ""),
            "is_day": current.get("is_day", True),
        },
    }
