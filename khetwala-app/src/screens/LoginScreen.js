import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme/colors';

const LOGO = require('../../assets/logo.png');

const QUICK_ACCOUNTS = [
  { name: 'Ashwin', phone: '9876543003', password: 'ashwin123456', role: 'Admin' },
  { name: 'Prem', phone: '9876543001', password: 'prem123456' },
  { name: 'Bhumi', phone: '9876543002', password: 'bhumi123456' },
];

export default function LoginScreen({ navigation }) {
  const { login, loginAsGuest } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('Validation', 'Please enter phone and password.');
      return;
    }

    setLoading(true);
    try {
      await login(phone.trim(), password);
    } catch (error) {
      const message = error?.response?.data?.detail || 'Unable to login.';
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  const onGuestLogin = async () => {
    setLoading(true);
    try {
      await loginAsGuest();
    } catch {
      Alert.alert('Guest Login Failed', 'Unable to continue as guest.');
    } finally {
      setLoading(false);
    }
  };

  const onQuickLogin = async (account) => {
    setLoading(true);
    try {
      await login(account.phone, account.password);
    } catch (error) {
      const message = error?.response?.data?.detail || 'Unable to login with demo account.';
      Alert.alert('Quick Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.card}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.subtitle}>Sign in to continue</Text>

          <TextInput
            style={styles.input}
            placeholder="Phone"
            placeholderTextColor={COLORS.onSurfaceVariant}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={COLORS.onSurfaceVariant}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.buttonText}>Login</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={onGuestLogin} disabled={loading}>
            <Text style={styles.secondaryButtonText}>Continue as Guest</Text>
          </TouchableOpacity>

          <Text style={styles.quickTitle}>Quick Demo Login</Text>
          <Text style={styles.quickSubTitle}>Tap any account below to login instantly</Text>
          <View style={styles.quickRow}>
            {QUICK_ACCOUNTS.map((account) => (
              <TouchableOpacity
                key={account.phone}
                style={styles.quickChip}
                onPress={() => onQuickLogin(account)}
                disabled={loading}
              >
                <Text style={styles.quickChipText}>{account.name}</Text>
                {account.role ? <Text style={styles.quickRoleText}>{account.role}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={() => navigation.navigate('Register')}>
            <Text style={styles.link}>No account? Register</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 20,
  },
  logo: {
    width: 180,
    height: 120,
    alignSelf: 'center',
    marginBottom: 4,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 20,
    color: COLORS.onSurfaceVariant,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    color: COLORS.onSurface,
    backgroundColor: COLORS.surface,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: COLORS.onPrimary,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
    backgroundColor: COLORS.surface,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  quickTitle: {
    marginTop: 14,
    marginBottom: 4,
    textAlign: 'center',
    color: COLORS.onSurfaceVariant,
    fontWeight: '600',
  },
  quickSubTitle: {
    marginBottom: 8,
    textAlign: 'center',
    color: COLORS.onSurfaceVariant,
    fontSize: 12,
  },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  quickChipText: {
    color: COLORS.onSurface,
    fontWeight: '600',
  },
  quickRoleText: {
    marginTop: 2,
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  link: {
    marginTop: 16,
    textAlign: 'center',
    color: COLORS.primary,
    fontWeight: '600',
  },
});
