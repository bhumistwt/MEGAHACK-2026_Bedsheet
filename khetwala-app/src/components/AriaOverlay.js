/**
 * ARIA Global Overlay — Floating Button + Voice Interaction Panel
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Renders:
 * 1. A floating mic FAB (always visible, bottom-right above tab bar)
 *    - Tap → activate voice command
 *    - Long-press → toggle "Hi Aria" wake word mode
 *    - Pulsing animation when wake word is active
 *
 * 2. Full-screen modal overlay when voice is active:
 *    - Status text + icon
 *    - Animated waveform bars
 *    - Transcript & response display
 *    - Stop / Close controls
 *    - Wake word toggle
 */

import React, { useEffect, useRef, memo, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../theme/colors';
import { useAria, MODES } from '../context/AriaContext';

const { width: SCREEN_W } = Dimensions.get('window');

/* ─── Status configuration per mode ────────────────────────────────────────── */

const STATUS_CFG = {
  [MODES.IDLE]:           { text: '',                              icon: 'microphone',  color: COLORS.primary },
  [MODES.WAKE_LISTENING]: { text: '"Hi Aria" sun rahi hoon...',    icon: 'ear-hearing', color: '#3B82F6'      },
  [MODES.ACTIVATED]:      { text: 'Haan, bolo?',                  icon: 'microphone',  color: COLORS.accent  },
  [MODES.LISTENING]:      { text: 'Sun rahi hoon…',               icon: 'microphone',  color: COLORS.accent  },
  [MODES.PROCESSING]:     { text: 'Samajh rahi hoon…',            icon: 'brain',        color: '#F59E0B'      },
  [MODES.SPEAKING]:       { text: 'Bol rahi hoon…',               icon: 'volume-high', color: COLORS.primary },
  [MODES.EXECUTING]:      { text: 'Kaam kar rahi hoon…',          icon: 'cog-outline', color: COLORS.accent  },
};

/* ─── Waveform Bars Component ──────────────────────────────────────────────── */

const BAR_COUNT = 5;
const WaveformBars = memo(({ active, color }) => {
  const bars = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(8)),
  ).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((b, i) => b.setValue(8 + (i % 3) * 2));
      return;
    }
    const animations = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 30 - i * 3,
            duration: 220 + i * 65,
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 6 + i * 2,
            duration: 220 + i * 65,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.waveRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            { height: bar, backgroundColor: color || COLORS.accent },
          ]}
        />
      ))}
    </View>
  );
});

/* ─── Pulsing Ring (for FAB) ───────────────────────────────────────────────── */

