from collections import defaultdict
from datetime import UTC
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
from typing import Any
import asyncio

import httpx
from fastapi import APIRouter, HTTPException, Query

from core.config import settings
from core.logging import get_logger

router = APIRouter(prefix='/market', tags=['market'])
logger = get_logger('khetwala.market')

DISTRICT_ALIASES = {
    'nashik': 'Nashik',
    'nasik': 'Nashik',
    'pune': 'Pune',
    'poona': 'Pune',
    'nagpur': 'Nagpur',
    'aurangabad': 'Aurangabad',
    'chhatrapatisambhajinagar': 'Aurangabad',
    'sambhajinagar': 'Aurangabad',
    'solapur': 'Solapur',
    'sholapur': 'Solapur',
    'kolhapur': 'Kolhapur',
}

DISTRICT_LIST = ['Nashik', 'Pune', 'Nagpur', 'Aurangabad', 'Solapur', 'Kolhapur']
MARKET_RECORD_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
CACHE_TTL_SECONDS = 6 * 60 * 60

FALLBACK_PRICES = {
    'Onion': 2100.0,
    'Tomato': 1800.0,
    'Wheat': 2650.0,
    'Rice': 3100.0,
    'Potato': 1600.0,
    'Soybean': 5200.0,
}


def _normalize_district_token(value: str) -> str:
    return ''.join(ch for ch in value.lower() if ch.isalpha())


def _canonical_district(value: str) -> str:
    cleaned = _normalize_district_token(value)
    if not cleaned:
        return value.strip().title() or 'Nashik'

    if cleaned in DISTRICT_ALIASES:
        return DISTRICT_ALIASES[cleaned]

    for district in DISTRICT_LIST:
        token = _normalize_district_token(district)
        if token == cleaned or token in cleaned or cleaned in token:
            return district

    return value.strip().title()


def _canonical_state(value: str) -> str:
    text = value.strip()
    if text.lower() == 'maharashtra':
        return 'Maharashtra'
    return text.title()


def _cache_key(state: str, district: str) -> tuple[str, str]:
    return (_canonical_state(state).lower(), _canonical_district(district).lower())


def _save_records_to_cache(state: str, district: str, records: list[dict[str, Any]]) -> None:
    MARKET_RECORD_CACHE[_cache_key(state, district)] = {
        'records': records,
        'cached_at': datetime.now(UTC),
    }


def _get_cached_records(state: str, district: str) -> tuple[list[dict[str, Any]], datetime | None]:
    cached = MARKET_RECORD_CACHE.get(_cache_key(state, district))
    if not cached:
        return [], None

    cached_at = cached.get('cached_at')
    if not isinstance(cached_at, datetime):
        return [], None

    age = (datetime.now(UTC) - cached_at).total_seconds()
    if age > CACHE_TTL_SECONDS:
        return [], None

    records = cached.get('records') or []
    return records, cached_at


def _fallback_records(district: str, today: str) -> list[dict[str, Any]]:
    mandi_name = f'{district} Mandi'
    return [
        {
            'commodity': crop,
            'market': mandi_name,
            'modal_price': str(price),
            'arrival_date': today,
        }
        for crop, price in FALLBACK_PRICES.items()
    ]


async def _fetch_records_with_retry(url: str, params: dict[str, Any], attempts: int = 3) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                payload = response.json()
                return payload.get('records') or []
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            if attempt < attempts:
                await asyncio.sleep(0.4 * attempt)

    if last_error:
        raise last_error

    return []


