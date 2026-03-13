export const DISTRICTS = ['Nashik', 'Pune', 'Nagpur', 'Aurangabad', 'Solapur', 'Kolhapur'];
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

const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';

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

async function fetchLivePrices({ district, state = 'Maharashtra', lat, lon, limit = 25 }) {
  if (!district) {
    return [];
  }

  const params = new URLSearchParams({ district, state, limit: String(limit) });
  if (lat != null && lon != null) {
    params.append('lat', String(lat));
    params.append('lon', String(lon));
  }

  const response = await fetch(`${API_BASE_URL}/market/prices/live?${params.toString()}`);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || 'Failed to fetch live mandi prices');
  }

  const payload = await response.json();
  return normalizePrices(payload.prices || []);
}

export async function getAllPricesForDistrict(district, state = 'Maharashtra') {
  return fetchLivePrices({ district, state });
}

export async function getNearbyMandiPrices({ district, state = 'Maharashtra', latitude, longitude }) {
  return fetchLivePrices({ district, state, lat: latitude, lon: longitude });
}
