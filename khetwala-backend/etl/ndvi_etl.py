"""
Khetwala-मित्र NDVI ETL Pipeline
═══════════════════════════════════════════════════════════════════════════════

Fetches NDVI (Normalized Difference Vegetation Index) from satellite data.
Uses Google Earth Engine API when available, falls back to computed estimates
from NASA POWER vegetation proxy (ALLSKY_SFC_SW_DWN + PRECTOTCORR).
"""

from datetime import date, timedelta, timezone
from typing import Any, Dict, List, Optional
import math

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from core.config import settings
from core.logging import get_logger
from db.models import NDVIRecord

logger = get_logger("khetwala.etl.ndvi")


# District coordinates
DISTRICT_COORDS = {
    "nashik":      {"lat": 20.011, "lon": 73.790},
    "pune":        {"lat": 18.520, "lon": 73.857},
    "nagpur":      {"lat": 21.146, "lon": 79.088},
    "aurangabad":  {"lat": 19.876, "lon": 75.343},
    "solapur":     {"lat": 17.660, "lon": 75.906},
    "kolhapur":    {"lat": 16.705, "lon": 74.243},
    "amravati":    {"lat": 20.937, "lon": 77.780},
    "jalgaon":     {"lat": 21.012, "lon": 75.563},
    "sangli":      {"lat": 16.854, "lon": 74.564},
    "ahmednagar":  {"lat": 19.095, "lon": 74.749},
}


