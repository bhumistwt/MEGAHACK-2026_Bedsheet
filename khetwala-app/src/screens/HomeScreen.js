import React from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import WeatherBanner from '../components/WeatherBanner';
import { useLanguage } from '../context/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useAuth } from '../context/AuthContext';

const ACTION_CARDS = [
  { icon: 'calendar-check',     color: '#1B5E20', bg: '#E8F5E9', titleKey: 'home.harvestAdvisor', subtitleKey: 'home.harvestAdvisorSub', route: 'CropInput' },
  { icon: 'store',              color: '#0277BD', bg: '#E1F5FE', titleKey: 'home.bestMandi',      subtitleKey: 'home.bestMandiSub',      tab: 'Market' },
  { icon: 'package-variant',    color: '#E65100', bg: '#FFF3E0', titleKey: 'home.spoilageRisk',   subtitleKey: 'home.spoilageRiskSub',   route: 'Spoilage' },
  { icon: 'leaf-circle-outline',color: '#2E7D32', bg: '#F1F8E9', titleKey: 'home.diseaseScanner', subtitleKey: 'home.diseaseScannerSub', tab: 'Disease' },
  { icon: 'bank',               color: '#4527A0', bg: '#EDE7F6', titleKey: 'home.govtSchemes',    subtitleKey: 'home.govtSchemesSub',    route: 'Schemes' },
  { icon: 'bell-ring-outline',  color: '#C62828', bg: '#FFEBEE', titleKey: 'home.smartAlerts',    subtitleKey: 'home.smartAlertsSub',    route: 'Alerts' },
  { icon: 'earth',              color: '#795548', bg: '#EFEBE9', titleKey: 'soilHealth.cardTitle', subtitleKey: 'soilHealth.cardSub',     route: 'SoilHealth' },
  { icon: 'handshake',           color: '#1565C0', bg: '#E3F2FD', titleKey: 'deals.cardTitle',     subtitleKey: 'deals.cardSub',          route: 'Deals' },
];

export default function HomeScreen({ navigation }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const district = user?.district || 'Nashik';

  const handleCardPress = (card) => {
    if (card.route) navigation.navigate(card.route);
    else if (card.tab) navigation.navigate(card.tab);
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return t('home.greeting');
    if (h < 17) return t('home.greeting');
    return t('home.greeting');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <LinearGradient
        colors={[COLORS.primary, '#2E7D32']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.topBar}>
          <View>
            <Text style={styles.brandLabel}>{t('common.appName')}</Text>
            <Text style={styles.brandSub}>
              {user?.full_name ? `${user.full_name} • ${district}` : district}
            </Text>
          </View>
          <LanguageSwitcher compact />
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentContainer}
      >
        {/* ── Weather ─────────────────────────────────────────────── */}
        <WeatherBanner
          district={district}
          onPress={() => navigation.navigate('Alerts')}
        />

        {/* ── Greeting Card ───────────────────────────────────────── */}
        <View style={styles.greetingCard}>
          <Text style={styles.greetingTitle}>{greeting()}</Text>
          <Text style={styles.greetingSubtitle}>{t('home.subtitle')}</Text>
        </View>

        {/* ── Action Grid ─────────────────────────────────────────── */}
        <View style={styles.grid}>
          {ACTION_CARDS.map((card) => (
            <TouchableOpacity
              key={card.titleKey}
              style={styles.actionCard}
              activeOpacity={0.7}
              onPress={() => handleCardPress(card)}
            >
              <View style={[styles.cardIconWrap, { backgroundColor: card.bg }]}>
                <MaterialCommunityIcons name={card.icon} size={28} color={card.color} />
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{t(card.titleKey)}</Text>
              <Text style={styles.cardSubtitle} numberOfLines={2}>{t(card.subtitleKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandLabel: {
    ...TYPOGRAPHY.titleLarge,
    color: COLORS.onPrimary,
    fontWeight: '800',
  },
  brandSub: {
    ...TYPOGRAPHY.bodySmall,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  contentContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: 100,
    minHeight: '100%',
  },
  greetingCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    ...ELEVATION.level1,
  },
  greetingTitle: {
    ...TYPOGRAPHY.headlineSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  greetingSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: COLORS.onSurfaceVariant,
    marginTop: SPACING.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: SPACING.lg,
    rowGap: SPACING.md,
  },
  actionCard: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  cardTitle: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  cardSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurfaceVariant,
    marginTop: 2,
  },
});
