import React, { useEffect, useMemo, useRef, useState } from 'react';
import Slider from '@react-native-community/slider';
import {
  Animated,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Appbar, Button, Card, Menu, Text, ActivityIndicator } from 'react-native-paper';
import Svg, { Circle } from 'react-native-svg';
import { CROP_OPTIONS, STORAGE_OPTIONS } from '../data/farmOptions';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { formatCurrency, getSpoilageRisk } from '../services/apiService';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const DEFAULT_TEMP_C = 36;
const CIRCLE_SIZE = 224;
const STROKE_WIDTH = 16;
const CIRCLE_RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getRiskConfig = (riskPercent) => {
  if (riskPercent <= 30) {
    return { label: 'LOW RISK', color: COLORS.success };
  }
  if (riskPercent <= 60) {
    return { label: 'MEDIUM RISK', color: COLORS.tertiary };
  }
  if (riskPercent <= 80) {
    return { label: 'HIGH RISK', color: COLORS.warning };
  }
  return { label: 'CRITICAL', color: COLORS.error };
};

function PickerField({ label, value, options, onSelect }) {
  const [menuVisible, setMenuVisible] = useState(false);
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Button
            mode="outlined"
            style={styles.pickerButton}
            labelStyle={styles.pickerLabel}
            contentStyle={styles.pickerContent}
            onPress={() => setMenuVisible(true)}
          >
            {value}
          </Button>
        }
      >
        {options.map((option) => (
          <Menu.Item
            key={option}
            title={option}
            onPress={() => {
              onSelect(option);
              setMenuVisible(false);
            }}
          />
        ))}
      </Menu>
    </View>
  );
}

const actionBadgeStyle = (rank) => {
  if (rank === 1) {
    return {
      badge: styles.greenBadge,
      label: 'Cheapest',
      button: COLORS.success,
      icon: 'cash',
    };
  }
  if (rank === 2) {
    return {
      badge: styles.yellowBadge,
      label: 'Moderate',
      button: COLORS.tertiary,
      icon: 'scale-balance',
    };
  }
  return {
    badge: styles.blueBadge,
    label: 'Best Result',
    button: COLORS.info,
    icon: 'star-outline',
  };
};

