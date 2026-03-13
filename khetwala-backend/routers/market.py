from collections import defaultdict
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from core.config import settings

router = APIRouter(prefix='/market', tags=['market'])


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
    if not settings.data_gov_api_key:
        raise HTTPException(status_code=500, detail='DATA_GOV_API_KEY is not configured')

    params = {
        'api-key': settings.data_gov_api_key,
        'format': 'json',
        'limit': 500,
        'filters[state]': state,
        'filters[district]': district,
    }

    url = f"{settings.data_gov_base_url.rstrip('/')}/resource/{settings.data_gov_resource_id}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f'Mandi source API error: {exc.response.status_code}') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail='Failed to connect to mandi source API') from exc

    records = payload.get('records') or []

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

    return {
        'district': district,
        'state': state,
        'count': len(rows[:limit]),
        'prices': rows[:limit],
        'source': 'agmarknet-data-gov',
    }
