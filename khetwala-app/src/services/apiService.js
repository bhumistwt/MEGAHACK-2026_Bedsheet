import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

/**
 * Khetwala API Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Production-ready API client with caching, error handling, and offline fallback.
 * Connects to the Khetwala FastAPI backend for all predictions and data.
 * Now with NetInfo-based connectivity detection for accurate offline handling.
 */

// Base URL configuration - use environment variable or default to localhost
// For USB debugging: Use 'http://localhost:8000' with `adb reverse tcp:8000 tcp:8000`
// For WiFi: Set EXPO_PUBLIC_BACKEND_URL to your computer's LAN IP
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const TOKEN_KEY = '@khetwala_auth_token';
const GUEST_TOKEN = '@guest_session';

// Cache configuration
const CACHE_PREFIX = 'khetwala_api_cache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// API client with timeout and default headers
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15000, // 15 second timeout
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token && token !== GUEST_TOKEN) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Ignore token read failures.
  }
  return config;
});

// ─── Axios response interceptor for unified error handling ──────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Enrich error with connectivity info
    if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
      const online = await isDeviceOnline();
      error._deviceOnline = online;
      error._friendlyMessage = online
        ? 'Server unreachable. Make sure backend is running and device is on the same network.'
        : 'No internet connection. Check your WiFi or mobile data.';
    } else if (error.code === 'ECONNABORTED') {
      error._friendlyMessage = 'Request timed out. Server may be slow or unreachable.';
    }
    return Promise.reject(error);
  }
);

// ─── Network connectivity check (used before API calls) ─────────────────────
let _lastNetState = { isConnected: true, isInternetReachable: true };

/**
 * Quick check if device has network connectivity using NetInfo.
 * @returns {Promise<boolean>}
 */
export const isDeviceOnline = async () => {
  try {
    const state = await NetInfo.fetch();
    _lastNetState = state;
    return state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true; // assume online if NetInfo fails
  }
};

/**
 * Get the last known network state (synchronous, for non-async contexts).
 */
export const getLastNetworkState = () => _lastNetState;

const CROP_MATURITY_DAYS = {
  onion: 125,
  tomato: 95,
  wheat: 120,
  rice: 135,
  potato: 105,
  soybean: 110,
};

const CROP_BASE_PRICE = {
  onion: 2100,
  tomato: 1750,
  wheat: 2650,
  rice: 3100,
  potato: 1550,
  soybean: 5200,
};

const STORAGE_BASE_RISK = {
  'open field': 0.7,
  warehouse: 0.4,
  'cold storage': 0.15,
};

const CROP_DECAY_RATE = {
  onion: 0.008,
  tomato: 0.04,
  wheat: 0.0015,
  rice: 0.0015,
  potato: 0.01,
  soybean: 0.0045,
};

const normalize = (value) => String(value || '').trim().toLowerCase();

const buildComboKey = (crop, district) =>
  `${normalize(crop) || 'unknown-crop'}::${normalize(district) || 'unknown-district'}`;

const buildCacheKey = (endpoint, crop, district) =>
  `${CACHE_PREFIX}:${endpoint}:${buildComboKey(crop, district)}`;

const toIso = (date) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
};

const withMeta = (payload, source) => ({
  ...payload,
  _meta: {
    source,
    usedCache: source === 'cache',
    usedMock: source === 'mock',
    banner:
      source === 'cache'
        ? '\u{1F4F5} Using cached data'
        : source === 'mock'
          ? '\u{1F4F4} Offline mode'
          : null,
    timestamp: new Date().toISOString(),
  },
});

/**
 * Check if the API backend is reachable and healthy.
 * First checks device connectivity via NetInfo, then pings backend.
 * @returns {Promise<{healthy: boolean, online: boolean, services: object}>}
 */
export const checkApiHealth = async () => {
  // Step 1: Check device connectivity
  const online = await isDeviceOnline();
  if (!online) {
    return {
      healthy: false,
      online: false,
      services: {},
      error: 'Device is offline',
    };
  }

  // Step 2: Check backend
  try {
    const response = await apiClient.get('/health');
    return {
      healthy: response.data?.status === 'healthy',
      online: true,
      services: response.data?.services || {},
      version: response.data?.version,
    };
  } catch (error) {
    return {
      healthy: false,
      online: true,
      services: {},
      error: error.code === 'ECONNABORTED'
        ? 'Server timeout'
        : error.message?.includes('Network Error')
          ? 'Server unreachable on this network'
          : error.message,
    };
  }
};

