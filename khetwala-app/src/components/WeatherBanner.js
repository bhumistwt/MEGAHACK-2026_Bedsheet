import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { fetchCurrentWeather, fetchWeatherForecast } from '../services/apiService';

const WEATHER_ICONS = {
  rain:     { name: 'weather-pouring',  color: '#C62828', bg: '#FFEBEE' },
  heat:     { name: 'thermometer-high', color: '#E65100', bg: '#FFF3E0' },
  allclear: { name: 'weather-sunny',    color: '#2E7D32', bg: '#E8F5E9' },
};

export default function WeatherBanner({ district = 'Nashik', onPress }) {
    const { t } = useLanguage();
    const [weather, setWeather] = useState(null);
    const [forecast, setForecast] = useState(null);
    const [alertInfo, setAlertInfo] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Fetch current weather + forecast in parallel
                const [current, fcast] = await Promise.all([
                    fetchCurrentWeather(district),
                    fetchWeatherForecast(district).catch(() => null),
                ]);
                if (cancelled) return;

                const data = {
                    temp: current.temp ?? 0,
                    rain_mm: current.rain_mm ?? 0,
                    humidity: current.humidity ?? 0,
                    windspeed: current.windspeed ?? 0,
                    description: current.description ?? '',
                    source: current.source || 'Open-Meteo',
                };
                setWeather(data);

                // Forecast data
                if (fcast) {
                    setForecast({
                        rain_3d: fcast.rain_in_3days ?? null,
                        rain_7d: fcast.rainfall ?? null,
                        temp_min: fcast.temp_min ?? null,
                        temp_max: fcast.temp_max ?? null,
                        extreme: fcast.extreme_weather ?? false,
                        alerts: fcast.alerts || [],
                        source: fcast.source || 'IMD / Open-Meteo',
                    });
                }

                // Determine alert type
                if (data.rain_mm > 5 || (fcast?.rain_in_3days > 30)) {
                    const msg = fcast?.rain_in_3days > 30
                        ? t('weather.rainAlert') + ` (${Math.round(fcast.rain_in_3days)}mm in 3 days)`
                        : t('weather.rainAlert');
                    setAlertInfo({ ...WEATHER_ICONS.rain, message: msg });
                } else if (data.temp > 38 || fcast?.extreme_weather) {
                    setAlertInfo({ ...WEATHER_ICONS.heat, message: t('weather.heatAlert', { temp: Math.round(data.temp) }) });
                } else {
                    setAlertInfo({ ...WEATHER_ICONS.allclear, message: t('weather.allClear') });
                }
            } catch {
                if (!cancelled) {
                    setAlertInfo({ ...WEATHER_ICONS.allclear, message: t('weather.allClear') });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [district]);

    if (!weather && !alertInfo) return null;

    return (
        <TouchableOpacity style={styles.banner} activeOpacity={0.75} onPress={onPress}>
            {/* Live temperature */}
            {weather && (
                <View style={styles.tempSection}>
                    <Text style={styles.tempValue}>{Math.round(weather.temp)}°</Text>
                    <Text style={styles.tempDesc} numberOfLines={1}>{weather.description || district}</Text>
                </View>
            )}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Stats + Alert */}
            <View style={styles.rightSection}>
                {/* Weather stats row */}
                {weather && (
                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <MaterialCommunityIcons name="water-percent" size={14} color={COLORS.info} />
                            <Text style={styles.statText}>{Math.round(weather.humidity)}%</Text>
                        </View>
                        <View style={styles.statItem}>
                            <MaterialCommunityIcons name="weather-windy" size={14} color={COLORS.secondary} />
                            <Text style={styles.statText}>{Math.round(weather.windspeed)} km/h</Text>
                        </View>
                        {forecast?.rain_3d != null && (
                            <View style={styles.statItem}>
                                <MaterialCommunityIcons name="weather-rainy" size={14} color={COLORS.info} />
                                <Text style={styles.statText}>{Math.round(forecast.rain_3d)}mm/3d</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Alert row */}
                {alertInfo && (
                    <View style={styles.alertSection}>
                        <View style={[styles.alertIconWrap, { backgroundColor: alertInfo.bg }]}>
                            <MaterialCommunityIcons name={alertInfo.name} size={18} color={alertInfo.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.alertText, { color: alertInfo.color }]} numberOfLines={2}>
                                {alertInfo.message}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Source attribution */}
                <View style={styles.sourceRow}>
                    <Text style={styles.sourceText}>
                        {forecast?.source || weather?.source || 'IMD / Open-Meteo'}
                    </Text>
                    <Text style={styles.tapHint}>{t('weather.tapForAlerts')}</Text>
                </View>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        ...ELEVATION.level1,
    },
    tempSection: {
        alignItems: 'center',
        paddingRight: SPACING.md,
        minWidth: 60,
    },
    tempValue: {
        ...TYPOGRAPHY.headlineMedium,
        color: COLORS.primary,
        fontWeight: '800',
    },
    tempDesc: {
        ...TYPOGRAPHY.labelSmall,
        color: COLORS.onSurfaceVariant,
        marginTop: 2,
        textTransform: 'capitalize',
    },
    divider: {
        width: 1,
        height: 56,
        backgroundColor: COLORS.outline,
        marginRight: SPACING.md,
        opacity: 0.3,
    },
    rightSection: {
        flex: 1,
    },
    statsRow: {
        flexDirection: 'row',
        gap: SPACING.md,
        marginBottom: 6,
    },
    statItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    statText: {
        ...TYPOGRAPHY.labelSmall,
        color: COLORS.onSurfaceVariant,
        fontWeight: '600',
    },
    alertSection: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
    },
    alertIconWrap: {
        width: 30,
        height: 30,
        borderRadius: RADIUS.xs,
        justifyContent: 'center',
        alignItems: 'center',
    },
    alertText: {
        ...TYPOGRAPHY.bodySmall,
        fontWeight: '700',
        lineHeight: 16,
    },
    sourceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    sourceText: {
        ...TYPOGRAPHY.labelSmall,
        color: COLORS.outline,
        fontStyle: 'italic',
        fontSize: 10,
    },
    tapHint: {
        ...TYPOGRAPHY.labelSmall,
        color: COLORS.onSurfaceVariant,
        fontSize: 10,
    },
});
