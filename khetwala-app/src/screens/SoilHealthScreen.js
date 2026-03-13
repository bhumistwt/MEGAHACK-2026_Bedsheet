/**
 * Khetwala-मित्र — Soil Health Screen
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Displays soil fertility data sourced from:
 *   • Government Soil Health Card (SHC) — NPK, pH, Organic Carbon
 *   • ISRO Bhuvan — Soil moisture estimates
 *   • ESA Sentinel-2 — NDVI vegetation health
 *
 * Features:
 *   - NPK gauges with Low/Medium/High ratings
 *   - pH scale visualiser
 *   - Soil moisture bar
 *   - NDVI vegetation health indicator
 *   - Soil quality index score ring
 *   - Data source attribution cards
 *   - Actionable recommendations
 */

import React, { useEffect, useState, useContext, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, ELEVATION, TYPOGRAPHY } from '../theme/colors';
import { LanguageContext } from '../context/LanguageContext';
import { fetchSoilHealth } from '../services/apiService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Nutrient Gauge Component ────────────────────────────────────────────────

const NutrientGauge = ({ label, value, unit, rating, icon, color }) => {
  const ratingColors = {
    Low: COLORS.error,
    Medium: COLORS.tertiary,
    High: COLORS.success,
    Unknown: COLORS.outline,
  };
  const barColor = ratingColors[rating] || COLORS.outline;
  const maxValues = { 'kg/ha': 400, '%': 1.5 };
  const maxVal = maxValues[unit] || 400;
  const pct = Math.min(100, ((value || 0) / maxVal) * 100);

  return (
    <View style={styles.gaugeCard}>
      <View style={styles.gaugeHeader}>
        <Ionicons name={icon || 'leaf'} size={18} color={barColor} />
        <Text style={styles.gaugeLabel}>{label}</Text>
      </View>
      <Text style={styles.gaugeValue}>
        {value != null ? value : '—'}{' '}
        <Text style={styles.gaugeUnit}>{unit}</Text>
      </Text>
      <View style={styles.gaugeBar}>
        <View style={[styles.gaugeFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.gaugeRating, { color: barColor }]}>{rating}</Text>
    </View>
  );
};

// ─── pH Scale Component ──────────────────────────────────────────────────────

const PHScale = ({ value, rating }) => {
  const pos = value ? Math.min(100, Math.max(0, ((value - 4) / 6) * 100)) : 50;
  return (
    <View style={styles.phCard}>
      <View style={styles.phHeader}>
        <Ionicons name="water" size={20} color={COLORS.info} />
        <Text style={styles.phTitle}>pH Level</Text>
        <Text style={styles.phValue}>{value ?? '—'}</Text>
      </View>
      <View style={styles.phScale}>
        {/* Gradient bar */}
        <View style={styles.phGradient}>
          <View style={[styles.phSegment, { flex: 1, backgroundColor: '#EF5350' }]} />
          <View style={[styles.phSegment, { flex: 1, backgroundColor: '#FF9800' }]} />
          <View style={[styles.phSegment, { flex: 1, backgroundColor: '#FFEB3B' }]} />
          <View style={[styles.phSegment, { flex: 2, backgroundColor: '#4CAF50' }]} />
          <View style={[styles.phSegment, { flex: 1, backgroundColor: '#42A5F5' }]} />
          <View style={[styles.phSegment, { flex: 1, backgroundColor: '#5C6BC0' }]} />
        </View>
        {/* Indicator */}
        <View style={[styles.phIndicator, { left: `${pos}%` }]}>
          <View style={styles.phDot} />
        </View>
      </View>
      <View style={styles.phLabels}>
        <Text style={styles.phLabelText}>Acidic</Text>
        <Text style={[styles.phLabelText, { color: COLORS.success }]}>Ideal</Text>
        <Text style={styles.phLabelText}>Alkaline</Text>
      </View>
      <Text style={styles.phRating}>{rating}</Text>
    </View>
  );
};

// ─── Soil Quality Ring ───────────────────────────────────────────────────────

