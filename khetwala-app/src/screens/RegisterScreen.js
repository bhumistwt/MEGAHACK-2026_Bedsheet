import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    password: '',
    district: '',
    state: 'Maharashtra',
  });
  const [loading, setLoading] = useState(false);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async () => {
    if (!form.full_name.trim() || !form.phone.trim() || !form.password.trim()) {
      Alert.alert('Validation', 'Name, phone and password are required.');
      return;
    }

    setLoading(true);
    try {
      await register({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        district: form.district.trim() || null,
        state: form.state,
      });
    } catch (error) {
      const message = error?.response?.data?.detail || 'Unable to register.';
      Alert.alert('Registration Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Create Account</Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={COLORS.onSurfaceVariant}
            value={form.full_name}
            onChangeText={(value) => setField('full_name', value)}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone"
            placeholderTextColor={COLORS.onSurfaceVariant}
            keyboardType="phone-pad"
            value={form.phone}
            onChangeText={(value) => setField('phone', value)}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={COLORS.onSurfaceVariant}
            secureTextEntry
            value={form.password}
            onChangeText={(value) => setField('password', value)}
          />
          <TextInput
            style={styles.input}
            placeholder="District (optional)"
            placeholderTextColor={COLORS.onSurfaceVariant}
            value={form.district}
            onChangeText={(value) => setField('district', value)}
          />

          <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.buttonText}>Register</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.link}>Already have an account? Login</Text>
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.onSurface,
    textAlign: 'center',
    marginBottom: 16,
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
  link: {
    marginTop: 16,
    textAlign: 'center',
    color: COLORS.primary,
    fontWeight: '600',
  },
});
