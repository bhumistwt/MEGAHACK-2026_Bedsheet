import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Appbar, Button, Card, Text } from 'react-native-paper';
import {
  classifyConfidence,
  formatCurrency,
  getExplanation,
  getHarvestRecommendation,
  getMandiRecommendation,
} from '../services/apiService';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';

const defaultFormData = {
  crop: 'Onion',
  cropStage: 'harvest-ready',
  district: 'Nashik',
  soilType: 'Black Soil (Regur)',
  sowingDate: new Date().toISOString(),
  storageType: 'Warehouse',
  transitHours: 12,
};

const formatDateLabel = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
};

const buildWindowText = (harvestWindow) =>
  `${formatDateLabel(harvestWindow?.start)} — ${formatDateLabel(harvestWindow?.end)}`;

function ConfidenceIndicator({ score }) {
  const config = classifyConfidence(score);
  return (
    <View style={styles.confidenceRow}>
      <View style={[styles.confidenceDot, { backgroundColor: config.color }]} />
      <Text style={styles.confidenceText}>{config.label}</Text>
    </View>
  );
}

function SkeletonCard({ title }) {
  return (
    <Card style={styles.card}>
      <View style={styles.skeletonHeader}>
        <Text style={styles.skeletonHeaderText}>{title}</Text>
      </View>
      <Card.Content style={styles.cardBody}>
        <View style={styles.skeletonLineWide} />
        <View style={styles.skeletonLineMid} />
        <View style={styles.skeletonLineShort} />
      </Card.Content>
    </Card>
  );
}

