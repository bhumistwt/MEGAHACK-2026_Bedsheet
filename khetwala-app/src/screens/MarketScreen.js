import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { DISTRICTS, getAllPricesForDistrict, getNearbyMandiPrices } from '../data/marketData';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';

const POSITIVE = '#2E7D32';

function PriceCard({ item }) {
  const isUp = item.change == null ? true : item.change >= 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.cropEmoji}>{item.emoji}</Text>
        <View>
          <Text style={styles.cropName}>{item.crop}</Text>
          <Text style={styles.mandiName}>{item.mandi}</Text>
        </View>
      </View>

      <View style={styles.cardRight}>
        <Text style={styles.priceValue}>₹{item.price}</Text>
        {item.change == null ? (
          <Text style={styles.noChangeText}>Change unavailable</Text>
        ) : (
          <View style={[styles.changePill, { backgroundColor: (isUp ? POSITIVE : COLORS.error) + '18' }]}>
            <MaterialCommunityIcons
              name={isUp ? 'trending-up' : 'trending-down'}
              size={14}
              color={isUp ? POSITIVE : COLORS.error}
            />
            <Text style={[styles.changeText, { color: isUp ? POSITIVE : COLORS.error }]}>
              {isUp ? '+' : ''}
              {item.change}%
            </Text>
          </View>
        )}
        {item.distance_km != null ? <Text style={styles.distanceText}>{item.distance_km} km away</Text> : null}
      </View>
    </View>
  );
}

export default function MarketScreen({ navigation }) {
  const [selectedDistrict, setSelectedDistrict] = useState('Nashik');
  const [selectedState, setSelectedState] = useState('Maharashtra');
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [locationEnabled, setLocationEnabled] = useState(false);

  const loadByDistrict = useCallback(async (district, state) => {
    setLoading(true);
    setErrorText('');
    try {
      const nextPrices = await getAllPricesForDistrict(district, state);
      setPrices(nextPrices);
    } catch {
      setPrices([]);
      setErrorText('Could not fetch live mandi prices for this district.');
    } finally {
      setLoading(false);
    }
  }, []);

  const tryLocationLoad = useCallback(async () => {
    setLoading(true);
    setErrorText('');

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationEnabled(false);
        await loadByDistrict(selectedDistrict, selectedState);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const geocoded = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      const place = geocoded?.[0] || {};
      const detectedDistrict = place.subregion || place.city || place.region || selectedDistrict;
      const detectedState = place.region || selectedState;

      setSelectedDistrict(detectedDistrict);
      setSelectedState(detectedState);
      setLocationEnabled(true);

      const nextPrices = await getNearbyMandiPrices({
        district: detectedDistrict,
        state: detectedState,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      setPrices(nextPrices);
    } catch {
      setLocationEnabled(false);
      await loadByDistrict(selectedDistrict, selectedState);
    } finally {
      setLoading(false);
    }
  }, [loadByDistrict, selectedDistrict, selectedState]);

  useEffect(() => {
    tryLocationLoad();
  }, [tryLocationLoad]);

  const subtitle = useMemo(() => {
    if (locationEnabled) {
      return `Nearby mandi prices around ${selectedDistrict}`;
    }
    return 'Live mandi prices by selected district';
  }, [locationEnabled, selectedDistrict]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.onSurface} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Market Prices</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
        >
          {DISTRICTS.map((district) => {
            const active = district === selectedDistrict;
            return (
              <TouchableOpacity
                key={district}
                style={[styles.chip, active && styles.chipActive]}
                onPress={async () => {
                  setLocationEnabled(false);
                  setSelectedDistrict(district);
                  await loadByDistrict(district, selectedState);
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{district}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.listWrap}>
          {loading ? (
            <View style={styles.loaderWrap}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loaderText}>Fetching live mandi prices...</Text>
            </View>
          ) : errorText ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : prices.length === 0 ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>No mandi prices available for this area right now.</Text>
            </View>
          ) : (
            prices.map((item, index) => <PriceCard key={`${item.crop}-${item.mandi}-${index}`} item={item} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  backBtn: {
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
  bodyContent: { paddingBottom: SPACING.lg },
  chipsContainer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.outline,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurface, fontWeight: '600' },
  chipTextActive: { color: COLORS.onPrimary },

  listWrap: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...ELEVATION.level1,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  cropEmoji: { fontSize: 24 },
  cropName: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, fontWeight: '700' },
  mandiName: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },

  cardRight: { alignItems: 'flex-end' },
  priceValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, fontWeight: '700' },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  changeText: { ...TYPOGRAPHY.bodySmall, fontWeight: '700' },
  noChangeText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 6 },
  distanceText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 4 },
  loaderWrap: { alignItems: 'center', paddingVertical: SPACING.xl },
  loaderText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm },
  errorWrap: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    ...ELEVATION.level1,
  },
  errorText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.error },
});