class NDVIETL:
    """NDVI data ETL — supports GEE and proxy estimation."""

    def __init__(self, db: Session):
        self.db = db
        self._gee_available = self._check_gee()

    def _check_gee(self) -> bool:
        """Check if Google Earth Engine is available."""
        try:
            import ee
            ee.Initialize()
            return True
        except Exception:
            return False

    def fetch_gee_ndvi(
        self,
        lat: float,
        lon: float,
        start_date: date,
        end_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch NDVI from Google Earth Engine Sentinel-2."""
        if not self._gee_available:
            return []

        try:
            import ee

            point = ee.Geometry.Point([lon, lat])
            collection = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterDate(start_date.isoformat(), end_date.isoformat())
                .filterBounds(point)
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
                .select(["B4", "B8"])  # Red, NIR
            )

            def compute_ndvi(image):
                ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
                return image.addBands(ndvi).set(
                    "date", image.date().format("YYYY-MM-dd")
                )

            ndvi_collection = collection.map(compute_ndvi)
            features = ndvi_collection.getRegion(point, 10).getInfo()

            if not features or len(features) < 2:
                return []

            headers = features[0]
            ndvi_idx = headers.index("NDVI") if "NDVI" in headers else -1
            date_idx = headers.index("time") if "time" in headers else -1

            records = []
            for row in features[1:]:
                if ndvi_idx >= 0 and row[ndvi_idx] is not None:
                    from datetime import datetime
                    ts = row[date_idx] / 1000 if date_idx >= 0 else None
                    record_date = (
                        datetime.fromtimestamp(ts, tz=timezone.utc).date()
                        if ts else date.today()
                    )
                    records.append({
                        "record_date": record_date,
                        "ndvi_value": round(float(row[ndvi_idx]), 4),
                    })

            return records

        except Exception as exc:
            logger.error(f"GEE NDVI fetch failed: {exc}")
            return []

    def estimate_ndvi_from_weather(
        self,
        district: str,
        days_back: int = 30,
    ) -> List[Dict[str, Any]]:
        """
        Estimate NDVI proxy from weather data when GEE is unavailable.
        Uses solar radiation + rainfall as vegetation proxy.
        """
        from db.models import WeatherRecord

        cutoff = date.today() - timedelta(days=days_back)
        weather_rows = (
            self.db.query(WeatherRecord)
            .filter(
                WeatherRecord.district == district.lower(),
                WeatherRecord.record_date >= cutoff,
            )
            .order_by(WeatherRecord.record_date.asc())
            .all()
        )

        if not weather_rows:
            return []

        records = []
        for w in weather_rows:
            solar = w.solar_radiation or 15.0
            rain = w.rainfall_mm or 0.0
            temp = w.temp_avg or 25.0

            # Vegetation proxy formula:
            # NDVI correlates with water availability and solar energy
            # Higher rain + moderate temp + solar → higher NDVI
            water_factor = min(1.0, rain / 10.0) * 0.4
            solar_factor = min(1.0, solar / 25.0) * 0.35
            temp_factor = max(0.0, 1.0 - abs(temp - 25.0) / 20.0) * 0.25

            ndvi_proxy = round(0.2 + water_factor + solar_factor + temp_factor, 4)
            ndvi_proxy = max(-0.1, min(0.95, ndvi_proxy))

            records.append({
                "record_date": w.record_date,
                "ndvi_value": ndvi_proxy,
            })

        return records

    def compute_trend(self, ndvi_values: List[float]) -> float:
        """Compute NDVI trend slope using linear regression."""
        n = len(ndvi_values)
        if n < 3:
            return 0.0

        x_mean = (n - 1) / 2.0
        y_mean = sum(ndvi_values) / n

        numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(ndvi_values))
        denominator = sum((i - x_mean) ** 2 for i in range(n))

        if denominator == 0:
            return 0.0

        return round(numerator / denominator, 6)

    def detect_plateau(self, ndvi_values: List[float], threshold: float = 0.01) -> bool:
        """Detect if NDVI has plateaued (harvest readiness signal)."""
        if len(ndvi_values) < 7:
            return False

        recent = ndvi_values[-7:]
        trend = self.compute_trend(recent)

        # Plateau: near-zero or negative slope after sustained growth
        return abs(trend) < threshold or trend < -threshold

    def load_records(
        self,
        records: List[Dict[str, Any]],
        district: str,
        lat: float,
        lon: float,
        source: str = "sentinel2",
    ) -> int:
        """Store NDVI records in the database."""
        if not records:
            return 0

        # Compute trend for all records
        ndvi_values = [r["ndvi_value"] for r in records]
        overall_trend = self.compute_trend(ndvi_values)

        inserted = 0
        for i, record in enumerate(records):
            # Compute rolling 30-day trend at each point
            window = ndvi_values[max(0, i - 29):i + 1]
            trend_30d = self.compute_trend(window) if len(window) >= 3 else 0.0
            plateau = self.detect_plateau(ndvi_values[:i + 1])

            try:
                self.db.add(NDVIRecord(
                    lat=lat,
                    lon=lon,
                    district=district,
                    record_date=record["record_date"],
                    ndvi_value=record["ndvi_value"],
                    ndvi_trend_30d=trend_30d,
                    growth_plateau=plateau,
                    source=source,
                ))
                self.db.flush()
                inserted += 1
            except IntegrityError:
                self.db.rollback()
            except Exception as exc:
                logger.warning(f"Failed to insert NDVI record: {exc}")
                self.db.rollback()

        self.db.commit()
        logger.info(f"Loaded {inserted} NDVI records for {district}")
        return inserted

    def sync_district(self, district: str, days_back: int = 60) -> int:
        """Sync NDVI data for a district."""
        coords = DISTRICT_COORDS.get(district.lower())
        if not coords:
            return 0

        end_date = date.today()
        start_date = end_date - timedelta(days=days_back)

        if self._gee_available:
            records = self.fetch_gee_ndvi(
                lat=coords["lat"], lon=coords["lon"],
                start_date=start_date, end_date=end_date,
            )
            source = "sentinel2"
        else:
            records = self.estimate_ndvi_from_weather(district, days_back=days_back)
            source = "weather_proxy"

        return self.load_records(
            records=records, district=district.lower(),
            lat=coords["lat"], lon=coords["lon"], source=source,
        )

    def run_full_sync(self, days_back: int = 60) -> Dict[str, int]:
        """Sync all districts."""
        results = {}
        for district in DISTRICT_COORDS:
            results[district] = self.sync_district(district, days_back)
        return results

    def get_ndvi_features(self, district: str) -> Dict[str, Any]:
        """Get NDVI features for prediction models."""
        cutoff = date.today() - timedelta(days=60)
        rows = (
            self.db.query(NDVIRecord)
            .filter(
                NDVIRecord.district == district.lower(),
                NDVIRecord.record_date >= cutoff,
            )
            .order_by(NDVIRecord.record_date.asc())
            .all()
        )

        if not rows:
            return {
                "ndvi_current": 0.55,
                "ndvi_trend_30d": 0.0,
                "growth_plateau": False,
                "data_points": 0,
                "source": "default",
                "confidence": 0.3,
            }

        ndvi_values = [r.ndvi_value for r in rows]
        latest = rows[-1]

        return {
            "ndvi_current": latest.ndvi_value,
            "ndvi_trend_30d": latest.ndvi_trend_30d or self.compute_trend(ndvi_values[-30:]),
            "growth_plateau": self.detect_plateau(ndvi_values),
            "data_points": len(rows),
            "source": latest.source,
            "confidence": min(0.85, 0.30 + len(rows) * 0.02),
        }