def _pick(record: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in record and record[key] not in (None, ''):
            return record[key]
    return None


def _to_float(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _to_date(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    formats = [
        '%Y-%m-%d',
        '%d/%m/%Y',
        '%d-%m-%Y',
        '%d %b %Y',
        '%d %B %Y',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _distance_km(lat1: float, lon1: float, lat2: float | None, lon2: float | None) -> float | None:
    if lat2 is None or lon2 is None:
        return None

    radius = 6371.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return round(radius * c, 2)


@router.get('/prices/live')
async def live_prices(
    district: str = Query(..., min_length=2),
    state: str = Query(default='Maharashtra', min_length=2),
    lat: float | None = Query(default=None),
    lon: float | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    canonical_district = _canonical_district(district)
    canonical_state = _canonical_state(state)

    params = {
        'api-key': settings.data_gov_api_key,
        'format': 'json',
        'limit': 500,
        'filters[state]': canonical_state,
        'filters[district]': canonical_district,
    }

    url = f"{settings.data_gov_base_url.rstrip('/')}/resource/{settings.data_gov_resource_id}"
    source_status = 'live'
    cached_at: datetime | None = None

    records: list[dict[str, Any]] = []
    if settings.data_gov_api_key:
        try:
            records = await _fetch_records_with_retry(url, params=params)
            if records:
                _save_records_to_cache(canonical_state, canonical_district, records)
        except Exception:
            cached_records, cached_at = _get_cached_records(canonical_state, canonical_district)
            if cached_records:
                records = cached_records
                source_status = 'cached'
            else:
                source_status = 'fallback'
    else:
        cached_records, cached_at = _get_cached_records(canonical_state, canonical_district)
        if cached_records:
            records = cached_records
            source_status = 'cached'
        else:
            source_status = 'fallback'

    if not records and source_status in ('fallback', 'cached'):
        records = _fallback_records(canonical_district, datetime.now(UTC).date().isoformat())
        source_status = 'fallback'

    normalized: list[dict[str, Any]] = []
    for record in records:
        commodity = _pick(record, ['commodity', 'Commodity'])
        market_name = _pick(record, ['market', 'Market'])
        modal_price = _to_float(_pick(record, ['modal_price', 'Modal Price (Rs./Quintal)', 'Modal Price']))
        date_value = _pick(record, ['arrival_date', 'Arrival_Date', 'Arrival Date'])
        date_obj = _to_date(date_value)

        if not commodity or not market_name or modal_price is None:
            continue

        market_lat = _to_float(_pick(record, ['latitude', 'Latitude']))
        market_lon = _to_float(_pick(record, ['longitude', 'Longitude']))

        distance = None
        if lat is not None and lon is not None:
            distance = _distance_km(lat, lon, market_lat, market_lon)

        normalized.append(
            {
                'crop': str(commodity).strip(),
                'mandi': str(market_name).strip(),
                'price': modal_price,
                'date': date_obj,
                'distance_km': distance,
            }
        )

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in normalized:
        key = (item['crop'], item['mandi'])
        grouped[key].append(item)

    rows: list[dict[str, Any]] = []
    for (_, _), entries in grouped.items():
        entries.sort(key=lambda value: value['date'] or datetime.min, reverse=True)
        latest = entries[0]
        previous = entries[1] if len(entries) > 1 else None

        price_change = None
        if previous and previous['price']:
            price_change = round(((latest['price'] - previous['price']) / previous['price']) * 100, 2)

        rows.append(
            {
                'crop': latest['crop'],
                'mandi': latest['mandi'],
                'price': latest['price'],
                'change': price_change,
                'distance_km': latest['distance_km'],
                'date': latest['date'].date().isoformat() if latest['date'] else None,
            }
        )

    rows.sort(
        key=lambda value: (
            value['distance_km'] is None,
            value['distance_km'] if value['distance_km'] is not None else 10**9,
            value['crop'],
        )
    )

    logger.info(
        'market_prices_resolved',
        source_status=source_status,
        district=canonical_district,
        state=canonical_state,
        has_coordinates=lat is not None and lon is not None,
        result_count=len(rows[:limit]),
    )

    return {
        'district': canonical_district,
        'state': canonical_state,
        'count': len(rows[:limit]),
        'prices': rows[:limit],
        'source': 'agmarknet-data-gov',
        'source_status': source_status,
        'last_updated': cached_at.isoformat() if cached_at else datetime.now(UTC).isoformat(),
    }
