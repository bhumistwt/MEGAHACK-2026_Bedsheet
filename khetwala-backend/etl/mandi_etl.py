"""
Khetwala-मित्र Mandi ETL Pipeline
═══════════════════════════════════════════════════════════════════════════════

Fetches historical & daily mandi prices from data.gov.in Agmarknet API.
Stores normalized records in PostgreSQL for time-series modeling.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

from core.config import settings
from core.logging import get_logger
from db.models import MandiPrice

logger = get_logger("khetwala.etl.mandi")

AGMARKNET_URL = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"

# Crops we track
TARGET_CROPS = [
    "Onion", "Tomato", "Wheat", "Rice", "Potato",
    "Soyabean", "Cotton", "Grape", "Banana", "Sugarcane",
]

# Maharashtra districts we cover
TARGET_DISTRICTS = [
    "Nashik", "Pune", "Nagpur", "Aurangabad", "Solapur",
    "Kolhapur", "Amravati", "Jalgaon", "Sangli", "Ahmednagar",
]


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def _parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    text = str(value).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


class MandiETL:
    """Agmarknet mandi price ETL pipeline."""

    def __init__(self, db: Session):
        self.db = db
        self.api_key = settings.datagov_api_key

    def fetch_prices(
        self,
        commodity: str,
        state: str = "Maharashtra",
        limit: int = 500,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Fetch mandi prices from Agmarknet API."""
        if not self.api_key:
            logger.warning("DATAGOV_API_KEY not set, skipping mandi ETL")
            return []

        params = {
            "api-key": self.api_key,
            "format": "json",
            "filters[state]": state,
            "filters[commodity]": commodity,
            "limit": limit,
            "offset": offset,
        }

        try:
            response = requests.get(AGMARKNET_URL, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            records = data.get("records", [])
            logger.info(
                f"Fetched {len(records)} records",
                commodity=commodity,
                state=state,
            )
            return records
        except Exception as exc:
            logger.error(f"Mandi API fetch failed: {exc}", commodity=commodity)
            return []

    def transform_record(self, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Transform a raw Agmarknet record into normalized form."""
        modal_price = _safe_float(raw.get("modal_price"), 0.0)
        if modal_price <= 0:
            return None

        arrival_date = _parse_date(raw.get("arrival_date"))
        if not arrival_date:
            return None

        district = str(raw.get("district", "")).strip()
        market = str(raw.get("market", "")).strip()
        commodity = str(raw.get("commodity", "")).strip().lower()
        state = str(raw.get("state", "")).strip()
        variety = str(raw.get("variety", "")).strip() or None

        return {
            "commodity": commodity,
            "state": state,
            "district": district.lower(),
            "market": market,
            "variety": variety,
            "arrival_date": arrival_date,
            "min_price": _safe_float(raw.get("min_price")),
            "max_price": _safe_float(raw.get("max_price")),
            "modal_price": modal_price,
            "arrival_qty_tonnes": _safe_float(raw.get("arrivals_tonnes")),
        }

    def load_records(self, records: List[Dict[str, Any]]) -> int:
        """Insert transformed records (skip duplicates)."""
        if not records:
            return 0

        inserted = 0
        for record in records:
            try:
                self.db.add(MandiPrice(**record))
                self.db.flush()
                inserted += 1
            except IntegrityError:
                self.db.rollback()
                continue
            except Exception as exc:
                logger.warning(f"Failed to insert record: {exc}")
                self.db.rollback()
                continue

        self.db.commit()
        logger.info(f"Loaded {inserted} new mandi records")
        return inserted

    def run_full_sync(self, state: str = "Maharashtra") -> Dict[str, int]:
        """Full ETL: fetch all target crops, transform, and load."""
        totals = {"fetched": 0, "loaded": 0, "skipped": 0}

        for crop in TARGET_CROPS:
            logger.info(f"Syncing {crop}...")
            raw_records = self.fetch_prices(commodity=crop, state=state, limit=1000)
            totals["fetched"] += len(raw_records)

            transformed = []
            for raw in raw_records:
                record = self.transform_record(raw)
                if record:
                    transformed.append(record)
                else:
                    totals["skipped"] += 1

            loaded = self.load_records(transformed)
            totals["loaded"] += loaded

        logger.info("Mandi ETL sync complete", **totals)
        return totals

    def run_daily_sync(self, state: str = "Maharashtra") -> Dict[str, int]:
        """Incremental daily sync — fetch latest records only."""
        return self.run_full_sync(state=state)

    def get_price_history(
        self,
        commodity: str,
        district: str,
        days: int = 90,
    ) -> List[Dict[str, Any]]:
        """Query stored price history for a crop+district."""
        cutoff = date.today() - timedelta(days=days)
        rows = (
            self.db.query(MandiPrice)
            .filter(
                MandiPrice.commodity == commodity.lower(),
                MandiPrice.district == district.lower(),
                MandiPrice.arrival_date >= cutoff,
            )
            .order_by(MandiPrice.arrival_date.desc())
            .all()
        )
        return [
            {
                "date": str(r.arrival_date),
                "market": r.market,
                "modal_price": r.modal_price,
                "min_price": r.min_price,
                "max_price": r.max_price,
                "arrival_qty": r.arrival_qty_tonnes,
            }
            for r in rows
        ]
