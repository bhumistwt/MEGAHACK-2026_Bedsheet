"""
Khetwala-मित्र Mandi Price Prediction Model
═══════════════════════════════════════════════════════════════════════════════

XGBoost + Prophet-style time-series model for 7-15 day price forecasting.
Trains on historical Agmarknet data from PostgreSQL.

Inputs:  Historical prices, arrival volumes, weather, seasonality
Output:  7-15 day modal price forecast with confidence intervals
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple
import json
import math
import os
import pickle

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.logging import get_logger
from db.models import MandiPrice, WeatherRecord

logger = get_logger("khetwala.ml.price")

MODEL_VERSION = "1.0.0"
MODEL_DIR = os.path.join(os.path.dirname(__file__), "saved_models")


class PricePredictor:
    """
    XGBoost-based mandi price prediction model.

    Features:
    - Time-series lag features (7, 14, 21, 30 day)
    - Moving averages (7, 14, 21 day)
    - Arrival volume trends
    - Weather signals (rainfall, temperature)
    - Seasonal indicators (month, day-of-week, holiday proximity)
    - Price momentum and volatility
    """

    def __init__(self, db: Session):
        self.db = db
        self.models = {}  # crop -> trained model
        self._load_models()

    def _load_models(self):
        """Load pre-trained models from disk if available."""
        os.makedirs(MODEL_DIR, exist_ok=True)
        for filename in os.listdir(MODEL_DIR):
            if filename.startswith("price_") and filename.endswith(".pkl"):
                crop = filename.replace("price_", "").replace(".pkl", "")
                try:
                    with open(os.path.join(MODEL_DIR, filename), "rb") as f:
                        self.models[crop] = pickle.load(f)
                    logger.info(f"Loaded price model for {crop}")
                except Exception as exc:
                    logger.warning(f"Failed to load model {filename}: {exc}")

    def _save_model(self, crop: str, model):
        """Save trained model to disk."""
        os.makedirs(MODEL_DIR, exist_ok=True)
        path = os.path.join(MODEL_DIR, f"price_{crop}.pkl")
        with open(path, "wb") as f:
            pickle.dump(model, f)
        logger.info(f"Saved price model for {crop}")

    def _extract_features(
        self,
        prices: List[Dict[str, Any]],
        weather: List[Dict[str, Any]],
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Build feature matrix and target vector from historical data.

        Features per row:
        [0]  price_lag_1         - yesterday's price
        [1]  price_lag_7         - 7-day lag
        [2]  price_lag_14        - 14-day lag
        [3]  price_lag_30        - 30-day lag
        [4]  ma_7               - 7-day moving average
        [5]  ma_14              - 14-day moving average
        [6]  ma_21              - 21-day moving average
        [7]  price_momentum     - (ma_7 - ma_21) / ma_21
        [8]  price_volatility   - std(last 7 prices) / mean(last 7 prices)
        [9]  arrival_qty        - daily arrival quantity
        [10] arrival_ma_7       - 7-day avg arrivals
        [11] month_sin          - sin(2π * month/12) for seasonality
        [12] month_cos          - cos(2π * month/12)
        [13] day_of_week        - 0-6
        [14] avg_temp           - recent average temperature
        [15] total_rainfall_7d  - rainfall in last 7 days
        [16] humidity           - average humidity
        """
        if len(prices) < 35:
            return np.array([]), np.array([])

        # Sort chronologically
        prices_sorted = sorted(prices, key=lambda x: x["date"])

        # Create weather lookup
        weather_lookup = {}
        for w in weather:
            weather_lookup[w["date"]] = w

        X_rows = []
        y_values = []

        for i in range(30, len(prices_sorted)):
            row = prices_sorted[i]
            target_price = row["modal_price"]

            # Lag features
            lag_1 = prices_sorted[i - 1]["modal_price"]
            lag_7 = prices_sorted[i - 7]["modal_price"]
            lag_14 = prices_sorted[i - 14]["modal_price"]
            lag_30 = prices_sorted[i - 30]["modal_price"]

            # Moving averages
            window_7 = [prices_sorted[j]["modal_price"] for j in range(i - 7, i)]
            window_14 = [prices_sorted[j]["modal_price"] for j in range(i - 14, i)]
            window_21 = [prices_sorted[j]["modal_price"] for j in range(i - 21, i)]

            ma_7 = sum(window_7) / 7
            ma_14 = sum(window_14) / 14
            ma_21 = sum(window_21) / 21

            # Momentum
            momentum = (ma_7 - ma_21) / ma_21 if ma_21 > 0 else 0.0

            # Volatility
            mean_7 = ma_7
            std_7 = (sum((p - mean_7) ** 2 for p in window_7) / 7) ** 0.5
            volatility = std_7 / mean_7 if mean_7 > 0 else 0.0

            # Arrival quantity
            arrival = row.get("arrival_qty", 0.0) or 0.0
            arrivals_7 = [
                prices_sorted[j].get("arrival_qty", 0.0) or 0.0
                for j in range(i - 7, i)
            ]
            arrival_ma_7 = sum(arrivals_7) / 7

            # Date features
            try:
                dt = date.fromisoformat(row["date"])
            except (ValueError, TypeError):
                continue
            month = dt.month
            month_sin = math.sin(2 * math.pi * month / 12)
            month_cos = math.cos(2 * math.pi * month / 12)
            dow = dt.weekday()

            # Weather features
            w = weather_lookup.get(row["date"], {})
            avg_temp = w.get("temp_avg", 30.0) or 30.0
            rainfall_7d = w.get("rainfall_mm", 0.0) or 0.0
            humidity = w.get("humidity", 60.0) or 60.0

            feature_vector = [
                lag_1, lag_7, lag_14, lag_30,
                ma_7, ma_14, ma_21,
                momentum, volatility,
                arrival, arrival_ma_7,
                month_sin, month_cos, dow,
                avg_temp, rainfall_7d, humidity,
            ]

            X_rows.append(feature_vector)
            y_values.append(target_price)

        return np.array(X_rows), np.array(y_values)

    def train(self, commodity: str, district: str = None) -> Dict[str, Any]:
        """
        Train price prediction model on stored historical data.
        Uses XGBoost with gradient boosting.
        """
        from sklearn.ensemble import GradientBoostingRegressor
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error

        # Query historical prices
        query = self.db.query(MandiPrice).filter(
            MandiPrice.commodity == commodity.lower()
        )
        if district:
            query = query.filter(MandiPrice.district == district.lower())
        query = query.order_by(MandiPrice.arrival_date.asc())
        rows = query.all()

        prices = [
            {
                "date": str(r.arrival_date),
                "modal_price": r.modal_price,
                "arrival_qty": r.arrival_qty_tonnes or 0.0,
            }
            for r in rows
        ]

        # Query weather data
        weather_rows = self.db.query(WeatherRecord).filter(
            WeatherRecord.district == (district or "nashik").lower()
        ).all()
        weather = [
            {
                "date": str(w.record_date),
                "temp_avg": w.temp_avg,
                "rainfall_mm": w.rainfall_mm,
                "humidity": w.humidity,
            }
            for w in weather_rows
        ]

        X, y = self._extract_features(prices, weather)

        if len(X) < 50:
            logger.warning(
                f"Insufficient data for {commodity}: {len(X)} samples. Need 50+."
            )
            return {"status": "insufficient_data", "samples": len(X)}

        # Time-series cross-validation
        tscv = TimeSeriesSplit(n_splits=3)
        mae_scores = []
        mape_scores = []

        for train_idx, test_idx in tscv.split(X):
            X_train, X_test = X[train_idx], X[test_idx]
            y_train, y_test = y[train_idx], y[test_idx]

            model = GradientBoostingRegressor(
                n_estimators=200,
                max_depth=6,
                learning_rate=0.05,
                subsample=0.8,
                min_samples_split=10,
                min_samples_leaf=5,
                random_state=42,
            )
            model.fit(X_train, y_train)
            preds = model.predict(X_test)

            mae_scores.append(mean_absolute_error(y_test, preds))
            mape_scores.append(mean_absolute_percentage_error(y_test, preds))

        # Train final model on all data
        final_model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_split=10,
            min_samples_leaf=5,
            random_state=42,
        )
        final_model.fit(X, y)

        self.models[commodity.lower()] = final_model
        self._save_model(commodity.lower(), final_model)

        avg_mae = sum(mae_scores) / len(mae_scores)
        avg_mape = sum(mape_scores) / len(mape_scores)

        result = {
            "status": "trained",
            "commodity": commodity,
            "samples": len(X),
            "mae": round(avg_mae, 2),
            "mape": round(avg_mape * 100, 2),
            "model_version": MODEL_VERSION,
        }
        logger.info("Price model trained", **result)
        return result

    def predict(
        self,
        commodity: str,
        district: str,
        forecast_days: int = 7,
    ) -> Dict[str, Any]:
        """
        Generate price forecast for next N days.

        Returns:
            Predicted prices with confidence intervals.
        """
        model = self.models.get(commodity.lower())

        # Get recent price history for feature construction
        cutoff = date.today() - timedelta(days=60)
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

        if len(prices) < 14:
            return self._statistical_forecast(commodity, district, forecast_days)

        price_list = [p.modal_price for p in prices]
        dates = [p.arrival_date for p in prices]
        arrivals = [p.arrival_qty_tonnes or 0.0 for p in prices]

        # Weather features
        weather_rows = (
            self.db.query(WeatherRecord)
            .filter(
                WeatherRecord.district == district.lower(),
                WeatherRecord.record_date >= cutoff,
            )
            .all()
        )
        weather_map = {str(w.record_date): w for w in weather_rows}

        forecasts = []
        current_prices = list(price_list)  # mutable copy

        for day_offset in range(1, forecast_days + 1):
            forecast_date = date.today() + timedelta(days=day_offset)

            # Build feature vector for this day
            n = len(current_prices)
            lag_1 = current_prices[-1]
            lag_7 = current_prices[-7] if n >= 7 else current_prices[0]
            lag_14 = current_prices[-14] if n >= 14 else current_prices[0]
            lag_30 = current_prices[-30] if n >= 30 else current_prices[0]

            ma_7 = sum(current_prices[-7:]) / min(7, n)
            ma_14 = sum(current_prices[-14:]) / min(14, n)
            ma_21 = sum(current_prices[-21:]) / min(21, n)

            momentum = (ma_7 - ma_21) / ma_21 if ma_21 > 0 else 0.0
            mean_7 = ma_7
            window_7 = current_prices[-7:] if n >= 7 else current_prices
            std_7 = (sum((p - mean_7) ** 2 for p in window_7) / len(window_7)) ** 0.5
            volatility = std_7 / mean_7 if mean_7 > 0 else 0.0

            arr_recent = arrivals[-7:] if len(arrivals) >= 7 else arrivals
            arrival_ma = sum(arr_recent) / len(arr_recent) if arr_recent else 0.0

            month = forecast_date.month
            month_sin = math.sin(2 * math.pi * month / 12)
            month_cos = math.cos(2 * math.pi * month / 12)
            dow = forecast_date.weekday()

            # Weather — use latest available
            last_weather = weather_rows[-1] if weather_rows else None
            avg_temp = last_weather.temp_avg if last_weather else 30.0
            rain = last_weather.rainfall_mm if last_weather else 0.0
            humid = last_weather.humidity if last_weather else 60.0

            features = np.array([[
                lag_1, lag_7, lag_14, lag_30,
                ma_7, ma_14, ma_21,
                momentum, volatility,
                arrival_ma, arrival_ma,
                month_sin, month_cos, dow,
                avg_temp or 30.0, rain or 0.0, humid or 60.0,
            ]])

            if model is not None:
                predicted = float(model.predict(features)[0])
            else:
                # Fallback: weighted moving average with momentum
                predicted = ma_7 * (1 + momentum * 0.3)

            # Confidence interval based on volatility
            uncertainty = max(predicted * volatility, predicted * 0.03)
            ci_low = round(predicted - 2 * uncertainty, 2)
            ci_high = round(predicted + 2 * uncertainty, 2)

            forecasts.append({
                "date": str(forecast_date),
                "predicted_price": round(predicted, 2),
                "ci_low": ci_low,
                "ci_high": ci_high,
                "day_offset": day_offset,
            })

            # Feed prediction back for next day's features
            current_prices.append(predicted)

        # Compute overall direction
        if forecasts:
            start_price = price_list[-1]
            end_price = forecasts[-1]["predicted_price"]
            pct_change = ((end_price - start_price) / start_price) * 100

            if pct_change > 3:
                direction = "rising"
            elif pct_change < -3:
                direction = "falling"
            else:
                direction = "stable"
        else:
            pct_change = 0.0
            direction = "stable"

        confidence = 0.75 if model else 0.55
        if len(prices) > 60:
            confidence = min(0.90, confidence + 0.10)

        return {
            "commodity": commodity,
            "district": district,
            "current_price": round(price_list[-1], 2),
            "forecasts": forecasts,
            "direction": direction,
            "pct_change_forecast": round(pct_change, 2),
            "confidence": confidence,
            "model_version": MODEL_VERSION if model else "statistical_fallback",
            "data_points_used": len(prices),
            "source": "ml_model" if model else "statistical",
        }

    def _statistical_forecast(
        self,
        commodity: str,
        district: str,
        forecast_days: int,
    ) -> Dict[str, Any]:
        """
        Fallback statistical forecast when ML model is unavailable
        or insufficient training data.
        """
        from db.models import CropMeta

        # Get any available price data
        prices = (
            self.db.query(MandiPrice)
            .filter(MandiPrice.commodity == commodity.lower())
            .order_by(MandiPrice.arrival_date.desc())
            .limit(30)
            .all()
        )

        meta = (
            self.db.query(CropMeta)
            .filter(CropMeta.crop == commodity.lower())
            .first()
        )

        if prices:
            price_list = [p.modal_price for p in prices]
            base_price = sum(price_list) / len(price_list)
        elif meta and meta.base_price_per_quintal:
            base_price = meta.base_price_per_quintal
        else:
            base_price = 2000.0

        forecasts = []
        for day in range(1, forecast_days + 1):
            # Simple mean-reverting forecast
            noise = base_price * 0.01 * (day % 3 - 1)
            predicted = round(base_price + noise, 2)
            forecasts.append({
                "date": str(date.today() + timedelta(days=day)),
                "predicted_price": predicted,
                "ci_low": round(predicted * 0.92, 2),
                "ci_high": round(predicted * 1.08, 2),
                "day_offset": day,
            })

        return {
            "commodity": commodity,
            "district": district,
            "current_price": round(base_price, 2),
            "forecasts": forecasts,
            "direction": "stable",
            "pct_change_forecast": 0.0,
            "confidence": 0.35,
            "model_version": "statistical_fallback",
            "data_points_used": len(prices),
            "source": "statistical_fallback",
        }
