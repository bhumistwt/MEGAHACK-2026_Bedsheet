/**
 * ARIA Global Context — State Management + Action Execution
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Wraps the entire app to provide:
 * - Voice interaction state (mode, transcript, response)
 * - Wake word detection loop
 * - Intent execution (navigation, API fetches, TTS feedback)
 * - Navigation ref for cross-screen navigation
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  startRecording,
  stopRecording,
  audioToBase64,
  deleteAudio,
  transcribeAudio,
  containsWakeWord,
  extractCommand,
  parseIntent,
  detectLanguageCode,
  speak,
  stopSpeaking,
} from '../services/ariaVoiceEngine';
import {
  getFullAdvisory,
  getPriceForecast,
  getMandiRecommendationV2,
  getSpoilageRiskV2,
  getHarvestWindowV2,
  checkApiHealth,
} from '../services/apiService';
import { useLanguage } from './LanguageContext';

/* ─────────────────────────────────────────────────────────────────────────── */

const AriaContext = createContext(null);

export const useAria = () => {
  const ctx = useContext(AriaContext);
  if (!ctx) throw new Error('useAria must be inside <AriaProvider>');
  return ctx;
};

/* ─── Constants ────────────────────────────────────────────────────────────── */

export const MODES = Object.freeze({
  IDLE: 'idle',
  WAKE_LISTENING: 'wake_listening',
  ACTIVATED: 'activated',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  EXECUTING: 'executing',
});

const WAKE_CHUNK_MS = 3500;   // record 3.5s chunks for wake-word
const COMMAND_MAX_MS = 10000; // max 10s per voice command
const DISMISS_DELAY = 2500;   // auto-dismiss overlay after response

/* ─── Provider ─────────────────────────────────────────────────────────────── */

