/**
 * ARIA Voice Engine — Wake Word Detection, Transcription & Intent Parsing
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Pure-function service (no React) that handles:
 * 1. Audio recording via expo-av (dynamic import for Expo Go safety)
 * 2. Audio → base64 conversion via expo-file-system
 * 3. Gemini multimodal transcription (audio → text)
 * 4. Wake word detection ("Hi Aria" pattern matching)
 * 5. Intent parsing (local keyword match + Gemini NLU fallback)
 * 6. Text-to-speech via expo-speech
 */

import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { NativeModules } from 'react-native';
import { getBackendBaseUrl } from '../config/backend';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY || '';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const BACKEND_URL = getBackendBaseUrl();

const SUPPORTED_LANGUAGE_CODES = ['hi', 'en', 'mr', 'gu', 'kn'];
const LANGUAGE_NAMES = {
  hi: 'Hindi',
  en: 'English',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
};

const HINDI_HINTS = ['hai', 'nahi', 'kya', 'mera', 'meri', 'mausam', 'mandi'];
const MARATHI_HINTS = ['aahe', 'nahi', 'kay', 'majha', 'majhi', 'havaman', 'kapani'];
const ENGLISH_HINTS = ['weather', 'market', 'price', 'scheme', 'harvest', 'help', 'today'];

export const detectLanguageCode = (text, fallback = 'en') => {
  const safeFallback = SUPPORTED_LANGUAGE_CODES.includes(fallback) ? fallback : 'en';
  const sample = String(text || '').trim();
  if (!sample) return safeFallback;

  let devanagari = 0;
  let gujarati = 0;
  let kannada = 0;
  let latin = 0;

  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0900 && code <= 0x097f) devanagari += 1;
    else if (code >= 0x0a80 && code <= 0x0aff) gujarati += 1;
    else if (code >= 0x0c80 && code <= 0x0cff) kannada += 1;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) latin += 1;
  }

  if (kannada > 0 && kannada >= Math.max(devanagari, gujarati)) return 'kn';
  if (gujarati > 0 && gujarati >= Math.max(devanagari, kannada)) return 'gu';

  if (devanagari > 0) {
    const lower = sample.toLowerCase();
    const mrScore = MARATHI_HINTS.reduce((acc, token) => (lower.includes(token) ? acc + 1 : acc), 0);
    const hiScore = HINDI_HINTS.reduce((acc, token) => (lower.includes(token) ? acc + 1 : acc), 0);
    return mrScore > hiScore ? 'mr' : 'hi';
  }

  if (latin > 0) {
    const lower = sample.toLowerCase();
    if (ENGLISH_HINTS.some((token) => lower.includes(token))) return 'en';
  }

  return safeFallback;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Audio Module (lazy-loaded)
 * ───────────────────────────────────────────────────────────────────────────── */

let _Audio = null;
let _audioChecked = false;

/**
 * Safely check if ExponentAV native module is registered
 * before calling require('expo-av') which would throw a fatal error.
 */
const _isExpoAVAvailable = () => {
  // Check new Expo Modules architecture
  if (globalThis.expo?.modules?.ExponentAV) return true;
  // Check classic NativeModules bridge
  if (NativeModules?.ExponentAV) return true;
  return false;
};