export default function RecommendationScreen({ navigation, route }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(true);
  const [harvestData, setHarvestData] = useState(null);
  const [mandiData, setMandiData] = useState(null);
  const [explanationData, setExplanationData] = useState(null);
  const [loadingHarvest, setLoadingHarvest] = useState(true);
  const [loadingMandi, setLoadingMandi] = useState(true);
  const [loadingWhy, setLoadingWhy] = useState(true);
  const [offlineBanner, setOfflineBanner] = useState('');

  const formData = useMemo(
    () => route?.params?.formData || defaultFormData,
    [route?.params?.formData]
  );

  useEffect(() => {
    let mounted = true;

    const loadRecommendations = async () => {
      setLoadingHarvest(true);
      setLoadingMandi(true);
      setLoadingWhy(true);
      setOfflineBanner('');

      const harvestPromise = getHarvestRecommendation({
        crop: formData.crop,
        district: formData.district,
        sowingDate: formData.sowingDate,
        cropStage: formData.cropStage || 'harvest-ready',
        soilType: formData.soilType,
      });

      const mandiPromise = getMandiRecommendation({
        crop: formData.crop,
        district: formData.district,
        quantityQuintals: 10,
      });

      const [harvestResponse, mandiResponse] = await Promise.all([
        harvestPromise,
        mandiPromise,
      ]);

      if (!mounted) {
        return;
      }

      setHarvestData(harvestResponse);
      setMandiData(mandiResponse);
      setLoadingHarvest(false);
      setLoadingMandi(false);

      if (harvestResponse?._meta?.usedCache || mandiResponse?._meta?.usedCache) {
        setOfflineBanner(
          '\u{1F4F5} No internet \u2014 showing your last saved recommendation'
        );
      }

      const explainResponse = await getExplanation({
        crop: formData.crop,
        district: formData.district,
        decisionId: `${formData.crop}-${formData.district}-${Date.now()}`,
      });

      if (!mounted) {
        return;
      }

      setExplanationData(explainResponse);
      setLoadingWhy(false);

      if (explainResponse?._meta?.usedCache) {
        setOfflineBanner(
          '\u{1F4F5} No internet \u2014 showing your last saved recommendation'
        );
      }
    };

    loadRecommendations();
    return () => {
      mounted = false;
    };
  }, [formData]);

  const openSpoilageRisk = () => {
    navigation.navigate('Spoilage', {
      prefill: {
        crop: formData.crop,
        district: formData.district,
        storageType: formData.storageType,
        transitHours: Number(formData.transitHours || 12),
      },
      source: 'recommendation',
    });
  };

  const openAriaAssistant = () => {
    navigation.navigate('Home');
  };

  const renderWhyReasons = () => {
    const reasons = [
      explanationData?.weather_reason,
      explanationData?.market_reason,
      explanationData?.supply_reason,
    ].filter(Boolean);

    return reasons.map((reason) => (
      <View key={reason} style={styles.reasonRow}>
        <Text style={styles.reasonIcon}>{'\u2022'}</Text>
        <Text style={styles.reasonText}>{reason}</Text>
      </View>
    ));
  };

  const isPendingBoth = loadingHarvest && loadingMandi;

  return (
    <View style={styles.screen}>
      <Appbar.Header style={styles.header}>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={t('recommendation.header')} titleStyle={styles.headerTitle} />
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

        {isPendingBoth || loadingHarvest ? (
          <SkeletonCard title={t('recommendation.harvestWindow')} />
        ) : (
          <Card style={styles.card}>
            <View style={[styles.cardHeader, styles.harvestHeader]}>
              <Text style={styles.cardHeaderText}>
                {t('recommendation.harvestWindow')}
              </Text>
            </View>
            <Card.Content style={styles.cardBody}>
              <Text style={styles.windowValue}>
                {buildWindowText(harvestData?.harvest_window)}
              </Text>
              <Text style={styles.windowSubtitle}>
                {harvestData?.risk_if_delayed || 'Window based on crop stage and current forecast.'}
              </Text>
              <ConfidenceIndicator score={harvestData?.confidence} />
            </Card.Content>
          </Card>
        )}

        {isPendingBoth || loadingMandi ? (
          <SkeletonCard title={t('recommendation.bestMandi')} />
        ) : (
          <Card style={styles.card}>
            <View style={[styles.cardHeader, styles.marketHeader]}>
              <Text style={styles.cardHeaderText}>
                {`${t('recommendation.sellAt')} ${mandiData?.best_mandi || t('recommendation.bestMandi')}`}
              </Text>
            </View>
            <Card.Content style={styles.cardBody}>
              <Text style={styles.priceRange}>
                {`${formatCurrency(mandiData?.expected_price_range?.[0])} — ${formatCurrency(
                  mandiData?.expected_price_range?.[1]
                )} ${t('common.perQuintal')}`}
              </Text>
              <Text style={styles.marketMeta}>
                {`${t('recommendation.transportCost', { cost: formatCurrency(mandiData?.transport_cost) })}`}
              </Text>
              <View style={styles.profitBox}>
                <Text style={styles.profitLine}>
                  {`${t('recommendation.localSale')} \u2192 ${formatCurrency(
                    mandiData?.net_profit_comparison?.local_mandi
                  )}`}
                </Text>
                <Text style={styles.profitLine}>
                  {`${mandiData?.best_mandi || 'Best mandi'} \u2192 ${formatCurrency(
                    mandiData?.net_profit_comparison?.best_mandi
                  )}`}
                </Text>
              </View>
              <ConfidenceIndicator score={mandiData?.confidence} />
            </Card.Content>
          </Card>
        )}

        <Card style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setExpanded((prev) => !prev)}
            style={styles.whyHeaderRow}
          >
            <Text style={styles.whyTitle}>{t('recommendation.whyRecommend')}</Text>
            <MaterialCommunityIcons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={COLORS.onSurface}
            />
          </TouchableOpacity>
          {expanded ? (
            <Card.Content style={styles.whyBody}>
              {loadingWhy ? (
                <View style={styles.whyLoader}>
                  <ActivityIndicator animating color={COLORS.primary} />
                  <Text style={styles.loaderText}>{t('recommendation.loadingReasons')}</Text>
                </View>
              ) : (
                <>
                  {renderWhyReasons()}
                  <Text style={styles.confidenceMessage}>
                    {explanationData?.confidence_message}
                  </Text>
                  <ConfidenceIndicator score={explanationData?.confidence} />
                </>
              )}
            </Card.Content>
          ) : null}
        </Card>

        <Button
          mode="contained"
          style={styles.spoilageButton}
          contentStyle={styles.spoilageButtonContent}
          buttonColor="#8D6E63"
          onPress={openSpoilageRisk}
        >
          {t('recommendation.checkSpoilage')}
        </Button>
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
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
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
  cardHeader: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  harvestHeader: {
    backgroundColor: COLORS.primary,
  },
  marketHeader: {
    backgroundColor: COLORS.info,
  },
  cardHeaderText: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onPrimary,
    fontWeight: '700',
  },
  cardBody: {
    paddingVertical: SPACING.sm,
    rowGap: SPACING.sm,
  },
  windowValue: {
    ...TYPOGRAPHY.headlineMedium,
    color: COLORS.onSurface,
    lineHeight: 34,
    fontWeight: '800',
  },
  windowSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurfaceVariant,
    lineHeight: 21,
  },
  priceRange: {
    ...TYPOGRAPHY.headlineSmall,
    color: COLORS.onSurface,
    lineHeight: 30,
    fontWeight: '800',
  },
  marketMeta: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurfaceVariant,
  },
  profitBox: {
    backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    rowGap: 6,
  },
  profitLine: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurface,
    fontWeight: '600',
  },
  whyHeaderRow: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  whyTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  whyBody: {
    paddingTop: 2,
    paddingBottom: SPACING.md,
    rowGap: SPACING.sm,
  },
  whyLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
  },
  loaderText: {
    ...TYPOGRAPHY.bodyMedium,
    marginTop: SPACING.sm,
    color: COLORS.onSurfaceVariant,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: SPACING.sm,
  },
  reasonIcon: {
    ...TYPOGRAPHY.bodyLarge,
    marginTop: 1,
    color: COLORS.primary,
  },
  reasonText: {
    flex: 1,
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurface,
    lineHeight: 21,
  },
  confidenceMessage: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurfaceVariant,
    lineHeight: 18,
  },
  confidenceRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: SPACING.sm,
  },
  confidenceDot: {
    width: 10,
    height: 10,
    borderRadius: RADIUS.full,
  },
  confidenceText: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.onSurfaceVariant,
    fontWeight: '600',
  },
  skeletonHeader: {
    backgroundColor: COLORS.surfaceContainerHigh,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  skeletonHeaderText: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurfaceVariant,
    fontWeight: '700',
  },
  skeletonLineWide: {
    height: 18,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceContainerHigh,
    width: '95%',
  },
  skeletonLineMid: {
    height: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceContainer,
    width: '72%',
  },
  skeletonLineShort: {
    height: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceContainer,
    width: '56%',
  },
  spoilageButton: {
    borderRadius: RADIUS.md,
    marginTop: SPACING.xs,
  },
  spoilageButtonContent: {
    minHeight: 54,
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
