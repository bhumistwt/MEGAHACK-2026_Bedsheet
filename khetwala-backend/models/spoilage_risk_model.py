from typing import Any, Dict, List


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


class SpoilageRiskModel:
    """Rule-based realistic spoilage risk model."""

    STORAGE_BASE_RISK = {
        "open_field": 0.70,
        "warehouse": 0.40,
        "cold_storage": 0.15,
    }

    CROP_DECAY_RATE = {
        "onion": 0.008,
        "tomato": 0.040,
        "wheat": 0.0015,
        "rice": 0.0015,
        "potato": 0.010,
        "soybean": 0.0045,
    }

    SHELF_LIFE_DAYS = {
        "onion": 30,
        "tomato": 7,
        "wheat": 180,
        "rice": 180,
        "potato": 60,
        "soybean": 45,
    }

    def _normalize_storage_type(self, storage_type: str) -> str:
        key = storage_type.strip().lower().replace(" ", "_")
        if key not in self.STORAGE_BASE_RISK:
            return "warehouse"
        return key

    def _normalize_crop(self, crop: str) -> str:
        key = crop.strip().lower()
        return key if key in self.CROP_DECAY_RATE else "onion"

    def _risk_category(self, risk_score: float) -> str:
        if risk_score <= 0.30:
            return "Low"
        if risk_score <= 0.60:
            return "Medium"
        if risk_score <= 0.80:
            return "High"
        return "Critical"

    def predict(
        self,
        crop: str,
        storage_type: str,
        transit_hours: float,
        days_since_harvest: int,
        avg_temp: float,
        humidity_index: float,
        rain_in_3days: bool,
    ) -> Dict[str, Any]:
        crop_key = self._normalize_crop(crop)
        storage_key = self._normalize_storage_type(storage_type)
        safe_transit_hours = max(0.0, float(transit_hours))
        safe_days_since_harvest = max(0, int(days_since_harvest))

        used_defaults = False
        try:
            temp = float(avg_temp)
        except (TypeError, ValueError):
            temp = 32.0
            used_defaults = True

        try:
            humidity = float(humidity_index)
        except (TypeError, ValueError):
            humidity = 65.0
            used_defaults = True

        base = self.STORAGE_BASE_RISK[storage_key]
        crop_decay = self.CROP_DECAY_RATE[crop_key]

        risk = base
        risk += safe_days_since_harvest * crop_decay
        risk += safe_transit_hours * 0.015
        risk += (temp - 30.0) * 0.02 if temp > 30.0 else 0.0
        risk += 0.1 if humidity > 80.0 else 0.0
        risk += 0.15 if rain_in_3days else 0.0
        risk = _clamp(risk, 0.0, 0.95)

        factors: List[str] = []
        if base >= 0.65:
            factors.append("Open field storage has high baseline spoilage exposure.")
        elif base <= 0.20:
            factors.append("Cold storage reduces baseline spoilage risk.")

        if safe_days_since_harvest > 0:
            factors.append(
                f"{safe_days_since_harvest} days since harvest increased decay accumulation."
            )
        if safe_transit_hours > 0:
            factors.append(
                f"{int(round(safe_transit_hours))} transit hours raised handling and heat exposure."
            )
        if temp > 30.0:
            factors.append("High temperature accelerates moisture and quality loss.")
        if humidity > 80.0:
            factors.append("High humidity raises fungal and microbial spoilage risk.")
        if rain_in_3days:
            factors.append("Rain in 3 days increases post-harvest moisture risk.")

        category = self._risk_category(risk)

        daily_growth = crop_decay + (0.004 if temp > 30 else 0.001)
        if risk >= 0.70:
            days_safe = 0
        else:
            days_safe = int((0.70 - risk) / max(0.001, daily_growth))

        days_safe = max(0, min(days_safe, self.SHELF_LIFE_DAYS.get(crop_key, 30)))
        confidence = 0.8 if not used_defaults else 0.62

        return {
            "risk_score": round(risk, 3),
            "risk_category": category,
            "risk_factors": factors,
            "days_safe": days_safe,
            "confidence": round(confidence, 3),
        }
