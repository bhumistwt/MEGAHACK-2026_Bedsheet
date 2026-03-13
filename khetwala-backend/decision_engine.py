from typing import Any, Dict, List


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


def _build_preservation_actions(risk_score: float) -> List[Dict[str, Any]]:
    rank_1_saves = int(_clamp(15 + risk_score * 30, 12, 45))
    rank_2_saves = int(_clamp(72 + risk_score * 22, 70, 90))
    rank_3_saves = int(_clamp(84 + risk_score * 14, 82, 96))

    return [
        {
            "rank": 1,
            "tag": "cheapest",
            "action": "Sell immediately at local market",
            "cost_inr_per_quintal": 0,
            "saves_percent": rank_1_saves,
        },
        {
            "rank": 2,
            "tag": "moderate",
            "action": "Move to cold storage",
            "cost_inr_per_quintal": 450,
            "saves_percent": rank_2_saves,
        },
        {
            "rank": 3,
            "tag": "best_outcome",
            "action": "Grade + warehouse storage",
            "cost_inr_per_quintal": 780,
            "saves_percent": rank_3_saves,
        },
    ]


def combine_model_outputs(
    price_trend: Dict[str, Any],
    harvest_window: Dict[str, Any],
    spoilage_risk: Dict[str, Any],
    features: Dict[str, Any],
) -> Dict[str, Any]:
    direction = str(price_trend.get("direction", "stable")).lower()
    spoilage_category = str(spoilage_risk.get("risk_category", "Medium")).lower()
    risk_score = float(spoilage_risk.get("risk_score", 0.5))
    extreme_weather = bool(features.get("extreme_weather_flag", False))

    action = str(harvest_window.get("recommendation", "harvest_now"))
    if extreme_weather:
        action = "sell_immediately"
    elif direction == "rising" and spoilage_category == "low":
        action = action if action.startswith("wait_") else "wait_3_days"
    elif direction == "falling" or spoilage_category in {"high", "critical"}:
        action = "sell_immediately"

    best_mandi_name = str(features.get("best_mandi_name", "Local Mandi"))
    best_mandi_price = float(features.get("best_mandi_price", 0.0))
    local_mandi_price = float(features.get("local_mandi_price", best_mandi_price))
    distance_km = float(features.get("estimated_distance_km", 28.0))
    transport_cost = float(features.get("transport_cost_estimate", 0.0))
    expected_price_range = price_trend.get(
        "expected_price_range",
        [round(best_mandi_price * 0.96, 3), round(best_mandi_price * 1.04, 3)],
    )

    price_diff_per_quintal = max(0.0, (best_mandi_price - local_mandi_price) * 100.0)
    best_mandi_far = distance_km > 95.0
    if best_mandi_far and transport_cost > price_diff_per_quintal:
        selected_market_name = "Local Mandi"
        selected_price_range = [
            round(local_mandi_price * 0.98, 3),
            round(local_mandi_price * 1.02, 3),
        ]
    else:
        selected_market_name = best_mandi_name
        selected_price_range = expected_price_range

    net_profit_comparison = {
        "best_mandi": round(float(features.get("net_profit_best_mandi", 0.0)), 3),
        "local_mandi": round(float(features.get("net_profit_local", 0.0)), 3),
    }

    price_conf = float(price_trend.get("confidence", 0.55))
    harvest_conf = float(harvest_window.get("confidence", 0.6))
    spoilage_conf = float(spoilage_risk.get("confidence", 0.62))
    overall_confidence = _clamp(
        (price_conf + harvest_conf + spoilage_conf) / 3.0,
        0.50,
        0.95,
    )

    return {
        "action": action,
        "best_mandi": {
            "name": selected_market_name,
            "expected_price_range": [round(float(v), 3) for v in selected_price_range],
        },
        "preservation_actions": _build_preservation_actions(risk_score=risk_score),
        "net_profit_comparison": net_profit_comparison,
        "overall_confidence": round(overall_confidence, 3),
    }
