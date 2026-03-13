"""
Khetwala-मित्र Soil Health Router
═══════════════════════════════════════════════════════════════════════════════

Exposes soil health data sourced from:
  • Government Soil Health Card (SHC) datasets
  • ISRO Bhuvan portal
  • Sentinel-2 satellite NDVI vegetation health

Provides:
  - NPK (Nitrogen, Phosphorus, Potassium) levels (region-level)
  - Soil pH & organic carbon
  - Soil moisture estimates (derived from weather + soil type)
  - NDVI vegetation health index
  - Soil quality index (0-1 normalized)
  - Crop-specific suitability scores
  - Recommendations for soil improvement
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.session import get_db
from db.models import SoilProfile, NDVIRecord, WeatherRecord
from core.logging import get_logger

logger = get_logger("khetwala.routers.soil_health")

router = APIRouter(prefix="/api/soil", tags=["soil-health"])

# ── Soil type characteristics ────────────────────────────────────────────────

SOIL_TYPE_INFO = {
    "Deep Black": {
        "description": "Rich in clay, excellent water retention. Good for cotton, soybean, wheat.",
        "water_retention": "High",
        "drainage": "Poor",
        "best_crops": ["cotton", "soybean", "wheat", "sugarcane"],
        "icon": "terrain",
        "color": "#3E2723",
    },
    "Medium Black": {
        "description": "Moderate clay content, good fertility. Suitable for most crops.",
        "water_retention": "Medium-High",
        "drainage": "Moderate",
        "best_crops": ["onion", "wheat", "soybean", "grape"],
        "icon": "terrain",
        "color": "#5D4037",
    },
    "Shallow Black": {
        "description": "Thin layer, low water retention. Needs irrigation management.",
        "water_retention": "Low-Medium",
        "drainage": "Good",
        "best_crops": ["sorghum", "millet", "groundnut"],
        "icon": "terrain",
        "color": "#795548",
    },
    "Laterite": {
        "description": "Acidic, rich in iron/aluminium. Good for plantation crops.",
        "water_retention": "Low",
        "drainage": "Excellent",
        "best_crops": ["rice", "banana", "sugarcane", "tomato"],
        "icon": "terrain",
        "color": "#BF360C",
    },
    "Alluvial": {
        "description": "River-deposited, very fertile. Excellent for most crops.",
        "water_retention": "Medium",
        "drainage": "Good",
        "best_crops": ["rice", "wheat", "sugarcane", "potato"],
        "icon": "terrain",
        "color": "#8D6E63",
    },
    "Red": {
        "description": "Iron-rich, slightly acidic. Good for dry farming.",
        "water_retention": "Low",
        "drainage": "Good",
        "best_crops": ["groundnut", "potato", "tomato"],
        "icon": "terrain",
        "color": "#C62828",
    },
}

# ── NPK rating thresholds (ICAR guidelines) ─────────────────────────────────

NPK_RATINGS = {
    "nitrogen": {"low": 200, "medium": 280, "high": 280},
    "phosphorus": {"low": 12, "medium": 25, "high": 25},
    "potassium": {"low": 150, "medium": 300, "high": 300},
    "ph": {"acidic": 6.0, "neutral_min": 6.5, "neutral_max": 7.5, "alkaline": 8.0},
    "organic_carbon": {"low": 0.4, "medium": 0.75, "high": 0.75},
}


def _rate_nutrient(value: float, thresholds: Dict) -> str:
    """Rate a nutrient as Low/Medium/High."""
    if value is None:
        return "Unknown"
    if value < thresholds["low"]:
        return "Low"
    elif value < thresholds.get("medium", thresholds.get("high", 999)):
        return "Medium"
    return "High"


def _rate_ph(ph: float) -> str:
    """Rate pH level."""
    if ph is None:
        return "Unknown"
    if ph < 6.0:
        return "Acidic"
    elif ph < 6.5:
        return "Slightly Acidic"
    elif ph <= 7.5:
        return "Neutral (Ideal)"
    elif ph <= 8.0:
        return "Slightly Alkaline"
    return "Alkaline"


def _compute_moisture_estimate(weather_records, soil_type: str) -> Dict[str, Any]:
    """Estimate soil moisture from recent weather + soil type properties."""
    if not weather_records:
        return {
            "moisture_pct": 45.0,
            "status": "moderate",
            "source": "estimate",
        }

    # Recent rainfall & evapotranspiration proxy
    total_rain = sum(w.rainfall_mm or 0 for w in weather_records)
    avg_temp = sum(w.temp_avg or 30 for w in weather_records) / len(weather_records)
    avg_humidity = sum(w.humidity or 60 for w in weather_records) / len(weather_records)

    # Soil type water retention factor
    retention = {
        "Deep Black": 0.85, "Medium Black": 0.70, "Shallow Black": 0.50,
        "Laterite": 0.35, "Alluvial": 0.60, "Red": 0.40,
    }.get(soil_type, 0.55)

    # Simple soil moisture model
    rain_contribution = min(total_rain * retention * 0.5, 80)
    evaporation = max(0, (avg_temp - 20) * 0.8)
    humidity_bonus = max(0, (avg_humidity - 50) * 0.15)
    moisture = max(10, min(90, 30 + rain_contribution - evaporation + humidity_bonus))

    if moisture > 65:
        status = "high"
    elif moisture > 40:
        status = "moderate"
    else:
        status = "low"

    return {
        "moisture_pct": round(moisture, 1),
        "status": status,
        "recent_rainfall_mm": round(total_rain, 1),
        "avg_temp": round(avg_temp, 1),
        "retention_factor": retention,
        "source": "weather_model",
    }


def _generate_soil_recommendations(
    soil: SoilProfile, moisture: Dict, ndvi_val: Optional[float]
) -> List[Dict[str, Any]]:
    """Generate actionable soil improvement recommendations."""
    recs = []

    if soil.nitrogen_kg_ha and soil.nitrogen_kg_ha < 200:
        recs.append({
            "type": "fertilizer",
            "priority": "high",
            "icon": "leaf",
            "title": "Nitrogen Deficiency",
            "detail": f"N level is {soil.nitrogen_kg_ha} kg/ha (Low). Apply urea or organic manure.",
            "action": "Apply 50-75 kg/acre urea or 2-3 tonnes FYM",
        })

    if soil.phosphorus_kg_ha and soil.phosphorus_kg_ha < 12:
        recs.append({
            "type": "fertilizer",
            "priority": "high",
            "icon": "flask-outline",
            "title": "Phosphorus Deficiency",
            "detail": f"P level is {soil.phosphorus_kg_ha} kg/ha (Low). Apply SSP or DAP.",
            "action": "Apply 25-30 kg/acre Single Super Phosphate",
        })

    if soil.potassium_kg_ha and soil.potassium_kg_ha < 150:
        recs.append({
            "type": "fertilizer",
            "priority": "medium",
            "icon": "beaker-outline",
            "title": "Potassium Deficiency",
            "detail": f"K level is {soil.potassium_kg_ha} kg/ha (Low). Apply MOP.",
            "action": "Apply 20-25 kg/acre Muriate of Potash",
        })

    if soil.ph and soil.ph > 8.0:
        recs.append({
            "type": "amendment",
            "priority": "medium",
            "icon": "water-outline",
            "title": "High pH (Alkaline Soil)",
            "detail": f"pH is {soil.ph} (alkaline). Add gypsum or organic matter.",
            "action": "Apply 2-3 tonnes/acre gypsum + organic compost",
        })
    elif soil.ph and soil.ph < 6.0:
        recs.append({
            "type": "amendment",
            "priority": "medium",
            "icon": "water-outline",
            "title": "Low pH (Acidic Soil)",
            "detail": f"pH is {soil.ph} (acidic). Apply lime.",
            "action": "Apply 1-2 tonnes/acre agricultural lime",
        })

    if soil.organic_carbon_pct and soil.organic_carbon_pct < 0.4:
        recs.append({
            "type": "organic",
            "priority": "high",
            "icon": "recycle",
            "title": "Low Organic Carbon",
            "detail": f"OC is {soil.organic_carbon_pct}% (Low). Soil health degrading.",
            "action": "Add 3-5 tonnes/acre FYM or vermicompost. Practice green manuring.",
        })

    if moisture.get("status") == "low":
        recs.append({
            "type": "irrigation",
            "priority": "high",
            "icon": "water",
            "title": "Low Soil Moisture",
            "detail": f"Estimated moisture: {moisture['moisture_pct']}%. Crop stress likely.",
            "action": "Irrigate immediately. Consider mulching to retain moisture.",
        })

    if ndvi_val is not None and ndvi_val < 0.3:
        recs.append({
            "type": "health",
            "priority": "high",
            "icon": "alert-circle",
            "title": "Poor Vegetation Health",
            "detail": f"NDVI is {ndvi_val:.2f} (stressed). Soil or crop issues likely.",
            "action": "Check for disease, nutrient deficiency, or water stress.",
        })

    if not recs:
        recs.append({
            "type": "info",
            "priority": "low",
            "icon": "check-circle",
            "title": "Soil Health Good",
            "detail": "No major issues detected. Continue current practices.",
            "action": "Maintain regular soil testing every 2 years.",
        })

    return recs


# ═══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/health/{district}")
def get_soil_health(
    district: str,
    state: str = Query("Maharashtra"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get comprehensive soil health report for a district.

    Returns:
      - NPK levels with ratings
      - pH & organic carbon
      - Soil moisture estimate
      - NDVI vegetation health
      - Soil quality index
      - Actionable recommendations
      - Data sources attribution
    """
    district_lower = district.lower()

    # 1. Fetch soil profile from Soil Health Card data
    soil = (
        db.query(SoilProfile)
        .filter(SoilProfile.district.ilike(f"%{district_lower}%"))
        .first()
    )

    if not soil:
        # Return structured fallback
        return {
            "district": district,
            "state": state,
            "available": False,
            "message": f"No soil health data available for {district}. "
                       "Please ensure your district's Soil Health Card data is uploaded.",
            "sources": _get_sources(),
        }

    # 2. Get recent weather for moisture estimate
    recent_weather = (
        db.query(WeatherRecord)
        .filter(WeatherRecord.district == district_lower)
        .order_by(WeatherRecord.record_date.desc())
        .limit(7)
        .all()
    )

    moisture = _compute_moisture_estimate(recent_weather, soil.soil_type)

    # 3. Get NDVI vegetation health
    ndvi_record = (
        db.query(NDVIRecord)
        .filter(NDVIRecord.district == district_lower)
        .order_by(NDVIRecord.record_date.desc())
        .first()
    )

    ndvi_val = ndvi_record.ndvi_value if ndvi_record else None
    ndvi_trend = ndvi_record.ndvi_trend_30d if ndvi_record else None

    if ndvi_val is not None:
        if ndvi_val > 0.6:
            ndvi_status = "Healthy"
        elif ndvi_val > 0.4:
            ndvi_status = "Moderate"
        elif ndvi_val > 0.25:
            ndvi_status = "Stressed"
        else:
            ndvi_status = "Critical"
    else:
        ndvi_status = "No Data"

    # 4. NPK ratings
    n_rating = _rate_nutrient(soil.nitrogen_kg_ha, NPK_RATINGS["nitrogen"])
    p_rating = _rate_nutrient(soil.phosphorus_kg_ha, NPK_RATINGS["phosphorus"])
    k_rating = _rate_nutrient(soil.potassium_kg_ha, NPK_RATINGS["potassium"])
    ph_rating = _rate_ph(soil.ph)
    oc_rating = _rate_nutrient(soil.organic_carbon_pct, NPK_RATINGS["organic_carbon"])

    # 5. Soil type info
    soil_info = SOIL_TYPE_INFO.get(soil.soil_type, {
        "description": f"{soil.soil_type} soil",
        "water_retention": "Medium",
        "drainage": "Moderate",
        "best_crops": [],
        "icon": "terrain",
        "color": "#795548",
    })

    # 6. Generate recommendations
    recommendations = _generate_soil_recommendations(soil, moisture, ndvi_val)

    return {
        "district": district,
        "state": state,
        "available": True,

        # Core fertility data
        "fertility": {
            "nitrogen": {
                "value": soil.nitrogen_kg_ha,
                "unit": "kg/ha",
                "rating": n_rating,
                "icon": "leaf",
            },
            "phosphorus": {
                "value": soil.phosphorus_kg_ha,
                "unit": "kg/ha",
                "rating": p_rating,
                "icon": "flask-outline",
            },
            "potassium": {
                "value": soil.potassium_kg_ha,
                "unit": "kg/ha",
                "rating": k_rating,
                "icon": "beaker-outline",
            },
        },

        # Chemical properties
        "properties": {
            "ph": {
                "value": soil.ph,
                "rating": ph_rating,
                "ideal_range": "6.5 - 7.5",
            },
            "organic_carbon": {
                "value": soil.organic_carbon_pct,
                "unit": "%",
                "rating": oc_rating,
                "ideal_range": "> 0.75%",
            },
        },

        # Soil quality index
        "quality_index": {
            "value": round(soil.soil_quality_index or 0, 2),
            "max": 1.0,
            "label": (
                "Excellent" if (soil.soil_quality_index or 0) > 0.75
                else "Good" if (soil.soil_quality_index or 0) > 0.6
                else "Fair" if (soil.soil_quality_index or 0) > 0.45
                else "Poor"
            ),
        },

        # Soil type characteristics
        "soil_type": {
            "name": soil.soil_type,
            "info": soil_info,
        },

        # Moisture estimate
        "moisture": moisture,

        # NDVI vegetation health
        "vegetation": {
            "ndvi": round(ndvi_val, 3) if ndvi_val else None,
            "trend_30d": round(ndvi_trend, 4) if ndvi_trend else None,
            "status": ndvi_status,
            "source": "sentinel2",
        },

        # Recommendations
        "recommendations": recommendations,

        # Data sources
        "sources": _get_sources(),
    }


