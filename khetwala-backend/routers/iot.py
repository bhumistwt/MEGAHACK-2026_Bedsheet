"""
[F17] Cold-Storage / IoT Monitor Router
═══════════════════════════════════════════════════════════════════════════════

Ingests temperature & humidity readings from BLE/WiFi sensors
in cold storage units. Triggers alerts when thresholds are exceeded.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from core.logging import get_logger
from db.session import get_db
from db.models import StorageReading

logger = get_logger("khetwala.routers.iot")
router = APIRouter(prefix="/iot", tags=["iot"])


# ── Crop storage thresholds ──────────────────────────────────────────────

STORAGE_THRESHOLDS = {
    "onion":  {"temp_min": 0, "temp_max": 5, "humidity_min": 65, "humidity_max": 70},
    "potato": {"temp_min": 2, "temp_max": 7, "humidity_min": 85, "humidity_max": 95},
    "tomato": {"temp_min": 10, "temp_max": 15, "humidity_min": 85, "humidity_max": 90},
    "apple":  {"temp_min": -1, "temp_max": 4, "humidity_min": 90, "humidity_max": 95},
    "grape":  {"temp_min": -1, "temp_max": 2, "humidity_min": 85, "humidity_max": 90},
    "wheat":  {"temp_min": 10, "temp_max": 25, "humidity_min": 40, "humidity_max": 60},
    "rice":   {"temp_min": 10, "temp_max": 25, "humidity_min": 50, "humidity_max": 65},
    "default": {"temp_min": 2, "temp_max": 15, "humidity_min": 60, "humidity_max": 85},
}


def _check_alert(crop: str, temp: float, humidity: float) -> dict:
    """Check if reading is within safe thresholds."""
    thresholds = STORAGE_THRESHOLDS.get(crop.lower(), STORAGE_THRESHOLDS["default"])
    alerts = []

    if temp < thresholds["temp_min"]:
        alerts.append({
            "type": "temperature_low",
            "message": f"🥶 Temperature ({temp}°C) bahut kam hai! {crop} ke liye min {thresholds['temp_min']}°C chahiye.",
            "severity": "high",
        })
    elif temp > thresholds["temp_max"]:
        alerts.append({
            "type": "temperature_high",
            "message": f"🔥 Temperature ({temp}°C) zyada hai! {crop} ke liye max {thresholds['temp_max']}°C chahiye. Spoilage risk!",
            "severity": "critical" if temp > thresholds["temp_max"] + 5 else "high",
        })

    if humidity < thresholds["humidity_min"]:
        alerts.append({
            "type": "humidity_low",
            "message": f"💧 Humidity ({humidity}%) kam hai! {crop} sukh jayega. Min {thresholds['humidity_min']}% chahiye.",
            "severity": "medium",
        })
    elif humidity > thresholds["humidity_max"]:
        alerts.append({
            "type": "humidity_high",
            "message": f"💦 Humidity ({humidity}%) zyada hai! Fungus ka khatra. Max {thresholds['humidity_max']}% safe hai.",
            "severity": "high",
        })

    return {
        "alert_triggered": len(alerts) > 0,
        "alerts": alerts,
        "safe_range": thresholds,
    }


# ── Schemas ──────────────────────────────────────────────────────────────

class StorageReadingRequest(BaseModel):
    user_id: int
    device_id: str
    temperature: float
    humidity: float
    crop: str = "onion"


class BatchReadingRequest(BaseModel):
    user_id: int
    device_id: str
    crop: str = "onion"
    readings: List[Dict[str, float]]  # [{"temperature": x, "humidity": y}, ...]


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/storage-reading")
def submit_reading(
    payload: StorageReadingRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Submit a single sensor reading from cold storage."""
    alert_info = _check_alert(payload.crop, payload.temperature, payload.humidity)

    reading = StorageReading(
        user_id=payload.user_id,
        device_id=payload.device_id,
        temperature=payload.temperature,
        humidity=payload.humidity,
        crop=payload.crop,
        alert_triggered=alert_info["alert_triggered"],
        reading_time=datetime.now(timezone.utc),
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return {
        "reading_id": reading.id,
        "temperature": payload.temperature,
        "humidity": payload.humidity,
        "crop": payload.crop,
        **alert_info,
        "timestamp": reading.reading_time.isoformat(),
    }


@router.post("/storage-reading/batch")
def submit_batch_readings(
    payload: BatchReadingRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Submit batch sensor readings."""
    results = []
    alert_count = 0

    for r in payload.readings:
        temp = r.get("temperature", 0)
        hum = r.get("humidity", 0)
        alert_info = _check_alert(payload.crop, temp, hum)

        reading = StorageReading(
            user_id=payload.user_id,
            device_id=payload.device_id,
            temperature=temp,
            humidity=hum,
            crop=payload.crop,
            alert_triggered=alert_info["alert_triggered"],
            reading_time=datetime.now(timezone.utc),
        )
        db.add(reading)
        if alert_info["alert_triggered"]:
            alert_count += 1

    db.commit()

    return {
        "readings_saved": len(payload.readings),
        "alerts_triggered": alert_count,
        "device_id": payload.device_id,
    }


@router.get("/storage-history/{user_id}/{device_id}")
def get_storage_history(
    user_id: int,
    device_id: str,
    hours: int = 24,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get storage reading history for a device."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    readings = (
        db.query(StorageReading)
        .filter(
            StorageReading.user_id == user_id,
            StorageReading.device_id == device_id,
            StorageReading.reading_time >= cutoff,
        )
        .order_by(desc(StorageReading.reading_time))
        .all()
    )

    if not readings:
        return {
            "user_id": user_id,
            "device_id": device_id,
            "message": "No readings in the last {hours} hours.",
            "readings": [],
        }

    temps = [r.temperature for r in readings]
    hums = [r.humidity for r in readings]
    alert_count = sum(1 for r in readings if r.alert_triggered)

    return {
        "user_id": user_id,
        "device_id": device_id,
        "period_hours": hours,
        "total_readings": len(readings),
        "alerts_count": alert_count,
        "temperature": {
            "current": temps[0],
            "avg": round(sum(temps) / len(temps), 1),
            "min": min(temps),
            "max": max(temps),
        },
        "humidity": {
            "current": hums[0],
            "avg": round(sum(hums) / len(hums), 1),
            "min": min(hums),
            "max": max(hums),
        },
        "readings": [
            {
                "temperature": r.temperature,
                "humidity": r.humidity,
                "alert": r.alert_triggered,
                "time": r.reading_time.isoformat(),
            }
            for r in readings[:50]  # Limit to last 50 for API response size
        ],
        "crop": readings[0].crop if readings else None,
        "safe_range": STORAGE_THRESHOLDS.get(
            readings[0].crop.lower() if readings else "default",
            STORAGE_THRESHOLDS["default"]
        ),
    }


@router.get("/devices/{user_id}")
def list_devices(
    user_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """List all IoT devices for a user with their latest status."""
    device_ids = (
        db.query(StorageReading.device_id)
        .filter(StorageReading.user_id == user_id)
        .distinct()
        .all()
    )

    devices = []
    for (device_id,) in device_ids:
        latest = (
            db.query(StorageReading)
            .filter(
                StorageReading.user_id == user_id,
                StorageReading.device_id == device_id,
            )
            .order_by(desc(StorageReading.reading_time))
            .first()
        )
        if latest:
            crop = latest.crop or "unknown"
            alert_info = _check_alert(crop, latest.temperature, latest.humidity)
            devices.append({
                "device_id": device_id,
                "crop": crop,
                "latest_temperature": latest.temperature,
                "latest_humidity": latest.humidity,
                "last_reading": latest.reading_time.isoformat(),
                "status": "alert" if alert_info["alert_triggered"] else "normal",
                "alerts": alert_info["alerts"],
            })

    return {
        "user_id": user_id,
        "total_devices": len(devices),
        "devices": devices,
    }


@router.get("/thresholds")
def get_thresholds(crop: Optional[str] = None) -> Dict[str, Any]:
    """Get safe storage thresholds for crops."""
    if crop:
        thresholds = STORAGE_THRESHOLDS.get(crop.lower(), STORAGE_THRESHOLDS["default"])
        return {"crop": crop, **thresholds}
    return {"thresholds": STORAGE_THRESHOLDS}