/**
 * Get the current API configuration.
 * @returns {object} API configuration details
 */
export const getApiConfig = () => ({
  baseUrl: BASE_URL,
  timeout: apiClient.defaults.timeout,
  cachePrefix: CACHE_PREFIX,
  cacheTtlMs: CACHE_TTL_MS,
});

const readCachedPayload = async (cacheKey) => {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || !parsed?.payload) {
      return null;
    }

    if (Date.now() - Number(parsed.timestamp) > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(cacheKey);
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
};

const writeCachedPayload = async (cacheKey, payload) => {
  try {
    await AsyncStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        payload,
      })
    );
  } catch {
    // Ignore cache write failures.
  }
};

/**
 * Make an API request with automatic fallback to cache or mock data.
 * Implements a four-tier fallback strategy:
 * 0. Check device connectivity via NetInfo
 * 1. Try network request to backend
 * 2. Fall back to cached response if available
 * 3. Use mock data as last resort
 */
const requestWithFallback = async ({
  endpoint,
  payload,
  crop,
  district,
  mockFactory,
}) => {
  const cacheKey = buildCacheKey(endpoint, crop, district);

  // Pre-check: is device online?
  const online = await isDeviceOnline();
  if (!online) {
    if (__DEV__) console.warn(`[apiService] Device offline, skipping ${endpoint}`);
    const cachedPayload = await readCachedPayload(cacheKey);
    if (cachedPayload) return withMeta(cachedPayload, 'cache');
    return withMeta(mockFactory(), 'mock');
  }

  try {
    const response = await apiClient.post(endpoint, payload);
    const data = response?.data || {};

    // Validate response has expected structure
    if (typeof data !== 'object') {
      throw new Error('Invalid response format');
    }

    // Cache successful response
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    // Log error for debugging (in production, send to monitoring)
    if (__DEV__) {
      console.warn(`API request failed for ${endpoint}:`, error.message);
    }

    // Try cached data first
    const cachedPayload = await readCachedPayload(cacheKey);
    if (cachedPayload) {
      return withMeta(cachedPayload, 'cache');
    }

    // Last resort: use mock data
    return withMeta(mockFactory(), 'mock');
  }
};

const buildHarvestMock = (cropData) => {
  const cropKey = normalize(cropData.crop);
  const maturityDays = CROP_MATURITY_DAYS[cropKey] || 110;
  const sowing = new Date(cropData.sowing_date || cropData.sowingDate || new Date());
  if (Number.isNaN(sowing.getTime())) {
    sowing.setTime(Date.now() - 100 * 24 * 60 * 60 * 1000);
  }

  const base = new Date(sowing);
  base.setDate(base.getDate() + maturityDays);

  const start = new Date(base);
  const end = new Date(base);
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);

  const cropStage = normalize(cropData.crop_stage || cropData.cropStage);
  const recommendation =
    cropStage === 'harvest-ready' ? 'harvest_now' : 'wait_2_days';

  return {
    harvest_window: {
      start: toIso(start),
      end: toIso(end),
    },
    recommendation,
    risk_if_delayed:
      'Using local fallback model. Confirm once connectivity resumes.',
    confidence: 0.58,
  };
};

const buildMandiMock = (cropData) => {
  const cropKey = normalize(cropData.crop);
  const basePrice = CROP_BASE_PRICE[cropKey] || 2200;
  const qtyQuintals = Number(cropData.quantity_quintals || cropData.quantityQuintals || 10);

  const rangeMin = Math.round(basePrice * 0.96);
  const rangeMax = Math.round(basePrice * 1.05);
  const transport = 240;
  const netBest = Math.round(rangeMax * qtyQuintals - transport * qtyQuintals);
  const netLocal = Math.round(rangeMin * qtyQuintals);

  return {
    best_mandi: `${cropData.district || 'Local'} Mandi`,
    expected_price_range: [rangeMin, rangeMax],
    transport_cost: transport,
    net_profit_comparison: {
      best_mandi: netBest,
      local_mandi: netLocal,
    },
    price_trend: {
      direction: 'stable',
      confidence: 0.56,
    },
    confidence: 0.56,
  };
};

