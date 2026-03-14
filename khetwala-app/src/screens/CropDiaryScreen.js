/**
 * [F9] Crop Diary Screen
 * Personal farming diary with auto-tagging and sentiment
 * Material Design 3
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const BASE_URL = getBackendBaseUrl();

const TAG_COLORS = {
  irrigation: '#1565C0', fertilizer: '#2E7D32', pesticide: '#D32F2F',
  disease: '#F57F17', weather: '#0277BD', harvest: '#FF6F00',
  market: '#6A1B9A', sowing: '#00838F', growth: '#558B2F',
  soil: '#795548', labor: '#E64A19', cost: '#455A64',
};

const SENTIMENT_ICONS = {
  positive: { icon: '😊', color: '#4CAF50' },
  negative: { icon: '😟', color: '#F44336' },
  neutral: { icon: '😐', color: '#9E9E9E' },
};

const MOCK_ENTRIES = [
  { id: 1, crop: 'Onion', content: 'Aaj irrigation pump chalu kiya. Soil moisture accha hai.', tags: ['irrigation', 'soil'], sentiment: 'positive', season: 'rabi', created_at: '2025-01-15T10:00:00' },
  { id: 2, crop: 'Onion', content: 'Thrips ka attack dikha. Imidacloprid spray kiya.', tags: ['disease', 'pesticide'], sentiment: 'negative', season: 'rabi', created_at: '2025-01-12T08:00:00' },
  { id: 3, crop: 'Tomato', content: 'Market mein ₹3500/quintal mil raha hai. Bahut accha.', tags: ['market'], sentiment: 'positive', season: 'rabi', created_at: '2025-01-10T16:00:00' },
];

export default function CropDiaryScreen({ navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [formCrop, setFormCrop] = useState('');
  const [formContent, setFormContent] = useState('');
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('entries');

  const fetchEntries = useCallback(async () => {
    try {
      const resp = await fetch(`${BASE_URL}/diary/entries/${user?.id || 1}`);
      const data = await resp.json();
      setEntries(data.entries || []);
    } catch (e) {
      setEntries(MOCK_ENTRIES);
    } finally { setLoading(false); setRefreshing(false); }
  }, [user]);

  const fetchSummary = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/diary/summary/${user?.id || 1}`);
      const data = await resp.json();
      setSummary(data);
    } catch (e) {
      setSummary({
        total_entries: 3, patterns: ['Irrigation is consistent', 'Disease management needed'],
        sentiment_trend: 'Mostly positive', top_tags: [['irrigation', 3], ['market', 2]],
        season_distribution: { rabi: 3 },
      });
    }
  };

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const onRefresh = () => { setRefreshing(true); fetchEntries(); };

  const openCreate = () => {
    setEditEntry(null);
    setFormCrop('');
    setFormContent('');
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setFormCrop(entry.crop);
    setFormContent(entry.content);
    setShowModal(true);
  };

  const saveEntry = async () => {
    if (!formCrop.trim() || !formContent.trim()) return;
    try {
      if (editEntry) {
        await fetch(`${BASE_URL}/diary/entries/${editEntry.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: formContent }),
        });
      } else {
        await fetch(`${BASE_URL}/diary/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user?.id || 1, crop: formCrop, content: formContent }),
        });
      }
    } catch (e) {
      // Mock
      const newEntry = {
        id: entries.length + 10,
        crop: formCrop,
        content: formContent,
        tags: ['growth'],
        sentiment: 'neutral',
        season: 'rabi',
        created_at: new Date().toISOString(),
      };
      setEntries(prev => [newEntry, ...prev]);
    }
    setShowModal(false);
    fetchEntries();
  };

  const deleteEntry = async (entryId) => {
    try {
      await fetch(`${BASE_URL}/diary/entries/${entryId}`, { method: 'DELETE' });
    } catch (e) { /* mock */ }
    setEntries(prev => prev.filter(e => e.id !== entryId));
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#33691E" />
      <View style={[styles.header, { backgroundColor: '#33691E' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>📔 Crop Diary</Text>
        <TouchableOpacity onPress={openCreate}>
          <MaterialCommunityIcons name="plus-circle" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['entries', 'summary'].map(t2 => (
          <TouchableOpacity key={t2} style={[styles.tabBtn, tab === t2 && styles.tabActive]}
            onPress={() => { setTab(t2); if (t2 === 'summary' && !summary) fetchSummary(); }}>
            <Text style={[styles.tabText, tab === t2 && styles.tabTextActive]}>
              {t2 === 'entries' ? '📝 Entries' : '📊 Summary'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled">

          {/* ── ENTRIES TAB ── */}
          {tab === 'entries' && (
            <View style={{ padding: SPACING.md }}>
              {entries.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={{ fontSize: 48 }}>📔</Text>
                  <Text style={styles.emptyTitle}>Start Your Diary</Text>
                  <Text style={styles.emptyText}>Record daily farming activities, observations and learnings.</Text>
                  <TouchableOpacity style={styles.createBtn} onPress={openCreate}>
                    <Text style={styles.createBtnText}>+ New Entry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                entries.map((entry) => (
                  <View key={entry.id} style={styles.entryCard}>
                    <View style={styles.entryHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryCrop}>{entry.crop}</Text>
                        <Text style={styles.entryDate}>{formatDate(entry.created_at)} • {entry.season}</Text>
                      </View>
                      <Text style={{ fontSize: 24 }}>{SENTIMENT_ICONS[entry.sentiment]?.icon || '😐'}</Text>
                    </View>
                    <Text style={styles.entryContent}>{entry.content}</Text>
                    <View style={styles.tagRow}>
                      {(entry.tags || []).map((tag, i) => (
                        <View key={i} style={[styles.tag, { backgroundColor: (TAG_COLORS[tag] || '#999') + '15' }]}>
                          <Text style={[styles.tagText, { color: TAG_COLORS[tag] || '#999' }]}>#{tag}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.entryActions}>
                      <TouchableOpacity onPress={() => openEdit(entry)}>
                        <MaterialCommunityIcons name="pencil" size={20} color={COLORS.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteEntry(entry.id)} style={{ marginLeft: SPACING.lg }}>
                        <MaterialCommunityIcons name="delete-outline" size={20} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* ── SUMMARY TAB ── */}
          {tab === 'summary' && summary && (
            <View style={{ padding: SPACING.md }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Diary Overview</Text>
                <View style={styles.statRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{summary.total_entries}</Text>
                    <Text style={styles.statLabel}>Total Entries</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{summary.sentiment_trend || '—'}</Text>
                    <Text style={styles.statLabel}>Mood Trend</Text>
                  </View>
                </View>
              </View>

              {summary.top_tags && summary.top_tags.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Top Tags</Text>
                  {summary.top_tags.map(([tag, count], i) => (
                    <View key={i} style={styles.topTagRow}>
                      <View style={[styles.tag, { backgroundColor: (TAG_COLORS[tag] || '#999') + '15' }]}>
                        <Text style={[styles.tagText, { color: TAG_COLORS[tag] || '#999' }]}>#{tag}</Text>
                      </View>
                      <View style={styles.topTagBar}>
                        <View style={[styles.topTagFill, { width: `${Math.min(count * 20, 100)}%`, backgroundColor: TAG_COLORS[tag] || '#999' }]} />
                      </View>
                      <Text style={styles.topTagCount}>{count}</Text>
                    </View>
                  ))}
                </View>
              )}

              {summary.patterns && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Patterns & Insights</Text>
                  {summary.patterns.map((p, i) => (
                    <View key={i} style={styles.patternRow}>
                      <MaterialCommunityIcons name="lightbulb-outline" size={18} color={COLORS.tertiary} />
                      <Text style={styles.patternText}>{p}</Text>
                    </View>
                  ))}
                </View>
              )}

              {summary.season_distribution && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Season Distribution</Text>
                  {Object.entries(summary.season_distribution).map(([season, count]) => (
                    <Text key={season} style={styles.seasonText}>
                      {season === 'kharif' ? '🌧️' : season === 'rabi' ? '❄️' : '☀️'} {season}: {count} entries
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      )}

      {/* ── CREATE/EDIT MODAL ── */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editEntry ? 'Edit Entry' : 'New Diary Entry'}</Text>

            {!editEntry && (
              <>
                <Text style={styles.formLabel}>Crop</Text>
                <TextInput style={styles.formInput} value={formCrop} onChangeText={setFormCrop}
                  placeholder="e.g. Onion, Tomato" />
              </>
            )}

            <Text style={styles.formLabel}>What happened today?</Text>
            <TextInput style={[styles.formInput, { height: 120, textAlignVertical: 'top' }]}
              value={formContent} onChangeText={setFormContent}
              placeholder="Irrigation kiya, pesticide spray kiya, mandi gaya..."
              multiline numberOfLines={5} />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEntry}>
                <Text style={styles.saveBtnText}>Save Entry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: 48, paddingBottom: 16, paddingHorizontal: SPACING.lg,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { marginRight: SPACING.md },
  headerTitle: { ...TYPOGRAPHY.titleLarge, flex: 1 },
  tabRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md, ...ELEVATION.level1,
  },
  tabBtn: { flex: 1, paddingVertical: SPACING.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant },
  tabTextActive: { color: COLORS.primary },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, marginBottom: SPACING.md },
  emptyCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xxl,
    alignItems: 'center', ...ELEVATION.level2,
  },
  emptyTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, marginTop: SPACING.md },
  emptyText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant, textAlign: 'center', marginTop: SPACING.sm },
  createBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.lg },
  createBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
  entryCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.sm },
  entryCrop: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  entryDate: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  entryContent: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, lineHeight: 22, marginBottom: SPACING.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  tag: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm },
  tagText: { ...TYPOGRAPHY.labelSmall, fontWeight: '600' },
  entryActions: { flexDirection: 'row', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.outlineVariant },
  statRow: { flexDirection: 'row', gap: SPACING.md },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md, padding: SPACING.md },
  statValue: { ...TYPOGRAPHY.titleLarge, color: COLORS.primary, fontWeight: '700' },
  statLabel: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  topTagRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.sm },
  topTagBar: { flex: 1, height: 6, backgroundColor: COLORS.surfaceContainerHigh, borderRadius: 3 },
  topTagFill: { height: 6, borderRadius: 3 },
  topTagCount: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant, width: 24, textAlign: 'right' },
  patternRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: SPACING.sm },
  patternText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, flex: 1, lineHeight: 22 },
  seasonText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, paddingVertical: SPACING.xs },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg },
  modalTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, marginBottom: SPACING.lg },
  formLabel: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant, marginBottom: 4, marginTop: SPACING.sm },
  formInput: {
    borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface,
  },
  modalActions: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  cancelBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  saveBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
});
