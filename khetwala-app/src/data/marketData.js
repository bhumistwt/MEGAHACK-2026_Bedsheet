import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBackendBaseUrl } from '../config/backend';

export const DISTRICTS = ['Nashik', 'Pune', 'Nagpur', 'Aurangabad', 'Solapur', 'Kolhapur'];
const DISTRICT_ALIASES = {
  nashik: 'Nashik',
  nasik: 'Nashik',
  pune: 'Pune',
  poona: 'Pune',
  nagpur: 'Nagpur',
  aurangabad: 'Aurangabad',
  chhatrapatisambhajinagar: 'Aurangabad',
  sambhajinagar: 'Aurangabad',
  solapur: 'Solapur',
  sholapur: 'Solapur',
  kolhapur: 'Kolhapur',
};
const CROP_EMOJI = {
  onion: '🧅',
  tomato: '🍅',
  wheat: '🌾',
  rice: '🍚',
  potato: '🥔',
  maize: '🌽',
  cotton: '🧶',
  soybean: '🫘',
  sugarcane: '🎋',
};

const API_BASE_URL = getBackendBaseUrl();
const MARKET_CACHE_PREFIX = 'market_prices_v1';

export async function sendMarketTelemetry(eventName, payload = {}) {
  try {
    await fetch(`${API_BASE_URL}/telemetry/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: eventName,
        source: 'market-screen',
        district: payload.district || null,
        state: payload.state || null,
        metadata: payload.metadata || {},
      }),
    });
  } catch {
    // ignore telemetry failures
  }
}

function normalizeDistrictToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/district|division|city|municipal/gi, '')
    .replace(/[^a-z]/g, '')
    .trim();
}

export function resolveDistrictName(rawDistrict, fallbackDistrict = 'Nashik') {
  const fallback = DISTRICTS.includes(fallbackDistrict) ? fallbackDistrict : DISTRICTS[0];
  if (!rawDistrict) {
    return fallback;
  }

  const cleaned = normalizeDistrictToken(rawDistrict);
  if (!cleaned) {
    return fallback;
  }

  if (DISTRICT_ALIASES[cleaned]) {
    return DISTRICT_ALIASES[cleaned];
  }

  const direct = DISTRICTS.find((district) => normalizeDistrictToken(district) === cleaned);
  if (direct) {
    return direct;
  }

  const contains = DISTRICTS.find((district) => {
    const token = normalizeDistrictToken(district);
    return token.includes(cleaned) || cleaned.includes(token);
  });

  return contains || fallback;
}

function getEmojiForCrop(crop) {
  const key = String(crop || '').toLowerCase();
  return CROP_EMOJI[key] || '🌿';
}

function normalizePrices(prices = []) {
  return prices.map((item) => ({
    crop: item.crop,
    emoji: getEmojiForCrop(item.crop),
    mandi: item.mandi,
    price: item.price,
    change: item.change,
    distance_km: item.distance_km,
    date: item.date,
  }));
}

function buildCacheKey({ district, state, lat, lon }) {
  const latKey = lat != null ? Number(lat).toFixed(2) : 'none';
  const lonKey = lon != null ? Number(lon).toFixed(2) : 'none';
  return `${MARKET_CACHE_PREFIX}:${state}:${district}:${latKey}:${lonKey}`;
}

async function saveCachedMarketResponse(cacheKey, response) {
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify(response));
  } catch {
    // ignore cache write failure
  }
}

async function readCachedMarketResponse(cacheKey) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw lastError;
}

async function fetchLivePrices({ district, state = 'Maharashtra', lat, lon, limit = 25 }) {
  if (!district) {
    return { prices: [], sourceStatus: 'fallback', lastUpdated: null };
  }

  const resolvedDistrict = resolveDistrictName(district, DISTRICTS[0]);
  const params = new URLSearchParams({ district: resolvedDistrict, state, limit: String(limit) });
  if (lat != null && lon != null) {
    params.append('lat', String(lat));
    params.append('lon', String(lon));
  }
  const cacheKey = buildCacheKey({ district: resolvedDistrict, state, lat, lon });

  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/market/prices/live?${params.toString()}`);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Failed to fetch live mandi prices');
    }

    const payload = await response.json();
    const normalizedPrices = normalizePrices(payload.prices || []);
    const nextResult = {
      prices: normalizedPrices,
      sourceStatus: payload.source_status || 'live',
      lastUpdated: payload.last_updated || new Date().toISOString(),
    };
    if (nextResult.sourceStatus !== 'live') {
      await sendMarketTelemetry('market_source_non_live', {
        district: resolvedDistrict,
        state,
        metadata: { sourceStatus: nextResult.sourceStatus },
      });
    }
    await saveCachedMarketResponse(cacheKey, nextResult);
    return nextResult;
  } catch {
    await sendMarketTelemetry('market_fetch_failed', {
      district: resolvedDistrict,
      state,
      metadata: { hasCoordinates: lat != null && lon != null },
    });
    const cached = await readCachedMarketResponse(cacheKey);
    if (cached && Array.isArray(cached.prices)) {
      return {
        prices: normalizePrices(cached.prices),
        sourceStatus: 'cached',
        lastUpdated: cached.lastUpdated || new Date().toISOString(),
      };
    }
    throw new Error('Failed to fetch live mandi prices');
  }
}

export async function getAllPricesForDistrict(district, state = 'Maharashtra') {
  return fetchLivePrices({ district, state });
}

export async function getNearbyMandiPrices({ district, state = 'Maharashtra', latitude, longitude }) {
  return fetchLivePrices({ district, state, lat: latitude, lon: longitude });
}