export function AriaProvider({ children, navigationRef }) {
  const { language } = useLanguage();
  /* ── state ───────────────────────────────────────────────────────────── */
  const [mode, setMode] = useState(MODES.IDLE);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [error, setError] = useState(null);
  const [userCtx, setUserCtx] = useState({ crop: 'Onion', district: 'Nashik' });
  const assistantLang = language || 'hi';

  const L10N = {
    execute: {
      hi: {
        price: (crop, price, dir) => `${crop} ka bhav abhi ${price} rupaye per quintal hai. Trend ${dir} hai.`,
        mandi: (best) => `Aapke liye sabse acchi mandi ${best} hai. Wahan bhav zyada mil raha hai.`,
        harvestNow: 'Aapki fasal tayyar hai. Aaj hi katai karo.',
        harvestWait: (wait) => `Abhi ${wait} din aur ruko, fir katai karo.`,
        weatherNav: 'Home page par mausam dikha rahi hoon.',
        advisoryFallback: 'Advisory tayyar hai, Home page dekho.',
        loadingDefault: 'Jankari dhundh rahi hoon...',
        dataError: 'Data load nahi ho paya. Phir try karo.',
      },
      en: {
        price: (crop, price, dir) => `${crop} price is ${price} rupees per quintal right now. Trend is ${dir}.`,
        mandi: (best) => `Best mandi for you is ${best}. It currently has a better rate.`,
        harvestNow: 'Your crop is ready. Harvest today.',
        harvestWait: (wait) => `Wait for ${wait} more days, then harvest.`,
        weatherNav: 'Opening weather details on home screen.',
        advisoryFallback: 'Advisory is ready. Please check home screen.',
        loadingDefault: 'Fetching details now...',
        dataError: 'Could not load data. Please try again.',
      },
      mr: {
        price: (crop, price, dir) => `${crop} चा भाव सध्या ${price} रुपये प्रति क्विंटल आहे. ट्रेंड ${dir} आहे.`,
        mandi: (best) => `तुमच्यासाठी सर्वात चांगली मंडी ${best} आहे. तिथे भाव चांगला आहे.`,
        harvestNow: 'पीक तयार आहे. आजच कापणी करा.',
        harvestWait: (wait) => `आणखी ${wait} दिवस थांबा, मग कापणी करा.`,
        weatherNav: 'होम स्क्रीनवर हवामान दाखवत आहे.',
        advisoryFallback: 'सल्ला तयार आहे, होम स्क्रीन पहा.',
        loadingDefault: 'माहिती आणत आहे...',
        dataError: 'माहिती मिळाली नाही. कृपया पुन्हा प्रयत्न करा.',
      },
      gu: {
        price: (crop, price, dir) => `${crop} નો ભાવ હાલમાં ${price} રૂપિયા પ્રતિ ક્વિન્ટલ છે. ટ્રેન્ડ ${dir} છે.`,
        mandi: (best) => `તમારા માટે સૌથી સારી મંડી ${best} છે. ત્યાં ભાવ વધુ છે.`,
        harvestNow: 'તમારો પાક તૈયાર છે. આજે જ કાપણી કરો.',
        harvestWait: (wait) => `હજુ ${wait} દિવસ રાહ જુઓ, પછી કાપણી કરો.`,
        weatherNav: 'હોમ સ્ક્રીન પર હવામાન બતાવી રહી છું.',
        advisoryFallback: 'સલાહ તૈયાર છે, હોમ સ્ક્રીન જુઓ.',
        loadingDefault: 'માહિતી લાવી રહી છું...',
        dataError: 'માહિતી લોડ થઈ નહીં. ફરી પ્રયત્ન કરો.',
      },
      kn: {
        price: (crop, price, dir) => `${crop} ಬೆಲೆ ಈಗ ಪ್ರತಿ ಕ್ವಿಂಟಲ್‌ಗೆ ${price} ರೂಪಾಯಿ ಇದೆ. ಟ್ರೆಂಡ್ ${dir} ಆಗಿದೆ.`,
        mandi: (best) => `ನಿಮಗೆ ಉತ್ತಮ ಮಾರುಕಟ್ಟೆ ${best}. ಅಲ್ಲಿ ಬೆಲೆ ಹೆಚ್ಚು ಇದೆ.`,
        harvestNow: 'ನಿಮ್ಮ ಬೆಳೆ ಸಿದ್ಧವಾಗಿದೆ. ಇಂದು ಕೊಯ್ಲು ಮಾಡಿ.',
        harvestWait: (wait) => `ಇನ್ನೂ ${wait} ದಿನ ಕಾಯಿರಿ, ನಂತರ ಕೊಯ್ಲು ಮಾಡಿ.`,
        weatherNav: 'ಹೋಮ್ ಪರದೆಯಲ್ಲಿ ಹವಾಮಾನ ತೋರಿಸುತ್ತಿದ್ದೇನೆ.',
        advisoryFallback: 'ಸಲಹೆ ಸಿದ್ಧವಾಗಿದೆ, ಹೋಮ್ ಪರದೆ ನೋಡಿ.',
        loadingDefault: 'ಮಾಹಿತಿ ತರಲಾಗುತ್ತಿದೆ...',
        dataError: 'ಡೇಟಾ ಲೋಡ್ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      },
    },
    generic: {
      unknown: {
        hi: 'Kuch gadbad huyi. Ek baar phir bolo.',
        en: 'Something went wrong. Please say that once again.',
        mr: 'काहीतरी चूक झाली. कृपया पुन्हा बोला.',
        gu: 'કંઈક ખોટું થયું. કૃપા કરીને ફરી બોલો.',
        kn: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.',
      },
      noSpeech: {
        hi: 'Awaaz nahi mili. Ek baar phir bolo.',
        en: 'No clear speech detected. Please speak again.',
        mr: 'आवाज स्पष्ट मिळाला नाही. कृपया पुन्हा बोला.',
        gu: 'આવાજ સ્પષ્ટ મળ્યો નહીં. કૃપા કરીને ફરી બોલો.',
        kn: 'ಸ್ಪಷ್ಟ ಧ್ವನಿ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಮಾತಾಡಿ.',
      },
      micPermission: {
        hi: 'Mic permission chalu karo.',
        en: 'Please enable microphone permission.',
        mr: 'माईक परवानगी सुरू करा.',
        gu: 'માઇક્રોફોન પરમિશન ચાલુ કરો.',
        kn: 'ಮೈಕ್ ಅನುಮತಿ ಸಕ್ರಿಯಗೊಳಿಸಿ.',
      },
      processingFail: {
        hi: 'Processing fail. Phir try karo.',
        en: 'Could not process command. Please try again.',
        mr: 'कमांड प्रोसेस झाली नाही. पुन्हा प्रयत्न करा.',
        gu: 'કમાન્ડ પ્રોસેસ થઈ નહીં. ફરી પ્રયત્ન કરો.',
        kn: 'ಕಮಾಂಡ್ ಪ್ರಕ್ರಿಯೆ ವಿಫಲವಾಯಿತು. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      },
      recordingFailed: {
        hi: 'Recording fail hui. Phir try karo.',
        en: 'Recording failed. Please try again.',
        mr: 'रेकॉर्डिंग फेल झाली. कृपया पुन्हा प्रयत्न करा.',
        gu: 'રેકોર્ડિંગ નિષ્ફળ ગયું. કૃપા કરીને ફરી પ્રયત્ન કરો.',
        kn: 'ರೆಕಾರ್ಡಿಂಗ್ ವಿಫಲವಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      },
      commandNotAllowed: {
        hi: 'Yeh command allowed nahi hai.',
        en: 'This command is not allowed.',
        mr: 'ही कमांड परवानगीत नाही.',
        gu: 'આ કમાન્ડ મંજૂર નથી.',
        kn: 'ಈ ಕಮಾಂಡ್ ಅನುಮತಿಸಲ್ಪಟ್ಟಿಲ್ಲ.',
      },
    },
  };

  const msg = (bucket, key, langOverride = null) => {
    const langKey = langOverride || assistantLang;
    return L10N?.[bucket]?.[key]?.[langKey] || L10N?.[bucket]?.[key]?.hi || '';
  };

  /* ── refs (avoid stale closures) ─────────────────────────────────────── */
  const modeRef = useRef(MODES.IDLE);
  const recRef = useRef(null);       // current recording
  const wakeLoop = useRef(false);    // wake-loop running flag
  const timerRef = useRef(null);     // auto-stop timer
  const ctxRef = useRef(userCtx);
  const navRef = useRef(navigationRef);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { ctxRef.current = userCtx; }, [userCtx]);
  useEffect(() => { navRef.current = navigationRef; }, [navigationRef]);

  /* ── helpers ─────────────────────────────────────────────────────────── */

  const nav = useCallback((screen, params) => {
    try {
      const ref = navRef.current;
      if (ref?.current?.isReady?.()) {
        ref.current.navigate(screen, params);
      }
    } catch (e) {
      console.warn('Navigation failed:', e.message);
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const killRecording = useCallback(async () => {
    if (recRef.current) {
      const uri = await stopRecording(recRef.current);
      recRef.current = null;
      deleteAudio(uri);
    }
  }, []);

  /* ── resetToIdle (with optional wake-restart) ────────────────────────── */

  const resetToIdle = useCallback((delay = DISMISS_DELAY) => {
    clearTimers();
    timerRef.current = setTimeout(() => {
      setMode(MODES.IDLE);
      setOverlayVisible(false);
      setTranscript('');
      setResponse('');
      setError(null);
      // restart wake word if it was enabled
      if (wakeLoop.current) startWakeLoop();
    }, delay);
  }, []); // intentionally empty — uses refs internally

  /* ── executeAction — runs after intent is parsed ─────────────────────── */

  const executeAction = useCallback(async (result, runtimeLang = assistantLang) => {
    const ctx = ctxRef.current;
    const crop = result.params?.crop || ctx.crop;
    const district = result.params?.district || ctx.district;

    const exec = L10N.execute[runtimeLang] || L10N.execute.hi;

    const allowedNavigateScreens = new Set([
      'Market', 'Disease', 'Schemes', 'MainTabs', 'CropInput', 'Spoilage', 'Alerts', 'ARIA',
    ]);
    const allowedFetchActions = new Set([
      'price_forecast', 'best_mandi', 'harvest', 'weather', 'full_advisory',
    ]);

    if (result.intent === 'navigate' && result.screen && !allowedNavigateScreens.has(result.screen)) {
      const blocked = msg('generic', 'commandNotAllowed', runtimeLang);
      setResponse(blocked);
      setMode(MODES.SPEAKING);
      await speak(blocked, runtimeLang);
      return;
    }

    if (result.intent === 'fetch' && result.action && !allowedFetchActions.has(result.action)) {
      const blocked = msg('generic', 'commandNotAllowed', runtimeLang);
      setResponse(blocked);
      setMode(MODES.SPEAKING);
      await speak(blocked, runtimeLang);
      return;
    }

    switch (result.intent) {
      case 'navigate':
        if (result.screen) {
          setMode(MODES.EXECUTING);
          nav(result.screen, result.params);
        }
        break;

      case 'fetch': {
        setMode(MODES.EXECUTING);
        try {
          const health = await checkApiHealth();
          if (health && health.online === false) {
            const offlineMsg = {
              hi: 'Internet off hai. Network on karke phir try karo.',
              en: 'You are offline. Turn on internet and try again.',
              mr: 'इंटरनेट बंद आहे. नेटवर्क सुरू करून पुन्हा प्रयत्न करा.',
              gu: 'ઇન્ટરનેટ બંધ છે. નેટવર્ક ચાલુ કરીને ફરી પ્રયત્ન કરો.',
              kn: 'ಇಂಟರ್ನೆಟ್ ಆಫ್ ಇದೆ. ನೆಟ್‌ವರ್ಕ್ ಆನ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
            };
            const textMsg = offlineMsg[runtimeLang] || offlineMsg.hi;
            setResponse(textMsg);
            setMode(MODES.SPEAKING);
            await speak(textMsg, runtimeLang);
            break;
          }

          let dataResponse = '';
          switch (result.action) {
            case 'price_forecast': {
              const pf = await getPriceForecast({ crop, district, forecastDays: 7 });
              const price = pf?.current_price || pf?.forecasts?.[0]?.predicted_price || '?';
              const dir = pf?.direction || 'stable';
              dataResponse = exec.price(crop, price, dir);
              break;
            }
            case 'best_mandi': {
              const mr = await getMandiRecommendationV2({ crop, district, quantityQuintals: 10 });
              const best = mr?.best_mandi || mr?.recommendations?.[0]?.mandi || district;
              dataResponse = exec.mandi(best);
              break;
            }
            case 'harvest': {
              const hw = await getHarvestWindowV2({ crop, district });
              const action = hw?.action || 'wait';
              const wait = hw?.wait_days || 0;
              dataResponse = action === 'harvest_now'
                ? exec.harvestNow
                : exec.harvestWait(wait);
              break;
            }
            case 'weather':
              nav('MainTabs');
              dataResponse = exec.weatherNav;
              break;
            case 'full_advisory': {
              const adv = await getFullAdvisory({ crop, district });
              dataResponse = adv?.summary || exec.advisoryFallback;
              nav('MainTabs');
              break;
            }
            default:
              dataResponse = result.response || exec.loadingDefault;
          }
          setResponse(dataResponse);
          setMode(MODES.SPEAKING);
          await speak(dataResponse, runtimeLang);
        } catch {
          const fallback = result.response || exec.dataError;
          setResponse(fallback);
          setMode(MODES.SPEAKING);
          await speak(fallback, runtimeLang);
        }
        break;
      }

      case 'stop':
        break; // will reset below

      case 'chat':
      default:
        // gemini already provided a response — spoken in processCommand
        break;
    }
  }, [nav, assistantLang]);

  /* ── processCommand — NLU + action ───────────────────────────────────── */

  const processCommand = useCallback(async (text) => {
    setMode(MODES.PROCESSING);
    try {
      const runtimeLang = detectLanguageCode(text, assistantLang);
      const result = await parseIntent(text, ctxRef.current, runtimeLang);
      setResponse(result.response || '');

      // Speak the response first (unless fetch will override it)
      if (result.intent !== 'fetch') {
        setMode(MODES.SPEAKING);
        await speak(result.response || L10N.generic.unknown[runtimeLang] || L10N.generic.unknown.hi, runtimeLang);
      }

      await executeAction(result, runtimeLang);
    } catch (e) {
      console.error('processCommand error:', e);
      const runtimeLang = detectLanguageCode(text, assistantLang);
      const errorMsg = msg('generic', 'unknown', runtimeLang);
      setResponse(errorMsg);
      setMode(MODES.SPEAKING);
      await speak(errorMsg, runtimeLang);
    }
    resetToIdle();
  }, [executeAction, resetToIdle, assistantLang]);

  /* ── finishListening — stop recording → transcribe → process ─────────── */

  const finishListening = useCallback(async () => {
    clearTimers();
    if (!recRef.current) return;

    setMode(MODES.PROCESSING);
    let uri = null;
    try {
      uri = await stopRecording(recRef.current);
      recRef.current = null;

      if (!uri) {
        setError(msg('generic', 'recordingFailed'));
        setMode(MODES.IDLE);
        return;
      }

      const b64 = await audioToBase64(uri);
      deleteAudio(uri);
      uri = null;

      const raw = await transcribeAudio(b64, 'audio/mp4', assistantLang);
      if (!raw) {
        const noSpeech = msg('generic', 'noSpeech');
        setResponse(noSpeech);
        setMode(MODES.SPEAKING);
        await speak(noSpeech, assistantLang);
        resetToIdle();
        return;
      }

      const cmd = containsWakeWord(raw) ? extractCommand(raw) : raw;
      setTranscript(cmd);
      await processCommand(cmd);
    } catch (err) {
      console.error('finishListening:', err);
      if (uri) deleteAudio(uri);
      setError(err.message === 'MIC_DENIED'
        ? msg('generic', 'micPermission')
        : msg('generic', 'processingFail'));
      resetToIdle(3000);
    }
  }, [processCommand, resetToIdle, clearTimers, assistantLang]);

  /* ── startListening — begin recording a voice command ─────────────────── */

  const startListening = useCallback(async () => {
    // kill any prior recording
    await killRecording();
    clearTimers();

    setMode(MODES.LISTENING);
    setTranscript('');
    setResponse('');
    setError(null);
    setOverlayVisible(true);

    try {
      const rec = await startRecording();
      recRef.current = rec;

      // Auto-stop after COMMAND_MAX_MS
      timerRef.current = setTimeout(() => {
        if (modeRef.current === MODES.LISTENING) finishListening();
      }, COMMAND_MAX_MS);
    } catch (err) {
      setError(err.message === 'MIC_DENIED'
        ? msg('generic', 'micPermission')
        : msg('generic', 'processingFail'));
      setMode(MODES.IDLE);
    }
  }, [finishListening, killRecording, clearTimers, assistantLang]);

  /* ── Wake Word Loop ──────────────────────────────────────────────────── */

  const startWakeLoop = useCallback(async () => {
    wakeLoop.current = true;
    setMode(MODES.WAKE_LISTENING);

    while (wakeLoop.current) {
      let uri = null;
      try {
        const rec = await startRecording();
        recRef.current = rec;

        await new Promise((r) => setTimeout(r, WAKE_CHUNK_MS));
        if (!wakeLoop.current) { await killRecording(); break; }

        uri = await stopRecording(rec);
        recRef.current = null;
        if (!uri) continue;

        const b64 = await audioToBase64(uri);
        deleteAudio(uri);
        uri = null;

        const text = await transcribeAudio(b64, 'audio/mp4', assistantLang);
        if (text && containsWakeWord(text)) {
          // 🎉 Wake word detected
          wakeLoop.current = false;
          setOverlayVisible(true);

          const cmd = extractCommand(text);
          if (cmd && cmd.length > 3 && cmd !== text) {
            // Command included: "Hi Aria, show prices"
            setTranscript(cmd);
            await processCommand(cmd);
          } else {
            // Just wake word — prompt for command
            setMode(MODES.ACTIVATED);
            const wakePrompt = {
              hi: 'Haan, bolo?',
              en: 'Yes, tell me.',
              mr: 'हो, सांगा.',
              gu: 'હા, બોલો.',
              kn: 'ಹೌದು, ಹೇಳಿ.',
            };
            await speak(wakePrompt[assistantLang] || wakePrompt.hi, assistantLang);
            await startListening();
          }
          return; // exit loop
        }
      } catch (err) {
        if (uri) deleteAudio(uri);
        recRef.current = null;
        // brief pause before retrying
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }, [processCommand, startListening, killRecording, assistantLang]);

  const stopWakeLoop = useCallback(async () => {
    wakeLoop.current = false;
    await killRecording();
    if (modeRef.current === MODES.WAKE_LISTENING) setMode(MODES.IDLE);
  }, [killRecording]);

  /* ── toggleWakeWord ──────────────────────────────────────────────────── */

  const toggleWakeWord = useCallback(async () => {
    if (wakeWordEnabled) {
      setWakeWordEnabled(false);
      await stopWakeLoop();
    } else {
      setWakeWordEnabled(true);
      startWakeLoop();
    }
  }, [wakeWordEnabled, startWakeLoop, stopWakeLoop]);

  /* ── onMicPress — floating button tap ────────────────────────────────── */

  const onMicPress = useCallback(async () => {
    const m = modeRef.current;
    if (m === MODES.LISTENING) {
      await finishListening();
    } else if (m === MODES.SPEAKING || m === MODES.EXECUTING) {
      stopSpeaking();
      resetToIdle(0);
    } else {
      // IDLE or WAKE_LISTENING → start command
      if (wakeLoop.current) {
        wakeLoop.current = false;
        await killRecording();
      }
      await startListening();
    }
  }, [finishListening, startListening, resetToIdle, killRecording]);

  /* ── dismiss overlay ─────────────────────────────────────────────────── */

  const dismiss = useCallback(async () => {
    stopSpeaking();
    clearTimers();
    await killRecording();
    wakeLoop.current = false;
    setMode(MODES.IDLE);
    setOverlayVisible(false);
    setTranscript('');
    setResponse('');
    setError(null);
    // If wake word was enabled, restart loop after short delay
    if (wakeWordEnabled) {
      setTimeout(() => {
        wakeLoop.current = true;
        startWakeLoop();
      }, 800);
    }
  }, [wakeWordEnabled, clearTimers, killRecording, startWakeLoop]);

  /* ── updateContext ───────────────────────────────────────────────────── */

  const updateContext = useCallback((next) => {
    setUserCtx((prev) => ({ ...prev, ...next }));
  }, []);

  /* ── cleanup ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      wakeLoop.current = false;
      stopSpeaking();
      clearTimers();
      killRecording();
    };
  }, [clearTimers, killRecording]);

  /* ── context value ───────────────────────────────────────────────────── */

  const value = {
    mode,
    wakeWordEnabled,
    transcript,
    response,
    overlayVisible,
    error,
    userCtx,
    onMicPress,
    dismiss,
    toggleWakeWord,
    startListening,
    finishListening,
    updateContext,
  };

  return (
    <AriaContext.Provider value={value}>
      {children}
    </AriaContext.Provider>
  );
}
