/**
 * Language Context — Global Language Provider
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides:
 * - `language` — current lang code ('en' | 'hi' | 'mr' | 'gu' | 'kn')
 * - `setLanguage(code)` — switch language (persists to AsyncStorage)
 * - `t(key, params)` — shortcut for translate(key, params, language)
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translate, LANGUAGES } from '../i18n';

const STORAGE_KEY = '@khetwala_language';
const DEFAULT_LANG = 'hi';
const VALID_LANGUAGES = ['en', 'hi', 'mr', 'gu', 'kn'];

const LanguageContext = createContext(null);

export { LANGUAGES };

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be inside <LanguageProvider>');
  return ctx;
}

export function LanguageProvider({ children }) {
  const [language, setLangState] = useState(DEFAULT_LANG);
  const [ready, setReady] = useState(false);

  // Load saved language on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved && VALID_LANGUAGES.includes(saved)) {
          setLangState(saved);
        }
      } catch {
        // ignore
      }
      setReady(true);
    })();
  }, []);

  const setLanguage = useCallback(async (code) => {
    if (!VALID_LANGUAGES.includes(code)) return;
    setLangState(code);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, code);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key, params) => translate(key, params, language),
    [language]
  );

  const value = { language, setLanguage, t, ready, LANGUAGES };

  // Don't render until we've loaded the saved language
  if (!ready) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
