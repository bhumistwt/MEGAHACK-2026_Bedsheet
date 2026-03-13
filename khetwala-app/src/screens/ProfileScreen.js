import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';

const ProfileField = ({ icon, label, value }) => (
  <View style={styles.fieldRow}>
    <View style={styles.fieldIconWrap}>
      <MaterialCommunityIcons name={icon} size={18} color={COLORS.primary} />
    </View>
    <View style={styles.fieldBody}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || '—'}</Text>
    </View>
  </View>
);

export default function ProfileScreen({ navigation }) {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.onPrimary} />
        </TouchableOpacity>
        <View style={styles.avatarCircle}>
          <MaterialCommunityIcons name="account-outline" size={36} color={COLORS.onPrimary} />
        </View>
        <Text style={styles.headerName}>{user?.full_name || 'Farmer'}</Text>
        <Text style={styles.headerPhone}>{user?.phone}</Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal Information</Text>
          <ProfileField icon="account-outline" label="Full Name" value={user?.full_name} />
          <ProfileField icon="phone-outline" label="Phone" value={user?.phone} />
          <ProfileField icon="email-outline" label="Email" value={user?.email} />
          <ProfileField icon="map-marker-outline" label="District" value={user?.district} />
          <ProfileField icon="map-outline" label="State" value={user?.state} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Farm Details</Text>
          <ProfileField icon="sprout-outline" label="Main Crop" value={user?.main_crop} />
          <ProfileField
            icon="ruler-square"
            label="Farm Size"
            value={user?.farm_size_acres ? `${user.farm_size_acres} acres` : null}
          />
          <ProfileField icon="terrain" label="Soil Type" value={user?.soil_type} />
        </View>

        <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={22} color={COLORS.error} />
          <Text style={[styles.menuText, { color: COLORS.error }]}>Log out</Text>
        </TouchableOpacity>

        <View style={{ height: SPACING.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 48,
    paddingBottom: SPACING.lg,
    alignItems: 'center',
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
  },
  backBtn: {
    position: 'absolute',
    top: 48,
    left: SPACING.md,
    padding: SPACING.xs,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerName: { ...TYPOGRAPHY.titleLarge, color: COLORS.onPrimary, fontWeight: '800' },
  headerPhone: { ...TYPOGRAPHY.bodyMedium, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...ELEVATION.level1,
  },
  cardTitle: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, fontWeight: '700', marginBottom: SPACING.sm },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.outlineVariant,
  },
  fieldIconWrap: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primaryContainer,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  fieldBody: { flex: 1 },
  fieldLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginBottom: 1 },
  fieldValue: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...ELEVATION.level1,
  },
  menuText: { flex: 1, ...TYPOGRAPHY.bodyLarge, fontWeight: '600', marginLeft: SPACING.sm },
  logoutItem: { borderWidth: 1, borderColor: COLORS.error + '30' },
});
