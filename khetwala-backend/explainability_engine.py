from typing import Any, Dict


def generate_explanation(
    decision: Dict[str, Any],
    features: Dict[str, Any],
    price_trend: Dict[str, Any],
    spoilage_risk: Dict[str, Any],
) -> Dict[str, str]:
    crop = str(features.get("crop", "this crop"))
    rain_in_3days = bool(features.get("rain_in_3days", False))
    avg_temp = float(features.get("avg_temp", 30.0))
    direction = str(price_trend.get("direction", "stable")).lower()
    arrival_pressure = str(features.get("arrival_pressure", "normal")).lower()

    if rain_in_3days:
        weather_reason = (
            "Heavy rain expected in 3 days. Harvesting early prevents crop damage."
        )
    elif avg_temp > 35.0:
        weather_reason = "High temperatures will increase spoilage risk rapidly."
    else:
        weather_reason = "Weather is stable for the next 7 days. Safe window."

    if direction == "rising":
        market_reason = (
            f"Mandi prices for {crop} have been rising for 7 days. "
            "Waiting may get you better rates."
        )
    elif direction == "falling":
        market_reason = (
            "Prices are dropping. Selling soon locks in better value."
        )
    elif arrival_pressure == "high":
        market_reason = (
            "Many farmers in your area are selling this week. "
            "Prices may fall due to oversupply."
        )
    else:
        market_reason = (
            "Prices are currently stable. A short wait or quick sale both remain viable."
        )

    if arrival_pressure == "high":
        supply_reason = (
            "High supply from nearby districts may reduce prices by 15–20%."
        )
    elif arrival_pressure == "low":
        supply_reason = (
            "Less competition in market this week. Good time to sell."
        )
    else:
        supply_reason = (
            "Supply levels are normal, so price swings from arrivals are limited."
        )

    confidence = float(decision.get("overall_confidence", spoilage_risk.get("confidence", 0.55)))
    if confidence > 0.75:
        confidence_message = "High confidence based on recent data."
    elif confidence > 0.55:
        confidence_message = "Medium confidence. Limited mandi data for your district."
    else:
        confidence_message = "Low confidence. Using regional averages as fallback."

    return {
        "weather_reason": weather_reason,
        "market_reason": market_reason,
        "supply_reason": supply_reason,
        "confidence_message": confidence_message,
    }
