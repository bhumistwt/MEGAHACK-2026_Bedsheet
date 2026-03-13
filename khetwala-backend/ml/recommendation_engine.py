"""
Khetwala-मित्र Mandi Recommendation Engine
═══════════════════════════════════════════════════════════════════════════════

Ranks mandis by predicted net profit for a farmer's crop shipment.
Formula: Net Profit = (Predicted Price × Quantity) – Transport Cost – Spoilage Loss

Inputs:  Crop, district, quantity, available mandis
Output:  Ranked mandi recommendations with profit breakdown
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional
import math

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.logging import get_logger
from db.models import (
    MandiPrice,
    TransportRoute,
    CropMeta,
    WeatherRecord,
    NDVIRecord,
)
from ml.price_predictor import PricePredictor
from ml.spoilage_model import SpoilageModel

logger = get_logger("khetwala.ml.recommendation")

# Known mandi markets per district (expandable via DB)
DEFAULT_MANDIS = {
    "nashik": ["nashik", "pune", "mumbai"],
    "pune": ["pune", "mumbai", "solapur"],
    "nagpur": ["nagpur", "amravati", "akola"],
    "ahmednagar": ["ahmednagar", "pune", "nashik"],
    "solapur": ["solapur", "pune", "kolhapur"],
    "kolhapur": ["kolhapur", "pune", "sangli"],
    "aurangabad": ["aurangabad", "nashik", "pune"],
    "jalgaon": ["jalgaon", "nashik", "nagpur"],
    "amravati": ["amravati", "nagpur", "akola"],
    "sangli": ["sangli", "kolhapur", "pune"],
}


class RecommendationEngine:
    """
    Multi-criteria mandi selection optimizer.

    For each candidate mandi, computes:
    1. Predicted sale price (from PricePredictor)
    2. Transport cost (from TransportRoute data)
    3. Spoilage loss during transit (from SpoilageModel)
    4. Net profit = Revenue - Transport - Spoilage Loss
    5. Rankings and reasoning
    """

    def __init__(self, db: Session):
        self.db = db
        self.price_predictor = PricePredictor(db)
        self.spoilage_model = SpoilageModel(db)
        self._crop_cache = {}
        self._load_crop_meta()

    def _load_crop_meta(self):
        """Cache crop prices for profit estimation."""
        for crop in self.db.query(CropMeta).all():
            self._crop_cache[crop.crop.lower()] = {
                "base_price": crop.base_price_per_quintal or 2000,
                "shelf_life": crop.shelf_life_days,
                "category": crop.category,
            }

    def recommend(
        self,
        commodity: str,
        origin_district: str,
        quantity_quintals: float = 10.0,
        storage_type: str = "covered",
        packaging: str = "jute_bag",
        target_mandis: Optional[List[str]] = None,
        forecast_days: int = 3,
    ) -> Dict[str, Any]:
        """
        Generate ranked mandi recommendations.

        Args:
            commodity: Crop name (e.g., "onion", "tomato")
            origin_district: Farmer's district
            quantity_quintals: Amount to sell (1 quintal = 100 kg)
            storage_type: Current storage type
            packaging: Packaging method
            target_mandis: Optional list of mandis to evaluate
            forecast_days: Days ahead for price prediction

        Returns:
            Ranked list of mandis with profit analysis.
        """
        quantity_kg = quantity_quintals * 100
        crop_key = commodity.lower()
        origin = origin_district.lower()

        # Determine candidate mandis
        if target_mandis:
            candidates = [m.lower() for m in target_mandis]
        else:
            candidates = DEFAULT_MANDIS.get(origin, [origin])
            # Add origin itself if not already included
            if origin not in candidates:
                candidates.insert(0, origin)

        mandi_results = []

        for mandi in candidates:
            result = self._evaluate_mandi(
                commodity=crop_key,
                origin=origin,
                destination=mandi,
                quantity_kg=quantity_kg,
                quantity_quintals=quantity_quintals,
                storage_type=storage_type,
                packaging=packaging,
                forecast_days=forecast_days,
            )
            mandi_results.append(result)

        # Sort by net profit descending
        mandi_results.sort(key=lambda x: x["net_profit_inr"], reverse=True)

        # Assign ranks
        for i, result in enumerate(mandi_results):
            result["rank"] = i + 1

        # Best option
        best = mandi_results[0] if mandi_results else None

        return {
            "commodity": commodity,
            "origin_district": origin_district,
            "quantity_quintals": quantity_quintals,
            "recommendations": mandi_results,
            "best_mandi": best["mandi"] if best else None,
            "best_net_profit": best["net_profit_inr"] if best else 0,
            "total_mandis_evaluated": len(mandi_results),
            "reasoning": self._generate_summary(mandi_results, commodity),
            "model_version": "1.0.0",
        }

    def _evaluate_mandi(
        self,
        commodity: str,
        origin: str,
        destination: str,
        quantity_kg: float,
        quantity_quintals: float,
        storage_type: str,
        packaging: str,
        forecast_days: int,
    ) -> Dict[str, Any]:
        """Evaluate a single mandi option."""

        # --- Price Prediction ---
        price_forecast = self.price_predictor.predict(
            commodity=commodity,
            district=destination,
            forecast_days=forecast_days,
        )

        if price_forecast.get("forecasts"):
            # Use average of forecast period
            predicted_prices = [
                f["predicted_price"] for f in price_forecast["forecasts"]
            ]
            avg_predicted_price = sum(predicted_prices) / len(predicted_prices)
        else:
            avg_predicted_price = price_forecast.get("current_price", 2000)

        price_per_quintal = avg_predicted_price
        revenue = price_per_quintal * quantity_quintals

        # --- Transport Cost ---
        transport = self._get_transport_cost(origin, destination, quantity_kg)
        transport_cost = transport["total_cost"]

        # --- Spoilage Loss ---
        spoilage = self.spoilage_model.predict(
            commodity=commodity,
            district=origin,
            destination_market=destination,
            storage_type=storage_type,
            packaging=packaging,
            quantity_kg=quantity_kg,
        )
        spoilage_pct = spoilage["spoilage_pct"]
        spoilage_loss_kg = quantity_kg * (spoilage_pct / 100)
        spoilage_loss_value = (spoilage_loss_kg / 100) * price_per_quintal

        # --- Net Profit ---
        net_profit = revenue - transport_cost - spoilage_loss_value

        return {
            "mandi": destination,
            "predicted_price_per_quintal": round(avg_predicted_price, 2),
            "price_trend": price_forecast.get("direction", "stable"),
            "price_confidence": price_forecast.get("confidence", 0.5),
            "revenue_inr": round(revenue, 2),
            "transport": {
                "distance_km": transport.get("distance_km", 0),
                "time_hours": transport.get("time_hours", 0),
                "fuel_cost": round(transport.get("fuel_cost", 0), 2),
                "total_cost": round(transport_cost, 2),
            },
            "spoilage": {
                "risk_level": spoilage["risk_level"],
                "loss_pct": spoilage_pct,
                "loss_kg": round(spoilage_loss_kg, 1),
                "loss_value_inr": round(spoilage_loss_value, 2),
            },
            "net_profit_inr": round(net_profit, 2),
            "profit_margin_pct": round(
                (net_profit / revenue * 100) if revenue > 0 else 0, 2
            ),
            "is_local": origin == destination,
        }

    def _get_transport_cost(
        self, origin: str, destination: str, quantity_kg: float
    ) -> Dict[str, Any]:
        """Get transport cost from route database."""
        if origin == destination:
            return {
                "distance_km": 0,
                "time_hours": 0,
                "fuel_cost": 0,
                "total_cost": 200,  # Minimal local transport
            }

        route = (
            self.db.query(TransportRoute)
            .filter(
                TransportRoute.origin == origin,
                TransportRoute.destination == destination,
            )
            .first()
        )

        if not route:
            # Try reverse
            route = (
                self.db.query(TransportRoute)
                .filter(
                    TransportRoute.origin == destination,
                    TransportRoute.destination == origin,
                )
                .first()
            )

        if route:
            distance = route.distance_km or 100
            hours = route.typical_hours or (distance / 40)  # Assume 40 km/h
            fuel_per_km = route.fuel_cost_per_km or 8.0

            # Scale by quantity: base truck (1000kg) + extra for more
            trucks_needed = max(1, math.ceil(quantity_kg / 3000))
            fuel_cost = distance * fuel_per_km * trucks_needed

            # Loading/unloading labor
            labor = 500 * trucks_needed

            total = fuel_cost + labor

            return {
                "distance_km": distance,
                "time_hours": round(hours, 1),
                "fuel_cost": round(fuel_cost, 2),
                "labor_cost": labor,
                "trucks": trucks_needed,
                "total_cost": round(total, 2),
            }

        # Estimate if no route data
        est_distance = 150  # Default estimate
        est_cost = est_distance * 8 * max(1, math.ceil(quantity_kg / 3000)) + 500

        return {
            "distance_km": est_distance,
            "time_hours": round(est_distance / 40, 1),
            "fuel_cost": round(est_cost - 500, 2),
            "total_cost": round(est_cost, 2),
            "estimated": True,
        }

    def _generate_summary(
        self, results: List[Dict], commodity: str
    ) -> str:
        """Generate human-readable recommendation summary."""
        if not results:
            return "No mandi data available for evaluation."

        best = results[0]
        worst = results[-1]

        summary_parts = [
            f"Best option: {best['mandi'].title()} mandi with estimated "
            f"net profit of ₹{best['net_profit_inr']:,.0f}.",
        ]

        if len(results) > 1:
            profit_diff = best["net_profit_inr"] - worst["net_profit_inr"]
            summary_parts.append(
                f"Choosing the best mandi saves ₹{profit_diff:,.0f} compared "
                f"to {worst['mandi'].title()}."
            )

        # Add noteworthy insights
        local = [r for r in results if r.get("is_local")]
        if local and local[0]["rank"] != 1:
            best_mandi = best["mandi"].title()
            local_mandi = local[0]["mandi"].title()
            improvement = best["net_profit_inr"] - local[0]["net_profit_inr"]
            if improvement > 0:
                summary_parts.append(
                    f"💡 Selling at {best_mandi} instead of local {local_mandi} "
                    f"earns ₹{improvement:,.0f} more despite transport costs."
                )

        # Spoilage warning
        high_spoilage = [r for r in results if r["spoilage"]["risk_level"] in ("High", "Critical")]
        if high_spoilage:
            names = ", ".join(r["mandi"].title() for r in high_spoilage[:2])
            summary_parts.append(
                f"⚠️ High spoilage risk for: {names}. Consider cold transport."
            )

        return " ".join(summary_parts)

    def quick_recommend(
        self,
        commodity: str,
        district: str,
        quantity_quintals: float = 10.0,
    ) -> Dict[str, Any]:
        """
        Simplified recommendation for the frontend.
        Returns top 3 mandis with essential info only.
        """
        full = self.recommend(
            commodity=commodity,
            origin_district=district,
            quantity_quintals=quantity_quintals,
        )

        top_3 = full["recommendations"][:3]
        simplified = []
        for r in top_3:
            simplified.append({
                "mandi": r["mandi"].title(),
                "price": f"₹{r['predicted_price_per_quintal']:,.0f}/q",
                "profit": f"₹{r['net_profit_inr']:,.0f}",
                "distance": f"{r['transport']['distance_km']} km",
                "spoilage_risk": r["spoilage"]["risk_level"],
                "rank": r["rank"],
            })

        return {
            "commodity": commodity,
            "district": district,
            "top_mandis": simplified,
            "best": simplified[0]["mandi"] if simplified else None,
            "reasoning": full["reasoning"],
        }
