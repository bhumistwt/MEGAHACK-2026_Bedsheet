import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Appbar, Button, Card, Text } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { scanDisease } from '../services/apiService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAMERA_HEIGHT = 280;

const HF_TOKEN = process.env.EXPO_PUBLIC_HF_TOKEN || '';
const HF_URL =
    'https://api-inference.huggingface.co/models/linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification';

const DISEASE_NAME_MAP = {
    'Tomato___Early_blight': 'पत्ती का धब्बा रोग (Early Blight)',
    'Tomato___Late_blight': 'टमाटर का झुलसा रोग (Late Blight)',
    'Tomato___healthy': 'फसल स्वस्थ है ✅',
    'Tomato___Leaf_Mold': 'पत्ती फफूंद (Leaf Mold)',
    'Tomato___Septoria_leaf_spot': 'सेप्टोरिया पत्ती धब्बा',
    'Tomato___Spider_mites Two-spotted_spider_mite': 'मकड़ी के कीट (Spider Mites)',
    'Tomato___Target_Spot': 'लक्ष्य धब्बा रोग (Target Spot)',
    'Tomato___Tomato_Yellow_Leaf_Curl_Virus': 'पीली पत्ती मोड़ वायरस',
    'Tomato___Tomato_mosaic_virus': 'मोज़ेक वायरस',
    'Tomato___Bacterial_spot': 'बैक्टीरियल स्पॉट',
    'Onion___purple_blotch': 'बैंगनी धब्बा रोग (Purple Blotch)',
    'Potato___Late_blight': 'आलू का झुलसा रोग (Late Blight)',
    'Potato___Early_blight': 'आलू पत्ती धब्बा रोग',
    'Potato___healthy': 'फसल स्वस्थ है ✅',
    'Corn_(maize)___healthy': 'फसल स्वस्थ है ✅',
    'Corn_(maize)___Common_rust_': 'मक्का का रतुआ रोग (Rust)',
    'Corn_(maize)___Northern_Leaf_Blight': 'मक्का उत्तरी झुलसा',
    'Rice___Brown_spot': 'भूरा धब्बा रोग (Brown Spot)',
    'Rice___Leaf_blast': 'ब्लास्ट रोग (Leaf Blast)',
    'Rice___healthy': 'फसल स्वस्थ है ✅',
    'Wheat___healthy': 'फसल स्वस्थ है ✅',
    'Wheat___Brown_rust': 'गेहूं का भूरा रतुआ',
};

const RANK_ICONS = [
    { icon: 'numeric-1-circle', color: COLORS.success },
    { icon: 'numeric-2-circle', color: COLORS.info },
    { icon: 'numeric-3-circle', color: COLORS.tertiary },
];

const TREATMENT_MAP = {
    default_disease: [
        { rankIdx: 0, label: 'सबसे सस्ता', treatment: 'नीम के तेल का छिड़काव', cost: 120, unit: 'एकड़' },
        { rankIdx: 1, label: 'सबसे असरदार', treatment: 'Mancozeb + Carbendazim spray', cost: 340, unit: 'एकड़' },
        { rankIdx: 2, label: 'Expert सलाह', treatment: 'Copper Oxychloride + systemic fungicide', cost: 580, unit: 'एकड़' },
    ],
    healthy: [],
};

const isHealthy = (label) =>
    label?.toLowerCase().includes('healthy') || false;

const getDiseaseDisplayName = (label) => {
    if (!label) return 'अज्ञात रोग';
    const cleaned = label.replace(/_+/g, '___').trim();
    for (const [key, value] of Object.entries(DISEASE_NAME_MAP)) {
        if (cleaned.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(cleaned.toLowerCase())) {
            return value;
        }
    }
    return label.replace(/_+/g, ' ').replace(/\s+/g, ' ');
};

const getTreatments = (label) => {
    if (isHealthy(label)) return TREATMENT_MAP.healthy;
    return TREATMENT_MAP.default_disease;
};

