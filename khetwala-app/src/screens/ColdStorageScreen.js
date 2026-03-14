/**
 * [F17] Cold Storage Monitor Screen
 * IoT sensor readings, temperature/humidity display, alerts
 * Material Design 3
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, RefreshControl, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const BASE_URL = getBackendBaseUrl();

const THRESHOLDS = {
  onion: { temp_min: 0, temp_max: 3, humidity_min: 65, humidity_max: 70, label: 'Onion' },
  potato: { temp_min: 3, temp_max: 7, humidity_min: 90, humidity_max: 95, label: 'Potato' },
  tomato: { temp_min: 7, temp_max: 13, humidity_min: 85, humidity_max: 95, label: 'Tomato' },
  apple: { temp_min: -1, temp_max: 4, humidity_min: 90, humidity_max: 95, label: 'Apple' },
  grape: { temp_min: -1, temp_max: 0, humidity_min: 90, humidity_max: 95, label: 'Grape' },
  wheat: { temp_min: 10, temp_max: 20, humidity_min: 40, humidity_max: 60, label: 'Wheat' },
};

const MOCK_DEVICES = [
  {
    device_id: 'COLD-001', crop: 'onion', location: 'Godown A',
    latest: { temperature: 2.5, humidity: 68, battery_percent: 82, timestamp: new Date().toISOString() },
    status: 'normal',
  },
  {
    device_id: 'COLD-002', crop: 'potato', location: 'Godown B',
    latest: { temperature: 9.2, humidity: 88, battery_percent: 45, timestamp: new Date().toISOString() },
    status: 'alert',
    alert: 'Temperature too high! Max: 7°C, Current: 9.2°C',
  },
  {
    device_id: 'COLD-003', crop: 'tomato', location: 'Market Yard',
    latest: { temperature: 10.5, humidity: 91, battery_percent: 91, timestamp: new Date().toISOString() },
    status: 'normal',
  },
];

const MOCK_HISTORY = {
  readings: [
    { temperature: 2.3, humidity: 67, timestamp: '2025-01-20T06:00:00' },
    { temperature: 2.5, humidity: 68, timestamp: '2025-01-20T12:00:00' },
    { temperature: 2.8, humidity: 66, timestamp: '2025-01-20T18:00:00' },
    { temperature: 2.1, humidity: 69, timestamp: '2025-01-21T06:00:00' },
    { temperature: 2.6, humidity: 68, timestamp: '2025-01-21T12:00:00' },
  ],
  stats: { avg_temp: 2.46, min_temp: 2.1, max_temp: 2.8, avg_humidity: 67.6, min_humidity: 66, max_humidity: 69 },
};

export default function ColdStorageScreen({ navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [history, setHistory] = useState(null);
  const [tab, setTab] = useState('devices');

  const fetchDevices = useCallback(async () => {
    try {
      const resp = await fetch(`${BASE_URL}/iot/devices/${user?.id || 1}`);
      const data = await resp.json();
      setDevices(data.devices || []);
    } catch (e) {
      setDevices(MOCK_DEVICES);
    } finally { setLoading(false); setRefreshing(false); }
  }, [user]);

  const fetchHistory = async (deviceId) => {
    try {
      const resp = await fetch(`${BASE_URL}/iot/storage-history/${user?.id || 1}/${deviceId}`);
      const data = await resp.json();
      setHistory(data);
    } catch (e) {
      setHistory(MOCK_HISTORY);
    }
  };

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const onRefresh = () => { setRefreshing(true); fetchDevices(); };

  const openDevice = (device) => {
    setSelectedDevice(device);
    fetchHistory(device.device_id);
    setTab('detail');
  };

  const tempColor = (temp, crop) => {
    const th = THRESHOLDS[crop] || THRESHOLDS.onion;
    if (temp < th.temp_min || temp > th.temp_max) return COLORS.error;
    if (temp <= th.temp_min + 1 || temp >= th.temp_max - 1) return '#FF9800';
    return COLORS.success;
  };

  const humidityColor = (hum, crop) => {
    const th = THRESHOLDS[crop] || THRESHOLDS.onion;
    if (hum < th.humidity_min || hum > th.humidity_max) return COLORS.error;
    return COLORS.success;
  };

  const batteryIcon = (pct) => {
    if (pct > 80) return 'battery';
    if (pct > 50) return 'battery-70';
    if (pct > 20) return 'battery-30';
    return 'battery-alert';
  };

  const batteryColor = (pct) => {
    if (pct > 50) return COLORS.success;
    if (pct > 20) return '#FF9800';
    return COLORS.error;
  };

  const timeSince = (ts) => {
    const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#01579B" />
      <View style={[styles.header, { backgroundColor: '#01579B' }]}>
        <TouchableOpacity onPress={() => {
          if (tab === 'detail') { setTab('devices'); setSelectedDevice(null); setHistory(null); }
          else navigation.goBack();
        }} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>
          {tab === 'detail' ? `🌡️ ${selectedDevice?.device_id}` : '❄️ Cold Storage Monitor'}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

          {/* ── DEVICES LIST ── */}
          {tab === 'devices' && (
            <View style={{ padding: SPACING.md }}>
              {/* Summary card */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{devices.length}</Text>
                  <Text style={styles.summaryLabel}>Devices</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: COLORS.success }]}>
                    {devices.filter(d => d.status === 'normal').length}
                  </Text>
                  <Text style={styles.summaryLabel}>Normal</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: COLORS.error }]}>
                    {devices.filter(d => d.status === 'alert').length}
                  </Text>
                  <Text style={styles.summaryLabel}>Alerts</Text>
                </View>
              </View>

              {devices.map(device => {
                const isAlert = device.status === 'alert';
                return (
                  <TouchableOpacity key={device.device_id}
                    style={[styles.deviceCard, isAlert && styles.deviceCardAlert]}
                    onPress={() => openDevice(device)}>
                    <View style={styles.deviceHeader}>
                      <View style={[styles.statusDot, { backgroundColor: isAlert ? COLORS.error : COLORS.success }]} />
                      <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                        <Text style={styles.deviceId}>{device.device_id}</Text>
                        <Text style={styles.deviceLocation}>{device.location} • {THRESHOLDS[device.crop]?.label || device.crop}</Text>
                      </View>
                      <View style={styles.batteryWrap}>
                        <MaterialCommunityIcons name={batteryIcon(device.latest?.battery_percent)}
                          size={18} color={batteryColor(device.latest?.battery_percent)} />
                        <Text style={[styles.batteryText, { color: batteryColor(device.latest?.battery_percent) }]}>
                          {device.latest?.battery_percent}%
                        </Text>
                      </View>
                    </View>

                    <View style={styles.gaugeRow}>
                      {/* Temperature gauge */}
                      <View style={styles.gauge}>
                        <MaterialCommunityIcons name="thermometer"
                          size={28} color={tempColor(device.latest?.temperature, device.crop)} />
                        <Text style={[styles.gaugeValue, { color: tempColor(device.latest?.temperature, device.crop) }]}>
                          {device.latest?.temperature?.toFixed(1)}°C
                        </Text>
                        <Text style={styles.gaugeLabel}>Temperature</Text>
                      </View>
                      {/* Humidity gauge */}
                      <View style={styles.gauge}>
                        <MaterialCommunityIcons name="water-percent"
                          size={28} color={humidityColor(device.latest?.humidity, device.crop)} />
                        <Text style={[styles.gaugeValue, { color: humidityColor(device.latest?.humidity, device.crop) }]}>
                          {device.latest?.humidity}%
                        </Text>
                        <Text style={styles.gaugeLabel}>Humidity</Text>
                      </View>
                    </View>

                    {isAlert && device.alert && (
                      <View style={styles.alertBanner}>
                        <MaterialCommunityIcons name="alert" size={16} color={COLORS.error} />
                        <Text style={styles.alertText}> {device.alert}</Text>
                      </View>
                    )}

                    <Text style={styles.lastSeen}>Last reading: {timeSince(device.latest?.timestamp)}</Text>
                  </TouchableOpacity>
                );
              })}

              {/* Thresholds reference */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>📋 Safe Storage Ranges</Text>
                {Object.entries(THRESHOLDS).map(([crop, th]) => (
                  <View key={crop} style={styles.thresholdRow}>
                    <Text style={styles.thresholdCrop}>{th.label}</Text>
                    <Text style={styles.thresholdVal}>🌡️ {th.temp_min}–{th.temp_max}°C</Text>
                    <Text style={styles.thresholdVal}>💧 {th.humidity_min}–{th.humidity_max}%</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── DEVICE DETAIL ── */}
          {tab === 'detail' && selectedDevice && (
            <View style={{ padding: SPACING.md }}>
              {/* Current readings */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Current Readings</Text>
                <View style={styles.detailGauges}>
                  <View style={styles.bigGauge}>
                    <MaterialCommunityIcons name="thermometer" size={40}
                      color={tempColor(selectedDevice.latest?.temperature, selectedDevice.crop)} />
                    <Text style={[styles.bigGaugeValue, {
                      color: tempColor(selectedDevice.latest?.temperature, selectedDevice.crop)
                    }]}>
                      {selectedDevice.latest?.temperature?.toFixed(1)}°C
                    </Text>
                    <Text style={styles.gaugeLabel}>Temperature</Text>
                    <Text style={styles.safeRange}>
                      Safe: {THRESHOLDS[selectedDevice.crop]?.temp_min}–{THRESHOLDS[selectedDevice.crop]?.temp_max}°C
                    </Text>
                  </View>
                  <View style={styles.bigGauge}>
                    <MaterialCommunityIcons name="water-percent" size={40}
                      color={humidityColor(selectedDevice.latest?.humidity, selectedDevice.crop)} />
                    <Text style={[styles.bigGaugeValue, {
                      color: humidityColor(selectedDevice.latest?.humidity, selectedDevice.crop)
                    }]}>
                      {selectedDevice.latest?.humidity}%
                    </Text>
                    <Text style={styles.gaugeLabel}>Humidity</Text>
                    <Text style={styles.safeRange}>
                      Safe: {THRESHOLDS[selectedDevice.crop]?.humidity_min}–{THRESHOLDS[selectedDevice.crop]?.humidity_max}%
                    </Text>
                  </View>
                </View>
              </View>

              {/* History stats */}
              {history?.stats && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>24h Statistics</Text>
                  <View style={styles.statsGrid}>
                    {[
                      { label: 'Avg Temp', val: `${history.stats.avg_temp?.toFixed(1)}°C`, icon: 'chart-line', color: '#2196F3' },
                      { label: 'Min Temp', val: `${history.stats.min_temp?.toFixed(1)}°C`, icon: 'arrow-down-bold', color: '#00BCD4' },
                      { label: 'Max Temp', val: `${history.stats.max_temp?.toFixed(1)}°C`, icon: 'arrow-up-bold', color: '#FF5722' },
                      { label: 'Avg Humidity', val: `${history.stats.avg_humidity?.toFixed(0)}%`, icon: 'water', color: '#4CAF50' },
                    ].map((s, i) => (
                      <View key={i} style={styles.statBox}>
                        <MaterialCommunityIcons name={s.icon} size={20} color={s.color} />
                        <Text style={styles.statBoxValue}>{s.val}</Text>
                        <Text style={styles.statBoxLabel}>{s.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Reading history */}
              {history?.readings && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Recent Readings</Text>
                  {history.readings.map((r, i) => {
                    const time = new Date(r.timestamp);
                    return (
                      <View key={i} style={styles.readingRow}>
                        <Text style={styles.readingTime}>
                          {time.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        <Text style={[styles.readingVal, { color: tempColor(r.temperature, selectedDevice.crop) }]}>
                          {r.temperature?.toFixed(1)}°C
                        </Text>
                        <Text style={[styles.readingVal, { color: humidityColor(r.humidity, selectedDevice.crop) }]}>
                          {r.humidity}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      )}
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
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, marginBottom: SPACING.md },
  summaryCard: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.md, gap: SPACING.md, ...ELEVATION.level2,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { ...TYPOGRAPHY.headlineMedium, color: COLORS.primary, fontWeight: '700' },
  summaryLabel: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  deviceCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  deviceCardAlert: { borderLeftWidth: 4, borderLeftColor: COLORS.error },
  deviceHeader: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  deviceId: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  deviceLocation: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  batteryWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  batteryText: { ...TYPOGRAPHY.labelSmall },
  gaugeRow: { flexDirection: 'row', marginTop: SPACING.md, gap: SPACING.md },
  gauge: { flex: 1, alignItems: 'center', backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md, padding: SPACING.md },
  gaugeValue: { ...TYPOGRAPHY.titleLarge, fontWeight: '700', marginTop: 4 },
  gaugeLabel: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFEBEE',
    borderRadius: RADIUS.sm, padding: SPACING.sm, marginTop: SPACING.sm,
  },
  alertText: { ...TYPOGRAPHY.bodySmall, color: COLORS.error, flex: 1 },
  lastSeen: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm, textAlign: 'right' },
  thresholdRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs,
    borderBottomWidth: 1, borderBottomColor: COLORS.outlineVariant, gap: SPACING.sm,
  },
  thresholdCrop: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurface, width: 60 },
  thresholdVal: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, flex: 1 },
  detailGauges: { flexDirection: 'row', gap: SPACING.md },
  bigGauge: {
    flex: 1, alignItems: 'center', backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: RADIUS.lg, padding: SPACING.lg,
  },
  bigGaugeValue: { fontSize: 32, fontWeight: '800', marginTop: SPACING.sm },
  safeRange: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statBox: {
    width: '47%', alignItems: 'center', backgroundColor: COLORS.surfaceContainerLow,
    borderRadius: RADIUS.md, padding: SPACING.md,
  },
  statBoxValue: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, fontWeight: '700', marginTop: 4 },
  statBoxLabel: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  readingRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.outlineVariant,
  },
  readingTime: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, flex: 1 },
  readingVal: { ...TYPOGRAPHY.labelLarge, fontWeight: '700', width: 60, textAlign: 'center' },
});