const QualityRing = ({ value, label }) => {
  const pct = Math.round((value || 0) * 100);
  const ringColor =
    pct > 75 ? COLORS.success : pct > 60 ? COLORS.primary : pct > 45 ? COLORS.tertiary : COLORS.error;

  return (
    <View style={styles.ringCard}>
      <Text style={styles.ringTitle}>Soil Quality Index</Text>
      <View style={styles.ringOuter}>
        <View style={[styles.ringProgress, { borderColor: ringColor }]}>
          <Text style={[styles.ringPct, { color: ringColor }]}>{pct}%</Text>
          <Text style={styles.ringLabel}>{label}</Text>
        </View>
      </View>
      <Text style={styles.ringSource}>Based on SHC analysis</Text>
    </View>
  );
};

// ─── Moisture Bar ────────────────────────────────────────────────────────────

const MoistureBar = ({ moisture }) => {
  if (!moisture) return null;
  const pct = moisture.moisture_pct || 0;
  const statusColor =
    moisture.status === 'high' ? COLORS.info : moisture.status === 'moderate' ? COLORS.success : COLORS.error;

  return (
    <View style={styles.moistureCard}>
      <View style={styles.moistureHeader}>
        <Ionicons name="water-outline" size={20} color={COLORS.info} />
        <Text style={styles.moistureTitle}>Soil Moisture</Text>
        <Text style={[styles.moistureStatus, { color: statusColor }]}>
          {moisture.status?.toUpperCase()}
        </Text>
      </View>
      <View style={styles.moistureBarTrack}>
        <View
          style={[
            styles.moistureBarFill,
            { width: `${Math.min(pct, 100)}%`, backgroundColor: statusColor },
          ]}
        />
      </View>
      <View style={styles.moistureInfo}>
        <Text style={styles.moistureVal}>{pct.toFixed(1)}%</Text>
        {moisture.recent_rainfall_mm != null && (
          <Text style={styles.moistureSub}>
            Rain: {moisture.recent_rainfall_mm} mm (7d)
          </Text>
        )}
      </View>
      <Text style={styles.sourceTag}>Source: ISRO Bhuvan + Weather Model</Text>
    </View>
  );
};

// ─── NDVI Card ───────────────────────────────────────────────────────────────

const NDVICard = ({ vegetation }) => {
  if (!vegetation) return null;
  const ndvi = vegetation.ndvi;
  const statusColor =
    vegetation.status === 'Healthy'
      ? COLORS.success
      : vegetation.status === 'Moderate'
      ? COLORS.tertiary
      : vegetation.status === 'Stressed'
      ? COLORS.warning
      : COLORS.error;

  const barPct = ndvi != null ? Math.min(100, ndvi * 100) : 0;

  return (
    <View style={styles.ndviCard}>
      <View style={styles.ndviHeader}>
        <Ionicons name="leaf" size={20} color={COLORS.success} />
        <Text style={styles.ndviTitle}>Vegetation Health (NDVI)</Text>
      </View>
      <View style={styles.ndviRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ndviValue}>{ndvi != null ? ndvi.toFixed(3) : '—'}</Text>
          <Text style={[styles.ndviStatus, { color: statusColor }]}>{vegetation.status}</Text>
        </View>
        <View style={styles.ndviBarWrap}>
          <View style={styles.ndviBarTrack}>
            <View style={[styles.ndviBarFill, { width: `${barPct}%`, backgroundColor: statusColor }]} />
          </View>
          <View style={styles.ndviScale}>
            <Text style={styles.ndviScaleText}>0</Text>
            <Text style={styles.ndviScaleText}>0.5</Text>
            <Text style={styles.ndviScaleText}>1.0</Text>
          </View>
        </View>
      </View>
      {vegetation.trend_30d != null && (
        <View style={styles.ndviTrend}>
          <Ionicons
            name={vegetation.trend_30d > 0 ? 'trending-up' : 'trending-down'}
            size={16}
            color={vegetation.trend_30d > 0 ? COLORS.success : COLORS.error}
          />
          <Text style={styles.ndviTrendText}>
            30-day trend: {vegetation.trend_30d > 0 ? '+' : ''}{(vegetation.trend_30d * 100).toFixed(2)}%
          </Text>
        </View>
      )}
      <Text style={styles.sourceTag}>Source: Sentinel-2 Satellite (ESA Copernicus)</Text>
    </View>
  );
};

