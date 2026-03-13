/**
 * [F3] Photo Diagnostic Screen
 * Multi-photo crop disease diagnosis with AI + 3-tier treatment
 * Material Design 3
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, Image, Alert, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';

const MOCK_DIAGNOSIS = {
  disease_detected: 'Late Blight (Phytophthora infestans)',
  confidence: 87,
  severity: 'Moderate',
  affected_area_percent: 35,
  description: 'Fungal disease causing dark lesions on leaves. Spreads rapidly in cool, wet conditions.',
  immediate_action: 'Remove affected leaves immediately. Ensure good air circulation.',
  treatments: [
    { tier: 1, name: 'Mancozeb 75% WP', type: 'Chemical', dosage: '2.5g/L water', application: 'Foliar spray every 7-10 days', cost: '₹200-300/kg', effectiveness: '85%' },
    { tier: 2, name: 'Copper Oxychloride', type: 'Chemical', dosage: '3g/L water', application: 'Preventive spray before monsoon', cost: '₹250-350/kg', effectiveness: '75%' },
    { tier: 3, name: 'Trichoderma viride', type: 'Biological', dosage: '5g/L water', application: 'Soil and foliar application', cost: '₹150-200/kg', effectiveness: '60%' },
  ],
  nearest_kvk: {
    name: 'KVK Nashik',
    address: 'Igatpuri Road, Nashik',
    phone: '0253-2345678',
    distance_km: 15,
  },
};

export default function PhotoDiagnosticScreen({ navigation }) {
  const { t } = useLanguage();
  const [photos, setPhotos] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);

  const pickPhoto = () => {
    // In production: use expo-image-picker
    Alert.alert(
      'Select Photo',
      'Choose a method',
      [
        {
          text: 'Camera', onPress: () => {
            // Mock: add placeholder
            if (photos.length < 3) {
              setPhotos(prev => [...prev, {
                uri: `placeholder_${Date.now()}`,
                label: `Photo ${prev.length + 1}`,
              }]);
            }
          }
        },
        {
          text: 'Gallery', onPress: () => {
            if (photos.length < 3) {
              setPhotos(prev => [...prev, {
                uri: `placeholder_${Date.now()}`,
                label: `Photo ${prev.length + 1}`,
              }]);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const analyzePhotos = async () => {
    if (photos.length === 0) {
      Alert.alert('No Photos', 'Please add at least one photo to analyze.');
      return;
    }

    setAnalyzing(true);
    try {
      // In production: send actual images via FormData
      const resp = await fetch(`${BASE_URL}/api/disease/photo-diagnostic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: photos.map(p => p.uri),
          crop: 'Tomato',
          symptoms: 'dark spots on leaves',
        }),
      });
      const data = await resp.json();
      setResult(data);
    } catch (e) {
      setResult(MOCK_DIAGNOSIS);
    } finally {
      setAnalyzing(false);
    }
  };

  const severityColor = (sev) => {
    const s = (sev || '').toLowerCase();
    if (s === 'severe' || s === 'high') return COLORS.error;
    if (s === 'moderate' || s === 'medium') return '#FF9800';
    return COLORS.success;
  };

  const tierIcon = (tier) => {
    if (tier === 1) return { icon: 'flash', color: COLORS.error, label: 'Best' };
    if (tier === 2) return { icon: 'shield-check', color: '#FF9800', label: 'Alternative' };
    return { icon: 'leaf', color: COLORS.success, label: 'Organic' };
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#BF360C" />
      <View style={[styles.header, { backgroundColor: '#BF360C' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>📸 Photo Diagnostic</Text>
      </View>

      <ScrollView style={{ flex: 1, padding: SPACING.md }}>
        {/* ── PHOTO UPLOAD ── */}
        {!result && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Upload Crop Photos</Text>
              <Text style={styles.subtitle}>Take up to 3 clear photos of affected leaves/plants</Text>

              <View style={styles.photoGrid}>
                {photos.map((photo, idx) => (
                  <View key={idx} style={styles.photoSlot}>
                    <View style={styles.photoPlaceholder}>
                      <MaterialCommunityIcons name="image" size={32} color={COLORS.primary} />
                      <Text style={styles.photoLabel}>{photo.label}</Text>
                    </View>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => removePhoto(idx)}>
                      <MaterialCommunityIcons name="close-circle" size={22} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < 3 && (
                  <TouchableOpacity style={styles.addPhotoSlot} onPress={pickPhoto}>
                    <MaterialCommunityIcons name="camera-plus" size={32} color={COLORS.onSurfaceVariant} />
                    <Text style={styles.addPhotoText}>Add Photo</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Tips */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📷 Photo Tips</Text>
              {[
                'Take photos in good natural light',
                'Focus on affected parts (leaves, stem, fruit)',
                'Include both close-up and full plant shots',
                'Avoid blurry or shadowed images',
              ].map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <MaterialCommunityIcons name="check-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={[styles.analyzeBtn, photos.length === 0 && { opacity: 0.5 }]}
              onPress={analyzePhotos} disabled={analyzing || photos.length === 0}>
              {analyzing ? (
                <ActivityIndicator color={COLORS.onPrimary} />
              ) : (
                <>
                  <MaterialCommunityIcons name="brain" size={24} color={COLORS.onPrimary} />
                  <Text style={styles.analyzeBtnText}>  Analyze with AI</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── DIAGNOSIS RESULT ── */}
        {result && (
          <>
            {/* Disease info */}
            <View style={styles.card}>
              <View style={styles.diagHeader}>
                <View style={[styles.diagIcon, { backgroundColor: severityColor(result.severity) + '15' }]}>
                  <MaterialCommunityIcons name="virus" size={28} color={severityColor(result.severity)} />
                </View>
                <View style={{ flex: 1, marginLeft: SPACING.md }}>
                  <Text style={styles.diseaseName}>{result.disease_detected}</Text>
                  <View style={styles.confRow}>
                    <Text style={styles.confText}>{result.confidence}% confident</Text>
                    <View style={[styles.sevBadge, { backgroundColor: severityColor(result.severity) + '15' }]}>
                      <Text style={[styles.sevText, { color: severityColor(result.severity) }]}>
                        {result.severity}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {result.affected_area_percent && (
                <View style={styles.areaBar}>
                  <Text style={styles.areaLabel}>Affected Area</Text>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, {
                      width: `${result.affected_area_percent}%`,
                      backgroundColor: severityColor(result.severity),
                    }]} />
                  </View>
                  <Text style={styles.areaPercent}>{result.affected_area_percent}%</Text>
                </View>
              )}

              <Text style={styles.descText}>{result.description}</Text>
            </View>

            {/* Immediate action */}
            {result.immediate_action && (
              <View style={[styles.card, { backgroundColor: '#FFF3E0', borderLeftWidth: 4, borderLeftColor: '#FF9800' }]}>
                <Text style={styles.actionTitle}>⚠️ Immediate Action</Text>
                <Text style={styles.actionText}>{result.immediate_action}</Text>
              </View>
            )}

            {/* 3-Tier treatments */}
            <Text style={styles.sectionTitle}>Treatment Options</Text>
            {(result.treatments || []).map((tr, idx) => {
              const ti = tierIcon(tr.tier);
              const isSelected = selectedTier === idx;
              return (
                <TouchableOpacity key={idx}
                  style={[styles.treatmentCard, isSelected && { borderColor: ti.color, borderWidth: 2 }]}
                  onPress={() => setSelectedTier(isSelected ? null : idx)}>
                  <View style={styles.treatmentHeader}>
                    <View style={[styles.tierBadge, { backgroundColor: ti.color + '15' }]}>
                      <MaterialCommunityIcons name={ti.icon} size={20} color={ti.color} />
                      <Text style={[styles.tierLabel, { color: ti.color }]}> Tier {tr.tier} • {ti.label}</Text>
                    </View>
                    <Text style={[styles.effectiveness, { color: ti.color }]}>{tr.effectiveness}</Text>
                  </View>

                  <Text style={styles.treatmentName}>{tr.name}</Text>
                  <Text style={styles.treatmentType}>{tr.type}</Text>

                  {isSelected && (
                    <View style={styles.treatmentDetails}>
                      <View style={styles.detailRow}>
                        <MaterialCommunityIcons name="eyedropper" size={16} color={COLORS.onSurfaceVariant} />
                        <Text style={styles.detailText}> Dosage: {tr.dosage}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <MaterialCommunityIcons name="spray" size={16} color={COLORS.onSurfaceVariant} />
                        <Text style={styles.detailText}> {tr.application}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <MaterialCommunityIcons name="currency-inr" size={16} color={COLORS.onSurfaceVariant} />
                        <Text style={styles.detailText}> Cost: {tr.cost}</Text>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Nearest KVK */}
            {result.nearest_kvk && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>🏫 Nearest KVK</Text>
                <Text style={styles.kvkName}>{result.nearest_kvk.name}</Text>
                <Text style={styles.kvkAddr}>{result.nearest_kvk.address}</Text>
                <Text style={styles.kvkPhone}>📞 {result.nearest_kvk.phone}</Text>
                <Text style={styles.kvkDist}>📍 {result.nearest_kvk.distance_km} km away</Text>
              </View>
            )}

            {/* Reset */}
            <TouchableOpacity style={[styles.analyzeBtn, { backgroundColor: COLORS.surfaceContainerHigh }]}
              onPress={() => { setResult(null); setPhotos([]); setSelectedTier(null); }}>
              <MaterialCommunityIcons name="camera-retake" size={24} color={COLORS.onSurface} />
              <Text style={[styles.analyzeBtnText, { color: COLORS.onSurface }]}>  New Diagnosis</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
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
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  subtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 4, marginBottom: SPACING.md },
  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, marginBottom: SPACING.sm, marginTop: SPACING.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  photoSlot: { width: 100, height: 100, position: 'relative' },
  photoPlaceholder: {
    width: 100, height: 100, borderRadius: RADIUS.md, backgroundColor: COLORS.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  photoLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.primary, marginTop: 4 },
  removeBtn: { position: 'absolute', top: -6, right: -6 },
  addPhotoSlot: {
    width: 100, height: 100, borderRadius: RADIUS.md, borderWidth: 2,
    borderColor: COLORS.outlineVariant, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  addPhotoText: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginTop: 4 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  tipText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, flex: 1 },
  analyzeBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm,
  },
  analyzeBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
  diagHeader: { flexDirection: 'row', alignItems: 'center' },
  diagIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  diseaseName: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4 },
  confText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  sevBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm },
  sevText: { ...TYPOGRAPHY.labelSmall, fontWeight: '700' },
  areaBar: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, gap: SPACING.sm },
  areaLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, width: 80 },
  barBg: { flex: 1, height: 8, backgroundColor: COLORS.surfaceContainerHigh, borderRadius: 4 },
  barFill: { height: 8, borderRadius: 4 },
  areaPercent: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant, width: 36, textAlign: 'right' },
  descText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, lineHeight: 22, marginTop: SPACING.md },
  actionTitle: { ...TYPOGRAPHY.titleSmall, color: '#E65100', marginBottom: SPACING.xs },
  actionText: { ...TYPOGRAPHY.bodyMedium, color: '#BF360C', lineHeight: 22 },
  treatmentCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  treatmentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm },
  tierLabel: { ...TYPOGRAPHY.labelSmall, fontWeight: '700' },
  effectiveness: { ...TYPOGRAPHY.labelLarge, fontWeight: '700' },
  treatmentName: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, marginTop: SPACING.sm },
  treatmentType: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  treatmentDetails: { marginTop: SPACING.md, backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md, padding: SPACING.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs },
  detailText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurface },
  kvkName: { ...TYPOGRAPHY.titleSmall, color: COLORS.primary, marginTop: SPACING.sm },
  kvkAddr: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  kvkPhone: { ...TYPOGRAPHY.bodyMedium, color: COLORS.primary, marginTop: SPACING.xs },
  kvkDist: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
});
