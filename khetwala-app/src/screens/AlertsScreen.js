import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';

const ALERT_ICONS = { neighbor: 'account-group-outline', scheme: 'bank-outline', harvest: 'clock-alert-outline', weather: 'weather-lightning-rainy', price: 'chart-line', info: 'information-outline' };

export default function AlertsScreen({ navigation }) {
    const { t } = useLanguage();
    const [alerts, setAlerts] = useState([]);

    const STATIC_ALERTS = [
        { id: 'neighbor', type: 'neighbor', urgency: 4, color: '#E65100', bgColor: COLORS.surface, message: t('alerts.supplyAlert', { crop: 'Onion', district: 'Nashik' }), action: t('alerts.checkOther'), time: t('alerts.hoursAgo', { n: 2 }) },
        { id: 'scheme', type: 'scheme', urgency: 5, color: '#1565C0', bgColor: COLORS.surface, message: t('alerts.schemeAlert'), action: t('alerts.viewSchemes'), time: t('alerts.hoursAgo', { n: 5 }) },
        { id: 'harvest', type: 'harvest', urgency: 6, color: COLORS.success, bgColor: COLORS.surface, message: t('alerts.harvestAlert', { crop: 'Onion' }), action: t('alerts.viewPlan'), time: t('alerts.hoursAgo', { n: 8 }) },
    ];

    const TYPE_LABELS = { weather: t('alerts.typeWeather'), price: t('alerts.typePrice'), neighbor: t('alerts.typeSupply'), scheme: t('alerts.typeScheme'), harvest: t('alerts.typeCrop'), info: t('alerts.typeInfo') };

    useEffect(() => { setAlerts([...STATIC_ALERTS].sort((a, b) => a.urgency - b.urgency)); }, []);

    const renderAlert = ({ item }) => (
        <View style={[styles.alertCard, { borderLeftColor: item.color }]}>
            <View style={styles.alertTopRow}>
                <View style={[styles.alertIconWrap, { backgroundColor: item.color + '14' }]}>
                    <MaterialCommunityIcons name={ALERT_ICONS[item.type] || 'information-outline'} size={20} color={item.color} />
                </View>
                <View style={[styles.alertBadge, { backgroundColor: item.color + '14' }]}>
                    <Text style={[styles.alertBadgeText, { color: item.color }]}>{TYPE_LABELS[item.type] || item.type}</Text>
                </View>
                <Text style={styles.alertTime}>{item.time}</Text>
            </View>
            <Text style={[styles.alertMessage, { color: item.color }]}>{item.message}</Text>
            {item.action ? (
                <TouchableOpacity style={[styles.alertAction, { borderColor: item.color + '40' }]} activeOpacity={0.8}
                    onPress={() => {
                        if (item.type === 'scheme') navigation.navigate('Schemes');
                        else if (item.type === 'price') navigation.navigate('Market');
                        else if (item.type === 'harvest') navigation.navigate('Recommendation');
                    }}>
                    <Text style={[styles.alertActionText, { color: item.color }]}>{item.action}</Text>
                    <MaterialCommunityIcons name="arrow-right" size={16} color={item.color} />
                </TouchableOpacity>
            ) : null}
        </View>
    );

    return (
        <View style={styles.screen}>
            <Appbar.Header style={styles.header}>
                <Appbar.BackAction onPress={() => navigation.goBack()} />
                <Appbar.Content title={t('alerts.header')} titleStyle={styles.headerTitle} />
            </Appbar.Header>
            <FlatList data={alerts} keyExtractor={(item) => item.id} renderItem={renderAlert} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconWrap}><MaterialCommunityIcons name="bell-outline" size={40} color={COLORS.onSurfaceVariant} /></View>
                        <Text style={styles.emptyText}>{t('alerts.noAlerts')}</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: COLORS.background },
    header: { backgroundColor: COLORS.surface, elevation: 0, borderBottomWidth: 1, borderBottomColor: COLORS.outlineVariant },
    headerTitle: { ...TYPOGRAPHY.titleLarge, fontWeight: '700', color: COLORS.onSurface },
    listContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xl, rowGap: SPACING.sm },
    alertCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderLeftWidth: 4, padding: SPACING.md, ...ELEVATION.level1, rowGap: SPACING.sm },
    alertTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    alertIconWrap: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
    alertBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 3, borderRadius: RADIUS.full },
    alertBadgeText: { ...TYPOGRAPHY.labelSmall, fontWeight: '700' },
    alertTime: { marginLeft: 'auto', ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant },
    alertMessage: { ...TYPOGRAPHY.bodyMedium, fontWeight: '700', lineHeight: 23 },
    alertAction: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1.5 },
    alertActionText: { ...TYPOGRAPHY.labelMedium, fontWeight: '700' },
    emptyState: { alignItems: 'center', paddingTop: 60 },
    emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.surfaceVariant, justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.md },
    emptyText: { ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurfaceVariant },
});
