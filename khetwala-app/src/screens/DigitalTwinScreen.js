/**
 * [F1] Digital Twin Screen — Crop Virtual Simulation
 * Material Design 3
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar, TextInput, Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const BASE_URL = getBackendBaseUrl();

export default function DigitalTwinScreen({ navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [simulations, setSimulations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newCrop, setNewCrop] = useState('');
  const [newDistrict, setNewDistrict] = useState(user?.district || 'Nashik');
  const [newSowingDate, setNewSowingDate] = useState('');
  const [whatifText, setWhatifText] = useState('');
  const [whatifResult, setWhatifResult] = useState(null);
  const [selectedSim, setSelectedSim] = useState(null);

  const fetchSimulations = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/digital-twin/${user?.id || 1}?active_only=true`);
      const data = await resp.json();
      setSimulations(data.simulations || []);
    } catch (e) {
      // Mock data
      setSimulations([
        { id: 1, crop: 'Onion', district: 'Nashik', sowing_date: '2025-01-01',
          current_stage: 'vegetative', health_score: 0.88, growth_day: 45,
          estimated_yield_kg: 7040, is_active: true },
      ]);
    }
  };

  useEffect(() => { fetchSimulations(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSimulations();
    setRefreshing(false);
  };

  const createSimulation = async () => {
    if (!newCrop || !newSowingDate) {
      Alert.alert('Error', 'Crop and sowing date required');
      return;
    }
    try {
      const resp = await fetch(`${BASE_URL}/digital-twin/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || 1,
          crop: newCrop,
          district: newDistrict,
          sowing_date: newSowingDate,
        }),
      });
      const data = await resp.json();
      Alert.alert('Created!', data.message || 'Digital twin created');
      setShowCreate(false);
      setNewCrop('');
      setNewSowingDate('');
      fetchSimulations();
    } catch (e) {
      Alert.alert('Error', 'Could not create simulation');
    }
  };

  const runWhatIf = async (simId) => {
    if (!whatifText) return;
    try {
      const resp = await fetch(`${BASE_URL}/digital-twin/${simId}/whatif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: whatifText, days_ahead: 7 }),
      });
      const data = await resp.json();
      setWhatifResult(data);
    } catch (e) {
      setWhatifResult({
        scenario: whatifText,
        recommendation: 'Network error — try again later.',
      });
    }
  };

  const healthColor = (score) => {
    if (score >= 0.8) return COLORS.success;
    if (score >= 0.6) return COLORS.tertiary;
    return COLORS.error;
  };

  const stageIcon = (stage) => {
    const icons = {
      seedling: 'sprout', vegetative: 'leaf', flowering: 'flower',
      bulbing: 'circle-multiple', maturity: 'check-circle',
      tuber_init: 'circle-slice-6', heading: 'wheat',
      tillering: 'grass',
    };
    return icons[stage] || 'sprout';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.onPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🌱 Crop Digital Twin</Text>
        <TouchableOpacity onPress={() => setShowCreate(!showCreate)} style={styles.addBtn}>
          <MaterialCommunityIcons name="plus" size={24} color={COLORS.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Create form */}
        {showCreate && (
          <View style={[styles.card, { borderLeftColor: COLORS.primary, borderLeftWidth: 4 }]}>
            <Text style={styles.cardTitle}>Create New Twin</Text>
            <TextInput style={styles.input} placeholder="Crop (e.g. Onion)"
              value={newCrop} onChangeText={setNewCrop} />
            <TextInput style={styles.input} placeholder="District"
              value={newDistrict} onChangeText={setNewDistrict} />
            <TextInput style={styles.input} placeholder="Sowing Date (YYYY-MM-DD)"
              value={newSowingDate} onChangeText={setNewSowingDate} />
            <TouchableOpacity style={styles.createBtn} onPress={createSimulation}>
              <Text style={styles.createBtnText}>Create Digital Twin</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Simulations list */}
        {simulations.length === 0 && !showCreate && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="flower-outline" size={64} color={COLORS.outline} />
            <Text style={styles.emptyText}>No active simulations</Text>
            <Text style={styles.emptySubtext}>Tap + to create your first crop digital twin</Text>
          </View>
        )}

        {simulations.map((sim) => (
          <View key={sim.id} style={styles.card}>
            {/* Header */}
            <View style={styles.simHeader}>
              <View style={[styles.stageIcon, { backgroundColor: healthColor(sim.health_score) + '20' }]}>
                <MaterialCommunityIcons name={stageIcon(sim.current_stage)} size={28}
                  color={healthColor(sim.health_score)} />
              </View>
              <View style={{ flex: 1, marginLeft: SPACING.md }}>
                <Text style={styles.simCrop}>{sim.crop}</Text>
                <Text style={styles.simDistrict}>{sim.district} • Day {sim.growth_day}</Text>
              </View>
              <View style={[styles.healthBadge, { backgroundColor: healthColor(sim.health_score) + '15' }]}>
                <Text style={[styles.healthText, { color: healthColor(sim.health_score) }]}>
                  {Math.round(sim.health_score * 100)}%
                </Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Stage</Text>
                <Text style={styles.statValue}>{sim.current_stage}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Est. Yield</Text>
                <Text style={styles.statValue}>{sim.estimated_yield_kg?.toLocaleString()} kg</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Sowing</Text>
                <Text style={styles.statValue}>{sim.sowing_date}</Text>
              </View>
            </View>

            {/* Health bar */}
            <View style={styles.healthBar}>
              <View style={[styles.healthFill, {
                width: `${sim.health_score * 100}%`,
                backgroundColor: healthColor(sim.health_score),
              }]} />
            </View>

            {/* What-if section */}
            <TouchableOpacity
              style={styles.whatifToggle}
              onPress={() => setSelectedSim(selectedSim === sim.id ? null : sim.id)}
            >
              <MaterialCommunityIcons name="flask-outline" size={18} color={COLORS.primary} />
              <Text style={styles.whatifToggleText}>  What-If Simulator</Text>
            </TouchableOpacity>

            {selectedSim === sim.id && (
              <View style={styles.whatifSection}>
                <TextInput style={styles.input}
                  placeholder="e.g. reduce irrigation 50%"
                  value={whatifText} onChangeText={setWhatifText} />
                <TouchableOpacity style={styles.whatifBtn} onPress={() => runWhatIf(sim.id)}>
                  <Text style={styles.whatifBtnText}>Run Scenario</Text>
                </TouchableOpacity>

                {whatifResult && (
                  <View style={styles.whatifResultCard}>
                    <Text style={styles.whatifScenario}>📊 {whatifResult.scenario}</Text>
                    <View style={styles.whatifStats}>
                      <Text style={[styles.whatifChange, { color: whatifResult.health_change_pct < 0 ? COLORS.error : COLORS.success }]}>
                        Health: {whatifResult.health_change_pct > 0 ? '+' : ''}{whatifResult.health_change_pct}%
                      </Text>
                      <Text style={[styles.whatifChange, { color: whatifResult.yield_change_pct < 0 ? COLORS.error : COLORS.success }]}>
                        Yield: {whatifResult.yield_change_pct > 0 ? '+' : ''}{whatifResult.yield_change_pct}%
                      </Text>
                    </View>
                    <Text style={styles.whatifAdvice}>{whatifResult.recommendation}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        ))}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.primary, paddingTop: 48, paddingBottom: 16,
    paddingHorizontal: SPACING.lg, flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { marginRight: SPACING.md },
  headerTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onPrimary, flex: 1 },
  addBtn: { padding: 4 },
  scrollView: { flex: 1, padding: SPACING.md },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, marginBottom: SPACING.md },
  input: {
    borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.sm, ...TYPOGRAPHY.bodyLarge,
    color: COLORS.onSurface,
  },
  createBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm,
  },
  createBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl },
  emptyText: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurfaceVariant, marginTop: SPACING.md },
  emptySubtext: { ...TYPOGRAPHY.bodyMedium, color: COLORS.outline, marginTop: SPACING.xs },
  simHeader: { flexDirection: 'row', alignItems: 'center' },
  stageIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  simCrop: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  simDistrict: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  healthBadge: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.full },
  healthText: { ...TYPOGRAPHY.labelLarge, fontWeight: '700' },
  statsRow: { flexDirection: 'row', marginTop: SPACING.md, gap: SPACING.md },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant },
  statValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, fontWeight: '600', marginTop: 2 },
  healthBar: {
    height: 6, backgroundColor: COLORS.surfaceContainerHigh,
    borderRadius: 3, marginTop: SPACING.md, overflow: 'hidden',
  },
  healthFill: { height: '100%', borderRadius: 3 },
  whatifToggle: {
    flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md,
    paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.outlineVariant,
  },
  whatifToggleText: { ...TYPOGRAPHY.labelLarge, color: COLORS.primary },
  whatifSection: { marginTop: SPACING.sm },
  whatifBtn: {
    backgroundColor: COLORS.secondaryContainer, borderRadius: RADIUS.md,
    padding: SPACING.sm, alignItems: 'center',
  },
  whatifBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSecondaryContainer },
  whatifResultCard: {
    backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md,
    padding: SPACING.md, marginTop: SPACING.sm,
  },
  whatifScenario: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, fontWeight: '600' },
  whatifStats: { flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm },
  whatifChange: { ...TYPOGRAPHY.labelLarge, fontWeight: '700' },
  whatifAdvice: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm, lineHeight: 20 },
});
