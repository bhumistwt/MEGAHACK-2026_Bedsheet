"""
Khetwala-मित्र Post-Harvest Spoilage Risk Model
═══════════════════════════════════════════════════════════════════════════════

Multi-factor spoilage prediction using crop biology + environmental signals.

Inputs:  Crop type, temp, humidity, transit time, storage, NDVI health
Output:  Spoilage probability (%), risk level, estimated loss, preservation tips
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional
import math

import numpy as np
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.models import CropMeta, WeatherRecord, TransportRoute, NDVIRecord, SoilProfile

logger = get_logger("khetwala.ml.spoilage")


# Spoilage rate modifiers based on peer-reviewed post-harvest research
# Source: FAO Technical Papers, ICAR Post-Harvest Technology bulletins
STORAGE_MULTIPLIERS = {
    "open_air": 1.5,       # No protection — highest spoilage
    "covered": 1.2,        # Tarpaulin / shed — moderate protection
    "cold_storage": 0.4,   # Refrigerated — significant reduction
    "controlled_atm": 0.2, # CA storage — best case
}

PACKAGING_MULTIPLIERS = {
    "none": 1.3,
    "jute_bag": 1.0,
    "plastic_crate": 0.8,
    "corrugated_box": 0.7,
    "vacuum_pack": 0.4,
}


class SpoilageModel:
    """
    Physics-informed spoilage risk model.

    Combines:
    1. Crop-specific shelf life and FAO loss rates (from CropMeta)
    2. Temperature-time integral (TTI) damage accumulation
    3. Humidity stress factor
    4. Transit duration impact
    5. NDVI-based pre-harvest health
    6. Storage and packaging modifiers
    """

    def __init__(self, db: Session):
        self.db = db
        self._crop_cache = {}
        self._load_crop_meta()

    def _load_crop_meta(self):
        """Cache crop metadata for fast lookups."""
        crops = self.db.query(CropMeta).all()
        for crop in crops:
            self._crop_cache[crop.crop.lower()] = {
                "shelf_life_days": crop.shelf_life_days,
                "fao_loss_pct": crop.fao_loss_pct,
                "optimal_temp_min": crop.optimal_temp_min,
                "optimal_temp_max": crop.optimal_temp_max,
                "optimal_humidity_min": crop.optimal_humidity_min,
                "optimal_humidity_max": crop.optimal_humidity_max,
                "category": crop.category,
            }

    def predict(
        self,
        commodity: str,
        district: str,
        destination_market: str = None,
        storage_type: str = "covered",
        packaging: str = "jute_bag",
        harvest_days_ago: int = 0,
        quantity_kg: float = 1000.0,
    ) -> Dict[str, Any]:
        """
        Predict spoilage risk for a crop shipment.

        Returns full risk assessment with:
        - spoilage_pct: estimated percentage loss
        - risk_level: Low / Medium / High / Critical
        - loss_value_estimate: monetary loss estimate in INR
        - factors: breakdown of contributing factors
        - recommendations: actionable preservation tips
        """
        crop_key = commodity.lower()
        meta = self._crop_cache.get(crop_key)

        if not meta:
            logger.warning(f"Unknown crop: {commodity}, using defaults")
            meta = {
                "shelf_life_days": 7,
                "fao_loss_pct": 15.0,
                "optimal_temp_min": 10,
                "optimal_temp_max": 25,
                "optimal_humidity_min": 60,
                "optimal_humidity_max": 80,
                "category": "vegetable",
            }

        # --- Factor 1: Temperature stress ---
        temp_factor = self._compute_temp_factor(district, meta)

        # --- Factor 2: Humidity stress ---
        humidity_factor = self._compute_humidity_factor(district, meta)

        # --- Factor 3: Transit/transport damage ---
        transit_factor = self._compute_transit_factor(
            district, destination_market
        )

        # --- Factor 4: Time decay (harvest age vs shelf life) ---
        time_factor = self._compute_time_factor(
            harvest_days_ago, meta["shelf_life_days"]
        )

        # --- Factor 5: Crop health from NDVI ---
        health_factor = self._compute_health_factor(district, commodity)

        # --- Factor 6: Soil quality impact on produce quality ---
        soil_factor = self._compute_soil_factor(district)

        # --- Storage and packaging modifiers ---
        storage_mult = STORAGE_MULTIPLIERS.get(storage_type, 1.0)
        packaging_mult = PACKAGING_MULTIPLIERS.get(packaging, 1.0)

        # === Composite spoilage model ===
        # Base spoilage from FAO data
        base_rate = meta["fao_loss_pct"] / 100.0

        # Environmental multiplier (product of normalized factors)
        env_multiplier = (
            (1 + temp_factor * 0.35)      # Temperature contributes 35%
            * (1 + humidity_factor * 0.18)  # Humidity 18%
            * (1 + transit_factor * 0.18)   # Transit 18%
            * (1 + time_factor * 0.14)      # Time decay 14%
            * (1 + health_factor * 0.05)    # Pre-harvest health 5%
            * (1 + soil_factor * 0.10)      # Soil quality impact 10%
        )

        # Apply storage/packaging
        effective_rate = base_rate * env_multiplier * storage_mult * packaging_mult

        # Clamp to 0-100%
        spoilage_pct = max(0.0, min(100.0, effective_rate * 100))

        # Risk classification
        if spoilage_pct < 8:
            risk_level = "Low"
        elif spoilage_pct < 20:
            risk_level = "Medium"
        elif spoilage_pct < 40:
            risk_level = "High"
        else:
            risk_level = "Critical"

        # Factor details for explainability
        factors = {
            "temperature": {
                "score": round(temp_factor, 3),
                "impact": "high" if temp_factor > 0.5 else "medium" if temp_factor > 0.2 else "low",
            },
            "humidity": {
                "score": round(humidity_factor, 3),
                "impact": "high" if humidity_factor > 0.5 else "medium" if humidity_factor > 0.2 else "low",
            },
            "transit": {
                "score": round(transit_factor, 3),
                "impact": "high" if transit_factor > 0.5 else "medium" if transit_factor > 0.2 else "low",
            },
            "time_decay": {
                "score": round(time_factor, 3),
                "impact": "high" if time_factor > 0.5 else "medium" if time_factor > 0.2 else "low",
            },
            "crop_health": {
                "score": round(health_factor, 3),
                "impact": "high" if health_factor > 0.5 else "medium" if health_factor > 0.2 else "low",
            },
            "soil_quality": {
                "score": round(soil_factor, 3),
                "impact": "high" if soil_factor > 0.5 else "medium" if soil_factor > 0.2 else "low",
            },
            "storage_type": storage_type,
            "storage_multiplier": storage_mult,
            "packaging": packaging,
            "packaging_multiplier": packaging_mult,
        }

        # Recommendations
        recommendations = self._generate_recommendations(
            meta, temp_factor, humidity_factor, transit_factor,
            storage_type, packaging, spoilage_pct
        )

        return {
            "commodity": commodity,
            "district": district,
            "spoilage_pct": round(spoilage_pct, 2),
            "risk_level": risk_level,
            "loss_estimate_kg": round(quantity_kg * spoilage_pct / 100, 1),
            "shelf_life_remaining_days": max(
                0, meta["shelf_life_days"] - harvest_days_ago
            ),
            "fao_baseline_pct": meta["fao_loss_pct"],
            "factors": factors,
            "recommendations": recommendations,
            "confidence": 0.72 if meta.get("category") else 0.55,
            "model_version": "1.0.0",
        }

    def _compute_temp_factor(
        self, district: str, meta: Dict
    ) -> float:
        """
        Temperature stress factor: how far current temp is from optimal range.
        Uses Temperature-Time Integral concept.
        """
        # Get recent weather
        recent = (
            self.db.query(WeatherRecord)
            .filter(WeatherRecord.district == district.lower())
            .order_by(WeatherRecord.record_date.desc())
            .limit(3)
            .all()
        )

        if not recent:
            return 0.3  # Moderate default

        avg_temp = sum(w.temp_avg or 30.0 for w in recent) / len(recent)
        opt_min = meta["optimal_temp_min"]
        opt_max = meta["optimal_temp_max"]

        if opt_min <= avg_temp <= opt_max:
            return 0.0

        # Deviation from optimal range
        if avg_temp > opt_max:
            deviation = avg_temp - opt_max
        else:
            deviation = opt_min - avg_temp

        # Exponential damage above threshold
        # Each 5°C above optimal doubles damage rate (Q10 rule)
        stress = min(1.0, (deviation / 10.0) ** 1.5)
        return stress

    def _compute_humidity_factor(
        self, district: str, meta: Dict
    ) -> float:
        """Humidity stress: too high promotes fungal growth, too low causes desiccation."""
        recent = (
            self.db.query(WeatherRecord)
            .filter(WeatherRecord.district == district.lower())
            .order_by(WeatherRecord.record_date.desc())
            .limit(3)
            .all()
        )

        if not recent:
            return 0.2

        avg_humidity = sum(w.humidity or 60.0 for w in recent) / len(recent)
        opt_min = meta["optimal_humidity_min"]
        opt_max = meta["optimal_humidity_max"]

        if opt_min <= avg_humidity <= opt_max:
            return 0.0

        if avg_humidity > opt_max:
            # High humidity — fungal risk
            deviation = (avg_humidity - opt_max) / 20.0
        else:
            # Low humidity — desiccation
            deviation = (opt_min - avg_humidity) / 30.0

        return min(1.0, deviation)

    def _compute_transit_factor(
        self, origin: str, destination: str = None
    ) -> float:
        """Transit damage based on route data (if available)."""
        if not destination:
            return 0.2  # Default moderate

        route = (
            self.db.query(TransportRoute)
            .filter(
                TransportRoute.origin == origin.lower(),
                TransportRoute.destination == destination.lower(),
            )
            .first()
        )

        if not route:
            # Try reverse
            route = (
                self.db.query(TransportRoute)
                .filter(
                    TransportRoute.origin == destination.lower(),
                    TransportRoute.destination == origin.lower(),
                )
                .first()
            )

        if route:
            # Transit time impact: each hour above 4 hours adds 5% stress
            hours = route.typical_hours or 4
            time_stress = max(0, (hours - 4) * 0.05)

            # Road condition impact
            road_factor = route.spoilage_rate_pct_per_hr or 0.0
            distance_factor = min(1.0, (route.distance_km or 100) / 500.0) * 0.3

            return min(1.0, time_stress + road_factor * hours / 100 + distance_factor)

        return 0.25  # Unknown route

    def _compute_time_factor(
        self, days_since_harvest: int, shelf_life: int
    ) -> float:
        """Time decay: exponential as approaching shelf life end."""
        if shelf_life <= 0:
            return 0.5

        ratio = days_since_harvest / shelf_life

        if ratio < 0.3:
            return 0.0
        elif ratio < 0.6:
            return 0.2
        elif ratio < 0.8:
            return 0.5
        elif ratio < 1.0:
            return 0.8
        else:
            return 1.0  # Past shelf life

    def _compute_health_factor(
        self, district: str, commodity: str
    ) -> float:
        """Pre-harvest crop health from NDVI data."""
        ndvi = (
            self.db.query(NDVIRecord)
            .filter(NDVIRecord.district == district.lower())
            .order_by(NDVIRecord.record_date.desc())
            .first()
        )

        if not ndvi:
            return 0.1  # Assume healthy if no data

        ndvi_val = ndvi.ndvi_value or 0.5

        # Low NDVI = stressed/diseased crop = higher post-harvest loss
        if ndvi_val > 0.6:
            return 0.0  # Healthy
        elif ndvi_val > 0.4:
            return 0.2  # Moderate stress
        elif ndvi_val > 0.25:
            return 0.5  # Significant stress
        else:
            return 0.8  # Severe stress

    def _compute_soil_factor(self, district: str) -> float:
        """
        Soil quality impact on post-harvest produce quality.

        Crops grown in nutrient-deficient or pH-imbalanced soil tend to have:
        - Lower cellular integrity → faster bruising and decay
        - Lower sugar/starch content → reduced shelf life
        - Weaker cell walls → more susceptible to pathogens

        Sources: Soil Health Card (SHC), ICAR research
        """
        soil = (
            self.db.query(SoilProfile)
            .filter(SoilProfile.district.ilike(f"%{district.lower()}%"))
            .first()
        )

        if not soil:
            return 0.1  # Assume moderate if no data

        sqi = soil.soil_quality_index or 0.5
        ph = soil.ph or 7.0
        oc = soil.organic_carbon_pct or 0.5

        # Good soil = lower spoilage factor, poor soil = higher
        # Inverted: high SQI means LESS spoilage risk from soil
        soil_score = sqi

        # pH penalty
        if ph < 6.0 or ph > 8.0:
            soil_score *= 0.7
        elif ph < 6.5 or ph > 7.5:
            soil_score *= 0.9

        # Low organic carbon penalty
        if oc < 0.4:
            soil_score *= 0.8

        # Convert to spoilage factor (inverse: good soil = low factor)
        factor = max(0, 1.0 - soil_score)
        return round(min(1.0, factor), 2)

    def _generate_recommendations(
        self,
        meta: Dict,
        temp_factor: float,
        humidity_factor: float,
        transit_factor: float,
        storage_type: str,
        packaging: str,
        spoilage_pct: float,
    ) -> List[str]:
        """Generate actionable preservation recommendations."""
        tips = []

        # Temperature-specific
        if temp_factor > 0.3:
            tips.append(
                f"⚠️ Temperature outside optimal range "
                f"({meta['optimal_temp_min']}-{meta['optimal_temp_max']}°C). "
                f"Consider cold storage or pre-cooling before transport."
            )

        # Humidity-specific
        if humidity_factor > 0.3:
            tips.append(
                "💧 High humidity increases fungal risk. "
                "Use ventilated packaging and avoid sealed containers."
            )

        # Transit
        if transit_factor > 0.3:
            tips.append(
                "🚛 Long transit expected. Ship during cooler hours "
                "(early morning / night) to reduce heat damage."
            )

        # Storage upgrade
        if storage_type == "open_air":
            tips.append(
                "🏢 Open-air storage increases losses by 50%. "
                "Move to covered or cold storage if available."
            )
        elif storage_type == "covered" and spoilage_pct > 15:
            tips.append(
                "❄️ Consider cold storage — it can reduce losses by 60% "
                "compared to covered storage."
            )

        # Packaging upgrade
        if packaging in ("none", "jute_bag") and spoilage_pct > 10:
            tips.append(
                "📦 Upgrade packaging to plastic crates or corrugated boxes "
                "to reduce mechanical damage during transport."
            )

        # High-risk alert
        if spoilage_pct > 30:
            tips.append(
                "🔴 CRITICAL: Sell within 24-48 hours or arrange cold storage "
                "immediately. Consider nearby markets to minimize transit time."
            )

        # Category-specific
        if meta.get("category") == "leafy_green":
            tips.append(
                "🥬 Leafy greens: Pre-cool to 4°C within 1 hour of harvest. "
                "Mist lightly to maintain turgor."
            )
        elif meta.get("category") == "fruit":
            tips.append(
                "🍎 Handle fruits gently — bruising accelerates ethylene "
                "production and ripening. Keep away from ethylene sources."
            )

        return tips if tips else [
            "✅ Current conditions are favorable. Maintain storage practices."
        ]

    def batch_predict(
        self,
        commodity: str,
        districts: List[str],
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """Predict spoilage risk across multiple districts."""
        results = []
        for district in districts:
            result = self.predict(
                commodity=commodity,
                district=district,
                **kwargs,
            )
            results.append(result)
        return sorted(results, key=lambda x: x["spoilage_pct"])
