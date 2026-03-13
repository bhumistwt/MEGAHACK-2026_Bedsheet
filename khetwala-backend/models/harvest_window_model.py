from datetime import date, datetime, timedelta
from typing import Any, Dict


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


class HarvestWindowModel:
    """Blended rule + model confidence logic for harvest timing."""

    CROP_MATURITY_DAYS = {
        "onion": 125,
        "tomato": 95,
        "wheat": 120,
        "rice": 135,
        "potato": 105,
        "soybean": 110,
    }

    def _parse_sowing_date(self, sowing_date: str) -> date:
        if not sowing_date:
            return date.today() - timedelta(days=100)
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y"):
            try:
                return datetime.strptime(str(sowing_date), fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(str(sowing_date)).date()
        except ValueError:
            return date.today() - timedelta(days=100)

    def predict(
        self,
        crop_type: str,
        crop_stage: str,
        sowing_date: str,
        weather_features: Dict[str, Any],
        price_trend: Dict[str, Any],
        spoilage_risk: Dict[str, Any],
    ) -> Dict[str, Any]:
        crop_key = crop_type.strip().lower()
        crop_stage_key = crop_stage.strip().lower()
        sow_date = self._parse_sowing_date(sowing_date)
        maturity_days = self.CROP_MATURITY_DAYS.get(crop_key, 110)

        today = date.today()
        harvest_base_date = sow_date + timedelta(days=maturity_days)
        window_start = harvest_base_date - timedelta(days=2)
        window_end = harvest_base_date + timedelta(days=2)

        rain_in_3days = bool(weather_features.get("rain_in_3days", False))
        extreme_weather_flag = bool(weather_features.get("extreme_weather_flag", False))
        trend_direction = str(price_trend.get("direction", "stable")).lower()
        spoilage_category = str(spoilage_risk.get("risk_category", "Medium")).lower()

        recommendation = "harvest_now"
        risk_if_delayed = (
            "Delaying harvest can reduce quality and market value under current conditions."
        )

        if extreme_weather_flag:
            recommendation = "harvest_now"
            window_start = today
            window_end = today
            risk_if_delayed = (
                "Extreme weather risk detected. Delay can trigger sudden field loss."
            )
        elif rain_in_3days and crop_stage_key == "harvest-ready":
            recommendation = "harvest_now"
            window_start = today
            window_end = today + timedelta(days=1)
            risk_if_delayed = (
                "Rain expected in 3 days. Waiting may increase fungal and moisture damage."
            )
        elif trend_direction == "falling":
            recommendation = "harvest_now"
            window_start = today
            window_end = today + timedelta(days=1)
            risk_if_delayed = (
                "Prices are falling. Delaying harvest can reduce realized selling price."
            )
        elif trend_direction == "rising" and spoilage_category == "low":
            wait_days = 5
            recommendation = f"wait_{wait_days}_days"
            window_start = today + timedelta(days=wait_days - 1)
            window_end = today + timedelta(days=wait_days + 1)
            risk_if_delayed = (
                "Limited spoilage risk and rising prices suggest waiting can improve returns."
            )
        else:
            wait_days = 2
            recommendation = f"wait_{wait_days}_days"
            window_start = max(today, harvest_base_date - timedelta(days=1))
            window_end = window_start + timedelta(days=2)
            risk_if_delayed = (
                "Moderate uncertainty. A short wait window is safer than a long delay."
            )

        price_conf = float(price_trend.get("confidence", 0.55))
        spoilage_conf = float(spoilage_risk.get("confidence", 0.62))
        confidence = (price_conf * 0.45) + (spoilage_conf * 0.35) + 0.2

        if recommendation == "harvest_now":
            confidence += 0.06
        if crop_stage_key not in {"harvest-ready", "ready", "mature"}:
            confidence -= 0.08

        confidence = round(_clamp(confidence, 0.52, 0.94), 3)

        return {
            "harvest_window_start": window_start.isoformat(),
            "harvest_window_end": window_end.isoformat(),
            "recommendation": recommendation,
            "risk_if_delayed": risk_if_delayed,
            "confidence": confidence,
        }
