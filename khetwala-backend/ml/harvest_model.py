"""
Khetwala-मित्र Harvest Window Optimization Model
═══════════════════════════════════════════════════════════════════════════════

Determines optimal harvest timing using crop maturity signals + weather
forecast + NDVI trends + market price predictions.

Inputs:  Crop type, sowing date, district, NDVI, weather forecast
Output:  Harvest recommendation (Now / Wait N days / Rain Risk), reasoning
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional
import math

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.logging import get_logger
from db.models import CropMeta, WeatherRecord, NDVIRecord, MandiPrice, SoilProfile

logger = get_logger("khetwala.ml.harvest")


class HarvestModel:
    """
    Multi-signal harvest window optimizer.

    Combines:
    1. Crop maturity calendar (days since sowing vs expected maturity)
    2. NDVI growth curve analysis (plateau = maturity)
    3. Weather risk window (rainfall in next 5 days)
    4. Price-optimal timing (sell when price is predicted to peak)
    5. Soil moisture conditions
    """

    def __init__(self, db: Session):
        self.db = db
        self._crop_cache = {}
        self._load_crop_meta()

    def _load_crop_meta(self):
        """Cache crop metadata."""
        for crop in self.db.query(CropMeta).all():
            self._crop_cache[crop.crop.lower()] = {
                "maturity_days_min": crop.maturity_days_min,
                "maturity_days_max": crop.maturity_days_max,
                "category": crop.category,
                "shelf_life_days": crop.shelf_life_days,
            }

    def predict(
        self,
        commodity: str,
        district: str,
        sowing_date: Optional[str] = None,
        crop_age_days: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Generate harvest timing recommendation.

        Returns:
            action: "harvest_now" | "wait" | "urgent_harvest"
            optimal_window: {start_date, end_date}
            risk_factors: detailed breakdown
            reasoning: human-readable explanation
        """
        crop_key = commodity.lower()
        meta = self._crop_cache.get(crop_key)

        if not meta:
            meta = {
                "maturity_days_min": 60,
                "maturity_days_max": 90,
                "category": "vegetable",
                "shelf_life_days": 7,
            }

        # Determine crop age
        if sowing_date:
            try:
                sow = date.fromisoformat(sowing_date)
                age_days = (date.today() - sow).days
            except ValueError:
                age_days = crop_age_days or 60
        elif crop_age_days is not None:
            age_days = crop_age_days
            sow = date.today() - timedelta(days=age_days)
        else:
            age_days = None
            sow = None

        # === Signal 1: Maturity Assessment ===
        maturity_signal = self._assess_maturity(age_days, meta)

        # === Signal 2: NDVI Growth Curve ===
        ndvi_signal = self._assess_ndvi(district)

        # === Signal 3: Weather Risk Window ===
        weather_signal = self._assess_weather_risk(district)

        # === Signal 4: Price Timing ===
        price_signal = self._assess_price_timing(commodity, district)

        # === Signal 5: Soil Quality ===
        soil_signal = self._assess_soil_quality(district)

        # === Signal 6: Composite Decision ===
        decision = self._make_decision(
            maturity_signal, ndvi_signal, weather_signal, price_signal, meta
        )

        return {
            "commodity": commodity,
            "district": district,
            "crop_age_days": age_days,
            "sowing_date": sowing_date,
            **decision,
            "signals": {
                "maturity": maturity_signal,
                "ndvi": ndvi_signal,
                "weather": weather_signal,
                "price": price_signal,
                "soil": soil_signal,
            },
            "confidence": self._compute_confidence(
                maturity_signal, ndvi_signal, weather_signal, soil_signal
            ),
            "model_version": "1.0.0",
        }

    def _assess_maturity(
        self, age_days: Optional[int], meta: Dict
    ) -> Dict[str, Any]:
        """Assess crop maturity based on calendar age."""
        if age_days is None:
            return {
                "status": "unknown",
                "score": 0.5,
                "detail": "Sowing date not provided — maturity estimated from NDVI",
            }

        min_days = meta["maturity_days_min"]
        max_days = meta["maturity_days_max"]
        mid_days = (min_days + max_days) / 2

        if age_days < min_days * 0.8:
            # Clearly immature
            days_remaining = min_days - age_days
            return {
                "status": "immature",
                "score": 0.0,
                "days_to_maturity": days_remaining,
                "detail": f"Crop is {age_days} days old, needs {min_days}-{max_days} days. "
                          f"~{days_remaining} days to earliest harvest.",
            }
        elif age_days < min_days:
            # Approaching maturity
            progress = (age_days - min_days * 0.8) / (min_days * 0.2)
            return {
                "status": "approaching",
                "score": 0.3 + 0.3 * progress,
                "days_to_maturity": min_days - age_days,
                "detail": f"Approaching maturity. {min_days - age_days} days to earliest harvest.",
            }
        elif age_days <= max_days:
            # In harvest window
            progress = (age_days - min_days) / max(1, max_days - min_days)
            return {
                "status": "mature",
                "score": 0.8 + 0.2 * progress,
                "days_to_maturity": 0,
                "detail": f"Crop is mature at {age_days} days. Within optimal harvest window.",
            }
        else:
            # Over-mature
            overdue = age_days - max_days
            return {
                "status": "over_mature",
                "score": 1.0,
                "days_overdue": overdue,
                "detail": f"⚠️ Crop is {overdue} days past optimal harvest. "
                          f"Quality degradation likely.",
            }

    def _assess_ndvi(self, district: str) -> Dict[str, Any]:
        """
        Assess NDVI growth curve for harvest readiness.
        NDVI plateau or decline = crop reaching maturity.
        """
        records = (
            self.db.query(NDVIRecord)
            .filter(NDVIRecord.district == district.lower())
            .order_by(NDVIRecord.record_date.desc())
            .limit(6)
            .all()
        )

        if not records:
            return {
                "status": "no_data",
                "score": 0.5,
                "detail": "No NDVI satellite data available for this district.",
            }

        latest = records[0]
        ndvi_val = latest.ndvi_value or 0.5
        trend = getattr(latest, "ndvi_trend_30d", None)
        if trend is None:
            trend = getattr(latest, "trend_30d", 0.0)
        plateau = latest.growth_plateau or False

        # Interpret NDVI signals
        if plateau or trend < -0.01:
            # Declining or plateau = maturity / senescence
            return {
                "status": "harvest_ready",
                "score": 0.85,
                "ndvi": round(ndvi_val, 3),
                "trend": round(trend, 4),
                "plateau": plateau,
                "detail": "NDVI shows plateau/decline — crop likely reaching maturity.",
            }
        elif trend < 0.005:
            # Plateauing
            return {
                "status": "near_ready",
                "score": 0.65,
                "ndvi": round(ndvi_val, 3),
                "trend": round(trend, 4),
                "plateau": False,
                "detail": "NDVI growth slowing — approaching harvest readiness.",
            }
        else:
            # Still growing
            return {
                "status": "growing",
                "score": 0.3,
                "ndvi": round(ndvi_val, 3),
                "trend": round(trend, 4),
                "plateau": False,
                "detail": f"NDVI still increasing (trend: +{trend:.4f}/day). "
                          f"Crop actively growing.",
            }

    def _assess_weather_risk(self, district: str) -> Dict[str, Any]:
        """
        Assess weather risk for harvest operations.
        Rain in next 3-5 days = bad for harvesting.
        """
        # Get recent weather to estimate coming conditions
        recent = (
            self.db.query(WeatherRecord)
            .filter(WeatherRecord.district == district.lower())
            .order_by(WeatherRecord.record_date.desc())
            .limit(7)
            .all()
        )

        if not recent:
            return {
                "status": "no_data",
                "score": 0.5,
                "detail": "No weather data available.",
            }

        # Analyze recent rainfall pattern
        rainfall_values = [w.rainfall_mm or 0.0 for w in recent]
        avg_rainfall = sum(rainfall_values) / len(rainfall_values)
        max_rainfall = max(rainfall_values)

        # Humidity trend
        humidity_values = [w.humidity or 60.0 for w in recent]
        avg_humidity = sum(humidity_values) / len(humidity_values)

        # Wind for drying assessment
        wind_values = [w.wind_speed or 2.0 for w in recent]
        avg_wind = sum(wind_values) / len(wind_values)

        # Decision logic
        if max_rainfall > 20 or avg_rainfall > 10:
            # Heavy rain — bad for harvest
            return {
                "status": "rain_risk",
                "score": 0.9,
                "avg_rainfall_mm": round(avg_rainfall, 1),
                "max_rainfall_mm": round(max_rainfall, 1),
                "avg_humidity": round(avg_humidity, 1),
                "detail": f"⚠️ Recent heavy rainfall ({max_rainfall:.1f}mm max). "
                          f"Wait for 2-3 dry days before harvesting.",
                "recommendation": "delay_harvest",
            }
        elif avg_rainfall > 3 or avg_humidity > 85:
            # Moderate rain risk
            return {
                "status": "moderate_rain",
                "score": 0.6,
                "avg_rainfall_mm": round(avg_rainfall, 1),
                "avg_humidity": round(avg_humidity, 1),
                "detail": "Moderate moisture. Harvest possible but dry quickly.",
                "recommendation": "harvest_with_caution",
            }
        elif avg_humidity < 50 and avg_wind > 3:
            # Excellent drying conditions
            return {
                "status": "optimal",
                "score": 0.1,
                "avg_rainfall_mm": round(avg_rainfall, 1),
                "avg_humidity": round(avg_humidity, 1),
                "avg_wind": round(avg_wind, 1),
                "detail": "Excellent harvest conditions — low humidity, good wind for drying.",
                "recommendation": "harvest_now",
            }
        else:
            return {
                "status": "fair",
                "score": 0.3,
                "avg_rainfall_mm": round(avg_rainfall, 1),
                "avg_humidity": round(avg_humidity, 1),
                "detail": "Fair conditions for harvesting.",
                "recommendation": "harvest_ok",
            }

    def _assess_price_timing(
        self, commodity: str, district: str
    ) -> Dict[str, Any]:
        """
        Should farmer wait for better prices or sell now?
        Based on price trends from DB.
        """
        cutoff = date.today() - timedelta(days=30)
        prices = (
            self.db.query(MandiPrice)
            .filter(
                MandiPrice.commodity == commodity.lower(),
                MandiPrice.district == district.lower(),
                MandiPrice.arrival_date >= cutoff,
            )
            .order_by(MandiPrice.arrival_date.asc())
            .all()
        )

        if len(prices) < 5:
            return {
                "status": "insufficient_data",
                "score": 0.5,
                "detail": "Not enough price data for timing analysis.",
            }

        price_list = [p.modal_price for p in prices]
        recent_avg = sum(price_list[-7:]) / min(7, len(price_list))
        earlier_avg = sum(price_list[:7]) / min(7, len(price_list))

        if earlier_avg > 0:
            trend_pct = ((recent_avg - earlier_avg) / earlier_avg) * 100
        else:
            trend_pct = 0.0

        if trend_pct > 5:
            return {
                "status": "prices_rising",
                "score": 0.7,
                "trend_pct": round(trend_pct, 2),
                "current_avg": round(recent_avg, 2),
                "detail": f"Prices rising ({trend_pct:+.1f}%). "
                          f"Consider waiting 3-5 days for better returns.",
            }
        elif trend_pct < -5:
            return {
                "status": "prices_falling",
                "score": 0.3,
                "trend_pct": round(trend_pct, 2),
                "current_avg": round(recent_avg, 2),
                "detail": f"Prices declining ({trend_pct:+.1f}%). "
                          f"Harvest and sell soon to lock in current rates.",
            }
        else:
            return {
                "status": "prices_stable",
                "score": 0.5,
                "trend_pct": round(trend_pct, 2),
                "current_avg": round(recent_avg, 2),
                "detail": f"Prices stable ({trend_pct:+.1f}%). "
                          f"Market timing is neutral.",
            }

    def _assess_soil_quality(self, district: str) -> Dict[str, Any]:
        """
        Assess soil quality impact on harvest readiness.

        Soil with high NPK and good pH supports better crop development,
        potentially accelerating maturity. Poor soil can delay maturity
        and reduce crop quality.

        Sources: Soil Health Card (SHC), ICAR data
        """
        soil = (
            self.db.query(SoilProfile)
            .filter(SoilProfile.district.ilike(f"%{district.lower()}%"))
            .first()
        )

        if not soil:
            return {
                "status": "no_data",
                "score": 0.5,
                "detail": "No soil health data for this district.",
                "source": "soil_health_card",
            }

        sqi = soil.soil_quality_index or 0.5
        ph = soil.ph or 7.0
        n = soil.nitrogen_kg_ha or 200
        oc = soil.organic_carbon_pct or 0.5

        # pH deviation from ideal (6.5-7.5)
        ph_penalty = 0
        if ph < 6.0 or ph > 8.0:
            ph_penalty = 0.15
        elif ph < 6.5 or ph > 7.5:
            ph_penalty = 0.05

        # Nitrogen adequacy
        n_factor = min(1.0, n / 250)

        # Organic carbon adequacy
        oc_factor = min(1.0, oc / 0.75)

        # Combined soil score: how supportive is the soil for crop growth?
        soil_score = (sqi * 0.4 + n_factor * 0.3 + oc_factor * 0.2 + (1 - ph_penalty) * 0.1)
        soil_score = round(min(1.0, max(0, soil_score)), 2)

        if soil_score > 0.7:
            status = "good"
            detail = (
                f"Soil quality is good (SQI: {sqi:.2f}, pH: {ph}, N: {n} kg/ha). "
                f"Supports timely crop maturity."
            )
        elif soil_score > 0.5:
            status = "moderate"
            detail = (
                f"Soil quality is moderate (SQI: {sqi:.2f}, pH: {ph}, N: {n} kg/ha). "
                f"Crop maturity may be slightly delayed."
            )
        else:
            status = "poor"
            detail = (
                f"Soil quality is poor (SQI: {sqi:.2f}, pH: {ph}, N: {n} kg/ha). "
                f"Expect delayed maturity and potentially lower yield quality."
            )

        return {
            "status": status,
            "score": soil_score,
            "quality_index": round(sqi, 2),
            "ph": ph,
            "nitrogen_kg_ha": n,
            "organic_carbon_pct": oc,
            "detail": detail,
            "source": "soil_health_card",
        }

    def _make_decision(
        self,
        maturity: Dict,
        ndvi: Dict,
        weather: Dict,
        price: Dict,
        meta: Dict,
    ) -> Dict[str, Any]:
        """
        Combine all signals into a final harvest decision.

        Priority order:
        1. Over-mature → urgent harvest regardless
        2. Weather risk → delay if rain, urgent if clearing window
        3. Maturity + NDVI → are we ready?
        4. Price → optimize timing if we have flexibility
        """
        reasons = []

        # Check for urgent scenarios
        if maturity.get("status") == "over_mature":
            reasons.append("Crop is past optimal harvest window")
            if weather.get("status") in ("optimal", "fair"):
                return {
                    "action": "urgent_harvest",
                    "wait_days": 0,
                    "optimal_window": {
                        "start": str(date.today()),
                        "end": str(date.today() + timedelta(days=2)),
                    },
                    "reasoning": "🔴 Crop is over-mature. Harvest immediately to "
                                 "prevent further quality loss. " + "; ".join(reasons),
                    "priority": "critical",
                }
            else:
                return {
                    "action": "urgent_harvest",
                    "wait_days": 1,
                    "optimal_window": {
                        "start": str(date.today() + timedelta(days=1)),
                        "end": str(date.today() + timedelta(days=3)),
                    },
                    "reasoning": "🔴 Over-mature crop + rain risk. Wait for first dry "
                                 "window then harvest urgently.",
                    "priority": "critical",
                }

        # Not yet mature
        if maturity.get("score", 0.5) < 0.5 and ndvi.get("status") != "harvest_ready":
            wait = maturity.get("days_to_maturity", 10)
            return {
                "action": "wait",
                "wait_days": wait,
                "optimal_window": {
                    "start": str(date.today() + timedelta(days=max(0, wait - 5))),
                    "end": str(date.today() + timedelta(days=wait + 10)),
                },
                "reasoning": f"🟡 Crop not yet mature. {maturity.get('detail', '')} "
                             f"Recommended wait: ~{wait} days.",
                "priority": "low",
            }

        # Mature — check weather
        if weather.get("status") == "rain_risk":
            reasons.append("Heavy rain expected — delay harvest")
            return {
                "action": "wait",
                "wait_days": 3,
                "optimal_window": {
                    "start": str(date.today() + timedelta(days=3)),
                    "end": str(date.today() + timedelta(days=7)),
                },
                "reasoning": "🌧️ Crop is mature but weather is unfavorable. "
                             "Wait 2-3 days for dry conditions. "
                             + weather.get("detail", ""),
                "priority": "medium",
            }

        # Mature + good weather — consider price
        if price.get("status") == "prices_rising" and maturity.get("status") == "mature":
            shelf_life = meta.get("shelf_life_days", 7)
            wait = min(5, shelf_life // 2)
            reasons.append(f"Prices rising — can wait {wait} days for better rate")
            return {
                "action": "wait",
                "wait_days": wait,
                "optimal_window": {
                    "start": str(date.today()),
                    "end": str(date.today() + timedelta(days=wait + 3)),
                },
                "reasoning": f"🟢 Crop mature and weather favorable. Prices are rising "
                             f"({price.get('trend_pct', 0):+.1f}%). Consider waiting "
                             f"{wait} days for better price. Can harvest anytime in window.",
                "priority": "low",
            }

        # Default: mature + fair/good weather → harvest now
        return {
            "action": "harvest_now",
            "wait_days": 0,
            "optimal_window": {
                "start": str(date.today()),
                "end": str(date.today() + timedelta(days=5)),
            },
            "reasoning": "🟢 All signals favorable — crop is mature, weather is good, "
                         "and market conditions are acceptable. Harvest recommended.",
            "priority": "medium",
        }

    def _compute_confidence(
        self,
        maturity: Dict,
        ndvi: Dict,
        weather: Dict,
        soil: Dict = None,
    ) -> float:
        """Compute overall confidence based on data availability."""
        conf = 0.5  # Base

        # Maturity known
        if maturity.get("status") != "unknown":
            conf += 0.12

        # NDVI data available
        if ndvi.get("status") != "no_data":
            conf += 0.12

        # Weather data available
        if weather.get("status") != "no_data":
            conf += 0.12

        # Soil data available
        if soil and soil.get("status") != "no_data":
            conf += 0.08

        return round(min(0.95, conf), 2)
