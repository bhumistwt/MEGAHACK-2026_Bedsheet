/**
 * Language Switcher Component
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Compact pill-style language toggle that can be placed in any header/toolbar.
 * Shows the three language options with the active one highlighted.
 */

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage, LANGUAGES } from '../context/LanguageContext';

export default function LanguageSwitcher({ style, compact = false }) {
  const { language, setLanguage } = useLanguage();

  const labels = compact
    ? { en: 'EN', hi: 'हिं', mr: 'मर', gu: 'ગુ' }
    : { en: 'EN', hi: 'हिंदी', mr: 'मराठी', gu: 'ગુજરાતી' };

  return (
    <View style={[styles.container, style]}>
      {LANGUAGES.map((lang) => {
        const isActive = language === lang.code;
        return (
          <TouchableOpacity
            key={lang.code}
            onPress={() => setLanguage(lang.code)}
            style={[styles.pill, isActive && styles.pillActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
              {labels[lang.code]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceVariant,
    borderRadius: RADIUS.full,
    padding: 2,
  },
  pill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
  },
  pillActive: {
    backgroundColor: COLORS.primary,
  },
  pillText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  pillTextActive: {
    color: COLORS.onPrimary,
  },
});