const buildSpoilageMock = (storageData) => {
  const cropKey = normalize(storageData.crop);
  const storageKey = normalize(storageData.storage_type || storageData.storageType);
  const days = Math.max(0, Number(storageData.days_since_harvest || storageData.daysSinceHarvest || 0));
  const transit = Math.max(0, Number(storageData.transit_hours || storageData.transitHours || 0));
  const avgTemp = Number(storageData.avg_temp || 34);

  const base = STORAGE_BASE_RISK[storageKey] ?? 0.4;
  const decay = CROP_DECAY_RATE[cropKey] ?? 0.008;
  const tempPenalty = avgTemp > 30 ? (avgTemp - 30) * 0.02 : 0;
  const risk = Math.min(0.95, base + days * decay + transit * 0.015 + tempPenalty);
  const riskScore = Number(risk.toFixed(3));

  const riskCategory =
    riskScore <= 0.3
      ? 'Low'
      : riskScore <= 0.6
        ? 'Medium'
        : riskScore <= 0.8
          ? 'High'
          : 'Critical';

  const daysSafe = riskScore >= 0.7 ? 0 : Math.max(0, Math.floor((0.7 - riskScore) / (decay + 0.003)));

  return {
    risk_score: riskScore,
    risk_category: riskCategory,
    risk_factors: [
      `${days} days since harvest increased base decay.`,
      `${Math.round(transit)} transit hours increased handling exposure.`,
      avgTemp > 30
        ? 'High temperature accelerated spoilage.'
        : 'Temperature impact was moderate.',
    ],
    days_safe: daysSafe,
    preservation_actions_ranked: [
      {
        rank: 1,
        tag: 'cheapest',
        action: 'Sell immediately at local market',
        cost_inr_per_quintal: 0,
        saves_percent: 24,
      },
      {
        rank: 2,
        tag: 'moderate',
        action: 'Move to cold storage',
        cost_inr_per_quintal: 450,
        saves_percent: 84,
      },
      {
        rank: 3,
        tag: 'best_outcome',
        action: 'Grade + warehouse storage',
        cost_inr_per_quintal: 780,
        saves_percent: 91,
      },
    ],
    avg_temp: avgTemp,
    confidence: 0.57,
  };
};

const buildExplainMock = (decisionData) => ({
  weather_reason:
    'Weather is stable for the next 7 days. Safe window for field operations.',
  market_reason: `Mandi prices for ${decisionData.crop} are stable. Monitor daily before dispatch.`,
  supply_reason: 'Supply levels are normal this week; sudden oversupply pressure is limited.',
  confidence_message: 'Medium confidence. Limited mandi data for your district.',
  confidence: 0.58,
  decision_id: decisionData.decision_id || decisionData.decisionId || 'mock-decision',
});

export const getHarvestRecommendation = async (cropData) =>
  requestWithFallback({
    endpoint: '/predict/harvest',
    payload: {
      crop: cropData.crop,
      district: cropData.district,
      sowing_date: cropData.sowingDate || cropData.sowing_date,
      crop_stage: cropData.cropStage || cropData.crop_stage || 'harvest-ready',
      soil_type: cropData.soilType || cropData.soil_type || 'Loamy',
      state: cropData.state || 'Maharashtra',
    },
    crop: cropData.crop,
    district: cropData.district,
    mockFactory: () => buildHarvestMock(cropData),
  });

export const getMandiRecommendation = async (cropData) =>
  requestWithFallback({
    endpoint: '/predict/mandi',
    payload: {
      crop: cropData.crop,
      district: cropData.district,
      quantity_quintals: Number(cropData.quantityQuintals || cropData.quantity_quintals || 10),
      state: cropData.state || 'Maharashtra',
    },
    crop: cropData.crop,
    district: cropData.district,
    mockFactory: () => buildMandiMock(cropData),
  });