export default function DiseaseScreen({ navigation }) {
    const { t: tr } = useLanguage();
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef(null);
    const [capturedImage, setCapturedImage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    useEffect(() => {
        if (!permission?.granted) {
            requestPermission();
        }
    }, [permission]);

    const takePhoto = async () => {
        if (!cameraRef.current) return;
        try {
            const photo = await cameraRef.current.takePictureAsync({
                quality: 0.7,
                base64: false,
            });
            setCapturedImage(photo.uri);
            setResult(null);
        } catch (err) {
            Alert.alert('Error', 'फोटो लेने में समस्या हुई');
        }
    };

    const pickFromGallery = async () => {
        const pickerResult = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsEditing: true,
            aspect: [4, 3],
        });
        if (!pickerResult.canceled && pickerResult.assets?.length > 0) {
            setCapturedImage(pickerResult.assets[0].uri);
            setResult(null);
        }
    };

    const analyseImage = async () => {
        if (!capturedImage) return;
        setLoading(true);
        setResult(null);

        try {
            const base64 = await FileSystem.readAsStringAsync(capturedImage, {
                encoding: FileSystem.EncodingType.Base64,
            });

            // ── Strategy 1: Use backend API (recommended) ──
            const backendResult = await scanDisease(base64);

            if (backendResult?.success) {
                setResult({
                    label: backendResult.disease_label,
                    confidence: backendResult.confidence,
                    success: true,
                    diseaseName: backendResult.disease_name,
                    isHealthy: backendResult.is_healthy,
                    treatments: backendResult.treatments,
                    impact: backendResult.impact,
                });
                return;
            }

            // ── Strategy 2: Direct HuggingFace call (fallback) ──
            if (HF_TOKEN) {
                const response = await fetch(HF_URL, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${HF_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ inputs: base64 }),
                });

                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const topPrediction = Array.isArray(data[0]) ? data[0][0] : data[0];
                        setResult({
                            label: topPrediction.label,
                            confidence: topPrediction.score,
                            success: true,
                        });
                        return;
                    }
                }
            }

            // ── Both strategies failed ──
            setResult({
                label: null,
                confidence: 0,
                success: false,
                errorMessage: backendResult?.message || 'Unable to analyze image. Please check your internet connection.',
            });
        } catch (err) {
            if (__DEV__) console.warn('Disease analysis error:', err);
            setResult({
                label: null,
                confidence: 0,
                success: false,
                errorMessage: 'Analysis failed. Please try again.',
            });
        } finally {
            setLoading(false);
        }
    };

    const retake = () => {
        setCapturedImage(null);
        setResult(null);
    };

    const healthy = result?.success && (result.isHealthy || isHealthy(result.label));
    const diseaseName = result?.success ? (result.diseaseName || getDiseaseDisplayName(result.label)) : null;
    const treatments = result?.success
        ? (result.treatments || getTreatments(result.label))
        : [];
    const confidencePercent = result?.confidence ? Math.round(result.confidence * 100) : 0;

    return (
        <View style={styles.screen}>
            <Appbar.Header style={styles.header}>
                <Appbar.BackAction onPress={() => navigation.goBack()} />
                <Appbar.Content title={tr('disease.header')} titleStyle={styles.headerTitle} />
            </Appbar.Header>

            <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Title */}
                <View style={styles.titleBlock}>
                    <Text style={styles.pageTitle}>{tr('disease.title')}</Text>
                    <Text style={styles.pageSubtitle}>{tr('disease.subtitle')}</Text>
                </View>

                {/* Camera / Preview */}
                <View style={styles.cameraContainer}>
                    {capturedImage ? (
                        <Image source={{ uri: capturedImage }} style={styles.previewImage} />
                    ) : permission?.granted ? (
                        <CameraView
                            ref={cameraRef}
                            style={styles.camera}
                            facing="back"
                        >
                            {/* Viewfinder brackets */}
                            <View style={styles.viewfinder}>
                                <View style={[styles.corner, styles.cornerTL]} />
                                <View style={[styles.corner, styles.cornerTR]} />
                                <View style={[styles.corner, styles.cornerBL]} />
                                <View style={[styles.corner, styles.cornerBR]} />
                            </View>
                        </CameraView>
                    ) : (
                        <View style={styles.noCamera}>
                            <Text style={styles.noCameraText}>
                                {tr('disease.cameraPermission')}
                            </Text>
                            <Button mode="contained" onPress={requestPermission} buttonColor={COLORS.primary}>
                                {tr('disease.givePermission')}
                            </Button>
                        </View>
                    )}
                </View>

                {/* Capture buttons */}
                {!capturedImage ? (
                    <View style={styles.buttonRow}>
                        <TouchableOpacity style={styles.captureButton} onPress={takePhoto} activeOpacity={0.8}>
                            <Text style={styles.captureButtonText}>{tr('disease.takePhoto')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.galleryButton} onPress={pickFromGallery} activeOpacity={0.8}>
                            <Text style={styles.galleryButtonText}>{tr('disease.gallery')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : !result && !loading ? (
                    <View style={styles.buttonRow}>
                        <TouchableOpacity style={styles.analyseButton} onPress={analyseImage} activeOpacity={0.8}>
                            <Text style={styles.analyseButtonText}>{tr('disease.analyze')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.retakeButton} onPress={retake} activeOpacity={0.8}>
                            <Text style={styles.retakeButtonText}>{tr('disease.retake')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : null}

                {/* Loading state */}
                {loading ? (
                    <Card style={styles.card}>
                        <Card.Content style={styles.loaderContent}>
                            <ActivityIndicator size="large" color={COLORS.primary} />
                            <Text style={styles.loaderText}>{tr('disease.loading')}</Text>
                        </Card.Content>
                    </Card>
                ) : null}

                {/* Result - Success */}
                {result?.success ? (
                    <>
                        <Card style={styles.card}>
                            <Card.Content style={styles.resultContent}>
                                <Text
                                    style={[
                                        styles.diseaseName,
                                        { color: healthy ? '#2E7D32' : '#C62828' },
                                    ]}
                                >
                                    {diseaseName}
                                </Text>

                                <View style={styles.confidenceRow}>
                                    <View style={[styles.confidenceBar, { width: `${confidencePercent}%` }]} />
                                </View>
                                <Text style={styles.confidenceText}>
                                    {tr('disease.confidence', { percent: confidencePercent })}
                                </Text>

                                {!healthy ? (
                                    <View style={styles.impactBox}>
                                        <Text style={styles.impactText}>
                                            {result.impact || tr('disease.impact')}
                                        </Text>
                                    </View>
                                ) : null}
                            </Card.Content>
                        </Card>

                        {/* Treatment options */}
                        {treatments.length > 0 ? (
                            <Card style={styles.card}>
                                <Card.Content style={styles.treatmentContent}>
                                    <Text style={styles.sectionTitle}>{tr('disease.treatmentTitle')}</Text>
                                    {treatments.map((t, idx) => (
                                        <View key={idx} style={styles.treatmentRow}>
                                            <View style={styles.treatmentRankWrap}>
                                                <MaterialCommunityIcons
                                                    name={RANK_ICONS[t.rankIdx || idx]?.icon || 'circle'}
                                                    size={28}
                                                    color={RANK_ICONS[t.rankIdx || idx]?.color || COLORS.outline}
                                                />
                                            </View>
                                            <View style={styles.treatmentInfo}>
                                                <Text style={styles.treatmentLabel}>{t.label}</Text>
                                                <Text style={styles.treatmentName}>{t.treatment}</Text>
                                                <Text style={styles.treatmentCost}>₹{t.cost}/{t.unit}</Text>
                                            </View>
                                        </View>
                                    ))}
                                </Card.Content>
                            </Card>
                        ) : null}

                        <Button
                            mode="contained"
                            style={styles.updatePlanButton}
                            buttonColor={COLORS.primary}
                            contentStyle={styles.updatePlanContent}
                            onPress={() => navigation.navigate('Recommendation')}
                        >
                            {tr('disease.updatePlan')}
                        </Button>

                        <Button
                            mode="outlined"
                            style={styles.retakeFull}
                            onPress={retake}
                        >
                            {tr('disease.scanAnother')}
                        </Button>
                    </>
                ) : null}

                {/* Result - Failure */}
                {result && !result.success ? (
                    <Card style={styles.card}>
                        <Card.Content style={styles.failContent}>
                            <View style={styles.failIconWrap}>
                                <MaterialCommunityIcons name="alert-circle-outline" size={40} color={COLORS.warning} />
                            </View>
                            <Text style={styles.failTitle}>
                                {result.errorMessage || tr('disease.photoSaved')}
                            </Text>
                            <Text style={styles.failSubtitle}>
                                {tr('disease.checkInternet')}
                            </Text>
                            <Button mode="contained" onPress={analyseImage} buttonColor={COLORS.primary}
                                style={{ marginBottom: 8 }}>
                                {tr('disease.retryAnalysis') || 'Retry Analysis'}
                            </Button>
                            <Button mode="outlined" onPress={retake}>
                                {tr('disease.retake')}
                            </Button>
                        </Card.Content>
                    </Card>
                ) : null}
            </ScrollView>
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
    scrollArea: { flex: 1 },
    scrollContent: {
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.md,
        paddingBottom: SPACING.xxl,
        rowGap: SPACING.sm,
    },
    titleBlock: { marginBottom: SPACING.xs },
    pageTitle: {
        ...TYPOGRAPHY.headlineSmall,
        fontWeight: '800',
        color: COLORS.onSurface,
        marginBottom: SPACING.xs,
    },
    pageSubtitle: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant },

    cameraContainer: {
        width: '100%',
        height: CAMERA_HEIGHT,
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        backgroundColor: '#000',
    },
    camera: { flex: 1 },
    previewImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    viewfinder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    corner: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderColor: COLORS.accent,
        borderWidth: 3,
    },
    cornerTL: { top: 30, left: 30, borderRightWidth: 0, borderBottomWidth: 0 },
    cornerTR: { top: 30, right: 30, borderLeftWidth: 0, borderBottomWidth: 0 },
    cornerBL: { bottom: 30, left: 30, borderRightWidth: 0, borderTopWidth: 0 },
    cornerBR: { bottom: 30, right: 30, borderLeftWidth: 0, borderTopWidth: 0 },
    noCamera: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.lg,
        backgroundColor: '#1A1A1A',
    },
    noCameraText: {
        ...TYPOGRAPHY.bodyMedium,
        color: '#ccc',
        textAlign: 'center',
        marginBottom: SPACING.md,
    },

    buttonRow: {
        flexDirection: 'row',
        columnGap: SPACING.sm,
    },
    captureButton: {
        flex: 1,
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.md,
        alignItems: 'center',
    },
    captureButtonText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary, fontWeight: '700' },
    galleryButton: {
        flex: 1,
        backgroundColor: COLORS.surface,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.md,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: COLORS.primary,
    },
    galleryButtonText: { ...TYPOGRAPHY.labelLarge, color: COLORS.primary, fontWeight: '700' },
    analyseButton: {
        flex: 2,
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.md,
        alignItems: 'center',
    },
    analyseButtonText: { ...TYPOGRAPHY.titleMedium, color: COLORS.onPrimary, fontWeight: '800' },
    retakeButton: {
        flex: 1,
        backgroundColor: COLORS.surfaceVariant,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.md,
        alignItems: 'center',
    },
    retakeButtonText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant, fontWeight: '600' },

    card: {
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        backgroundColor: COLORS.surface,
        ...ELEVATION.level1,
    },
    loaderContent: {
        alignItems: 'center',
        paddingVertical: SPACING.xl,
    },
    loaderText: { ...TYPOGRAPHY.bodyMedium, marginTop: SPACING.sm, color: COLORS.onSurfaceVariant },

    resultContent: { paddingVertical: SPACING.md, rowGap: SPACING.sm },
    diseaseName: { ...TYPOGRAPHY.titleLarge, fontWeight: '800', lineHeight: 30 },
    confidenceRow: {
        height: 8,
        backgroundColor: COLORS.surfaceContainerHigh,
        borderRadius: RADIUS.xs,
        overflow: 'hidden',
    },
    confidenceBar: {
        height: '100%',
        backgroundColor: COLORS.accent,
        borderRadius: RADIUS.xs,
    },
    confidenceText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant, fontWeight: '600' },
    impactBox: {
        backgroundColor: COLORS.warningContainer,
        borderRadius: RADIUS.md,
        padding: SPACING.sm,
        borderWidth: 1,
        borderColor: COLORS.warning + '40',
    },
    impactText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.warning, fontWeight: '600', lineHeight: 22 },

    treatmentContent: { paddingVertical: SPACING.sm, rowGap: SPACING.sm },
    sectionTitle: { ...TYPOGRAPHY.titleMedium, fontWeight: '700', color: COLORS.onSurface },
    treatmentRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        columnGap: SPACING.sm,
        backgroundColor: COLORS.surfaceContainerLow,
        borderRadius: RADIUS.md,
        padding: SPACING.sm,
        borderWidth: 1,
        borderColor: COLORS.outlineVariant,
    },
    treatmentRankWrap: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    treatmentInfo: { flex: 1 },
    treatmentLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, fontWeight: '600', marginBottom: 2 },
    treatmentName: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, fontWeight: '700' },
    treatmentCost: { ...TYPOGRAPHY.labelMedium, color: COLORS.success, fontWeight: '700', marginTop: 2 },

    updatePlanButton: { borderRadius: RADIUS.md, marginTop: SPACING.xs },
    updatePlanContent: { minHeight: 54 },
    retakeFull: { borderRadius: RADIUS.md },

    failContent: { alignItems: 'center', paddingVertical: SPACING.lg, rowGap: SPACING.sm },
    failIconWrap: {
        width: 64,
        height: 64,
        borderRadius: RADIUS.full,
        backgroundColor: COLORS.warningContainer,
        alignItems: 'center',
        justifyContent: 'center',
    },
    failTitle: {
        ...TYPOGRAPHY.titleSmall,
        color: COLORS.onSurface,
        fontWeight: '700',
        textAlign: 'center',
        lineHeight: 24,
    },
    failSubtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, textAlign: 'center' },
});