const ensureAudio = async () => {
  if (_Audio) return _Audio;
  if (_audioChecked) return null; // already failed once
  _audioChecked = true;

  // Guard: Don't even require the module if native code isn't available
  if (!_isExpoAVAvailable()) {
    console.log('[AriaVoice] ExponentAV native module not registered — skipping expo-av');
    return null;
  }

  try {
    const mod = require('expo-av');
    if (mod && mod.Audio) {
      _Audio = mod.Audio;
      return _Audio;
    }
    return null;
  } catch (e) {
    console.log('[AriaVoice] expo-av not available:', e.message);
    return null;
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Recording
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Request mic permission + start recording.
 * @returns {Promise<Recording>}  expo-av Recording instance
 */
export const startRecording = async () => {
  const Audio = await ensureAudio();
  if (!Audio) throw new Error('expo-av unavailable');

  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('MIC_DENIED');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );
  return recording;
};

/**
 * Stop a recording and return its file URI.
 */
export const stopRecording = async (recording) => {
  if (!recording) return null;
  try {
    await recording.stopAndUnloadAsync();
    const Audio = await ensureAudio();
    if (Audio) {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    }
    return recording.getURI();
  } catch {
    return null;
  }
};

/**
 * Read a local audio file as a base64 string.
 */
export const audioToBase64 = async (uri) => {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
};

/**
 * Delete a temporary audio file.
 */
export const deleteAudio = (uri) => {
  if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Gemini Transcription
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Transcribe audio via Gemini 2.0-Flash multimodal API.
 * @param {string} audioBase64  Base64-encoded audio data
 * @param {string} mimeType     MIME type (default: audio/mp4 for AAC/m4a)
 * @returns {string}            Transcribed text, or '' if silence
 */
export const transcribeAudio = async (audioBase64, mimeType = 'audio/mp4', lang = 'hi') => {
  const safeLang = SUPPORTED_LANGUAGE_CODES.includes(lang) ? lang : 'hi';
  const languageName = LANGUAGE_NAMES[safeLang] || 'Hindi';

  if (!GOOGLE_API_KEY) {
    const response = await fetch(`${BACKEND_URL}/aria/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: mimeType,
        language_code: safeLang,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backend transcription ${response.status}: ${body.slice(0, 200)}`);
    }

    const payload = await response.json();
    const transcript = String(payload?.transcript || '').trim();
    if (!transcript || transcript === '[SILENCE]') return '';
    return transcript;
  }

  const res = await fetch(`${GEMINI_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64,
              },
            },
            {
              text:
                `Transcribe this ${languageName} audio exactly as spoken. ` +
                'Output ONLY the transcription text, no explanations. ' +
                'If the audio has no speech or only background noise, output exactly: [SILENCE]',
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.0, maxOutputTokens: 300 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini transcription ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  if (!text || text === '[SILENCE]') return '';
  return text;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Wake Word Detection
 * ───────────────────────────────────────────────────────────────────────────── */

const WAKE_STRICT = [
  /\bhi\s*aria\b/i,
  /\bhey\s*aria\b/i,
  /\bhai\s*ariya\b/i,
  /\bhi\s*ariya\b/i,
  /\bok(?:ay)?\s*aria\b/i,
  /\bहाय?\s*आरिया\b/,
  /\bहाई?\s*आरिया\b/,
  /\bहाय?\s*एरिया\b/,
];

const WAKE_LOOSE = /\baria\b|\bariya\b|\bआरिया\b/i;

/**
 * Does the transcript contain the "Hi Aria" wake word?
 */
export const containsWakeWord = (transcript) => {
  if (!transcript) return false;
  for (const re of WAKE_STRICT) if (re.test(transcript)) return true;
  return WAKE_LOOSE.test(transcript);
};

/**
 * Strip the wake-word prefix from a transcript to get the actual command.
 * "Hi Aria, show mandi prices" → "show mandi prices"
 */
export const extractCommand = (transcript) => {
  if (!transcript) return '';
  const cleaned = transcript
    .replace(
      /^(hi|hey|hai|ok(?:ay)?|हाय?|हाई?)\s*(aria|ariya|आरिया|एरिया)\s*[,.\-!?\s]*/i,
      ''
    )
    .trim();
  return cleaned || transcript;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Intent Parsing
 * ───────────────────────────────────────────────────────────────────────────── */

/** @typedef {{ intent: string, screen?: string, action?: string, params?: object, response: string }} IntentResult */

const INTENT_MAP = [
  {
    intent: 'navigate',
    screen: 'Market',
    keys: ['mandi', 'price', 'market', 'bhav', 'भाव', 'मंडी', 'दाम', 'rate',
           'bazaar', 'बाजार', 'बाज़ार', 'किस भाव', 'कितने में',
           'बाजारभाव', 'भाव काय', 'બજાર ભાવ', 'મંડી ભાવ', 'ಮಾರುಕಟ್ಟೆ ಬೆಲೆ', 'ಮಂಡಿ ಬೆಲೆ'],
    say: 'Mandi bhav dikha rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'Disease',
    keys: ['disease', 'scan', 'camera', 'बीमारी', 'रोग', 'pest', 'कीड़',
           'photo', 'diagnos', 'fungus'],
    say: 'Camera khol rahi hoon. Fasal ki photo lo.',
  },
  {
    intent: 'navigate',
    screen: 'Schemes',
    keys: ['scheme', 'yojana', 'योजना', 'government', 'सरकारी', 'subsidy',
           'pradhan', 'प्रधान', 'PM Kisan', 'loan',
           'योजना दाखवा', 'सरकारी योजना', 'યોજના', 'સરકારી યોજના', 'ಯೋಜನೆ', 'ಸರ್ಕಾರಿ ಯೋಜನೆ'],
    say: 'Sarkari yojnayein dikha rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'MainTabs',
    keys: ['home', 'dashboard', 'होम', 'main page', 'ghar'],
    say: 'Home page khol rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'CropInput',
    keys: ['crop input', 'new crop', 'add crop', 'enter crop', 'फसल दर्ज',
           'crop detail'],
    say: 'Crop details ka page khol rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'Spoilage',
    keys: ['spoilage', 'spoil', 'rot', 'खराब', 'सड़', 'storage risk',
           'store', 'स्टोर', 'रखना'],
    say: 'Storage risk check kar rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'Alerts',
    keys: ['alert', 'notification', 'अलर्ट', 'सूचना', 'चेतावनी'],
    say: 'Aapke alerts dikha rahi hoon.',
  },
  {
    intent: 'navigate',
    screen: 'ARIA',
    keys: ['chat with aria', 'aria se baat', 'aria chat', 'text aria',
           'aria type'],
    say: 'ARIA chat khol rahi hoon.',
  },
  {
    intent: 'fetch',
    action: 'price_forecast',
    keys: ['price forecast', 'price tomorrow', 'price prediction', 'कल का भाव',
           'भाव बताओ', 'rate batao', 'rate kya hai', 'kitne mein bikega'],
    say: 'Bhav ka estimate nikal rahi hoon...',
  },
  {
    intent: 'fetch',
    action: 'harvest',
    keys: ['harvest', 'कटाई', 'काट', 'when to cut', 'कब काटूं', 'कब तोड़ूं',
           'ready to harvest', 'todhna',
           'कापणी', 'कधी कापू', 'કાપણી', 'ક્યારે કાપવું', 'ಕೊಯ್ಲು', 'ಯಾವಾಗ ಕೊಯ್ಯಬೇಕು'],
    say: 'Katai ka sahi samay bata rahi hoon...',
  },
  {
    intent: 'fetch',
    action: 'weather',
    keys: ['weather', 'rain', 'मौसम', 'बारिश', 'temperature', 'तापमान',
           'बादल', 'धूप', 'garmi', 'hava',
           'हवामान', 'पाऊस', 'तापमान', 'હવામાન', 'વરસાદ', 'તાપમાન', 'ಹವಾಮಾನ', 'ಮಳೆ', 'ತಾಪಮಾನ'],
    say: 'Mausam ki jankari la rahi hoon...',
  },
  {
    intent: 'fetch',
    action: 'best_mandi',
    keys: ['best mandi', 'which mandi', 'कौन सा मंडी', 'कहाँ बेचूं',
           'कहां बेचूं', 'किधर बेचूं', 'sabse accha mandi'],
    say: 'Sabse acchi mandi dhundh rahi hoon...',
  },
  {
    intent: 'fetch',
    action: 'full_advisory',
    keys: ['full advice', 'pura advice', 'sab batao', 'poori salah',
           'recommendation', 'suggest', 'kya karu', 'सलाह', 'क्या करूं'],
    say: 'Aapke liye poori salah tayyar kar rahi hoon...',
  },
  {
    intent: 'stop',
    keys: ['stop', 'close', 'cancel', 'bye', 'बंद', 'रुक', 'बस', 'bass',
           'thankyou', 'shukriya', 'alvida'],
    say: 'Theek hai, zarurat pade toh bolo.',
  },
];

const LOCAL_RESPONSE_FALLBACK = {
  hi: 'Samajh gayi, kaam kar rahi hoon.',
  en: 'Got it, working on it now.',
  mr: 'समजलो, लगेच काम सुरू करतो.',
  gu: 'સમજી ગઈ, હમણાં કામ શરૂ કરું છું.',
  kn: 'ಅರ್ಥವಾಯಿತು, ಈಗ ಕೆಲಸ ಪ್ರಾರಂಭಿಸುತ್ತಿದ್ದೇನೆ.',
};

const LOCAL_NETWORK_SLOW = {
  hi: 'Network slow hai, thoda baad mein try karo.',
  en: 'Network is slow right now. Please try again shortly.',
  mr: 'नेटवर्क स्लो आहे, थोड्या वेळाने पुन्हा प्रयत्न करा.',
  gu: 'નેટવર્ક ધીમું છે, થોડા સમય પછી ફરી પ્રયત્ન કરો.',
  kn: 'ನೆಟ್‌ವರ್ಕ್ ನಿಧಾನವಾಗಿದೆ, ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
};

const LOCAL_UNKNOWN = {
  hi: 'Kuch samajh nahi aaya, ek baar phir bolo.',
  en: 'I could not understand that. Please say it once again.',
  mr: 'समजलं नाही, कृपया पुन्हा बोला.',
  gu: 'સમજાયું નથી, કૃપા કરીને ફરી બોલો.',
  kn: 'ಅರ್ಥವಾಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.',
};

const LOCAL_MATCH_RESPONSES = {
  hi: {
    'navigate:Market': 'Mandi bhav dikha rahi hoon.',
    'navigate:Disease': 'Camera khol rahi hoon. Fasal ki photo lo.',
    'navigate:Schemes': 'Sarkari yojnayein dikha rahi hoon.',
    'navigate:MainTabs': 'Home page khol rahi hoon.',
    'navigate:CropInput': 'Crop details ka page khol rahi hoon.',
    'navigate:Spoilage': 'Storage risk check kar rahi hoon.',
    'navigate:Alerts': 'Aapke alerts dikha rahi hoon.',
    'navigate:ARIA': 'ARIA chat khol rahi hoon.',
    'fetch:price_forecast': 'Bhav ka estimate nikal rahi hoon...',
    'fetch:harvest': 'Katai ka sahi samay bata rahi hoon...',
    'fetch:weather': 'Mausam ki jankari la rahi hoon...',
    'fetch:best_mandi': 'Sabse acchi mandi dhundh rahi hoon...',
    'fetch:full_advisory': 'Aapke liye poori salah tayyar kar rahi hoon...',
    'stop': 'Theek hai, zarurat pade toh bolo.',
  },
  en: {
    'navigate:Market': 'Opening mandi prices now.',
    'navigate:Disease': 'Opening camera for crop scan.',
    'navigate:Schemes': 'Opening government schemes now.',
    'navigate:MainTabs': 'Opening home dashboard.',
    'navigate:CropInput': 'Opening crop details screen.',
    'navigate:Spoilage': 'Checking storage risk now.',
    'navigate:Alerts': 'Opening your alerts now.',
    'navigate:ARIA': 'Opening ARIA chat now.',
    'fetch:price_forecast': 'Getting your price forecast now...',
    'fetch:harvest': 'Checking best harvest timing now...',
    'fetch:weather': 'Getting weather update now...',
    'fetch:best_mandi': 'Finding the best mandi now...',
    'fetch:full_advisory': 'Preparing your full advisory now...',
    'stop': 'Okay, I am here whenever you need me.',
  },
  mr: {
    'navigate:Market': 'मंडी भाव उघडत आहे.',
    'navigate:Disease': 'कॅमेरा उघडत आहे. पिकाचा फोटो घ्या.',
    'navigate:Schemes': 'सरकारी योजना उघडत आहे.',
    'navigate:MainTabs': 'होम डॅशबोर्ड उघडत आहे.',
    'navigate:CropInput': 'पीक तपशील पेज उघडत आहे.',
    'navigate:Spoilage': 'स्टोरेज जोखीम तपासत आहे.',
    'navigate:Alerts': 'तुमचे अलर्ट उघडत आहे.',
    'navigate:ARIA': 'ARIA चॅट उघडत आहे.',
    'fetch:price_forecast': 'भावाचा अंदाज काढत आहे...',
    'fetch:harvest': 'कापणीचा योग्य वेळ तपासत आहे...',
    'fetch:weather': 'हवामान माहिती आणत आहे...',
    'fetch:best_mandi': 'सर्वोत्तम मंडी शोधत आहे...',
    'fetch:full_advisory': 'तुमचा पूर्ण सल्ला तयार करत आहे...',
    'stop': 'ठीक आहे, गरज लागली तर पुन्हा विचारा.',
  },
  gu: {
    'navigate:Market': 'મંડી ભાવ ખોલી રહી છું.',
    'navigate:Disease': 'કેમેરા ખોલી રહી છું. પાકનો ફોટો લો.',
    'navigate:Schemes': 'સરકારી યોજનાઓ ખોલી રહી છું.',
    'navigate:MainTabs': 'હોમ ડેશબોર્ડ ખોલી રહી છું.',
    'navigate:CropInput': 'પાક વિગતો સ્ક્રીન ખોલી રહી છું.',
    'navigate:Spoilage': 'સ્ટોરેજ જોખમ તપાસી રહી છું.',
    'navigate:Alerts': 'તમારા એલર્ટ ખોલી રહી છું.',
    'navigate:ARIA': 'ARIA ચેટ ખોલી રહી છું.',
    'fetch:price_forecast': 'ભાવનો અંદાજ કાઢી રહી છું...',
    'fetch:harvest': 'કાપણીનો યોગ્ય સમય તપાસી રહી છું...',
    'fetch:weather': 'હવામાન માહિતી લાવી રહી છું...',
    'fetch:best_mandi': 'સૌથી સારી મંડી શોધી રહી છું...',
    'fetch:full_advisory': 'તમારો સંપૂર્ણ સલાહ રિપોર્ટ તૈયાર કરી રહી છું...',
    'stop': 'બરાબર, જરૂર પડે ત્યારે ફરી પૂછો.',
  },
  kn: {
    'navigate:Market': 'ಮಂಡಿ ಬೆಲೆಗಳನ್ನು ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'navigate:Disease': 'ಕ್ಯಾಮೆರಾ ತೆರೆಯುತ್ತಿದ್ದೇನೆ. ಬೆಳೆ ಫೋಟೋ ತೆಗೆದುಕೊಳ್ಳಿ.',
    'navigate:Schemes': 'ಸರಕಾರಿ ಯೋಜನೆಗಳನ್ನು ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'navigate:MainTabs': 'ಹೋಮ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'navigate:CropInput': 'ಬೆಳೆ ವಿವರಗಳ ಪರದೆ ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'navigate:Spoilage': 'ಸಂಗ್ರಹಣಾ ಅಪಾಯ ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ.',
    'navigate:Alerts': 'ನಿಮ್ಮ ಅಲರ್ಟ್‌ಗಳನ್ನು ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'navigate:ARIA': 'ARIA ಚಾಟ್ ತೆರೆಯುತ್ತಿದ್ದೇನೆ.',
    'fetch:price_forecast': 'ಬೆಲೆ ಅಂದಾಜು ತರಲಾಗುತ್ತಿದೆ...',
    'fetch:harvest': 'ಕೊಯ್ಲಿನ ಸರಿಯಾದ ಸಮಯ ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ...',
    'fetch:weather': 'ಹವಾಮಾನ ಮಾಹಿತಿ ತರಲಾಗುತ್ತಿದೆ...',
    'fetch:best_mandi': 'ಅತ್ಯುತ್ತಮ ಮಾರುಕಟ್ಟೆ ಹುಡುಕಲಾಗುತ್ತಿದೆ...',
    'fetch:full_advisory': 'ನಿಮ್ಮ ಸಂಪೂರ್ಣ ಸಲಹೆ ವರದಿ ತಯಾರಿಸುತ್ತಿದ್ದೇನೆ...',
    'stop': 'ಸರಿ, ಬೇಕಾದರೆ ಮತ್ತೆ ಕೇಳಿ.',
  },
};

const getLocalMatchResponse = (entry, lang = 'hi') => {
  const safeLang = SUPPORTED_LANGUAGE_CODES.includes(lang) ? lang : 'hi';
  const key = entry.intent === 'stop'
    ? 'stop'
    : `${entry.intent}:${entry.intent === 'navigate' ? entry.screen : entry.action}`;
  return LOCAL_MATCH_RESPONSES[safeLang]?.[key] || LOCAL_RESPONSE_FALLBACK[safeLang];
};

const normalizeIntentResult = (obj, lang = 'hi') => {
  const safeLang = SUPPORTED_LANGUAGE_CODES.includes(lang) ? lang : 'hi';
  const rawIntent = String(obj?.intent || 'chat').toLowerCase();
  const rawAction = String(obj?.action || '').trim();
  const actionLower = rawAction.toLowerCase();

  const navMap = {
    market: 'Market',
    mandi: 'Market',
    disease: 'Disease',
    camera: 'Disease',
    schemes: 'Schemes',
    scheme: 'Schemes',
    maintabs: 'MainTabs',
    home: 'MainTabs',
    cropinput: 'CropInput',
    spoilage: 'Spoilage',
    alerts: 'Alerts',
    aria: 'ARIA',
  };

  const fetchMap = {
    price_forecast: 'price_forecast',
    forecast: 'price_forecast',
    price: 'price_forecast',
    harvest: 'harvest',
    weather: 'weather',
    best_mandi: 'best_mandi',
    mandi: 'best_mandi',
    full_advisory: 'full_advisory',
    advisory: 'full_advisory',
  };

  if (rawIntent === 'navigate') {
    const screen = navMap[actionLower] || rawAction;
    if (!screen) return { intent: 'chat', response: LOCAL_UNKNOWN[safeLang] };
    return {
      intent: 'navigate',
      screen,
      params: obj?.params || {},
      response: obj?.response || LOCAL_RESPONSE_FALLBACK[safeLang],
    };
  }

  if (rawIntent === 'fetch') {
    const action = fetchMap[actionLower] || rawAction;
    if (!action) return { intent: 'chat', response: LOCAL_UNKNOWN[safeLang] };
    return {
      intent: 'fetch',
      action,
      params: obj?.params || {},
      response: obj?.response || LOCAL_RESPONSE_FALLBACK[safeLang],
    };
  }

  if (rawIntent === 'stop') {
    return { intent: 'stop', response: obj?.response || LOCAL_MATCH_RESPONSES[safeLang]?.stop || LOCAL_RESPONSE_FALLBACK[safeLang] };
  }

  return {
    intent: 'chat',
    response: obj?.response || LOCAL_UNKNOWN[safeLang],
  };
};

/**
 * Try fast local keyword matching.  Returns null if no match.
 * @param {string} text
 * @returns {IntentResult|null}
 */
const matchLocal = (text, lang = 'hi') => {
  const lower = text.toLowerCase();
  for (const entry of INTENT_MAP) {
    for (const kw of entry.keys) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          intent: entry.intent,
          screen: entry.screen,
          action: entry.action,
          params: {},
          response: getLocalMatchResponse(entry, lang),
        };
      }
    }
  }
  return null;
};

/**
 * Use Gemini to understand complex / multilingual commands.
 */
const parseWithGemini = async (transcript, ctx, lang = 'hi') => {
  const safeLang = SUPPORTED_LANGUAGE_CODES.includes(lang) ? lang : 'hi';
  const outputLanguage = LANGUAGE_NAMES[safeLang] || 'Hindi';

  const prompt = `You are ARIA, a voice assistant for Indian farmers. Parse this voice command.

Farmer said: "${transcript}"
Context: Crop=${ctx.crop || 'Unknown'}, District=${ctx.district || 'Unknown'}

Available actions:
1. navigate:Market - Show mandi/market prices
2. navigate:Disease - Open camera for disease scanning
3. navigate:Schemes - Government schemes
4. navigate:MainTabs - Home dashboard
5. navigate:CropInput - Enter crop details
6. navigate:Spoilage - Storage/spoilage risk
7. navigate:Alerts - Notifications
8. navigate:ARIA - Chat screen
9. fetch:price_forecast - Price prediction
10. fetch:harvest - Harvest timing advice
11. fetch:weather - Weather info
12. fetch:best_mandi - Best mandi to sell at
13. fetch:full_advisory - Complete farm advisory
14. stop - Close assistant
15. chat - General farming question

Return ONLY valid JSON (no markdown fences):
{"intent":"navigate|fetch|stop|chat","action":"screen or fetch_type","params":{},"response":"Short natural reply in ${outputLanguage}. Max 2 sentences. Keep it practical for farmers."}`;

  const res = await fetch(`${GEMINI_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini NLU failed (${res.status})`);

  const data = await res.json();
  let raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    const obj = JSON.parse(raw);
    return normalizeIntentResult(obj, safeLang);
  } catch {
    // Gemini returned free-form text – treat as chat reply
    return { intent: 'chat', response: raw || LOCAL_UNKNOWN[safeLang] };
  }
};

/**
 * Parse a voice command into a structured intent.
 * First tries instant local keyword matching, then Gemini NLU.
 *
 * @param {string} transcript
 * @param {object} ctx  { crop, district }
 * @returns {Promise<IntentResult>}
 */
export const parseIntent = async (transcript, ctx = {}, lang = 'hi') => {
  const safeLang = SUPPORTED_LANGUAGE_CODES.includes(lang) ? lang : 'hi';

  if (!transcript) {
    return { intent: 'unknown', response: LOCAL_UNKNOWN[safeLang] };
  }

  const local = matchLocal(transcript, safeLang);
  if (local) return local;

  try {
    return await parseWithGemini(transcript, ctx, safeLang);
  } catch (err) {
    console.warn('Gemini NLU error:', err.message);
    return { intent: 'chat', response: LOCAL_NETWORK_SLOW[safeLang] };
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Text-to-Speech
 * ───────────────────────────────────────────────────────────────────────────── */

const SPEECH_CODES = { hi: 'hi-IN', en: 'en-IN', mr: 'mr-IN', gu: 'gu-IN', kn: 'kn-IN' };

/**
 * Speak text out loud. Returns a promise that resolves when speech finishes.
 */
export const speak = (text, lang = 'hi') =>
  new Promise((resolve) => {
    Speech.speak(text, {
      language: SPEECH_CODES[lang] || 'en-IN',
      rate: 0.95,
      pitch: 1.0,
      onDone: resolve,
      onStopped: resolve,
      onError: resolve,
    });
  });

/**
 * Stop any ongoing speech.
 */
export const stopSpeaking = () => Speech.stop();
