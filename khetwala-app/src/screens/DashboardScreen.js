/**
 * Khetwala-मित्र Dashboard Screen — Material Design 3
 * Enhanced with F4 Loss Lessons, F7 Story Cards, F-feature quick links
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const API_URL = getBackendBaseUrl();

export default function DashboardScreen({ navigation }) {
  const { user, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const [lessons, setLessons] = useState([]);
  const [stories, setStories] = useState([]);

  const coreTools = [
    { icon: 'calendar-check', title: t('home.harvestAdvisor'), subtitle: t('home.harvestAdvisorSub'), screen: 'CropInput', color: '#1B5E20', bg: '#E8F5E9' },
    { icon: 'store', title: t('home.bestMandi'), subtitle: t('home.bestMandiSub'), screen: 'Market', color: '#0277BD', bg: '#E1F5FE' },
    { icon: 'package-variant', title: t('home.spoilageRisk'), subtitle: t('home.spoilageRiskSub'), screen: 'Spoilage', color: '#E65100', bg: '#FFF3E0' },
    { icon: 'leaf-circle-outline', title: t('home.diseaseScanner'), subtitle: t('home.diseaseScannerSub'), screen: 'Disease', color: '#2E7D32', bg: '#F1F8E9' },
    { icon: 'bank', title: t('home.govtSchemes'), subtitle: t('home.govtSchemesSub'), screen: 'Schemes', color: '#4527A0', bg: '#EDE7F6' },
    { icon: 'bell-ring-outline', title: t('home.smartAlerts'), subtitle: t('home.smartAlertsSub'), screen: 'Alerts', color: '#C62828', bg: '#FFEBEE' },
    { icon: 'earth', title: t('soilHealth.cardTitle'), subtitle: t('soilHealth.cardSub'), screen: 'SoilHealth', color: '#795548', bg: '#EFEBE9' },
    { icon: 'handshake', title: t('deals.cardTitle'), subtitle: t('deals.cardSub'), screen: 'Deals', color: '#1565C0', bg: '#E3F2FD' },
  ];

  const advancedFeatures = [
    { icon: 'dna', label: 'Digital Twin', screen: 'DigitalTwin', color: '#1B5E20', bg: '#E8F5E9' },
    { icon: 'camera-burst', label: 'Photo Scan', screen: 'PhotoDiagnostic', color: '#BF360C', bg: '#FBE9E7' },
    { icon: 'handshake', label: 'Negotiate', screen: 'NegotiationSimulator', color: '#5D4037', bg: '#EFEBE9' },
    { icon: 'water-percent', label: 'Soil Health', screen: 'SoilHealth', color: '#6A1B9A', bg: '#F3E5F5' },
    { icon: 'notebook', label: 'Crop Diary', screen: 'CropDiary', color: '#33691E', bg: '#F1F8E9' },
    { icon: 'cart', label: 'Marketplace', screen: 'Marketplace', color: '#E65100', bg: '#FFF3E0' },
    { icon: 'store', label: 'B2B Connect', screen: 'BuyerConnect', color: '#0D47A1', bg: '#E3F2FD' },
    { icon: 'snowflake', label: 'Cold Storage', screen: 'ColdStorage', color: '#01579B', bg: '#E1F5FE' },
    user?.is_admin ? { icon: 'shield-account', label: 'Telemetry', screen: 'TelemetryAdmin', color: '#4A148C', bg: '#F3E5F5' } : null,
  ].filter(Boolean);

  // Fetch F4 loss lessons
  const fetchLessons = async () => {
    try {
      const resp = await fetch(`${API_URL}/harvest-cycles/lessons/${user?.id || 1}`);
      const data = await resp.json();
      setLessons((data.lessons || []).slice(0, 2));
    } catch (e) {
      setLessons([
        { crop: 'Onion', lesson: 'Agar 12 din pehle becha hota toh ₹1,200 zyada milte.', loss_amount: 1200, optimal_date: '2025-01-05' },
      ]);
    }
  };

  // Generate F7 story cards (community highlights)
  const generateStories = () => {
    setStories([
      { id: 1, emoji: '🧊', title: 'Storage Insight', text: 'Cold storage availability improved this week', screen: 'ColdStorage', bg: '#E3F2FD' },
      { id: 2, emoji: '📈', title: 'Market Insight', text: 'Onion prices up 15% in Lasalgaon', screen: 'Market', bg: '#E8F5E9' },
      { id: 3, emoji: '⚠️', title: 'Disease Alert', text: 'Thrips outbreak reported nearby', screen: 'PhotoDiagnostic', bg: '#FBE9E7' },
    ]);
  };

  useFocusEffect(
    useCallback(() => {
      refreshProfile?.().catch(() => {});
      fetchLessons();
      generateStories();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshProfile?.(); } catch {}
    setRefreshing(false);
  };

  const quickActions = [
    { icon: 'chart-line', label: t('dashboard.checkPrices'), screen: 'Market', color: '#0277BD', bg: '#E1F5FE' },
    { icon: 'leaf', label: t('dashboard.scanDisease'), screen: 'Disease', color: '#2E7D32', bg: '#E8F5E9' },
    { icon: 'weather-partly-cloudy', label: t('dashboard.weather'), screen: 'Alerts', color: '#E65100', bg: '#FFF3E0' },
    { icon: 'account-cog', label: t('dashboard.editProfile'), screen: 'Profile', color: '#6A1B9A', bg: '#F3E5F5' },
  ];

  const statCards = [
    { icon: 'sprout', label: t('dashboard.mainCrop'), value: user?.main_crop ? user.main_crop.charAt(0).toUpperCase() + user.main_crop.slice(1) : '—', color: '#2E7D32', bg: '#E8F5E9' },
    { icon: 'ruler-square', label: t('dashboard.farmSize'), value: user?.farm_size_acres ? `${user.farm_size_acres} ${t('dashboard.acres')}` : '—', color: '#0277BD', bg: '#E1F5FE' },
    { icon: 'counter', label: t('dashboard.harvests'), value: String(user?.total_harvests ?? 0), color: '#E65100', bg: '#FFF3E0' },
    { icon: 'currency-inr', label: t('dashboard.savings'), value: user?.savings_estimate ? `₹${Number(user.savings_estimate).toLocaleString('en-IN')}` : '₹0', color: '#1B5E20', bg: '#E8F5E9' },
  ];

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return t('dashboard.goodMorning');
    if (h < 17) return t('dashboard.goodAfternoon');
    return t('dashboard.goodEvening');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.userName}>{user?.full_name || t('dashboard.farmer')}</Text>
            <Text style={styles.location}>
              <MaterialCommunityIcons name="map-marker-outline" size={14} color="rgba(255,255,255,0.7)" />
              {' '}{user?.district || '—'}, {user?.state || 'Maharashtra'}
            </Text>
          </View>
          <TouchableOpacity style={styles.avatarCircle} onPress={() => navigation.navigate('Profile')}>
            <MaterialCommunityIcons name="account" size={28} color={COLORS.onPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
      >
        {/* ── Stats Grid ────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('dashboard.farmOverview')}</Text>
        <View style={styles.statsGrid}>
          {statCards.map((s, i) => (
            <View key={i} style={styles.statCard}>
              <View style={[styles.statIconBg, { backgroundColor: s.bg }]}>
                <MaterialCommunityIcons name={s.icon} size={22} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Quick Actions ─────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('dashboard.quickActions')}</Text>
        <View style={styles.actionsRow}>
          {quickActions.map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionCard} onPress={() => navigation.navigate(a.screen)} activeOpacity={0.7}>
              <View style={[styles.actionIconBg, { backgroundColor: a.bg }]}>
                <MaterialCommunityIcons name={a.icon} size={26} color={a.color} />
              </View>
              <Text style={styles.actionLabel} numberOfLines={2}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Core Tools</Text>
        <View style={styles.coreToolsGrid}>
          {coreTools.map((tool) => (
            <TouchableOpacity
              key={tool.title}
              style={styles.coreToolCard}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(tool.screen)}
            >
              <View style={[styles.coreToolIconWrap, { backgroundColor: tool.bg }]}> 
                <MaterialCommunityIcons name={tool.icon} size={24} color={tool.color} />
              </View>
              <Text style={styles.coreToolTitle} numberOfLines={1}>{tool.title}</Text>
              <Text style={styles.coreToolSubtitle} numberOfLines={2}>{tool.subtitle}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── AI Insights Card ──────────────────────────────────────── */}
        <TouchableOpacity style={styles.insightCard} onPress={() => navigation.navigate('ARIA')} activeOpacity={0.8}>
          <View style={styles.insightIconWrap}>
            <MaterialCommunityIcons name="robot-outline" size={28} color={COLORS.primary} />
          </View>
          <View style={styles.insightRight}>
            <Text style={styles.insightTitle}>{t('dashboard.askAria')}</Text>
            <Text style={styles.insightSub}>{t('dashboard.ariaDescription')}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.outlineVariant} />
        </TouchableOpacity>

        {/* ── F7: Story Cards (Community Highlights) ───────────────── */}
        {stories.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>📢 Community Stories</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.sm }}>
              {stories.map(story => (
                <TouchableOpacity key={story.id}
                  style={[styles.storyCard, { backgroundColor: story.bg }]}
                  onPress={() => story.screen && navigation.navigate(story.screen)}>
                  <Text style={{ fontSize: 28 }}>{story.emoji}</Text>
                  <Text style={styles.storyTitle}>{story.title}</Text>
                  <Text style={styles.storyText}>{story.text}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── F4: Loss Lessons Card ────────────────────────────────── */}
        {lessons.length > 0 && (
          <View style={styles.lessonsCard}>
            <Text style={styles.lessonsHeader}>📘 Harvest Lessons</Text>
            {lessons.map((lesson, i) => (
              <View key={i} style={styles.lessonItem}>
                <Text style={styles.lessonCrop}>{lesson.crop}</Text>
                <Text style={styles.lessonText}>{lesson.lesson}</Text>
                {lesson.loss_amount > 0 && (
                  <Text style={styles.lessonLoss}>Potential loss: ₹{lesson.loss_amount.toLocaleString()}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── New Feature Quick Links ──────────────────────────────── */}
        <Text style={styles.sectionTitle}>🚀 Explore Features</Text>
        <View style={styles.featureGrid}>
          {advancedFeatures.map((f, i) => (
            <TouchableOpacity key={i} style={[styles.featureBtn, { backgroundColor: f.bg }]}
              onPress={() => navigation.navigate(f.screen)}>
              <MaterialCommunityIcons name={f.icon} size={22} color={f.color} />
              <Text style={[styles.featureBtnLabel, { color: f.color }]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Member Since ──────────────────────────────────────────── */}
        <View style={styles.memberCard}>
          <MaterialCommunityIcons name="shield-check-outline" size={20} color={COLORS.primary} />
          <Text style={styles.memberText}>
            {t('dashboard.memberSince')}{' '}
            {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '—'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 48, paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
  },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { ...TYPOGRAPHY.bodySmall, color: 'rgba(255,255,255,0.75)' },
  userName: { ...TYPOGRAPHY.headlineSmall, color: COLORS.onPrimary, fontWeight: '800', marginTop: 2 },
  location: { ...TYPOGRAPHY.labelSmall, color: 'rgba(255,255,255,0.7)', marginTop: SPACING.xs },
  avatarCircle: {
    width: 48, height: 48, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: 30 },

  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, fontWeight: '700', marginBottom: SPACING.sm, marginTop: SPACING.sm },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: {
    width: '48%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  statIconBg: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.sm,
  },
  statValue: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, fontWeight: '800' },
  statLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginTop: 2 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  actionCard: {
    width: '48%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm, alignItems: 'center', ...ELEVATION.level1,
  },
  actionIconBg: {
    width: 50, height: 50, borderRadius: RADIUS.lg,
    justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.sm,
  },
  actionLabel: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurface, textAlign: 'center', fontWeight: '600' },

  coreToolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  coreToolCard: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  coreToolIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  coreToolTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, fontWeight: '700' },
  coreToolSubtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },

  insightCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primaryContainer, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.sm,
  },
  insightIconWrap: { marginRight: SPACING.md },
  insightRight: { flex: 1 },
  insightTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.primary, fontWeight: '700' },
  insightSub: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },

  memberCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: SPACING.md, gap: SPACING.xs,
  },
  memberText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant },

  // F7 Story Cards
  storyCard: {
    width: 160, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginRight: SPACING.sm, ...ELEVATION.level1,
  },
  storyTitle: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurface, fontWeight: '700', marginTop: SPACING.xs },
  storyText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },

  // F4 Lessons
  lessonsCard: {
    backgroundColor: '#FFF8E1', borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: '#FF8F00',
  },
  lessonsHeader: { ...TYPOGRAPHY.titleSmall, color: '#E65100', marginBottom: SPACING.sm },
  lessonItem: { marginBottom: SPACING.sm },
  lessonCrop: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurface, fontWeight: '700' },
  lessonText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, lineHeight: 20, marginTop: 2 },
  lessonLoss: { ...TYPOGRAPHY.labelSmall, color: COLORS.error, marginTop: 2 },

  // Feature grid
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  featureBtn: {
    width: '23%', borderRadius: RADIUS.md, padding: SPACING.sm,
    alignItems: 'center', justifyContent: 'center', minHeight: 64,
  },
  featureBtnLabel: { ...TYPOGRAPHY.labelSmall, marginTop: 4, textAlign: 'center', fontWeight: '600' },
});