const PulseRing = memo(({ active }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.6, duration: 900, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  return (
    <Animated.View
      style={[
        styles.pulseRing,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
});

/* ─── Main Overlay ─────────────────────────────────────────────────────────── */

export default function AriaOverlay() {
  const {
    mode,
    wakeWordEnabled,
    transcript,
    response,
    overlayVisible,
    error,
    onMicPress,
    dismiss,
    toggleWakeWord,
    finishListening,
  } = useAria();

  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [currentRoute, setCurrentRoute] = useState(null);

  useEffect(() => {
    const getActiveRoute = (state) => {
      if (!state) return null;
      let route = state.routes[state.index];
      while (route?.state) {
        route = route.state.routes[route.state.index];
      }
      return route?.name || null;
    };
    // Set initial route
    try {
      setCurrentRoute(getActiveRoute(navigation.getState()));
    } catch { /* navigation not ready yet */ }
    // Listen to navigation state changes
    const unsubscribe = navigation.addListener('state', (e) => {
      setCurrentRoute(getActiveRoute(e.data?.state));
    });
    return unsubscribe;
  }, [navigation]);

  const cfg = STATUS_CFG[mode] || STATUS_CFG[MODES.IDLE];
  const showWave = mode === MODES.LISTENING || mode === MODES.SPEAKING;
  const showStop = mode === MODES.LISTENING;

  /* ── FAB icon logic ──────────────────────────────────────────────── */
  const fabIcon = wakeWordEnabled && mode === MODES.WAKE_LISTENING
    ? 'ear-hearing'
    : 'microphone';

  return (
    <>
      {/* ═══ Floating Action Button ═══════════════════════════════════════ */}
      {!overlayVisible && currentRoute !== 'ARIA' && (
        <View style={[styles.fabWrap, { bottom: 85 + insets.bottom }]}>
          <PulseRing active={wakeWordEnabled && mode === MODES.WAKE_LISTENING} />
          <Pressable
            onPress={onMicPress}
            onLongPress={toggleWakeWord}
            delayLongPress={600}
            android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: true }}
            style={({ pressed }) => [
              styles.fab,
              pressed && styles.fabPressed,
            ]}
          >
            <MaterialCommunityIcons name={fabIcon} size={26} color="#FFF" />
            {wakeWordEnabled && <View style={styles.wakeDot} />}
          </Pressable>
        </View>
      )}

      {/* ═══ Voice Interaction Modal ══════════════════════════════════════ */}
      <Modal
        visible={overlayVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={dismiss}
      >
        {/* backdrop — tap to dismiss */}
        <Pressable style={styles.backdrop} onPress={dismiss}>
          {/* card — catch taps so they don't dismiss */}
          <Pressable style={[styles.card, { paddingBottom: 20 + insets.bottom }]}>

            {/* close X */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={dismiss}
              hitSlop={12}
            >
              <MaterialCommunityIcons name="close" size={22} color="#888" />
            </TouchableOpacity>

            {/* ── status text ──────────────────────────────────────── */}
            <Text style={[styles.statusText, { color: cfg.color }]}>
              {cfg.text}
            </Text>

            {/* ── center visual ────────────────────────────────────── */}
            <View style={styles.centerArea}>
              {showWave ? (
                <WaveformBars active color={cfg.color} />
              ) : (
                <View style={[styles.iconCircle, { backgroundColor: cfg.color + '18' }]}>
                  <MaterialCommunityIcons
                    name={cfg.icon}
                    size={52}
                    color={cfg.color}
                  />
                </View>
              )}
            </View>

            {/* ── stop button (while listening) ────────────────────── */}
            {showStop && (
              <TouchableOpacity
                style={[styles.stopBtn, { backgroundColor: cfg.color }]}
                onPress={finishListening}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="stop" size={28} color="#FFF" />
                <Text style={styles.stopLabel}>Tap to stop</Text>
              </TouchableOpacity>
            )}

            {/* ── transcript ───────────────────────────────────────── */}
            {transcript ? (
              <View style={styles.textBox}>
                <Text style={styles.label}>🗣️  You said</Text>
                <Text style={styles.transcriptTxt}>{transcript}</Text>
              </View>
            ) : null}

            {/* ── response ─────────────────────────────────────────── */}
            {response ? (
              <View style={styles.textBox}>
                <Text style={styles.label}>🤖  ARIA</Text>
                <Text style={styles.responseTxt}>{response}</Text>
              </View>
            ) : null}

            {/* ── error ────────────────────────────────────────────── */}
            {error ? (
              <View style={[styles.textBox, { backgroundColor: '#FEE2E2' }]}>
                <Text style={[styles.responseTxt, { color: COLORS.warning }]}>
                  {error}
                </Text>
              </View>
            ) : null}

            {/* ── wake word toggle ─────────────────────────────────── */}
            <TouchableOpacity
              style={styles.wakeRow}
              onPress={toggleWakeWord}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={wakeWordEnabled ? 'ear-hearing' : 'ear-hearing-off'}
                size={18}
                color={wakeWordEnabled ? COLORS.accent : '#999'}
              />
              <Text
                style={[
                  styles.wakeTxt,
                  wakeWordEnabled && { color: COLORS.accent, fontWeight: '600' },
                ]}
              >
                {wakeWordEnabled ? '"Hi Aria" Active' : 'Enable "Hi Aria"'}
              </Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────────────── */

const FAB_SIZE = 56;

const styles = StyleSheet.create({
  /* FAB */
  fabWrap: {
    position: 'absolute',
    right: 18,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    width: FAB_SIZE + 20,
    height: FAB_SIZE + 20,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.95 }] },
  wakeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3B82F6',
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  pulseRing: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 3,
    borderColor: '#3B82F6',
  },

  /* modal backdrop */
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },

  /* card */
  card: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 18,
    minHeight: 340,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    zIndex: 10,
    padding: 4,
  },

  /* status */
  statusText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 8,
    letterSpacing: 0.3,
  },

  /* center visual */
  centerArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 100,
    marginVertical: 8,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* waveform */
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    gap: 6,
  },
  waveBar: {
    width: 6,
    borderRadius: 3,
  },

  /* stop button */
  stopBtn: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
    marginBottom: 12,
  },
  stopLabel: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },

  /* text sections */
  textBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 4,
    letterSpacing: 0.4,
  },
  transcriptTxt: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  responseTxt: {
    fontSize: 15,
    color: COLORS.primary,
    lineHeight: 22,
    fontWeight: '500',
  },

  /* wake toggle */
  wakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  wakeTxt: {
    fontSize: 13,
    color: '#888',
  },
});
