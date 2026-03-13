/**
 * ARIA 2.0 Dialect & Tone Personalization
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * District-specific dialect rules and tone modifiers for ARIA's personality.
 * Used to make ARIA feel like a local — not a generic AI chatbot.
 */

// ─── District Dialect Profiles ────────────────────────────────────────────────
export const DIALECT_PROFILES = {
  // === Maharashtra ===
  Nashik: {
    region: 'Nashik',
    language: 'mr',
    greeting: 'काय मित्रा, कसं काय?',
    farewell: 'चला मग, काळजी घ्या!',
    encouragement: 'चिंता नको, होईल सगळं!',
    localCrops: ['onion', 'grape', 'tomato'],
    toneWords: {
      yes: 'हो ना',
      no: 'नाही रे',
      okay: 'बरं बरं',
      think: 'थांब, बघतो',
      hurry: 'लवकर कर',
    },
    mixingStyle: 'marathi-hindi', // code-mixing pattern
  },
  Pune: {
    region: 'Pune',
    language: 'mr',
    greeting: 'नमस्कार! कसं चाललंय?',
    farewell: 'बरं, जमलं तर सांगा!',
    encouragement: 'काळजी नको, सगळं नीट होईल!',
    localCrops: ['sugarcane', 'onion', 'wheat'],
    toneWords: {
      yes: 'हो',
      no: 'नाही',
      okay: 'ठीक आहे',
      think: 'थांबा, पाहतो',
      hurry: 'लवकर करा',
    },
    mixingStyle: 'pure-marathi',
  },
  Nagpur: {
    region: 'Nagpur / Vidarbha',
    language: 'mr',
    greeting: 'काय रे, कसं हाये?',
    farewell: 'जा बे, काम कर!',
    encouragement: 'टेन्शन नको घेऊ, होईन सगळं!',
    localCrops: ['cotton', 'orange', 'soybean'],
    toneWords: {
      yes: 'हो बे',
      no: 'नाय',
      okay: 'चालल',
      think: 'थांब, बघतो',
      hurry: 'लवकर कर बे',
    },
    mixingStyle: 'vidarbha-hindi',
  },
  Jalna: {
    region: 'Marathwada',
    language: 'mr',
    greeting: 'राम राम! कसं हाय?',
    farewell: 'चला, येतो!',
    encouragement: 'होईल सगळं, घाबरू नको!',
    localCrops: ['cotton', 'soybean', 'jowar'],
    toneWords: {
      yes: 'हो',
      no: 'नाय',
      okay: 'चाललं',
      think: 'थांब, पाहतो',
      hurry: 'लवकर कर',
    },
    mixingStyle: 'marathwada-hindi',
  },
  Aurangabad: {
    region: 'Marathwada',
    language: 'mr',
    greeting: 'राम राम! कसं हाय भौ?',
    farewell: 'चला, येऊ!',
    encouragement: 'टेन्शन नग घेऊ!',
    localCrops: ['cotton', 'bajra', 'jowar'],
    toneWords: {
      yes: 'हो की',
      no: 'नाय',
      okay: 'बरं',
      think: 'थांब जरा',
      hurry: 'लवकर कर की',
    },
    mixingStyle: 'marathwada-hindi',
  },

  // === Hindi-belt defaults ===
  _hindi_default: {
    region: 'Hindi Belt',
    language: 'hi',
    greeting: 'नमस्ते! कैसे हो भाई?',
    farewell: 'चलो, ध्यान रखो!',
    encouragement: 'टेंशन मत लो, सब ठीक होगा!',
    localCrops: [],
    toneWords: {
      yes: 'हाँ',
      no: 'नहीं',
      okay: 'ठीक है',
      think: 'रुको, देखता हूँ',
      hurry: 'जल्दी करो',
    },
    mixingStyle: 'hindi',
  },

  // === English defaults ===
  _english_default: {
    region: 'English',
    language: 'en',
    greeting: 'Hello! How can I help you today?',
    farewell: 'Take care! Reach out anytime.',
    encouragement: "Don't worry, we'll figure this out together!",
    localCrops: [],
    toneWords: {
      yes: 'Yes',
      no: 'No',
      okay: 'Okay',
      think: 'Let me check',
      hurry: 'Hurry up',
    },
    mixingStyle: 'english',
  },

  // === Gujarati defaults ===
  _gujarati_default: {
    region: 'Gujarat',
    language: 'gu',
    greeting: 'કેમ છો ભાઈ? શું મદદ કરું?',
    farewell: 'ચાલો, ધ્યાન રાખજો!',
    encouragement: 'ચિંતા નહીં, બધું સારું થશે!',
    localCrops: ['cotton', 'groundnut', 'wheat'],
    toneWords: {
      yes: 'હા',
      no: 'ના',
      okay: 'ઠીક છે',
      think: 'રહો, જોઉં છું',
      hurry: 'જલ્દી કરો',
    },
    mixingStyle: 'gujarati',
  },
  Ahmedabad: {
    region: 'Ahmedabad',
    language: 'gu',
    greeting: 'કેમ છો ભાઈ? શું ચાલે છે?',
    farewell: 'ચાલો, આવજો!',
    encouragement: 'ચિંતા નહીં કરો, બધું સારું થશે!',
    localCrops: ['cotton', 'wheat', 'bajra'],
    toneWords: {
      yes: 'હા વળી',
      no: 'ના ભાઈ',
      okay: 'ઠીક છે',
      think: 'જોઉં છું',
      hurry: 'જલ્દી કરો',
    },
    mixingStyle: 'gujarati',
  },
  Rajkot: {
    region: 'Saurashtra',
    language: 'gu',
    greeting: 'કેમ છો? મજામાં ને?',
    farewell: 'ફરી મળીશું!',
    encouragement: 'હિંમત રાખો, થઈ જશે!',
    localCrops: ['groundnut', 'cotton', 'sesame'],
    toneWords: {
      yes: 'હા ને',
      no: 'ના ભાઈ',
      okay: 'એ ય',
      think: 'જોઉં',
      hurry: 'ઝટ કરો',
    },
    mixingStyle: 'saurashtra-gujarati',
  },

  // === Kannada defaults ===
  _kannada_default: {
    region: 'Karnataka',
    language: 'kn',
    greeting: 'ನಮಸ್ಕಾರ! ಹೇಗಿದ್ದೀರಿ?',
    farewell: 'ಹೋಗಿ ಬನ್ನಿ, ಜಾಗ್ರತೆ!',
    encouragement: 'ಚಿಂತೆ ಬೇಡ, ಎಲ್ಲಾ ಸರಿ ಆಗುತ್ತೆ!',
    localCrops: ['ragi', 'rice', 'sugarcane'],
    toneWords: {
      yes: 'ಹೌದು',
      no: 'ಇಲ್ಲ',
      okay: 'ಸರಿ',
      think: 'ನೋಡ್ತೀನಿ',
      hurry: 'ಬೇಗ ಮಾಡಿ',
    },
    mixingStyle: 'kannada',
  },
  Bengaluru: {
    region: 'Bengaluru',
    language: 'kn',
    greeting: 'ಹೇಗಿದ್ದೀರಿ ಸರ್? ಏನು ಸಹಾಯ?',
    farewell: 'ಸರಿ, ಮತ್ತೆ ಸಿಗೋಣ!',
    encouragement: 'ಟೆನ್ಷನ್ ಬೇಡ, ಎಲ್ಲಾ ಸರಿ ಆಗುತ್ತೆ!',
    localCrops: ['ragi', 'vegetables', 'flowers'],
    toneWords: {
      yes: 'ಹೌದು',
      no: 'ಇಲ್ಲ ಬಿಡಿ',
      okay: 'ಓಕೆ',
      think: 'ನೋಡ್ತೀನಿ',
      hurry: 'ಬೇಗ ಮಾಡಿ',
    },
    mixingStyle: 'bengaluru-kannada',
  },
  Mysuru: {
    region: 'Mysuru',
    language: 'kn',
    greeting: 'ನಮಸ್ಕಾರ! ಹೆಂಗಿದ್ದೀರಿ?',
    farewell: 'ಆಯ್ತು, ಹೋಗಿ ಬನ್ನಿ!',
    encouragement: 'ಚಿಂತೆ ಮಾಡಬೇಡಿ, ಸರಿ ಹೋಗುತ್ತೆ!',
    localCrops: ['sugarcane', 'rice', 'tobacco'],
    toneWords: {
      yes: 'ಹೌದು',
      no: 'ಇಲ್ಲ',
      okay: 'ಆಯ್ತು',
      think: 'ನೋಡ್ತೀನಿ',
      hurry: 'ಬೇಗ',
    },
    mixingStyle: 'mysuru-kannada',
  },
  Belgaum: {
    region: 'North Karnataka',
    language: 'kn',
    greeting: 'ಏನಪಾ, ಹೆಂಗಿದೀಯ?',
    farewell: 'ಬರ್ತೀನಿ, ಉಳಿ!',
    encouragement: 'ಟೆನ್ಶನ್ ಬ್ಯಾಡ, ಆಗ್ತದೆ!',
    localCrops: ['sugarcane', 'jowar', 'groundnut'],
    toneWords: {
      yes: 'ಹೌದಪಾ',
      no: 'ಇಲ್ಲಪಾ',
      okay: 'ಸರಿ',
      think: 'ನೋಡ್ತೀನಿ',
      hurry: 'ಬೇಗ ಮಾಡಪಾ',
    },
    mixingStyle: 'north-karnataka',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get dialect profile for a district. Falls back to language default.
 */
export const getDialectProfile = (district, languageCode = 'hi') => {
  if (district && DIALECT_PROFILES[district]) {
    return DIALECT_PROFILES[district];
  }
  if (languageCode === 'mr') return DIALECT_PROFILES.Nashik;  // default MR
  if (languageCode === 'gu') return DIALECT_PROFILES._gujarati_default;
  if (languageCode === 'kn') return DIALECT_PROFILES._kannada_default;
  if (languageCode === 'en') return DIALECT_PROFILES._english_default;
  return DIALECT_PROFILES._hindi_default;
};

/**
 * Build a dialect-flavored greeting for ARIA.
 */
export const getDialectGreeting = (district, name = '', languageCode = 'hi') => {
  const profile = getDialectProfile(district, languageCode);
  if (name) {
    return `${profile.greeting.replace('!', ',')} ${name}!`;
  }
  return profile.greeting;
};

/**
 * Get an encouragement phrase for distressed farmers.
 */
export const getEncouragement = (district, languageCode = 'hi') => {
  return getDialectProfile(district, languageCode).encouragement;
};

// ─── Emotion → ARIA Mood Color Map ───────────────────────────────────────────
export const EMOTION_MOOD = {
  happy:      { color: '#FFD54F', icon: 'emoticon-happy-outline',    label: 'Khush' },
  worried:    { color: '#90CAF9', icon: 'emoticon-sad-outline',      label: 'Chinta' },
  frustrated: { color: '#EF9A9A', icon: 'emoticon-angry-outline',    label: 'Gussa' },
  neutral:    { color: '#C8E6C9', icon: 'robot-outline',             label: 'Normal' },
  caring:     { color: '#CE93D8', icon: 'heart-outline',             label: 'Care' },
  urgent:     { color: '#FFAB91', icon: 'alert-circle-outline',      label: 'Jaldi' },
};

/**
 * Map detected emotion → mood config for avatar/UI.
 */
export const getMoodConfig = (emotion) => {
  return EMOTION_MOOD[emotion] || EMOTION_MOOD.neutral;
};
