export const CROP_OPTIONS = [
  'Onion',
  'Tomato',
  'Wheat',
  'Rice',
  'Potato',
  'Soybean',
];

export const DISTRICT_OPTIONS = [
  'Nashik',
  'Pune',
  'Aurangabad',
  'Nagpur',
  'Solapur',
  'Kolhapur',
  'Amravati',
];

export const SOIL_OPTIONS = ['Sandy', 'Loamy', 'Clay', 'Black Soil (Regur)'];

export const STORAGE_OPTIONS = ['Open Field', 'Warehouse', 'Cold Storage'];

export const DISTRICT_COORDINATES = {
  Nashik: { lat: 20.011, lon: 73.79 },
  Pune: { lat: 18.52, lon: 73.8567 },
  Aurangabad: { lat: 19.8762, lon: 75.3433 },
  Nagpur: { lat: 21.1458, lon: 79.0882 },
  Solapur: { lat: 17.6599, lon: 75.9064 },
  Kolhapur: { lat: 16.705, lon: 74.2433 },
  Amravati: { lat: 20.9374, lon: 77.7796 },
};

export const CROP_DURATIONS_DAYS = {
  Onion: 125,
  Tomato: 95,
  Wheat: 120,
  Rice: 135,
  Potato: 105,
  Soybean: 110,
};

export const BASE_PRICE_RANGE = {
  Onion: { min: 18, max: 22 },
  Tomato: { min: 16, max: 26 },
  Wheat: { min: 24, max: 31 },
  Rice: { min: 28, max: 35 },
  Potato: { min: 12, max: 18 },
  Soybean: { min: 45, max: 56 },
};