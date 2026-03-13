import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme/colors';

export default function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Khetwala</Text>
        <Text style={styles.subtitle}>Welcome, {user?.full_name || 'Farmer'}</Text>
        <Text style={styles.meta}>District: {user?.district || 'Not set'}</Text>

        <TouchableOpacity style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: COLORS.primary,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 18,
    color: COLORS.onSurface,
  },
  meta: {
    marginTop: 6,
    color: COLORS.onSurfaceVariant,
  },
  button: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: {
    color: COLORS.onPrimary,
    fontWeight: '600',
  },
});