@router.get("/ndvi/{district}")
def get_ndvi_history(
    district: str,
    days: int = Query(30, ge=7, le=180),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Get NDVI vegetation health history for a district."""
    cutoff = date.today() - timedelta(days=days)
    records = (
        db.query(NDVIRecord)
        .filter(
            NDVIRecord.district == district.lower(),
            NDVIRecord.record_date >= cutoff,
        )
        .order_by(NDVIRecord.record_date.asc())
        .all()
    )

    history = [
        {
            "date": str(r.record_date),
            "ndvi": round(r.ndvi_value, 3),
            "trend": round(r.ndvi_trend_30d, 4) if r.ndvi_trend_30d else None,
            "plateau": r.growth_plateau,
        }
        for r in records
    ]

    return {
        "district": district,
        "days": days,
        "count": len(history),
        "history": history,
        "source": "Sentinel-2 Satellite (ESA Copernicus)",
    }


@router.get("/crop-suitability/{district}/{crop}")
def get_crop_suitability(
    district: str,
    crop: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Check how suitable the soil is for a specific crop."""
    soil = (
        db.query(SoilProfile)
        .filter(SoilProfile.district.ilike(f"%{district.lower()}%"))
        .first()
    )

    if not soil:
        return {
            "district": district,
            "crop": crop,
            "available": False,
            "message": "No soil data available for this district.",
        }

    soil_info = SOIL_TYPE_INFO.get(soil.soil_type, {})
    best_crops = [c.lower() for c in soil_info.get("best_crops", [])]
    crop_lower = crop.lower()

    # Suitability score based on soil type match + nutrient levels
    score = 0.5  # base
    if crop_lower in best_crops:
        score += 0.3
    if soil.soil_quality_index and soil.soil_quality_index > 0.6:
        score += 0.1
    if soil.organic_carbon_pct and soil.organic_carbon_pct > 0.5:
        score += 0.1

    score = min(1.0, score)

    if score > 0.8:
        suitability = "Excellent"
    elif score > 0.6:
        suitability = "Good"
    elif score > 0.4:
        suitability = "Fair"
    else:
        suitability = "Poor"

    return {
        "district": district,
        "crop": crop,
        "available": True,
        "suitability": suitability,
        "score": round(score, 2),
        "soil_type": soil.soil_type,
        "best_crops_for_soil": soil_info.get("best_crops", []),
        "is_recommended": crop_lower in best_crops,
        "quality_index": soil.soil_quality_index,
    }


def _get_sources() -> List[Dict[str, str]]:
    """Return data source attribution."""
    return [
        {
            "name": "Soil Health Card (SHC)",
            "org": "Government of India — Ministry of Agriculture",
            "url": "https://soilhealth.dac.gov.in",
            "type": "fertility",
        },
        {
            "name": "Bhuvan",
            "org": "ISRO — Indian Space Research Organisation",
            "url": "https://bhuvan.nrsc.gov.in",
            "type": "soil_moisture",
        },
        {
            "name": "Sentinel-2 NDVI",
            "org": "ESA Copernicus Programme",
            "url": "https://scihub.copernicus.eu",
            "type": "vegetation_health",
        },
    ]
