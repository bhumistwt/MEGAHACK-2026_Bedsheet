from typing import Any, Dict, List

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, float(value)))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


class PriceTrendModel:
    """Predicts mandi price direction with calibrated probabilities."""

    def __init__(self) -> None:
        self.pipeline: Pipeline = self._train_model()

    def _train_model(self) -> Pipeline:
        rng = np.random.default_rng(seed=42)
        samples: List[Dict[str, Any]] = []
        labels: List[str] = []

        momentum_values = ["rising", "falling", "stable"]
        arrival_values = ["low", "normal", "high"]

        for _ in range(240):
            price_7d_avg = float(rng.uniform(1200, 5600))
            price_14d_avg = price_7d_avg * float(rng.uniform(0.92, 1.08))
            price_momentum = str(rng.choice(momentum_values, p=[0.35, 0.35, 0.30]))
            arrival_pressure = str(rng.choice(arrival_values, p=[0.30, 0.45, 0.25]))
            rain_in_7days = bool(rng.integers(0, 2))
            avg_temp = float(rng.uniform(20, 42))

            if price_momentum == "rising" and arrival_pressure == "low":
                label = "rising"
            elif price_momentum == "falling" or arrival_pressure == "high":
                label = "falling"
            else:
                label = "stable"

            if rain_in_7days and label == "rising":
                label = "stable"
            if avg_temp > 38 and label == "stable" and arrival_pressure == "high":
                label = "falling"

            if rng.uniform(0, 1) < 0.07:
                label = str(rng.choice(["rising", "falling", "stable"]))

            samples.append(
                {
                    "price_7d_avg": price_7d_avg,
                    "price_14d_avg": price_14d_avg,
                    "price_momentum": price_momentum,
                    "arrival_pressure": arrival_pressure,
                    "rain_in_7days": rain_in_7days,
                    "avg_temp": avg_temp,
                }
            )
            labels.append(label)

        estimator = Pipeline(
            steps=[
                ("vectorizer", DictVectorizer(sparse=False)),
                (
                    "classifier",
                    CalibratedClassifierCV(
                        estimator=Pipeline(
                            steps=[
                                ("scaler", StandardScaler()),
                                ("logit", LogisticRegression(max_iter=1500)),
                            ]
                        ),
                        cv=3,
                        method="sigmoid",
                    ),
                ),
            ]
        )
        estimator.fit(samples, labels)
        return estimator

    def _fallback_prediction(self, features: Dict[str, Any]) -> Dict[str, Any]:
        momentum = str(features.get("price_momentum", "stable")).lower()
        arrival_pressure = str(features.get("arrival_pressure", "normal")).lower()
        price_7d_avg = _safe_float(features.get("price_7d_avg"), 0.0)

        if momentum == "rising" and arrival_pressure == "low":
            direction = "rising"
        else:
            direction = "stable"

        base_price = price_7d_avg if price_7d_avg > 0 else 2000.0
        expected_range = [
            round(base_price * 0.96, 3),
            round(base_price * 1.05, 3),
        ]

        return {
            "direction": direction,
            "confidence": 0.55,
            "expected_price_range": expected_range,
            "fallback_used": True,
        }

    def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        required_fields = (
            "price_7d_avg",
            "price_14d_avg",
            "price_momentum",
            "arrival_pressure",
            "rain_in_7days",
            "avg_temp",
        )

        if any(field not in features for field in required_fields):
            return self._fallback_prediction(features)

        payload = {
            "price_7d_avg": _safe_float(features.get("price_7d_avg"), 0.0),
            "price_14d_avg": _safe_float(features.get("price_14d_avg"), 0.0),
            "price_momentum": str(features.get("price_momentum", "stable")).lower(),
            "arrival_pressure": str(features.get("arrival_pressure", "normal")).lower(),
            "rain_in_7days": bool(features.get("rain_in_7days", False)),
            "avg_temp": _safe_float(features.get("avg_temp"), 30.0),
        }

        if payload["price_7d_avg"] <= 0 or payload["price_14d_avg"] <= 0:
            return self._fallback_prediction(features)

        try:
            probabilities = self.pipeline.predict_proba([payload])[0]
            classes = list(self.pipeline.classes_)
            winning_index = int(np.argmax(probabilities))
            direction = str(classes[winning_index])
            confidence = float(probabilities[winning_index])

            base_price = payload["price_7d_avg"]
            delta = (payload["price_7d_avg"] - payload["price_14d_avg"]) / payload["price_14d_avg"]
            volatility = max(0.035, min(0.14, abs(delta) + 0.02))

            if direction == "rising":
                center_factor = 1.045
            elif direction == "falling":
                center_factor = 0.955
            else:
                center_factor = 1.0

            min_price = base_price * (center_factor - volatility)
            max_price = base_price * (center_factor + volatility)

            return {
                "direction": direction,
                "confidence": round(_clamp(confidence, 0.5, 0.97), 3),
                "expected_price_range": [round(min_price, 3), round(max_price, 3)],
                "fallback_used": False,
            }
        except Exception:
            return self._fallback_prediction(features)