export const getSpoilageRisk = async (storageData) =>
  requestWithFallback({
    endpoint: '/predict/spoilage',
    payload: {
      crop: storageData.crop,
      storage_type: storageData.storageType || storageData.storage_type,
      transit_hours: Number(storageData.transitHours || storageData.transit_hours || 12),
      days_since_harvest: Number(storageData.daysSinceHarvest || storageData.days_since_harvest || 0),
      district: storageData.district || 'Nashik',
      state: storageData.state || 'Maharashtra',
    },
    crop: storageData.crop,
    district: storageData.district || 'Nashik',
    mockFactory: () => buildSpoilageMock(storageData),
  });

export const getExplanation = async (decisionData) =>
  requestWithFallback({
    endpoint: '/explain/recommendation',
    payload: {
      crop: decisionData.crop,
      district: decisionData.district,
      decision_id: decisionData.decisionId || decisionData.decision_id || 'decision-latest',
      state: decisionData.state || 'Maharashtra',
    },
    crop: decisionData.crop,
    district: decisionData.district,
    mockFactory: () => buildExplainMock(decisionData),
  });

export const formatCurrency = (value) =>
  `\u20B9${new Intl.NumberFormat('en-IN').format(Math.round(Number(value) || 0))}`;

export const classifyConfidence = (score) => {
  const value = Number(score || 0);
  if (value > 0.75) {
    return {
      label: 'High confidence',
      color: '#1F9D55',
    };
  }
  if (value > 0.55) {
    return {
      label: 'Medium confidence',
      color: '#D9A400',
    };
  }
  return {
    label: 'Based on regional averages',
    color: '#D9822B',
  };
};

export const API_BASE_URL = BASE_URL;

// ═══════════════════════════════════════════════════════════════════════════════
// Weather API — Real-time weather from backend (Open-Meteo powered)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch real-time current weather for a district.
 * @param {string} district - District name (e.g. "Nashik")
 * @returns {Promise<{temp, humidity, rain_mm, description, windspeed, source}>}
 */
export const fetchCurrentWeather = async (district = 'nashik') => {
  const cacheKey = `${CACHE_PREFIX}:weather_current:${district.toLowerCase()}`;
  try {
    const response = await apiClient.get(`/api/weather/current/${encodeURIComponent(district.toLowerCase())}`);
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Current weather fetch failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta({
      temp: 32, humidity: 60, rain_mm: 0, description: 'Data unavailable',
      windspeed: 0, source: 'mock',
    }, 'mock');
  }
};

/**
 * Fetch full weather forecast and alerts for a district.
 * @param {string} district - District name (e.g. "Nashik")
 * @returns {Promise<{temp_min, temp_max, avg_temp, humidity, rainfall_mm, alerts, current, ...}>}
 */
