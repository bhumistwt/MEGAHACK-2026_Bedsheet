import React, { useEffect, useMemo, useState } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  Appbar,
  Button,
  HelperText,
  Menu,
  Text,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  CROP_OPTIONS,
  DISTRICT_OPTIONS,
  SOIL_OPTIONS,
  STORAGE_OPTIONS,
} from '../data/farmOptions';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';

const CROP_STAGE_OPTIONS = [
  { icon: 'sprout', label: 'Early Stage', value: 'early-stage' },
  { icon: 'leaf', label: 'Growing Well', value: 'growing' },
  { icon: 'check-circle-outline', label: 'Ready to Harvest', value: 'harvest-ready' },
];

function PickerField({ label, placeholder, value, options, onSelect }) {
  const [menuVisible, setMenuVisible] = useState(false);
  const displayValue = value || placeholder;
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Button mode="outlined" style={styles.pickerButton} labelStyle={[styles.pickerButtonLabel, !value && styles.placeholderText]} contentStyle={styles.pickerButtonContent} onPress={() => setMenuVisible(true)}>
            {displayValue}
          </Button>
        }
      >
        {options.map((option) => (
          <Menu.Item key={option} title={option} onPress={() => { onSelect(option); setMenuVisible(false); }} />
        ))}
      </Menu>
    </View>
  );
}

const formatDateForDisplay = (dateValue) =>
  new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(dateValue));

const matchDistrictName = (geocode) => {
  if (!geocode) return '';
  const candidates = [geocode.district, geocode.subregion, geocode.city, geocode.region, geocode.name]
    .filter(Boolean).map((item) => String(item).trim().toLowerCase());
  for (const candidate of candidates) {
    const match = DISTRICT_OPTIONS.find((district) => {
      const districtLower = district.toLowerCase();
      return candidate.includes(districtLower) || districtLower.includes(candidate);
    });
    if (match) return match;
  }
  return '';
};

