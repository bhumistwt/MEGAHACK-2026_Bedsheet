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
  /* ── state ───────────────────────────────────────────────────────────── */
  const [mode, setMode] = useState(MODES.IDLE);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [error, setError] = useState(null);
  const [userCtx, setUserCtx] = useState({ crop: 'Onion', district: 'Nashik' });

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

  const executeAction = useCallback(async (result) => {
    const ctx = ctxRef.current;
    const crop = result.params?.crop || ctx.crop;
    const district = result.params?.district || ctx.district;

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
          let dataResponse = '';
          switch (result.action) {
            case 'price_forecast': {
              const pf = await getPriceForecast({ crop, district, forecastDays: 7 });
              const price = pf?.current_price || pf?.forecasts?.[0]?.predicted_price || '?';
              const dir = pf?.direction || 'stable';
              dataResponse = `${crop} ka bhav abhi ${price} rupaye per quintal hai. Trend ${dir} hai.`;
              break;
            }
            case 'best_mandi': {
              const mr = await getMandiRecommendationV2({ crop, district, quantityQuintals: 10 });
              const best = mr?.best_mandi || mr?.recommendations?.[0]?.mandi || district;
              dataResponse = `Aapke liye sabse acchi mandi ${best} hai. Wahan bhav zyada mil raha hai.`;
              break;
            }
            case 'harvest': {
              const hw = await getHarvestWindowV2({ crop, district });
              const action = hw?.action || 'wait';
              const wait = hw?.wait_days || 0;
              dataResponse = action === 'harvest_now'
                ? 'Aapki fasal tayyar hai. Aaj hi katai karo.'
                : `Abhi ${wait} din aur ruko, fir katai karo.`;
              break;
            }
            case 'weather':
              nav('MainTabs');
              dataResponse = 'Home page par mausam dikha rahi hoon.';
              break;
            case 'full_advisory': {
              const adv = await getFullAdvisory({ crop, district });
              dataResponse = adv?.summary || 'Advisory tayyar hai, Home page dekho.';
              nav('MainTabs');
              break;
            }
            default:
              dataResponse = result.response || 'Jankari dhundh rahi hoon...';
          }
          setResponse(dataResponse);
          setMode(MODES.SPEAKING);
          await speak(dataResponse, 'hi');
        } catch {
          const fallback = result.response || 'Data load nahi ho paya. Phir try karo.';
          setResponse(fallback);
          setMode(MODES.SPEAKING);
          await speak(fallback, 'hi');
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
  }, [nav]);

  /* ── processCommand — NLU + action ───────────────────────────────────── */

  const processCommand = useCallback(async (text) => {
    setMode(MODES.PROCESSING);
    try {
      const result = await parseIntent(text, ctxRef.current);
      setResponse(result.response || '');

      // Speak the response first (unless fetch will override it)
      if (result.intent !== 'fetch') {
        setMode(MODES.SPEAKING);
        await speak(result.response || 'Samajh gayi.', 'hi');
      }

      await executeAction(result);
    } catch (e) {
      console.error('processCommand error:', e);
      const msg = 'Kuch gadbad huyi. Ek baar phir bolo.';
      setResponse(msg);
      setMode(MODES.SPEAKING);
      await speak(msg, 'hi');
    }
    resetToIdle();
  }, [executeAction, resetToIdle]);

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
        setError('Recording failed. Try again.');
        setMode(MODES.IDLE);
        return;
      }

      const b64 = await audioToBase64(uri);
      deleteAudio(uri);
      uri = null;

      const raw = await transcribeAudio(b64);
      if (!raw) {
        const noSpeech = 'Awaaz nahi mili. Ek baar phir bolo.';
        setResponse(noSpeech);
        setMode(MODES.SPEAKING);
        await speak(noSpeech, 'hi');
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
        ? 'Mic permission chalu karo.'
        : 'Processing fail. Phir try karo.');
      resetToIdle(3000);
    }
  }, [processCommand, resetToIdle, clearTimers]);

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
        ? 'Mic permission do, tab Aria sun payegi.'
        : 'Recording start nahi ho payi.');
      setMode(MODES.IDLE);
    }
  }, [finishListening, killRecording, clearTimers]);

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

        const text = await transcribeAudio(b64);
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
            await speak('Haan, bolo?', 'hi');
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
  }, [processCommand, startListening, killRecording]);

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
