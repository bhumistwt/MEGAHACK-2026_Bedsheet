"""
Khetwala-मित्र Weather ETL Pipeline
═══════════════════════════════════════════════════════════════════════════════

Fetches weather data from NASA POWER API (free, no key required).
Also supports OpenWeatherMap as supplementary source.
Stores district-level records for time-series analysis.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core.config import settings
from core.logging import get_logger
from db.models import WeatherRecord

logger = get_logger("khetwala.etl.weather")

# NASA POWER API — free, no key required
NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"

# District coordinates (lat, lon)
DISTRICT_COORDS = {
    "nashik":      {"lat": 20.011, "lon": 73.790, "state": "Maharashtra"},
    "pune":        {"lat": 18.520, "lon": 73.857, "state": "Maharashtra"},
    "nagpur":      {"lat": 21.146, "lon": 79.088, "state": "Maharashtra"},
    "aurangabad":  {"lat": 19.876, "lon": 75.343, "state": "Maharashtra"},
    "solapur":     {"lat": 17.660, "lon": 75.906, "state": "Maharashtra"},
    "kolhapur":    {"lat": 16.705, "lon": 74.243, "state": "Maharashtra"},
    "amravati":    {"lat": 20.937, "lon": 77.780, "state": "Maharashtra"},
    "jalgaon":     {"lat": 21.012, "lon": 75.563, "state": "Maharashtra"},
    "sangli":      {"lat": 16.854, "lon": 74.564, "state": "Maharashtra"},
    "ahmednagar":  {"lat": 19.095, "lon": 74.749, "state": "Maharashtra"},
}

# NASA POWER parameters we need
NASA_PARAMS = "T2M,T2M_MIN,T2M_MAX,RH2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,WS2M"


class WeatherETL:
    """NASA POWER + OpenWeatherMap weather data ETL."""

    def __init__(self, db: Session):
        self.db = db

    def fetch_nasa_power(
        self,
        lat: float,
        lon: float,
        start_date: date,
        end_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch weather data from NASA POWER API."""
        params = {
            "parameters": NASA_PARAMS,
            "community": "AG",
            "longitude": lon,
            "latitude": lat,
            "start": start_date.strftime("%Y%m%d"),
            "end": end_date.strftime("%Y%m%d"),
            "format": "JSON",
        }

        try:
            response = requests.get(NASA_POWER_URL, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()

            properties = data.get("properties", {})
            parameter_data = properties.get("parameter", {})

            if not parameter_data:
                logger.warning("NASA POWER returned empty parameter data")
                return []

            # Parse day-by-day records
            t2m = parameter_data.get("T2M", {})
            t2m_min = parameter_data.get("T2M_MIN", {})
            t2m_max = parameter_data.get("T2M_MAX", {})
            rh2m = parameter_data.get("RH2M", {})
            precip = parameter_data.get("PRECTOTCORR", {})
            solar = parameter_data.get("ALLSKY_SFC_SW_DWN", {})
            wind = parameter_data.get("WS2M", {})

            records = []
            for date_key in t2m:
                try:
                    record_date = datetime.strptime(date_key, "%Y%m%d").date()
                except ValueError:
                    continue

                # NASA POWER uses -999.0 for missing data
                def safe(val):
                    return val if val is not None and val > -900 else None

                records.append({
                    "record_date": record_date,
                    "temp_avg": safe(t2m.get(date_key)),
                    "temp_min": safe(t2m_min.get(date_key)),
                    "temp_max": safe(t2m_max.get(date_key)),
                    "humidity": safe(rh2m.get(date_key)),
                    "rainfall_mm": safe(precip.get(date_key)),
                    "solar_radiation": safe(solar.get(date_key)),
                    "wind_speed": safe(wind.get(date_key)),
                })

            logger.info(f"Fetched {len(records)} weather records from NASA POWER")
            return records

        except Exception as exc:
            logger.error(f"NASA POWER fetch failed: {exc}")
            return []

    def load_records(
        self,
        records: List[Dict[str, Any]],
        district: str,
        state: str,
        lat: float,
        lon: float,
    ) -> int:
        """Insert weather records (skip duplicates)."""
        if not records:
            return 0

        inserted = 0
        for record in records:
            try:
                values = {
                    "district": district,
                    "state": state,
                    "lat": lat,
                    "lon": lon,
                    "source": "nasa_power",
                    **record,
                }
                self.db.add(WeatherRecord(**values))
                self.db.flush()
                inserted += 1
            except IntegrityError:
                self.db.rollback()
                continue
            except Exception as exc:
                logger.warning(f"Failed to insert weather record: {exc}")
                self.db.rollback()
                continue

        self.db.commit()
        logger.info(f"Loaded {inserted} weather records for {district}")
        return inserted

    def sync_district(
        self,
        district: str,
        days_back: int = 90,
    ) -> int:
        """Sync weather data for a single district."""
        coords = DISTRICT_COORDS.get(district.lower())
        if not coords:
            logger.warning(f"No coordinates for district: {district}")
            return 0

        end_date = date.today() - timedelta(days=1)  # NASA POWER has 1-2 day lag
        start_date = end_date - timedelta(days=days_back)

        records = self.fetch_nasa_power(
            lat=coords["lat"],
            lon=coords["lon"],
            start_date=start_date,
            end_date=end_date,
        )

        return self.load_records(
            records=records,
            district=district.lower(),
            state=coords["state"],
            lat=coords["lat"],
            lon=coords["lon"],
        )

    def run_full_sync(self, days_back: int = 90) -> Dict[str, int]:
        """Sync all districts."""
        results = {}
        for district in DISTRICT_COORDS:
            count = self.sync_district(district, days_back=days_back)
            results[district] = count
        logger.info("Weather ETL sync complete", total_records=sum(results.values()))
        return results

    def get_weather_history(
        self,
        district: str,
        days: int = 30,
    ) -> List[Dict[str, Any]]:
        """Query stored weather history."""
        cutoff = date.today() - timedelta(days=days)
        rows = (
            self.db.query(WeatherRecord)
            .filter(
                WeatherRecord.district == district.lower(),
                WeatherRecord.record_date >= cutoff,
            )
            .order_by(WeatherRecord.record_date.desc())
            .all()
        )
        return [
            {
                "date": str(r.record_date),
                "temp_min": r.temp_min,
                "temp_max": r.temp_max,
                "temp_avg": r.temp_avg,
                "humidity": r.humidity,
                "rainfall_mm": r.rainfall_mm,
                "solar_radiation": r.solar_radiation,
                "wind_speed": r.wind_speed,
            }
            for r in rows
        ]

    def get_forecast_features(self, district: str) -> Dict[str, Any]:
        """Compute weather features for prediction models from recent data."""
        recent = self.get_weather_history(district, days=14)
        if not recent:
            return self._fallback_features(district)

        temps = [r["temp_avg"] for r in recent if r["temp_avg"] is not None]
        humidity = [r["humidity"] for r in recent if r["humidity"] is not None]
        rainfall = [r["rainfall_mm"] for r in recent if r["rainfall_mm"] is not None]

        avg_temp = sum(temps) / len(temps) if temps else 30.0
        avg_humidity = sum(humidity) / len(humidity) if humidity else 65.0
        total_rain_7d = sum(rainfall[:7]) if rainfall else 0.0
        total_rain_3d = sum(rainfall[:3]) if rainfall else 0.0

        rain_in_3days = total_rain_3d > 8.0
        rain_in_7days = total_rain_7d > 14.0
        extreme_weather = avg_temp > 36.5 or avg_humidity > 86.0

        temp_min = min(temps) if temps else 25.0
        temp_max = max(temps) if temps else 38.0

        return {
            "temp_min": round(temp_min, 2),
            "temp_max": round(temp_max, 2),
            "avg_temp": round(avg_temp, 2),
            "humidity": round(avg_humidity, 2),
            "humidity_index": round(avg_humidity, 2),
            "rainfall_7d": round(total_rain_7d, 2),
            "rainfall_3d": round(total_rain_3d, 2),
            "rain_in_3days": rain_in_3days,
            "rain_in_7days": rain_in_7days,
            "extreme_weather_flag": extreme_weather,
            "avg_temp_next7days": round(avg_temp, 2),
            "source": "nasa_power",
            "confidence": 0.85 if len(recent) >= 7 else 0.60,
            "data_points": len(recent),
        }

    def _fallback_features(self, district: str) -> Dict[str, Any]:
        """Climatology-based fallback when no DB data available."""
        # Regional climatology averages for Maharashtra
        profiles = {
            "nashik": {"temp": 28.5, "humidity": 62.0, "rain": 3.0},
            "pune": {"temp": 27.0, "humidity": 60.0, "rain": 3.5},
            "nagpur": {"temp": 31.0, "humidity": 55.0, "rain": 4.0},
            "aurangabad": {"temp": 30.0, "humidity": 52.0, "rain": 2.5},
            "solapur": {"temp": 31.5, "humidity": 48.0, "rain": 2.0},
            "kolhapur": {"temp": 26.0, "humidity": 68.0, "rain": 5.0},
            "amravati": {"temp": 30.5, "humidity": 54.0, "rain": 3.5},
        }
        p = profiles.get(district.lower(), {"temp": 30.0, "humidity": 58.0, "rain": 3.0})

        return {
            "temp_min": round(p["temp"] - 5.0, 2),
            "temp_max": round(p["temp"] + 6.0, 2),
            "avg_temp": p["temp"],
            "humidity": p["humidity"],
            "humidity_index": p["humidity"],
            "rainfall_7d": round(p["rain"] * 7, 2),
            "rainfall_3d": round(p["rain"] * 3, 2),
            "rain_in_3days": p["rain"] * 3 > 8.0,
            "rain_in_7days": p["rain"] * 7 > 14.0,
            "extreme_weather_flag": p["temp"] > 36.5,
            "avg_temp_next7days": p["temp"],
            "source": "climatology_fallback",
            "confidence": 0.45,
            "data_points": 0,
        }
