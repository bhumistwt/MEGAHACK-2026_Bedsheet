import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import WeatherBanner from '../components/WeatherBanner';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';

const ACTION_CARDS = [
  {
    title: 'Harvest Planning',
    subtitle: 'Track crop timing and readiness',
    color: '#1B5E20',
    bg: '#E8F5E9',
  },
  {
    title: 'Market Prices',
    subtitle: 'Review mandi trends and rates',
    color: '#0277BD',
    bg: '#E1F5FE',
  },
  {
    title: 'Storage Risk',
    subtitle: 'Check basic post-harvest handling',
    color: '#E65100',
    bg: '#FFF3E0',
  },
  {
    title: 'Farmer Profile',
    subtitle: 'Manage district and crop details',
    color: '#6A1B9A',
    bg: '#F3E5F5',
  },
];

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const district = user?.district || 'Not set';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <LinearGradient
        colors={[COLORS.primary, '#2E7D32']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Text style={styles.brandLabel}>Khetwala</Text>
        <Text style={styles.brandSub}>
          {user?.full_name ? `${user.full_name} • ${district}` : district}
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.contentContainer}>
        <WeatherBanner
          district={district === 'Not set' ? 'Nashik' : district}
          onPress={() => navigation.navigate('Market')}
        />

        <View style={styles.greetingCard}>
          <Text style={styles.greetingTitle}>Welcome back</Text>
          <Text style={styles.greetingSubtitle}>
            Your farm workspace is ready with the main tools in one place.
          </Text>
        </View>

        <View style={styles.grid}>
          {ACTION_CARDS.map((card) => (
            <TouchableOpacity
              key={card.title}
              style={styles.actionCard}
              onPress={
                card.title === 'Farmer Profile'
                  ? () => navigation.navigate('Profile')
                  : card.title === 'Market Prices'
                    ? () => navigation.navigate('Market')
                    : undefined
              }
              activeOpacity={
                card.title === 'Farmer Profile' || card.title === 'Market Prices' ? 0.7 : 1
              }
            >
              <View style={[styles.cardAccent, { backgroundColor: card.bg }]} />
              <Text style={[styles.cardTitle, { color: card.color }]}>{card.title}</Text>
              <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
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
  brandLabel: {
    ...TYPOGRAPHY.titleLarge,
    color: COLORS.onPrimary,
    fontWeight: '800',
  },
  brandSub: {
    ...TYPOGRAPHY.bodySmall,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 2,
  },
  contentContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: 80,
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
  cardAccent: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
  },
  cardTitle: {
    ...TYPOGRAPHY.titleSmall,
    fontWeight: '700',
  },
  cardSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurfaceVariant,
    marginTop: 2,
  },
  button: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: COLORS.onPrimary,
    fontWeight: '600',
  },
});
