import axios from 'axios';
import {
  BASE_PRICE_RANGE,
  CROP_DURATIONS_DAYS,
  DISTRICT_COORDINATES,
  DISTRICT_OPTIONS,
} from '../data/agriOptions';

const OPEN_WEATHER_URL = 'https://api.openweathermap.org/data/3.0/onecall';
const AGMARKNET_URL =
  'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const OPEN_WEATHER_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
const DATA_GOV_KEY = process.env.EXPO_PUBLIC_DATA_GOV_API_KEY;

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeDate = (date) => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return normalizeDate(next);
};

const formatMonthDay = (date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);

const formatMonthDayYear = (date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

const parseAmount = (value) => {
  if (typeof value === 'number') {
    return value;
  }
  if (value == null) {
    return NaN;
  }
  return Number(String(value).replace(/,/g, '').trim());
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const haversineDistanceKm = (pointA, pointB) => {
  const rad = Math.PI / 180;
  const dLat = (pointB.lat - pointA.lat) * rad;
  const dLon = (pointB.lon - pointA.lon) * rad;
  const lat1 = pointA.lat * rad;
  const lat2 = pointB.lat * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const identifyMarketDistrict = (marketName) => {
  if (!marketName) {
    return null;
  }
  const normalized = marketName.toLowerCase();
  return (
    DISTRICT_OPTIONS.find((district) =>
      normalized.includes(district.toLowerCase())
    ) || null
  );
};

const estimateDistanceKm = (selectedDistrict, marketName) => {
  const from = DISTRICT_COORDINATES[selectedDistrict];
  if (!from) {
    return 42;
  }
  const marketDistrict = identifyMarketDistrict(marketName) || selectedDistrict;
  const to = DISTRICT_COORDINATES[marketDistrict];
  if (!to) {
    return 42;
  }
  if (marketDistrict === selectedDistrict) {
    return 42;
  }
  return Math.round(clamp(haversineDistanceKm(from, to), 28, 260));
};

const calculateTrendPercent = (records) => {
  const modalPrices = records
    .map((record) => record.modalPrice)
    .filter((price) => Number.isFinite(price) && price > 0);
  if (modalPrices.length < 2) {
    return 23;
  }
  const recent = modalPrices.slice(0, 3);
  const older = modalPrices.slice(-3);
  const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const olderAvg = older.reduce((sum, value) => sum + value, 0) / older.length;
  if (olderAvg === 0) {
    return 23;
  }
  const trend = Math.round(((recentAvg - olderAvg) / olderAvg) * 100);
  return clamp(trend, -45, 55);
};

const buildMockWeather = (district) => {
  const today = normalizeDate(new Date());
  const districtShift = DISTRICT_OPTIONS.indexOf(district);
  const shift = districtShift >= 0 ? districtShift : 0;
  const rainPattern = [0.2, 0.6, 1.2, 2.6, 4.8, 7.2, 1.4];
  const popPattern = [0.1, 0.15, 0.24, 0.38, 0.52, 0.68, 0.22];

  const days = Array.from({ length: 7 }, (_, index) => {
    const shiftedIndex = (index + shift) % 7;
    const rainMm = rainPattern[shiftedIndex];
    const pop = popPattern[shiftedIndex];
    return {
      date: addDays(today, index),
      rainMm,
      pop,
      tempC: 23 + ((shiftedIndex + 2) % 5),
      summary: rainMm >= 4 ? 'Rain expected' : 'Stable weather',
    };
  });

  return { source: 'fallback', days };
};

const buildMockMandi = (crop, district) => {
  const fallback = BASE_PRICE_RANGE[crop] || BASE_PRICE_RANGE.Onion;
  const spread = Math.max(2, Math.round((fallback.max - fallback.min) * 0.35));
  const minPrice = fallback.min;
  const maxPrice = fallback.max;
  const modalPrice = Math.round((minPrice + maxPrice) / 2);

  return {
    source: 'fallback',
    marketName: `${district} Mandi`,
    minPrice,
    maxPrice,
    modalPrice,
    trendPercent: 23,
    records: [],
  };
};

const fetchWeatherForecast = async (district) => {
  if (!OPEN_WEATHER_KEY) {
    throw new Error('OPENWEATHER_KEY_MISSING');
  }
  const coordinates = DISTRICT_COORDINATES[district];
  if (!coordinates) {
    throw new Error('DISTRICT_COORDINATES_MISSING');
  }

  const response = await axios.get(OPEN_WEATHER_URL, {
    params: {
      lat: coordinates.lat,
      lon: coordinates.lon,
      appid: OPEN_WEATHER_KEY,
      units: 'metric',
      exclude: 'current,minutely,hourly,alerts',
    },
    timeout: 10000,
  });

  const days = (response.data?.daily || []).slice(0, 7).map((day) => ({
    date: normalizeDate(new Date(day.dt * 1000)),
    rainMm: Number(day.rain || 0),
    pop: Number(day.pop || 0),
    tempC: Number(day.temp?.day || day.temp?.max || 0),
    summary: day.weather?.[0]?.description || 'Weather data available',
  }));

  if (days.length === 0) {
    throw new Error('OPENWEATHER_EMPTY_RESPONSE');
  }

  return { source: 'api', days };
};

const fetchMandiData = async (crop, district) => {
  if (!DATA_GOV_KEY) {
    throw new Error('DATAGOV_KEY_MISSING');
  }

  const response = await axios.get(AGMARKNET_URL, {
    params: {
      'api-key': DATA_GOV_KEY,
      format: 'json',
      limit: 50,
      'filters[state]': 'Maharashtra',
      'filters[district]': district,
      'filters[commodity]': crop,
      'sort[arrival_date]': 'desc',
    },
    timeout: 10000,
  });

  const records = (response.data?.records || [])
    .map((record) => ({
      marketName: record.market,
      minPrice: parseAmount(record.min_price),
      maxPrice: parseAmount(record.max_price),
      modalPrice: parseAmount(record.modal_price),
      arrivalDate: record.arrival_date,
    }))
    .filter((record) => Number.isFinite(record.modalPrice));

  if (records.length === 0) {
    throw new Error('AGMARKNET_EMPTY_RESPONSE');
  }

  const bestMarket =
    [...records].sort((a, b) => b.modalPrice - a.modalPrice)[0] || records[0];

  return {
    source: 'api',
    marketName: bestMarket.marketName || `${district} Mandi`,
    minPrice: Number.isFinite(bestMarket.minPrice)
      ? bestMarket.minPrice
      : bestMarket.modalPrice,
    maxPrice: Number.isFinite(bestMarket.maxPrice)
      ? bestMarket.maxPrice
      : bestMarket.modalPrice + 3,
    modalPrice: bestMarket.modalPrice,
    trendPercent: calculateTrendPercent(records),
    records,
  };
};

const calculateHarvestWindow = (formData, weatherDays) => {
  const sowing = normalizeDate(new Date(formData.sowingDate));
  const sowingDate = Number.isNaN(sowing.getTime())
    ? addDays(new Date(), -90)
    : sowing;
  const durationDays = CROP_DURATIONS_DAYS[formData.crop] || 110;
  const targetHarvestDate = addDays(sowingDate, durationDays);
  let windowStart = addDays(targetHarvestDate, -2);
  let windowEnd = addDays(targetHarvestDate, 2);

  if (weatherDays.length > 0) {
    const forecastStart = weatherDays[0].date;
    const forecastEnd = weatherDays[weatherDays.length - 1].date;
    const isTargetNearForecast =
      targetHarvestDate >= addDays(forecastStart, -2) &&
      targetHarvestDate <= addDays(forecastEnd, 2);

    if (isTargetNearForecast) {
      const rainCutoff = weatherDays.find(
        (day) =>
          day.date >= windowStart &&
          day.date <= addDays(windowEnd, 5) &&
          (day.rainMm >= 3 || day.pop >= 0.45)
      );
      if (rainCutoff) {
        windowEnd = addDays(rainCutoff.date, -1);
      }
    }
  }

  if (windowEnd < windowStart) {
    windowStart = addDays(windowEnd, -2);
  }

  const windowDays =
    Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / DAY_MS)) +
    1;

  return { targetHarvestDate, windowStart, windowEnd, windowDays };
};

const buildRevenueSummary = (formData, mandiData) => {
  const district = formData.district;
  const transitHours = Number(formData.transitHours || 12);
  const averagePrice = Math.round((mandiData.minPrice + mandiData.maxPrice) / 2);
  const distanceKm = estimateDistanceKm(district, mandiData.marketName);
  const timeMultiplier = 1 + Math.max(0, transitHours - 12) * 0.012;
  const transportCost = Math.round(distanceKm * 28.5 * timeMultiplier);
  const storageFactor =
    formData.storageType === 'Cold Storage'
      ? 1
      : formData.storageType === 'Warehouse'
        ? 0.97
        : 0.93;
  const yieldKg = Math.round(570 * storageFactor);
  const mandiSale = Math.round(averagePrice * yieldKg);
  const localSale = Math.round(Math.max(6, averagePrice - 5.6) * yieldKg);
  const extraEarnings = Math.max(0, mandiSale - localSale);

  return {
    distanceKm,
    transportCost,
    localSale,
    mandiSale,
    extraEarnings,
  };
};

const buildReasonPoints = (formData, mandiData, weatherData, harvestWindow) => {
  const weatherCutoff = weatherData.days.find(
    (day) => day.rainMm >= 3 || day.pop >= 0.45
  );
  const rainDate = weatherCutoff
    ? formatMonthDay(weatherCutoff.date)
    : formatMonthDay(addDays(harvestWindow.windowEnd, 1));
  const trendWord =
    mandiData.trendPercent >= 0
      ? `rise ${Math.abs(mandiData.trendPercent)}%`
      : `drop ${Math.abs(mandiData.trendPercent)}%`;

  return [
    {
      icon: '\u{1F327}\u{FE0F}',
      text: `Rain expected after ${rainDate} - harvest before that`,
    },
    {
      icon: '\u{1F4CA}',
      text: `${formData.crop} prices ${trendWord} at ${mandiData.marketName}`,
    },
    {
      icon: '\u{1F331}',
      text: `Your ${formData.soilType.toLowerCase()} can support crop maturity for ${harvestWindow.windowDays} more days`,
    },
  ];
};

export const formatCurrency = (value) =>
  `\u20B9${new Intl.NumberFormat('en-IN').format(Math.round(value))}`;

export const formatWindowLabel = (startDate, endDate) =>
  `${formatMonthDay(startDate)} \u2014 ${formatMonthDayYear(endDate)}`;

export const getRecommendation = async (formData) => {
  const [weatherResult, mandiResult] = await Promise.allSettled([
    fetchWeatherForecast(formData.district),
    fetchMandiData(formData.crop, formData.district),
  ]);

  const weatherData =
    weatherResult.status === 'fulfilled'
      ? weatherResult.value
      : buildMockWeather(formData.district);

  const mandiData =
    mandiResult.status === 'fulfilled'
      ? mandiResult.value
      : buildMockMandi(formData.crop, formData.district);

  const harvestWindow = calculateHarvestWindow(formData, weatherData.days);
  const revenue = buildRevenueSummary(formData, mandiData);
  const reasons = buildReasonPoints(formData, mandiData, weatherData, harvestWindow);

  return {
    harvestWindow: {
      start: harvestWindow.windowStart,
      end: harvestWindow.windowEnd,
      subtitle: `${harvestWindow.windowDays} day window for best results`,
    },
    mandi: {
      marketName: mandiData.marketName,
      minPrice: mandiData.minPrice,
      maxPrice: mandiData.maxPrice,
      ...revenue,
    },
    reasons,
    sources: {
      weather: weatherData.source,
      mandi: mandiData.source,
    },
    currentTempC: Number.isFinite(weatherData.days?.[0]?.tempC)
      ? Math.round(weatherData.days[0].tempC)
      : 36,
  };
};
