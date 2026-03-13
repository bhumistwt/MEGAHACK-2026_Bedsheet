from typing import Any, Dict

from fastapi import APIRouter

from services.weather_service import fetch_current_weather, fetch_weather_features

router = APIRouter(prefix='/weather', tags=['weather'])


@router.get('/current/{district}')
def get_current_weather(district: str) -> Dict[str, Any]:
    return fetch_current_weather(district=district)


@router.get('/{district}')
def get_weather(district: str, state: str = 'Maharashtra') -> Dict[str, Any]:
    features = fetch_weather_features(district=district, state=state)
    current = fetch_current_weather(district=district)

    temp = float(features.get('avg_temp_next7days', 32))
    rain_3d = bool(features.get('rain_in_3days', False))
    extreme = bool(features.get('extreme_weather_flag', False))

    alerts = []
    if rain_3d:
        alerts.append(
            {
                'type': 'rain',
                'urgency': 1,
                'color': 'red',
                'message': 'Rain is expected soon. Consider harvest and storage precautions today.',
            }
        )
    if temp > 38:
        alerts.append(
            {
                'type': 'heat',
                'urgency': 2,
                'color': 'orange',
                'message': f'High heat ({round(temp)}°C) expected. Storage spoilage risk may increase.',
            }
        )
    if extreme and not rain_3d and temp <= 38:
        alerts.append(
            {
                'type': 'extreme',
                'urgency': 2,
                'color': 'orange',
                'message': 'Extreme weather alert. Protect harvested produce.',
            }
        )
    if not alerts:
        alerts.append(
            {
                'type': 'clear',
                'urgency': 10,
                'color': 'green',
                'message': 'Weather looks stable for the next few days.',
            }
        )

    return {
        'district': district,
        'state': state,
        'temp_min': features.get('temp_min'),
        'temp_max': features.get('temp_max'),
        'avg_temp': features.get('avg_temp_next7days'),
        'humidity': features.get('humidity'),
        'rainfall_mm': features.get('rainfall'),
        'rain_in_3days': rain_3d,
        'rain_in_7days': features.get('rain_in_7days'),
        'extreme_weather': extreme,
        'alerts': alerts,
        'source': features.get('source', 'fallback'),
        'confidence': features.get('confidence', 0.58),
        'current': {
            'temp': current.get('temp'),
            'humidity': current.get('humidity'),
            'rain_mm': current.get('rain_mm', 0),
            'windspeed': current.get('windspeed', 0),
            'description': current.get('description', ''),
            'is_day': current.get('is_day', True),
        },
    }
