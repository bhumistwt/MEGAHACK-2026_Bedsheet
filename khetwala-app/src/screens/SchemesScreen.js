import React, { useEffect, useState } from 'react';
import {
    FlatList,
    Linking,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, Text } from 'react-native-paper';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { CROP_OPTIONS } from '../data/farmOptions';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY || '';

const TYPE_COLORS = {
    subsidy: { bg: COLORS.successContainer, text: COLORS.success, label: 'सब्सिडी', icon: 'cash-multiple' },
    insurance: { bg: COLORS.infoContainer, text: COLORS.info, label: 'बीमा', icon: 'shield-check-outline' },
    loan: { bg: COLORS.warningContainer, text: COLORS.warning, label: 'लोन', icon: 'bank-outline' },
    msp: { bg: '#F3E5F5', text: COLORS.chain, label: 'MSP', icon: 'scale-balance' },
};

const STATE_FROM_COORDS = (lat, lon) => {
    if (lat >= 15.5 && lat <= 22.0 && lon >= 72.5 && lon <= 80.5) return 'Maharashtra';
    if (lat >= 20.0 && lat <= 24.5 && lon >= 74.0 && lon <= 84.5) return 'Madhya Pradesh';
    if (lat >= 25.0 && lat <= 30.5 && lon >= 77.0 && lon <= 84.5) return 'Uttar Pradesh';
    if (lat >= 28.0 && lat <= 33.0 && lon >= 73.5 && lon <= 77.5) return 'Haryana';
    if (lat >= 29.5 && lat <= 33.5 && lon >= 74.0 && lon <= 80.0) return 'Punjab';
    if (lat >= 11.0 && lat <= 18.0 && lon >= 76.0 && lon <= 80.5) return 'Karnataka';
    return 'Maharashtra';
};

const MOCK_SCHEMES = [
    {
        name: 'PM-KISAN सम्मान निधि',
        benefit_amount: '₹6,000 प्रति वर्ष',
        eligibility: 'सभी छोटे और सीमांत किसान जिनके पास 2 हेक्टेयर तक ज़मीन है',
        how_to_apply: 'pmkisan.gov.in पर आधार से रजिस्टर करें',
        deadline: '2025-03-31',
        scheme_type: 'subsidy',
        url: 'https://pmkisan.gov.in',
    },
    {
        name: 'प्रधानमंत्री फसल बीमा योजना (PMFBY)',
        benefit_amount: 'फसल नुकसान का 80% तक coverage',
        eligibility: 'सभी किसान — खरीफ और रबी फसलों के लिए',
        how_to_apply: 'नज़दीकी बैंक या CSC सेंटर पर apply करें',
        deadline: '2025-04-15',
        scheme_type: 'insurance',
        url: 'https://pmfby.gov.in',
    },
    {
        name: 'Kisan Credit Card (KCC)',
        benefit_amount: '₹3 लाख तक 4% ब्याज पर लोन',
        eligibility: 'सभी किसान — PM-KISAN लाभार्थी प्राथमिकता पर',
        how_to_apply: 'अपने बैंक ब्रांच में KCC application form भरें',
        deadline: null,
        scheme_type: 'loan',
        url: 'https://www.nabard.org',
    },
    {
        name: 'MSP — न्यूनतम समर्थन मूल्य',
        benefit_amount: '₹2,275/quintal (गेहूं 2024-25)',
        eligibility: 'सभी किसान जो सरकारी मंडी में बेचते हैं',
        how_to_apply: 'नज़दीकी APMC मंडी में MSP पर बिक्री करें',
        deadline: null,
        scheme_type: 'msp',
        url: 'https://farmer.gov.in',
    },
];