// ─── Source Card ──────────────────────────────────────────────────────────────

const SourceCard = ({ source }) => (
  <View style={styles.srcCard}>
    <Ionicons name="globe-outline" size={16} color={COLORS.primary} />
    <View style={{ flex: 1, marginLeft: 8 }}>
      <Text style={styles.srcName}>{source.name}</Text>
      <Text style={styles.srcOrg}>{source.org}</Text>
    </View>
  </View>
);

// ─── Recommendation Card ────────────────────────────────────────────────────

const RecCard = ({ rec }) => {
  const prioColor =
    rec.priority === 'high' ? COLORS.error : rec.priority === 'medium' ? COLORS.tertiary : COLORS.success;

  return (
    <View style={[styles.recCard, { borderLeftColor: prioColor }]}>
      <View style={styles.recHeader}>
        <Ionicons name={rec.icon || 'alert-circle'} size={18} color={prioColor} />
        <Text style={styles.recTitle}>{rec.title}</Text>
        <Text style={[styles.recPrio, { color: prioColor }]}>{rec.priority?.toUpperCase()}</Text>
      </View>
      <Text style={styles.recDetail}>{rec.detail}</Text>
      {rec.action && (
        <View style={styles.recAction}>
          <Ionicons name="arrow-forward-circle" size={14} color={COLORS.primary} />
          <Text style={styles.recActionText}>{rec.action}</Text>
        </View>
      )}
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════════════════════════════════

const SoilHealthScreen = ({ route }) => {
  const navigation = useNavigation();
  const { t } = useContext(LanguageContext);

  const district = route?.params?.district || 'nashik';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchSoilHealth(district);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load soil health data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [district]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // ─── Render States ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('soilHealth.loading', 'Loading soil data…')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={48} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>{t('common.retry', 'Retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!data || !data.available) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Ionicons name="earth" size={48} color={COLORS.outline} />
          <Text style={styles.errorText}>
            {data?.message || t('soilHealth.noData', 'No soil data available for this district.')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const f = data.fertility || {};
  const p = data.properties || {};

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.onSurface} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {t('soilHealth.title', 'Soil Health Report')}
          </Text>
          <Text style={styles.headerSub}>
            {data.district}, {data.state}
          </Text>
        </View>
        <View style={styles.soilBadge}>
          <Ionicons name="earth" size={16} color={COLORS.onPrimary} />
          <Text style={styles.soilBadgeText}>
            {data.soil_type?.name || 'Soil'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* Soil Quality + Soil Type */}
        <View style={styles.topRow}>
          <QualityRing value={data.quality_index?.value} label={data.quality_index?.label} />
          <View style={styles.soilTypeCard}>
            <Text style={styles.stTitle}>{data.soil_type?.name}</Text>
            <Text style={styles.stDesc}>{data.soil_type?.info?.description}</Text>
            <View style={styles.stProps}>
              <View style={styles.stProp}>
                <Text style={styles.stPropLabel}>Water Retention</Text>
                <Text style={styles.stPropVal}>{data.soil_type?.info?.water_retention}</Text>
              </View>
              <View style={styles.stProp}>
                <Text style={styles.stPropLabel}>Drainage</Text>
                <Text style={styles.stPropVal}>{data.soil_type?.info?.drainage}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Section: NPK Fertility */}
        <Text style={styles.sectionTitle}>
          <Ionicons name="nutrition" size={16} color={COLORS.primary} />{' '}
          {t('soilHealth.fertility', 'Soil Fertility (NPK)')}
        </Text>
        <View style={styles.gaugeRow}>
          <NutrientGauge
            label={t('soilHealth.nitrogen', 'Nitrogen (N)')}
            value={f.nitrogen?.value}
            unit={f.nitrogen?.unit}
            rating={f.nitrogen?.rating}
            icon="leaf"
            color={COLORS.success}
          />
          <NutrientGauge
            label={t('soilHealth.phosphorus', 'Phosphorus (P)')}
            value={f.phosphorus?.value}
            unit={f.phosphorus?.unit}
            rating={f.phosphorus?.rating}
            icon="flask"
            color={COLORS.info}
          />
          <NutrientGauge
            label={t('soilHealth.potassium', 'Potassium (K)')}
            value={f.potassium?.value}
            unit={f.potassium?.unit}
            rating={f.potassium?.rating}
            icon="beaker"
            color={COLORS.tertiary}
          />
        </View>

        {/* pH Scale */}
        <PHScale value={p.ph?.value} rating={p.ph?.rating} />

        {/* Organic Carbon */}
        <View style={styles.ocCard}>
          <View style={styles.ocRow}>
            <Ionicons name="analytics" size={20} color={COLORS.primary} />
            <Text style={styles.ocTitle}>
              {t('soilHealth.organicCarbon', 'Organic Carbon')}
            </Text>
          </View>
          <View style={styles.ocValues}>
            <Text style={styles.ocValue}>{p.organic_carbon?.value ?? '—'}%</Text>
            <Text
              style={[
                styles.ocRating,
                {
                  color:
                    p.organic_carbon?.rating === 'High'
                      ? COLORS.success
                      : p.organic_carbon?.rating === 'Medium'
                      ? COLORS.tertiary
                      : COLORS.error,
                },
              ]}
            >
              {p.organic_carbon?.rating}
            </Text>
          </View>
          <Text style={styles.ocIdeal}>
            Ideal: {p.organic_carbon?.ideal_range || '> 0.75%'}
          </Text>
          <Text style={styles.sourceTag}>Source: Soil Health Card (SHC)</Text>
        </View>

        {/* Soil Moisture */}
        <MoistureBar moisture={data.moisture} />

        {/* NDVI */}
        <NDVICard vegetation={data.vegetation} />

        {/* Recommendations */}
        {data.recommendations?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              <Ionicons name="bulb" size={16} color={COLORS.tertiary} />{' '}
              {t('soilHealth.recommendations', 'Recommendations')}
            </Text>
            {data.recommendations.map((rec, i) => (
              <RecCard key={i} rec={rec} />
            ))}
          </>
        )}

        {/* Data Sources */}
        <Text style={styles.sectionTitle}>
          <Ionicons name="server" size={16} color={COLORS.outline} />{' '}
          {t('soilHealth.dataSources', 'Data Sources')}
        </Text>
        <View style={styles.sourcesRow}>
          {(data.sources || []).map((s, i) => (
            <SourceCard key={i} source={s} />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  loadingText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant, marginTop: SPACING.md },
  errorText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurfaceVariant, textAlign: 'center', marginTop: SPACING.md },
  retryBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.xl,
  },
  retryText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    ...ELEVATION.level1,
  },
  backBtn: { padding: SPACING.xs, marginRight: SPACING.sm },
  headerTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  headerSub: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  soilBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    gap: 4,
  },
  soilBadgeText: { ...TYPOGRAPHY.labelSmall, color: COLORS.onPrimary },

  scroll: { padding: SPACING.md },

  // Top row
  topRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },

  // Quality Ring
  ringCard: {
    width: 130,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    ...ELEVATION.level1,
  },
  ringTitle: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginBottom: SPACING.sm },
  ringOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: COLORS.outlineVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringProgress: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceVariant,
  },
  ringPct: { ...TYPOGRAPHY.titleLarge, fontWeight: '700' },
  ringLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant },
  ringSource: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline, marginTop: SPACING.xs },

  // Soil Type
  soilTypeCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  stTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, marginBottom: 4 },
  stDesc: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginBottom: SPACING.sm },
  stProps: { flexDirection: 'row', gap: SPACING.md },
  stProp: { flex: 1 },
  stPropLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline },
  stPropVal: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurface },

  // Section Title
  sectionTitle: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurface,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },

  // Gauges
  gaugeRow: { flexDirection: 'row', gap: SPACING.sm },
  gaugeCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    ...ELEVATION.level1,
  },
  gaugeHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  gaugeLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant },
  gaugeValue: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  gaugeUnit: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline },
  gaugeBar: {
    height: 6,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 3,
    marginVertical: 4,
    overflow: 'hidden',
  },
  gaugeFill: { height: '100%', borderRadius: 3 },
  gaugeRating: { ...TYPOGRAPHY.labelSmall, fontWeight: '700', textAlign: 'center' },

  // pH
  phCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...ELEVATION.level1,
  },
  phHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phTitle: { ...TYPOGRAPHY.titleSmall, flex: 1, color: COLORS.onSurface },
  phValue: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, fontWeight: '700' },
  phScale: { height: 20, marginTop: SPACING.md, position: 'relative' },
  phGradient: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' },
  phSegment: { height: '100%' },
  phIndicator: { position: 'absolute', top: -2, marginLeft: -8 },
  phDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.onSurface,
    borderWidth: 3,
    borderColor: COLORS.surface,
  },
  phLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  phLabelText: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline },
  phRating: { ...TYPOGRAPHY.labelMedium, color: COLORS.primary, textAlign: 'center', marginTop: 4 },

  // Organic Carbon
  ocCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...ELEVATION.level1,
  },
  ocRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ocTitle: { ...TYPOGRAPHY.titleSmall, flex: 1, color: COLORS.onSurface },
  ocValues: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
  ocValue: { ...TYPOGRAPHY.headlineMedium, color: COLORS.onSurface, fontWeight: '700' },
  ocRating: { ...TYPOGRAPHY.labelLarge, fontWeight: '700' },
  ocIdeal: { ...TYPOGRAPHY.bodySmall, color: COLORS.outline, marginTop: 2 },

  // Moisture
  moistureCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...ELEVATION.level1,
  },
  moistureHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moistureTitle: { ...TYPOGRAPHY.titleSmall, flex: 1, color: COLORS.onSurface },
  moistureStatus: { ...TYPOGRAPHY.labelMedium, fontWeight: '700' },
  moistureBarTrack: {
    height: 10,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 5,
    marginTop: SPACING.sm,
    overflow: 'hidden',
  },
  moistureBarFill: { height: '100%', borderRadius: 5 },
  moistureInfo: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  moistureVal: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurface },
  moistureSub: { ...TYPOGRAPHY.bodySmall, color: COLORS.outline },

  // NDVI
  ndviCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...ELEVATION.level1,
  },
  ndviHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  ndviTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  ndviRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  ndviValue: { ...TYPOGRAPHY.headlineMedium, color: COLORS.onSurface, fontWeight: '700' },
  ndviStatus: { ...TYPOGRAPHY.labelLarge, fontWeight: '700' },
  ndviBarWrap: { flex: 1 },
  ndviBarTrack: {
    height: 10,
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: 5,
    overflow: 'hidden',
  },
  ndviBarFill: { height: '100%', borderRadius: 5 },
  ndviScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  ndviScaleText: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline },
  ndviTrend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.sm },
  ndviTrendText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },

  // Source tag
  sourceTag: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.outline,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },

  // Recommendations
  recCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    ...ELEVATION.level1,
  },
  recHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recTitle: { ...TYPOGRAPHY.titleSmall, flex: 1, color: COLORS.onSurface },
  recPrio: { ...TYPOGRAPHY.labelSmall, fontWeight: '700' },
  recDetail: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 4 },
  recAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  recActionText: { ...TYPOGRAPHY.labelSmall, color: COLORS.primary },

  // Sources
  sourcesRow: { gap: SPACING.sm },
  srcCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    ...ELEVATION.level1,
  },
  srcName: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurface },
  srcOrg: { ...TYPOGRAPHY.labelSmall, color: COLORS.outline },
});

export default SoilHealthScreen;
