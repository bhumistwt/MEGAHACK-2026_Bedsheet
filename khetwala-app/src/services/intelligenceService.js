/**
 * Khetwala-मित्र Intelligence Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * High-level wrapper for the ML-powered intelligence APIs.
 * Tries new /intelligence endpoints first, falls back to legacy /predict endpoints.
 */

import {
  getFullAdvisory,
  getPriceForecast,
  getMandiRecommendationV2,
  getSpoilageRiskV2,
  getHarvestWindowV2,
  getDataStatus,
  // Legacy fallbacks
  getHarvestRecommendation,
  getMandiRecommendation,
  getSpoilageRisk,
} from './apiService';

/**
 * Get complete intelligence advisory for a farmer.
 * Attempts the new full-advisory endpoint first, then falls back
 * to calling individual legacy endpoints.
 */
export const getIntelligence = async (params) => {
  // Try new unified endpoint
  const advisory = await getFullAdvisory(params);
  if (advisory && advisory._meta?.source === 'network') {
    return advisory;
  }

  // Fallback: call legacy endpoints individually
  const [harvest, mandi, spoilage] = await Promise.all([
    getHarvestRecommendation({
      crop: params.crop,
      district: params.district,
      sowingDate: params.sowingDate,
      cropStage: params.cropStage || 'harvest-ready',
    }).catch(() => null),
    getMandiRecommendation({
      crop: params.crop,
      district: params.district,
      quantityQuintals: params.quantityQuintals || 10,
    }).catch(() => null),
    getSpoilageRisk({
      crop: params.crop,
      district: params.district,
      storageType: params.storageType || 'covered',
      daysSinceHarvest: params.daysSinceHarvest || 0,
      transitHours: params.transitHours || 12,
    }).catch(() => null),
  ]);

  return {
    price_intelligence: mandi ? {
      current_price: mandi.expected_price_range?.[1],
      direction: mandi.price_trend?.direction || 'stable',
      confidence: mandi.confidence,
    } : null,
    spoilage_risk: spoilage ? {
      risk_level: spoilage.risk_category,
      loss_pct: Math.round((spoilage.risk_score || 0) * 100),
      shelf_life_remaining: spoilage.days_safe,
      top_recommendation: spoilage.preservation_actions_ranked?.[0]?.action,
    } : null,
    harvest_advisory: harvest ? {
      action: harvest.recommendation,
      reasoning: harvest.risk_if_delayed,
      priority: 'medium',
    } : null,
    mandi_rankings: mandi ? [{
      mandi: mandi.best_mandi,
      profit: `₹${(mandi.net_profit_comparison?.best_mandi || 0).toLocaleString('en-IN')}`,
      price: `₹${mandi.expected_price_range?.[1] || 0}/q`,
    }] : [],
    _meta: { source: 'legacy_fallback', timestamp: new Date().toISOString() },
  };
};

/**
 * Get price forecast with ML model.
 */
export const getSmartPriceForecast = async (crop, district, days = 7) => {
  return getPriceForecast({ crop, district, forecastDays: days });
};

/**
 * Get ML-powered mandi rankings.
 */
export const getSmartMandiRecommendation = async (params) => {
  return getMandiRecommendationV2(params);
};

/**
 * Get ML-powered spoilage risk.
 */
export const getSmartSpoilageRisk = async (params) => {
  return getSpoilageRiskV2(params);
};

/**
 * Get ML-powered harvest window.
 */
export const getSmartHarvestWindow = async (params) => {
  return getHarvestWindowV2(params);
};

/**
 * Check data pipeline health.
 */
export const checkDataPipeline = async () => {
  return getDataStatus();
};