export default function SpoilageScreen({ navigation, route }) {
  const { t } = useLanguage();
  const prefill = route?.params?.prefill || {};
  const source = route?.params?.source;
  const initialCrop = prefill.crop || CROP_OPTIONS[0];
  const initialStorage = prefill.storageType || STORAGE_OPTIONS[0];
  const initialDistrict = prefill.district || 'Nashik';
  const transitSeed = Number(prefill.transitHours);
  const initialTransit = Number.isFinite(transitSeed)
    ? clamp(transitSeed, 1, 48)
    : 12;
  const parsedTemp = Number(route?.params?.currentTempC);
  const initialTempC = Number.isFinite(parsedTemp) ? parsedTemp : DEFAULT_TEMP_C;

  const [crop, setCrop] = useState(initialCrop);
  const [daysSinceHarvest, setDaysSinceHarvest] = useState(0);
  const [storageType, setStorageType] = useState(initialStorage);
  const [transitHours, setTransitHours] = useState(initialTransit);
  const [district] = useState(initialDistrict);
  const [tempC, setTempC] = useState(initialTempC);
  const [riskResponse, setRiskResponse] = useState(null);
  const [loadingRisk, setLoadingRisk] = useState(false);
  const [offlineBanner, setOfflineBanner] = useState('');

  const progress = useRef(new Animated.Value(0)).current;
  const [animatedRisk, setAnimatedRisk] = useState(0);

  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      setAnimatedRisk(value);
    });
    return () => {
      progress.removeListener(listener);
    };
  }, [progress]);

  const checkedRiskPercent = useMemo(() => {
    const score = Number(riskResponse?.risk_score || 0);
    return Math.round(score * 100);
  }, [riskResponse]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: checkedRiskPercent,
      duration: 850,
      useNativeDriver: false,
    }).start();
  }, [checkedRiskPercent, progress]);

  const riskConfig = useMemo(
    () => getRiskConfig(Math.round(animatedRisk)),
    [animatedRisk]
  );

  const progressOffset =
    CIRCLE_CIRCUMFERENCE - (clamp(animatedRisk, 0, 100) / 100) * CIRCLE_CIRCUMFERENCE;

  const runSpoilageCheck = async () => {
    setLoadingRisk(true);
    const response = await getSpoilageRisk({
      crop,
      storageType,
      transitHours,
      daysSinceHarvest,
      district,
    });

    setRiskResponse(response);
    if (Number.isFinite(Number(response?.avg_temp))) {
      setTempC(Number(response.avg_temp));
    }

    if (response?._meta?.usedCache) {
      setOfflineBanner(
        '\u{1F4F5} No internet \u2014 showing your last saved recommendation'
      );
    } else {
      setOfflineBanner('');
    }
    setLoadingRisk(false);
  };

  const openMapsForColdStorage = async () => {
    const mapsUrl =
      'https://www.google.com/maps/search/?api=1&query=nearest+cold+storage';
    if (await Linking.canOpenURL(mapsUrl)) {
      await Linking.openURL(mapsUrl);
    }
  };

  const openAriaWithPreservationGuide = () => {
    navigation.navigate('Home');
  };

  const openSellNow = () => {
    navigation.navigate('Market');
  };

  const openAriaAssistant = () => {
    navigation.navigate('Home');
  };

  const handleAction = (action) => {
    const normalized = String(action || '').toLowerCase();
    if (normalized.includes('cold storage')) {
      openMapsForColdStorage();
      return;
    }
    if (normalized.includes('grade') || normalized.includes('warehouse')) {
      openAriaWithPreservationGuide();
      return;
    }
    openSellNow();
  };

  const actionButtonLabel = (action, rank) => {
    const normalized = String(action || '').toLowerCase();
    if (normalized.includes('cold storage')) {
      return 'Find Cold Storage';
    }
    if (normalized.includes('grade') || normalized.includes('warehouse')) {
      return 'How to do this?';
    }
    return rank === 1 ? 'Sell Now' : 'Apply';
  };

  const actions = riskResponse?.preservation_actions_ranked || [];
  const riskFactors = riskResponse?.risk_factors || [];

  return (
    <View style={styles.screen}>
      <Appbar.Header style={styles.header}>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={t('spoilage.header')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {offlineBanner ? (
          <View style={styles.offlineBanner}>
            <MaterialCommunityIcons name="wifi-off" size={16} color={COLORS.warning} />
            <Text style={styles.offlineBannerText}>{offlineBanner}</Text>
          </View>
        ) : null}

        <Card style={styles.card}>
          <Card.Content style={styles.cardContent}>
            <Text style={styles.sectionTitle}>{t('spoilage.inputSection')}</Text>
            {source === 'recommendation' ? (
              <Text style={styles.prefillText}>
                {t('spoilage.prefillNote')}
              </Text>
            ) : null}

            <PickerField
              label={t('spoilage.cropType')}
              value={crop}
              options={CROP_OPTIONS}
              onSelect={setCrop}
            />

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{t('spoilage.daysSinceHarvest')}</Text>
              <Text style={styles.sliderValue}>{`${daysSinceHarvest} ${t('common.days')}`}</Text>
              <Slider
                minimumValue={0}
                maximumValue={30}
                step={1}
                value={daysSinceHarvest}
                onValueChange={(value) => setDaysSinceHarvest(value)}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.outlineVariant}
                thumbTintColor={COLORS.accent}
              />
            </View>

            <PickerField
              label={t('spoilage.storageType')}
              value={storageType}
              options={STORAGE_OPTIONS}
              onSelect={setStorageType}
            />

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{t('spoilage.transitTime')}</Text>
              <Text style={styles.sliderValue}>{`${transitHours} ${t('common.hours')}`}</Text>
              <Slider
                minimumValue={1}
                maximumValue={48}
                step={1}
                value={transitHours}
                onValueChange={(value) => setTransitHours(value)}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.outlineVariant}
                thumbTintColor={COLORS.accent}
              />
            </View>

            <View style={styles.tempRow}>
              <MaterialCommunityIcons name="thermometer" size={18} color={COLORS.info} />
              <Text style={styles.tempText}>
                {`Current temp: ${Math.round(tempC)}\u00B0C (from weather)`}
              </Text>
            </View>

            <Button
              mode="contained"
              style={styles.checkButton}
              buttonColor={COLORS.primary}
              contentStyle={styles.checkButtonContent}
              onPress={runSpoilageCheck}
              disabled={loadingRisk}
            >
              {t('spoilage.checkRisk')}
            </Button>
          </Card.Content>
        </Card>

        {loadingRisk ? (
          <Card style={styles.card}>
            <Card.Content style={styles.loaderContent}>
              <ActivityIndicator animating size="large" color={COLORS.primary} />
              <Text style={styles.loaderText}>{t('spoilage.calculating')}</Text>
            </Card.Content>
          </Card>
        ) : null}

        {riskResponse ? (
          <Card style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <Text style={styles.sectionTitle}>{t('spoilage.riskMeter')}</Text>

              <View style={styles.meterWrap}>
                <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
                  <Circle
                    cx={CIRCLE_SIZE / 2}
                    cy={CIRCLE_SIZE / 2}
                    r={CIRCLE_RADIUS}
                    stroke={COLORS.surfaceContainerHigh}
                    strokeWidth={STROKE_WIDTH}
                    fill="none"
                  />
                  <AnimatedCircle
                    cx={CIRCLE_SIZE / 2}
                    cy={CIRCLE_SIZE / 2}
                    r={CIRCLE_RADIUS}
                    stroke={riskConfig.color}
                    strokeWidth={STROKE_WIDTH}
                    fill="none"
                    strokeDasharray={`${CIRCLE_CIRCUMFERENCE}`}
                    strokeDashoffset={progressOffset}
                    strokeLinecap="round"
                    origin={`${CIRCLE_SIZE / 2}, ${CIRCLE_SIZE / 2}`}
                    rotation="-90"
                  />
                </Svg>

                <View style={styles.meterCenter}>
                  <Text style={[styles.meterPercent, { color: riskConfig.color }]}>
                    {`${Math.round(animatedRisk)}%`}
                  </Text>
                  <Text style={[styles.riskTag, { color: riskConfig.color }]}>
                    {riskResponse?.risk_category?.toUpperCase() || riskConfig.label}
                  </Text>
                </View>
              </View>

              <Text style={styles.riskSummary}>
                {`${checkedRiskPercent}% spoilage risk in 3 days`}
              </Text>
              <Text style={styles.daysSafeText}>
                {`You have approximately ${riskResponse?.days_safe ?? 0} days before significant spoilage`}
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        {riskResponse ? (
          <Card style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <Text style={styles.sectionTitle}>{t('spoilage.preservationActions')}</Text>
              {actions.map((item) => {
                const style = actionBadgeStyle(item.rank);
                return (
                  <View key={`${item.rank}-${item.action}`} style={styles.rankCard}>
                    <View style={styles.rankTopRow}>
                      <Text style={styles.rankTitle}>
                        {`Rank ${item.rank} — ${style.label}`}
                      </Text>
                      <View style={[styles.badge, style.badge]}>
                        <Text style={styles.badgeText}>{style.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.actionName}>{item.action}</Text>
                    <Text style={styles.actionMeta}>
                      {`Cost: ${formatCurrency(item.cost_inr_per_quintal)}/quintal | You save: ${item.saves_percent}% of stock`}
                    </Text>
                    <Button
                      mode="contained"
                      buttonColor={style.button}
                      style={styles.actionButton}
                      onPress={() => handleAction(item.action)}
                    >
                      {actionButtonLabel(item.action, item.rank)}
                    </Button>
                  </View>
                );
              })}
            </Card.Content>
          </Card>
        ) : null}

        {riskResponse && riskFactors.length > 0 ? (
          <Card style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <Text style={styles.sectionTitle}>{t('spoilage.riskFactors')}</Text>
              {riskFactors.map((factor) => (
                <View key={factor} style={styles.factorRow}>
                  <Text style={styles.factorBullet}>{'\u2022'}</Text>
                  <Text style={styles.factorText}>{factor}</Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        ) : null}
      </ScrollView>

      <TouchableOpacity
        style={styles.ariaFab}
        activeOpacity={0.9}
        onPress={openAriaAssistant}
      >
        <MaterialCommunityIcons name="microphone" size={18} color={COLORS.onPrimary} />
        <Text style={styles.ariaFabText}>ARIA</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.surface,
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.outlineVariant,
  },
  headerTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    rowGap: SPACING.sm,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: SPACING.sm,
    backgroundColor: COLORS.warningContainer,
    borderColor: COLORS.warning + '40',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  offlineBannerText: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.warning,
    fontWeight: '600',
    flex: 1,
  },
  card: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    ...ELEVATION.level1,
  },
  cardContent: {
    rowGap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  prefillText: {
    ...TYPOGRAPHY.bodySmall,
    marginTop: -4,
    color: COLORS.onSurfaceVariant,
  },
  fieldBlock: {
    marginBottom: 2,
  },
  fieldLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.onSurface,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  pickerButton: {
    borderColor: COLORS.outlineVariant,
    borderRadius: RADIUS.md,
  },
  pickerLabel: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurface,
  },
  pickerContent: {
    minHeight: 48,
    justifyContent: 'center',
  },
  sliderValue: {
    ...TYPOGRAPHY.labelLarge,
    color: COLORS.primary,
    fontWeight: '700',
    marginBottom: 6,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: SPACING.sm,
  },
  tempText: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurface,
    fontWeight: '600',
  },
  checkButton: {
    borderRadius: RADIUS.md,
    marginTop: 2,
  },
  checkButtonContent: {
    minHeight: 54,
  },
  loaderContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
  },
  loaderText: {
    ...TYPOGRAPHY.bodyMedium,
    marginTop: SPACING.sm,
    color: COLORS.onSurfaceVariant,
  },
  meterWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: SPACING.xs,
  },
  meterCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  meterPercent: {
    ...TYPOGRAPHY.displaySmall,
    fontWeight: '800',
    lineHeight: 50,
  },
  riskTag: {
    ...TYPOGRAPHY.labelLarge,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  riskSummary: {
    ...TYPOGRAPHY.headlineMedium,
    fontWeight: '800',
    color: COLORS.onSurface,
    textAlign: 'center',
    lineHeight: 34,
  },
  daysSafeText: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurfaceVariant,
    textAlign: 'center',
    fontWeight: '700',
    lineHeight: 22,
  },
  rankCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.outlineVariant,
    backgroundColor: COLORS.surfaceContainerLow,
    padding: SPACING.sm,
    rowGap: SPACING.sm,
  },
  rankTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: SPACING.sm,
  },
  rankTitle: {
    flex: 1,
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  badge: {
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  greenBadge: {
    backgroundColor: COLORS.successContainer,
  },
  yellowBadge: {
    backgroundColor: COLORS.warningContainer,
  },
  blueBadge: {
    backgroundColor: COLORS.infoContainer,
  },
  badgeText: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  actionName: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  actionMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurfaceVariant,
    lineHeight: 20,
  },
  actionButton: {
    marginTop: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: SPACING.sm,
  },
  factorBullet: {
    marginTop: 2,
    color: COLORS.primary,
    ...TYPOGRAPHY.bodyLarge,
  },
  factorText: {
    flex: 1,
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurface,
    lineHeight: 21,
  },
  ariaFab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    ...ELEVATION.level3,
  },
  ariaFabText: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.onPrimary,
    fontWeight: '800',
  },
});
