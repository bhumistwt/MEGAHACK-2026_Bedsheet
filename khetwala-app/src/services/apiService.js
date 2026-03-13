const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';

function normalizeDistrict(district) {
  return encodeURIComponent(String(district || '').trim() || 'Nashik');
}

export async function fetchCurrentWeather(district = 'Nashik') {
  const response = await fetch(`${BASE_URL}/weather/current/${normalizeDistrict(district)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch current weather');
  }
  return response.json();
}

export async function fetchWeatherForecast(district = 'Nashik', state = 'Maharashtra') {
  const d = normalizeDistrict(district);
  const s = encodeURIComponent(String(state || 'Maharashtra'));
  const response = await fetch(`${BASE_URL}/weather/${d}?state=${s}`);
  if (!response.ok) {
    throw new Error('Failed to fetch weather forecast');
  }
  return response.json();
}
