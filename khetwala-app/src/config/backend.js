import { Platform } from 'react-native';

const sanitizeUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
};

const pushUnique = (bucket, value) => {
  const clean = sanitizeUrl(value);
  if (!clean || bucket.includes(clean)) return;
  bucket.push(clean);
};

export const getBackendCandidates = () => {
  const candidates = [];
  const envUrl = sanitizeUrl(process.env.EXPO_PUBLIC_BACKEND_URL);

  pushUnique(candidates, envUrl);

  if (Platform.OS === 'android') {
    if (__DEV__) {
      pushUnique(candidates, 'http://localhost:8000');
      pushUnique(candidates, 'http://10.0.2.2:8000');
    } else {
      pushUnique(candidates, 'http://10.0.2.2:8000');
      pushUnique(candidates, 'http://localhost:8000');
    }
  } else {
    pushUnique(candidates, 'http://localhost:8000');
  }

  return candidates;
};

export const getBackendBaseUrl = () => {
  const candidates = getBackendCandidates();
  return candidates[0] || 'http://localhost:8000';
};