export const fetchWeatherForecast = async (district = 'nashik') => {
  const cacheKey = `${CACHE_PREFIX}:weather_forecast:${district.toLowerCase()}`;
  try {
    const response = await apiClient.get(`/api/weather/${encodeURIComponent(district.toLowerCase())}`);
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Weather forecast fetch failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta({
      temp_min: 25, temp_max: 35, avg_temp: 30, humidity: 60, rainfall_mm: 0,
      rain_in_3days: false, rain_in_7days: false, extreme_weather: false,
      alerts: [{ type: 'clear', urgency: 10, color: 'green', message: 'Weather data unavailable' }],
      current: { temp: 32, humidity: 60, rain_mm: 0, description: 'Data unavailable' },
      source: 'mock',
    }, 'mock');
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Intelligence API (v2) — Database-backed, ML-powered endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get full AI advisory for a farmer's situation.
 * Single call returns: price forecast, spoilage risk, harvest timing, mandi rankings.
 */
export const getFullAdvisory = async (params) => {
  const cacheKey = buildCacheKey('full-advisory', params.crop, params.district);
  try {
    const response = await apiClient.post('/intelligence/full-advisory', {
      crop: params.crop,
      district: params.district,
      quantity_quintals: Number(params.quantityQuintals || params.quantity_quintals || 10),
      sowing_date: params.sowingDate || params.sowing_date || null,
      storage_type: params.storageType || params.storage_type || 'covered',
      packaging: params.packaging || 'jute_bag',
    });
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Full advisory failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    // Fall back to old endpoints
    return null;
  }
};

/**
 * Get ML-powered price forecast (7-15 days).
 */
export const getPriceForecast = async (params) => {
  const cacheKey = buildCacheKey('price-forecast', params.crop, params.district);
  try {
    const response = await apiClient.post('/intelligence/price-forecast', {
      crop: params.crop,
      district: params.district,
      forecast_days: params.forecastDays || params.forecast_days || 7,
    });
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Price forecast failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta(buildMandiMock(params), 'mock');
  }
};

/**
 * Get ML-powered mandi recommendation with profit analysis.
 */
export const getMandiRecommendationV2 = async (params) => {
  const cacheKey = buildCacheKey('mandi-recommend', params.crop, params.district);
  try {
    const response = await apiClient.post('/intelligence/mandi-recommend', {
      crop: params.crop,
      district: params.district,
      quantity_quintals: Number(params.quantityQuintals || params.quantity_quintals || 10),
      storage_type: params.storageType || params.storage_type || 'covered',
      packaging: params.packaging || 'jute_bag',
    });
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Mandi recommend failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta(buildMandiMock(params), 'mock');
  }
};

/**
 * Get ML-powered spoilage risk assessment.
 */
export const getSpoilageRiskV2 = async (params) => {
  const cacheKey = buildCacheKey('spoilage-v2', params.crop, params.district);
  try {
    const response = await apiClient.post('/intelligence/spoilage-risk', {
      crop: params.crop,
      district: params.district,
      destination_market: params.destinationMarket || params.destination_market || null,
      storage_type: params.storageType || params.storage_type || 'covered',
      packaging: params.packaging || 'jute_bag',
      harvest_days_ago: Number(params.daysSinceHarvest || params.harvest_days_ago || 0),
      quantity_kg: Number(params.quantityKg || params.quantity_kg || 1000),
    });
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Spoilage v2 failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta(buildSpoilageMock(params), 'mock');
  }
};

/**
 * Get harvest window recommendation from ML model.
 */
export const getHarvestWindowV2 = async (params) => {
  const cacheKey = buildCacheKey('harvest-v2', params.crop, params.district);
  try {
    const response = await apiClient.post('/intelligence/harvest-window', {
      crop: params.crop,
      district: params.district,
      sowing_date: params.sowingDate || params.sowing_date || null,
      crop_age_days: params.cropAgeDays || params.crop_age_days || null,
    });
    const data = response?.data || {};
    await writeCachedPayload(cacheKey, data);
    return withMeta(data, 'network');
  } catch (error) {
    if (__DEV__) console.warn('Harvest v2 failed:', error.message);
    const cached = await readCachedPayload(cacheKey);
    if (cached) return withMeta(cached, 'cache');
    return withMeta(buildHarvestMock(params), 'mock');
  }
};

/**
 * Scan a plant image for disease using the backend HuggingFace proxy.
 * Sends the base64-encoded image to /api/disease/scan.
 * @param {string} imageBase64 - Base64 encoded image string (no data URI prefix)
 * @returns {Promise<object>} Disease scan result
 */
export const scanDisease = async (imageBase64) => {
  try {
    const response = await apiClient.post('/api/disease/scan', {
      image_base64: imageBase64,
    }, { timeout: 30000 }); // longer timeout for ML inference
    return response?.data || { success: false, message: 'Empty response from server' };
  } catch (error) {
    if (__DEV__) console.warn('Disease scan via backend failed:', error.message);
    const status = error?.response?.status;
    if (status === 503) {
      return {
        success: false,
        message: 'Disease detection service is not configured on the server. Please set HF_TOKEN.',
        error: 'HF_TOKEN_MISSING',
      };
    }
    if (status === 400) {
      return {
        success: false,
        message: 'Invalid image data. Please try taking the photo again.',
        error: 'INVALID_IMAGE',
      };
    }
    return {
      success: false,
      message: 'Server unreachable. Check your internet connection and try again.',
      error: error.message,
    };
  }
};

/**
 * Get database data status (row counts per table).
 */
export const getDataStatus = async () => {
  try {
    const response = await apiClient.get('/intelligence/data-status');
    return response?.data || {};
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// F1-F17 NEW FEATURE API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * [F1] Digital Twin — Create a crop simulation
 */
export const createDigitalTwin = async (payload) => {
  try {
    const resp = await apiClient.post('/digital-twin/create', payload);
    return resp?.data;
  } catch (e) {
    if (__DEV__) console.warn('createDigitalTwin failed:', e.message);
    return null;
  }
};

/**
 * [F1] Digital Twin — Get user's simulations
 */
export const getDigitalTwins = async (userId) => {
  try {
    const resp = await apiClient.get(`/digital-twin/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F1] Digital Twin — Run what-if scenario
 */
export const runWhatIf = async (simulationId, payload) => {
  try {
    const resp = await apiClient.post(`/digital-twin/${simulationId}/whatif`, payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F3] Photo Diagnostic — Submit photos for AI analysis
 */
export const photoDiagnose = async (payload) => {
  try {
    const resp = await apiClient.post('/api/disease/photo-diagnostic', payload, { timeout: 30000 });
    return resp?.data;
  } catch (e) {
    if (__DEV__) console.warn('photoDiagnose failed:', e.message);
    return null;
  }
};

/**
 * [F4] Harvest Cycles — Log a harvest cycle
 */
export const logHarvestCycle = async (payload) => {
  try {
    const resp = await apiClient.post('/harvest-cycles/log', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F4] Harvest Cycles — Get loss lessons
 */
export const getHarvestLessons = async (userId) => {
  try {
    const resp = await apiClient.get(`/harvest-cycles/lessons/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F5] Negotiation Simulator — Start session
 */
export const startNegotiation = async (payload) => {
  try {
    const resp = await apiClient.post('/simulator/start', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F5] Negotiation Simulator — Submit offer
 */
export const negotiateOffer = async (payload) => {
  try {
    const resp = await apiClient.post('/simulator/negotiate', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F6] Community — Submit crop outcome
 */
export const submitCrowdOutcome = async (payload) => {
  try {
    const resp = await apiClient.post('/community/submit-outcome', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F6] Community — Get crowd insights
 */
export const getCrowdInsights = async (district, crop) => {
  try {
    const resp = await apiClient.get(`/community/insights/${district}/${crop}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F9] Crop Diary — Create entry
 */
export const createDiaryEntry = async (payload) => {
  try {
    const resp = await apiClient.post('/diary/create', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F9] Crop Diary — Get entries
 */
export const getDiaryEntries = async (userId, params = {}) => {
  try {
    const resp = await apiClient.get(`/diary/entries/${userId}`, { params });
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F9] Crop Diary — Get diary summary
 */
export const getDiarySummary = async (userId) => {
  try {
    const resp = await apiClient.get(`/diary/summary/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F10] Credit Score — Get farmer's Krishi score
 */
export const getKrishiScore = async (userId) => {
  try {
    const resp = await apiClient.get(`/farmer/credit-score/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F11] Marketplace — Get products
 */
export const getMarketplaceProducts = async (category = null) => {
  try {
    const url = category ? `/marketplace/products?category=${category}` : '/marketplace/products';
    const resp = await apiClient.get(url);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F11] Marketplace — Get AI recommendations
 */
export const getProductRecommendations = async (payload) => {
  try {
    const resp = await apiClient.post('/marketplace/recommend', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F11] Marketplace — Get local shops
 */
export const getLocalShops = async (district) => {
  try {
    const resp = await apiClient.get(`/marketplace/shops/${district}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F12] Policy Risk — Get risk assessment for a commodity
 */
export const getPolicyRisk = async (commodity) => {
  try {
    const resp = await apiClient.get(`/market/policy-risk/${commodity}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F12] Policy Risk — Get policy alerts
 */
export const getPolicyAlerts = async () => {
  try {
    const resp = await apiClient.get('/market/policy-alerts');
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F13] B2B — Get buyer orders
 */
export const getBuyerOrders = async (params = {}) => {
  try {
    const resp = await apiClient.get('/b2b/orders', { params });
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F13] B2B — Express interest in an order
 */
export const expressInterest = async (payload) => {
  try {
    const resp = await apiClient.post('/b2b/express-interest', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F13] B2B — Get my expressions
 */
export const getMyExpressions = async (userId) => {
  try {
    const resp = await apiClient.get(`/b2b/my-expressions/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F17] IoT — Get storage devices
 */
export const getIoTDevices = async (userId) => {
  try {
    const resp = await apiClient.get(`/iot/devices/${userId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F17] IoT — Get storage history
 */
export const getStorageHistory = async (userId, deviceId) => {
  try {
    const resp = await apiClient.get(`/iot/storage-history/${userId}/${deviceId}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

/**
 * [F17] IoT — Submit storage reading
 */
export const submitStorageReading = async (payload) => {
  try {
    const resp = await apiClient.post('/iot/storage-reading', payload);
    return resp?.data;
  } catch (e) {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Soil Health APIs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch comprehensive soil health report for a district
 * Sources: Soil Health Card (SHC), ISRO Bhuvan, Sentinel-2 NDVI
 */
export const fetchSoilHealth = async (district = 'nashik') => {
  try {
    const resp = await apiClient.get(`/api/soil/health/${district}`);
    return resp?.data;
  } catch (e) {
    console.warn('Soil health API error, using cached/fallback:', e.message);
    return {
      district,
      state: 'Maharashtra',
      available: true,
      fertility: {
        nitrogen: { value: 210, unit: 'kg/ha', rating: 'Medium' },
        phosphorus: { value: 18, unit: 'kg/ha', rating: 'Medium' },
        potassium: { value: 320, unit: 'kg/ha', rating: 'High' },
      },
      properties: {
        ph: { value: 7.5, rating: 'Neutral (Ideal)', ideal_range: '6.5 - 7.5' },
        organic_carbon: { value: 0.55, unit: '%', rating: 'Medium', ideal_range: '> 0.75%' },
      },
      quality_index: { value: 0.61, max: 1.0, label: 'Good' },
      soil_type: {
        name: 'Medium Black',
        info: {
          description: 'Moderate clay content, good fertility.',
          water_retention: 'Medium-High',
          drainage: 'Moderate',
        },
      },
      moisture: { moisture_pct: 45, status: 'moderate', source: 'estimate' },
      vegetation: { ndvi: 0.52, trend_30d: 0.01, status: 'Moderate', source: 'sentinel2' },
      recommendations: [],
      sources: [
        { name: 'Soil Health Card', org: 'Govt. of India', type: 'fertility' },
        { name: 'Bhuvan', org: 'ISRO', type: 'soil_moisture' },
        { name: 'Sentinel-2 NDVI', org: 'ESA Copernicus', type: 'vegetation_health' },
      ],
    };
  }
};

/**
 * Fetch NDVI vegetation health history for charts
 */
export const fetchNDVIHistory = async (district = 'nashik', days = 30) => {
  try {
    const resp = await apiClient.get(`/api/soil/ndvi/${district}?days=${days}`);
    return resp?.data;
  } catch (e) {
    return { district, days, count: 0, history: [] };
  }
};

/**
 * Check crop suitability for a district's soil
 */
export const fetchCropSuitability = async (district, crop) => {
  try {
    const resp = await apiClient.get(`/api/soil/crop-suitability/${district}/${crop}`);
    return resp?.data;
  } catch (e) {
    return null;
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// Blockchain Trust Layer APIs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get blockchain dashboard stats for a user
 */
export const fetchBlockchainStats = async (userId) => {
  try {
    const resp = await apiClient.get(`/blockchain/stats?user_id=${userId}`);
    return resp?.data?.stats || { proofs: 0, trades: 0, settlements: 0, total_volume: 0 };
  } catch (e) {
    return { proofs: 0, trades: 0, settlements: 0, total_volume: 0, blockchain_live: false };
  }
};

/**
 * List all trades for a user (as seller or buyer)
 */
export const fetchUserTrades = async (userId) => {
  try {
    const resp = await apiClient.get(`/blockchain/trade/list?user_id=${userId}`);
    return resp?.data?.trades || [];
  } catch (e) {
    return [];
  }
};

/**
 * Get detailed trade status with settlement info
 */
export const fetchTradeStatus = async (tradeId) => {
  try {
    const resp = await apiClient.get(`/blockchain/trade/status?trade_id=${tradeId}`);
    return resp?.data?.trade || null;
  } catch (e) {
    return null;
  }
};

/**
 * Create a new trade agreement (blockchain-anchored)
 */
export const createBlockchainTrade = async (payload) => {
  try {
    const resp = await apiClient.post('/blockchain/trade/create', payload);
    return resp?.data?.trade || null;
  } catch (e) {
    console.warn('[apiService] createBlockchainTrade failed:', e?.message);
    return null;
  }
};

/**
 * Confirm delivery for a trade
 */
export const confirmTradeDelivery = async (tradeId) => {
  try {
    const resp = await apiClient.post('/blockchain/trade/confirm-delivery', { trade_id: tradeId });
    return resp?.data?.trade || null;
  } catch (e) {
    return null;
  }
};

/**
 * Lock escrow funds for a trade
 */
export const lockTradeEscrow = async (tradeId) => {
  try {
    const resp = await apiClient.post('/blockchain/settlement/lock', { trade_id: tradeId });
    return resp?.data?.settlement || null;
  } catch (e) {
    return null;
  }
};

/**
 * Release escrowed funds after delivery
 */
export const releaseTradeEscrow = async (tradeId) => {
  try {
    const resp = await apiClient.post('/blockchain/settlement/release', { trade_id: tradeId });
    return resp?.data?.settlement || null;
  } catch (e) {
    return null;
  }
};

/**
 * List all recommendation proofs for a user
 */
export const fetchUserProofs = async (userId) => {
  try {
    const resp = await apiClient.get(`/blockchain/proof/list?user_id=${userId}`);
    return resp?.data?.proofs || [];
  } catch (e) {
    return [];
  }
};

export const requestDealConnection = async (tradeId, receiverId = null) => {
  try {
    const payload = { trade_id: tradeId };
    if (receiverId) payload.receiver_id = receiverId;
    const resp = await apiClient.post('/deal-comm/connections/request', payload);
    return resp?.data || null;
  } catch (e) {
    return null;
  }
};

export const respondDealConnection = async (requestId, action) => {
  try {
    const resp = await apiClient.post('/deal-comm/connections/respond', {
      request_id: requestId,
      action,
    });
    return resp?.data || null;
  } catch (e) {
    return null;
  }
};

export const fetchDealMessages = async (tradeId) => {
  try {
    const resp = await apiClient.get(`/deal-comm/messages/list?trade_id=${tradeId}`);
    return resp?.data?.messages || [];
  } catch (e) {
    return [];
  }
};

export const sendDealMessage = async (tradeId, messageText) => {
  try {
    const resp = await apiClient.post('/deal-comm/messages/send', {
      trade_id: tradeId,
      message_text: messageText,
    });
    return resp?.data?.message || null;
  } catch (e) {
    return null;
  }
};

export const markDealMessagesRead = async (tradeId) => {
  try {
    const resp = await apiClient.post('/deal-comm/messages/mark-read', {
      trade_id: tradeId,
    });
    return resp?.data || null;
  } catch (e) {
    return null;
  }
};

export const startDealCall = async (tradeId, callType) => {
  try {
    const resp = await apiClient.post('/deal-comm/calls/start', {
      trade_id: tradeId,
      call_type: callType,
    });
    return resp?.data?.call || null;
  } catch (e) {
    return null;
  }
};

export const endDealCall = async (roomId) => {
  try {
    const resp = await apiClient.post('/deal-comm/calls/end', { room_id: roomId });
    return resp?.data?.call || null;
  } catch (e) {
    return null;
  }
};

export const fetchDealCalls = async (tradeId) => {
  try {
    const resp = await apiClient.get(`/deal-comm/calls/list?trade_id=${tradeId}`);
    return resp?.data?.calls || [];
  } catch (e) {
    return [];
  }
};

export const requestAIVoiceCall = async ({ toPhone, userId, languageCode = 'en', initialPrompt = null }) => {
  try {
    const payload = {
      to_phone: toPhone,
      user_id: userId,
      language_code: languageCode,
      initial_prompt: initialPrompt,
    };
    const resp = await apiClient.post('/voice-agent/call/outbound', payload);
    return resp?.data || null;
  } catch (e) {
    return null;
  }
};