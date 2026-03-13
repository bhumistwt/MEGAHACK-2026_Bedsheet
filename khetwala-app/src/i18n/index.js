/**
 * i18n Index — Translation Lookup Utility
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides `translate(key, params, lang)` for resolving dot-path keys
 * like "home.greeting" with optional interpolation: {{name}}, {{n}}, etc.
 */

import en from './en';
import hi from './hi';
import mr from './mr';
import gu from './gu';

export const LANGUAGES = [
  { code: 'en', label: 'English',  nativeLabel: 'English'  },
  { code: 'hi', label: 'Hindi',    nativeLabel: 'हिंदी'    },
  { code: 'mr', label: 'Marathi',  nativeLabel: 'मराठी'    },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
];

const dictionaries = { en, hi, mr, gu };

/**
 * Resolve a dot-path key from a nested dictionary.
 * e.g. resolve(en, 'home.greeting') → 'Hello 👋'
 */
function resolve(dict, path) {
  const parts = path.split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Replace `{{key}}` placeholders in a string with values from params.
 */
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{{${k}}}`
  );
}

/**
 * Main translation function.
 *
 * @param {string} key     Dot-path key, e.g. 'home.greeting'
 * @param {object} params  Interpolation params, e.g. { name: 'Ashwin' }
 * @param {string} lang    Language code: 'en' | 'hi' | 'mr'
 * @returns {string}       Translated + interpolated string (falls back to English, then key)
 */
export function translate(key, params = {}, lang = 'en') {
  const dict = dictionaries[lang] || dictionaries.en;
  let result = resolve(dict, key);

  // Fallback to English if not found in selected language
  if (result === undefined && lang !== 'en') {
    result = resolve(dictionaries.en, key);
  }

  // Fallback to the key itself if still missing
  if (result === undefined) return key;

  return interpolate(result, params);
}

export default translate;
