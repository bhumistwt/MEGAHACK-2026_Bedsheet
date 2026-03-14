import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getBackendBaseUrl } from '../config/backend';

const API_BASE_URL = getBackendBaseUrl();

export default function TelemetryAdminScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [summary, setSummary] = useState({ total_events: 0, by_event: {}, last_event_at: null });

  const rows = useMemo(() => Object.entries(summary.by_event || {}).sort((a, b) => b[1] - a[1]), [summary]);

  const loadSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorText('');
    try {
      const response = await fetch(`${API_BASE_URL}/telemetry/summary`);
      if (!response.ok) {
        throw new Error('Unable to fetch telemetry summary');
      }
      const payload = await response.json();
      setSummary(payload);
    } catch {
      setErrorText('Could not load telemetry summary right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!user?.is_admin) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <View style={styles.lockedWrap}>
          <MaterialCommunityIcons name="shield-lock-outline" size={46} color={COLORS.error} />
          <Text style={styles.lockedTitle}>Admin access required</Text>
          <Text style={styles.lockedSub}>This screen is only available for admin users.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.onSurface} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Telemetry Dashboard</Text>
          <Text style={styles.subtitle}>Live counters for app reliability events</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loaderText}>Loading telemetry...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
            setRefreshing(true);
            loadSummary(true);
          }} />}
        >
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total events</Text>
            <Text style={styles.statValue}>{summary.total_events || 0}</Text>
            <Text style={styles.statSub}>
              Last update: {summary.last_event_at ? new Date(summary.last_event_at).toLocaleString() : '—'}
            </Text>
          </View>

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <View style={styles.listCard}>
            <Text style={styles.listTitle}>Events by type</Text>
            {rows.length === 0 ? (
              <Text style={styles.emptyText}>No telemetry events yet.</Text>
            ) : (
              rows.map(([name, count]) => (
                <View key={name} style={styles.eventRow}>
                  <Text style={styles.eventName}>{name}</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{count}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...ELEVATION.level1,
  },
  title: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, fontWeight: '700' },
  subtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  body: { flex: 1 },
  bodyContent: { padding: SPACING.md, paddingBottom: SPACING.xl },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loaderText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm },
  statCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  statLabel: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  statValue: { ...TYPOGRAPHY.headlineLarge, color: COLORS.primary, fontWeight: '800', marginTop: 2 },
  statSub: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 4 },
  listCard: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  listTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.outlineVariant,
  },
  eventName: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, textTransform: 'none' },
  countPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.primaryContainer,
  },
  countText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimaryContainer, fontWeight: '700' },
  errorText: { ...TYPOGRAPHY.bodySmall, color: COLORS.error, marginTop: SPACING.sm },
  lockedWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.lg },
  lockedTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, fontWeight: '700', marginTop: SPACING.sm },
  lockedSub: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant, marginTop: 6, textAlign: 'center' },
  backBtn: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtnText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onPrimary, fontWeight: '700' },
});
