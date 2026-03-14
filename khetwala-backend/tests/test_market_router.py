import asyncio

from routers import market as market_router
from core.config import settings


class _MockResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            'records': [
                {
                    'commodity': 'Onion',
                    'market': 'NearMandi',
                    'modal_price': '2200',
                    'arrival_date': '2025-02-01',
                    'latitude': '20.011',
                    'longitude': '73.79',
                }
            ]
        }


class _GoodClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, *args, **kwargs):
        return _MockResponse()


class _BadClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, *args, **kwargs):
        raise RuntimeError('source down')


def _run(coro):
    return asyncio.run(coro)


def test_market_district_canonicalization_with_fallback():
    original_key = settings.data_gov_api_key
    try:
        settings.data_gov_api_key = ''
        market_router.MARKET_RECORD_CACHE.clear()
        payload = _run(
            market_router.live_prices(
                district='Nasik',
                state='maharashtra',
                lat=20.011,
                lon=73.79,
                limit=10,
            )
        )
        assert payload['district'] == 'Nashik'
        assert payload['state'] == 'Maharashtra'
        assert payload['source_status'] == 'fallback'
        assert payload['count'] > 0
    finally:
        settings.data_gov_api_key = original_key


def test_market_uses_cache_when_live_source_fails():
    original_key = settings.data_gov_api_key
    original_client = market_router.httpx.AsyncClient
    try:
        settings.data_gov_api_key = 'x'
        market_router.MARKET_RECORD_CACHE.clear()

        market_router.httpx.AsyncClient = _GoodClient
        live_payload = _run(
            market_router.live_prices(
                district='Nashik',
                state='Maharashtra',
                lat=20.011,
                lon=73.79,
                limit=10,
            )
        )
        assert live_payload['source_status'] == 'live'
        assert live_payload['count'] == 1

        market_router.httpx.AsyncClient = _BadClient
        cached_payload = _run(
            market_router.live_prices(
                district='Nashik',
                state='Maharashtra',
                lat=20.011,
                lon=73.79,
                limit=10,
            )
        )
        assert cached_payload['source_status'] == 'cached'
        assert cached_payload['count'] == 1
    finally:
        market_router.httpx.AsyncClient = original_client
        settings.data_gov_api_key = original_key