const fetchSchemesFromAI = async (crop, state) => {
    if (!GOOGLE_API_KEY) return null;

    try {
        const prompt = `List 4 real active Indian government schemes for a ${crop} farmer in ${state} in 2024-25. Return ONLY a JSON array:
[{
  "name": "string",
  "benefit_amount": "string (e.g. '₹6,000 per year')",
  "eligibility": "string (one line, simple Hindi or English)",
  "how_to_apply": "string (one line)",
  "deadline": "string | null",
  "scheme_type": "subsidy | insurance | loan | msp"
}]
Use only real, active schemes. No markdown, just JSON.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
                }),
            }
        );

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch {
        return null;
    }
};

export default function SchemesScreen({ navigation }) {
    const { t } = useLanguage();
    const [state, setState] = useState('Maharashtra');
    const [selectedCrop, setSelectedCrop] = useState('Onion');
    const [schemes, setSchemes] = useState(MOCK_SCHEMES);
    const [loading, setLoading] = useState(false);
    const [fromAI, setFromAI] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
                    const detectedState = STATE_FROM_COORDS(loc.coords.latitude, loc.coords.longitude);
                    setState(detectedState);
                }
            } catch { /* use default */ }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            setLoading(true);
            const aiSchemes = await fetchSchemesFromAI(selectedCrop, state);
            if (aiSchemes && aiSchemes.length > 0) {
                setSchemes(aiSchemes);
                setFromAI(true);
            } else {
                setSchemes(MOCK_SCHEMES);
                setFromAI(false);
            }
            setLoading(false);
        })();
    }, [selectedCrop, state]);

    const getDaysRemaining = (deadline) => {
        if (!deadline) return null;
        const diff = Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : null;
    };

    const renderScheme = ({ item, index }) => {
        const typeConfig = TYPE_COLORS[item.scheme_type] || TYPE_COLORS.subsidy;
        const daysLeft = getDaysRemaining(item.deadline);

        return (
            <Card style={styles.schemeCard}>
                <Card.Content style={styles.schemeContent}>
                    <View style={styles.schemeTopRow}>
                        <Text style={styles.schemeName}>{item.name}</Text>
                        <View style={[styles.typeBadge, { backgroundColor: typeConfig.bg }]}>
                            <MaterialCommunityIcons name={typeConfig.icon} size={14} color={typeConfig.text} />
                            <Text style={[styles.typeBadgeText, { color: typeConfig.text }]}>
                                {typeConfig.label}
                            </Text>
                        </View>
                    </View>

                    <Text style={styles.benefitAmount}>{item.benefit_amount}</Text>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('schemes.eligibility')}</Text>
                        <Text style={styles.detailValue}>{item.eligibility}</Text>
                    </View>

                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{t('schemes.howToApply')}</Text>
                        <Text style={styles.detailValue}>{item.how_to_apply}</Text>
                    </View>

                    {daysLeft !== null && daysLeft <= 30 ? (
                        <View style={styles.deadlineBox}>
                            <Text style={styles.deadlineText}>
                            {t('schemes.deadline', { n: daysLeft })}
                            </Text>
                        </View>
                    ) : null}

                    <Button
                        mode="contained"
                        style={styles.applyButton}
                        buttonColor={typeConfig.text}
                        onPress={() => {
                            const url = item.url || `https://www.google.com/search?q=${encodeURIComponent(item.name + ' apply online')}`;
                            Linking.openURL(url);
                        }}
                    >
                        {t('schemes.applyNow')}
                    </Button>
                </Card.Content>
            </Card>
        );
    };

    return (
        <View style={styles.screen}>
            <Appbar.Header style={styles.header}>
                <Appbar.BackAction onPress={() => navigation.goBack()} />
                <Appbar.Content
                    title={t('schemes.header')}
                    titleStyle={styles.headerTitle}
                />
            </Appbar.Header>

            <View style={styles.stateRow}>
                <View style={styles.stateRowLeft}>
                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.stateLabel}>{state}</Text>
                </View>
                {fromAI ? (
                    <View style={styles.aiBadge}>
                        <MaterialCommunityIcons name="creation" size={14} color={COLORS.primary} />
                        <Text style={styles.aiLabel}>{t('schemes.aiPowered')}</Text>
                    </View>
                ) : null}
            </View>

            {/* Crop selector */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.cropScroll}
                contentContainerStyle={styles.cropScrollContent}
            >
                {CROP_OPTIONS.map((crop) => (
                    <TouchableOpacity
                        key={crop}
                        style={[
                            styles.cropPill,
                            selectedCrop === crop && styles.cropPillActive,
                        ]}
                        onPress={() => setSelectedCrop(crop)}
                    >
                        <Text
                            style={[
                                styles.cropPillText,
                                selectedCrop === crop && styles.cropPillTextActive,
                            ]}
                        >
                            {crop}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {loading ? (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                    <Text style={styles.loaderText}>{t('schemes.loading')}</Text>
                </View>
            ) : (
                <FlatList
                    data={schemes}
                    keyExtractor={(item, i) => `${item.name}-${i}`}
                    renderItem={renderScheme}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: COLORS.background },
    header: {
        backgroundColor: COLORS.surface,
        elevation: 0,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.outlineVariant,
    },
    headerTitle: { ...TYPOGRAPHY.titleMedium, fontWeight: '700', color: COLORS.onSurface },
    stateRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        backgroundColor: COLORS.surfaceContainerLow,
    },
    stateRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: SPACING.xs,
    },
    stateLabel: { ...TYPOGRAPHY.labelLarge, fontWeight: '600', color: COLORS.onSurface },
    aiBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 4,
        backgroundColor: COLORS.primaryContainer,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 4,
        borderRadius: RADIUS.full,
    },
    aiLabel: { ...TYPOGRAPHY.labelSmall, fontWeight: '700', color: COLORS.primary },

    cropScroll: { flexGrow: 0 },
    cropScrollContent: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        columnGap: SPACING.sm,
    },
    cropPill: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.surfaceVariant,
    },
    cropPillActive: { backgroundColor: COLORS.primary },
    cropPillText: { ...TYPOGRAPHY.labelMedium, fontWeight: '600', color: COLORS.onSurfaceVariant },
    cropPillTextActive: { color: COLORS.onPrimary },

    loader: { alignItems: 'center', paddingTop: 60 },
    loaderText: { ...TYPOGRAPHY.bodyMedium, marginTop: SPACING.sm, color: COLORS.onSurfaceVariant },

    listContent: {
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.sm,
        paddingBottom: SPACING.xl,
        rowGap: SPACING.sm,
    },
    schemeCard: {
        borderRadius: RADIUS.lg,
        backgroundColor: COLORS.surface,
        ...ELEVATION.level1,
    },
    schemeContent: { paddingVertical: SPACING.md, rowGap: SPACING.sm },
    schemeTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        columnGap: SPACING.sm,
    },
    schemeName: {
        flex: 1,
        ...TYPOGRAPHY.titleSmall,
        fontWeight: '800',
        color: COLORS.onSurface,
        lineHeight: 24,
    },
    typeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 4,
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs,
        borderRadius: RADIUS.full,
    },
    typeBadgeText: { ...TYPOGRAPHY.labelSmall, fontWeight: '700' },
    benefitAmount: {
        ...TYPOGRAPHY.titleLarge,
        fontWeight: '800',
        color: COLORS.success,
    },
    detailRow: { flexDirection: 'row', columnGap: 6 },
    detailLabel: { ...TYPOGRAPHY.labelSmall, fontWeight: '700', color: COLORS.onSurfaceVariant },
    detailValue: { flex: 1, ...TYPOGRAPHY.bodySmall, color: COLORS.onSurface, lineHeight: 20 },
    deadlineBox: {
        backgroundColor: COLORS.errorContainer,
        borderRadius: RADIUS.md,
        padding: SPACING.sm,
        borderWidth: 1,
        borderColor: COLORS.error + '40',
    },
    deadlineText: { ...TYPOGRAPHY.labelMedium, fontWeight: '700', color: COLORS.error },
    applyButton: { borderRadius: RADIUS.md, marginTop: SPACING.xs },
});
