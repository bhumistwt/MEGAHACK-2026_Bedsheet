from collections import Counter
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.logging import get_logger

router = APIRouter(prefix='/telemetry', tags=['telemetry'])
logger = get_logger('khetwala.telemetry')

_EVENT_COUNTER = Counter()
_LAST_EVENT_AT: datetime | None = None


class TelemetryEvent(BaseModel):
    event_name: str = Field(min_length=2, max_length=64)
    source: str = Field(default='mobile-app', max_length=64)
    district: str | None = Field(default=None, max_length=64)
    state: str | None = Field(default=None, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post('/events')
def ingest_event(payload: TelemetryEvent) -> dict[str, Any]:
    global _LAST_EVENT_AT

    event_key = payload.event_name.strip().lower()
    _EVENT_COUNTER[event_key] += 1
    _LAST_EVENT_AT = datetime.now(UTC)

    logger.info(
        'telemetry_event_ingested',
        event_name=event_key,
        source=payload.source,
        district=payload.district,
        state=payload.state,
    )

    return {
        'ok': True,
        'event_name': event_key,
        'count': _EVENT_COUNTER[event_key],
        'last_event_at': _LAST_EVENT_AT.isoformat(),
    }


@router.get('/summary')
def telemetry_summary() -> dict[str, Any]:
    return {
        'total_events': int(sum(_EVENT_COUNTER.values())),
        'by_event': dict(_EVENT_COUNTER),
        'last_event_at': _LAST_EVENT_AT.isoformat() if _LAST_EVENT_AT else None,
    }