export default function CropInputScreen({ navigation }) {
  const { t } = useLanguage();
  const [crop, setCrop] = useState('');
  const [cropStage, setCropStage] = useState('');
  const [district, setDistrict] = useState('');
  const [soilType, setSoilType] = useState('');
  const [sowingDate, setSowingDate] = useState('');
  const [storageType, setStorageType] = useState('');
  const [transitHours, setTransitHours] = useState(12);
  const [submitted, setSubmitted] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [autoDetectedDistrict, setAutoDetectedDistrict] = useState('');
  const [districtManualEdit, setDistrictManualEdit] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  const showDistrictPicker = locationDenied || districtManualEdit || !autoDetectedDistrict;

  const isValid = useMemo(
    () => Boolean(crop && cropStage && district && soilType && sowingDate && storageType),
    [crop, cropStage, district, soilType, sowingDate, storageType]
  );

  useEffect(() => {
    let mounted = true;
    const detectDistrict = async () => {
      setDetectingLocation(true);
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') { if (mounted) { setLocationDenied(true); setDistrictManualEdit(true); } return; }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const places = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        const matchedDistrict = matchDistrictName(places?.[0]);
        if (mounted && matchedDistrict) { setDistrict(matchedDistrict); setAutoDetectedDistrict(matchedDistrict); setDistrictManualEdit(false); setLocationDenied(false); }
      } catch { if (mounted) setDistrictManualEdit(true); }
      finally { if (mounted) setDetectingLocation(false); }
    };
    detectDistrict();
    return () => { mounted = false; };
  }, []);

  const openDatePicker = () => {
    DateTimePickerAndroid.open({
      value: sowingDate ? new Date(sowingDate) : new Date(), mode: 'date',
      onChange: (event, selectedDate) => { if (event.type === 'set' && selectedDate) setSowingDate(selectedDate.toISOString()); },
      maximumDate: new Date(),
    });
  };

  const handleSubmit = () => {
    setSubmitted(true);
    if (!isValid) return;
    navigation.navigate('Recommendation', { formData: { crop, cropStage, district, soilType, sowingDate, storageType, transitHours } });
  };

  return (
    <View style={styles.screen}>
      <Appbar.Header style={styles.header}>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title={t('cropInput.header')} titleStyle={styles.headerTitle} />
      </Appbar.Header>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.formCard}>
          <PickerField label={t('cropInput.selectCrop')} placeholder={t('cropInput.chooseCrop')} value={crop} options={CROP_OPTIONS} onSelect={setCrop} />

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('cropInput.cropCondition')}</Text>
            <View style={styles.stageRow}>
              {CROP_STAGE_OPTIONS.map((item) => {
                const selected = cropStage === item.value;
                return (
                  <TouchableOpacity key={item.value} style={[styles.stageButton, selected && styles.stageButtonActive]} activeOpacity={0.9} onPress={() => setCropStage(item.value)}>
                    <View style={[styles.stageIconWrap, selected && styles.stageIconWrapActive]}>
                      <MaterialCommunityIcons name={item.icon} size={22} color={selected ? COLORS.primary : COLORS.onSurfaceVariant} />
                    </View>
                    <Text style={[styles.stageLabel, selected && styles.stageLabelActive]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {detectingLocation ? <Text style={styles.locationStatus}>{t('cropInput.detecting')}</Text> : null}

          {autoDetectedDistrict && !showDistrictPicker ? (
            <View style={styles.autoDetectedRow}>
              <MaterialCommunityIcons name="map-marker-check-outline" size={18} color={COLORS.primary} />
              <Text style={styles.autoDetectedText}>{autoDetectedDistrict}</Text>
              <Button compact mode="text" onPress={() => setDistrictManualEdit(true)}>{t('cropInput.edit')}</Button>
            </View>
          ) : null}

          {showDistrictPicker ? (
            <PickerField label={t('cropInput.yourDistrict')} placeholder={t('cropInput.chooseDistrict')} value={district} options={DISTRICT_OPTIONS} onSelect={setDistrict} />
          ) : null}

          {locationDenied ? <Text style={styles.permissionHint}>{t('cropInput.locationDenied')}</Text> : null}

          <PickerField label={t('cropInput.soilType')} placeholder={t('cropInput.chooseSoil')} value={soilType} options={SOIL_OPTIONS} onSelect={setSoilType} />

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('cropInput.sowingDate')}</Text>
            <Button mode="outlined" style={styles.pickerButton} labelStyle={[styles.pickerButtonLabel, !sowingDate && styles.placeholderText]} contentStyle={styles.pickerButtonContent} onPress={openDatePicker}>
              {sowingDate ? formatDateForDisplay(sowingDate) : t('cropInput.selectDate')}
            </Button>
          </View>

          <PickerField label={t('cropInput.storageType')} placeholder={t('cropInput.chooseStorage')} value={storageType} options={STORAGE_OPTIONS} onSelect={setStorageType} />

          <View style={styles.sliderBlock}>
            <Text style={styles.fieldLabel}>{t('cropInput.transitTime')}</Text>
            <Text style={styles.transitValue}>{`${transitHours} ${t('common.hours')}`}</Text>
            <Slider minimumValue={1} maximumValue={48} step={1} value={transitHours} onValueChange={(value) => setTransitHours(value)} minimumTrackTintColor={COLORS.primary} maximumTrackTintColor={COLORS.outlineVariant} thumbTintColor={COLORS.primary} />
          </View>

          <HelperText type="error" visible={submitted && !isValid}>{t('cropInput.completeFields')}</HelperText>
        </View>

        <Button mode="contained" style={styles.submitButton} contentStyle={styles.submitButtonContent} buttonColor={COLORS.primary} onPress={handleSubmit}>
          {t('cropInput.getRecommendation')}
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  header: { backgroundColor: COLORS.surface, elevation: 0, borderBottomWidth: 1, borderBottomColor: COLORS.outlineVariant },
  headerTitle: { ...TYPOGRAPHY.titleLarge, fontWeight: '700', color: COLORS.onSurface },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.xl, rowGap: SPACING.md },
  formCard: { borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, padding: SPACING.md, ...ELEVATION.level1 },
  fieldBlock: { marginBottom: SPACING.md },
  fieldLabel: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurface, marginBottom: SPACING.sm },
  pickerButton: { borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md },
  pickerButtonContent: { minHeight: 48, justifyContent: 'center' },
  pickerButtonLabel: { ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface },
  placeholderText: { color: COLORS.onSurfaceVariant },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  stageButton: { width: '31%', minHeight: 92, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.outlineVariant, backgroundColor: COLORS.surfaceVariant, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, alignItems: 'center', justifyContent: 'center', rowGap: SPACING.xs },
  stageButtonActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryContainer },
  stageIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center' },
  stageIconWrapActive: { backgroundColor: COLORS.primary + '18' },
  stageLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, textAlign: 'center', fontWeight: '600' },
  stageLabelActive: { color: COLORS.primary },
  locationStatus: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginBottom: SPACING.sm },
  autoDetectedRow: { marginBottom: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.primaryContainer, borderWidth: 1, borderColor: COLORS.primary + '30', borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm },
  autoDetectedText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.primary, fontWeight: '600', flex: 1 },
  permissionHint: { ...TYPOGRAPHY.bodySmall, color: COLORS.warning, marginTop: -SPACING.xs, marginBottom: SPACING.sm },
  sliderBlock: { marginTop: SPACING.xs, marginBottom: SPACING.xs },
  transitValue: { ...TYPOGRAPHY.bodyLarge, color: COLORS.primary, fontWeight: '700', marginBottom: SPACING.xs },
  submitButton: { borderRadius: RADIUS.lg },
  submitButtonContent: { minHeight: 56 },
});
