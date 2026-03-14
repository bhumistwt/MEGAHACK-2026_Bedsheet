/**
 * Khetwala-मित्र Network Context
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Global network connectivity state management using @react-native-community/netinfo.
 * Provides real-time connectivity status, backend reachability check,
 * and methods for screens/services to query network state.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { getBackendBaseUrl } from '../config/backend';

const NetworkContext = createContext(null);

// Backend health check interval (30 seconds)
const BACKEND_CHECK_INTERVAL_MS = 30_000;
// Quick retry after connectivity change
const BACKEND_QUICK_CHECK_MS = 2_000;

const BASE_URL = getBackendBaseUrl();

/**
 * NetworkProvider wraps the app and provides:
 * - isConnected: device has internet access
 * - isBackendReachable: backend API server responds to /health
 * - connectionType: wifi, cellular, etc.
 * - checkBackendNow(): force an immediate backend health check
 */
export function NetworkProvider({ children }) {
  const [isConnected, setIsConnected] = useState(true); // assume connected initially
  const [isBackendReachable, setIsBackendReachable] = useState(null); // null = unknown
  const [connectionType, setConnectionType] = useState('unknown');
  const [lastChecked, setLastChecked] = useState(null);
  const backendCheckTimer = useRef(null);
  const appState = useRef(AppState.currentState);

  // ─── Backend health check ──────────────────────────────────────────────
  const checkBackendNow = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${BASE_URL}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      const reachable = response.ok;
      setIsBackendReachable(reachable);
      setLastChecked(new Date().toISOString());
      return reachable;
    } catch (err) {
      setIsBackendReachable(false);
      setLastChecked(new Date().toISOString());
      return false;
    }
  }, []);

  // ─── Start periodic backend checks ────────────────────────────────────
  const startPeriodicCheck = useCallback(() => {
    if (backendCheckTimer.current) clearInterval(backendCheckTimer.current);
    backendCheckTimer.current = setInterval(() => {
      checkBackendNow();
    }, BACKEND_CHECK_INTERVAL_MS);
  }, [checkBackendNow]);

  const stopPeriodicCheck = useCallback(() => {
    if (backendCheckTimer.current) {
      clearInterval(backendCheckTimer.current);
      backendCheckTimer.current = null;
    }
  }, []);

  // ─── NetInfo listener ─────────────────────────────────────────────────
  useEffect(() => {
    // Initial fetch
    NetInfo.fetch().then((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
      setConnectionType(state.type || 'unknown');
      if (connected) {
        checkBackendNow();
        startPeriodicCheck();
      }
    });

    // Subscribe to connectivity changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
      setConnectionType(state.type || 'unknown');

      if (connected) {
        // When reconnected, quickly check backend
        setTimeout(() => checkBackendNow(), BACKEND_QUICK_CHECK_MS);
        startPeriodicCheck();
      } else {
        setIsBackendReachable(false);
        stopPeriodicCheck();
      }
    });

    return () => {
      unsubscribe();
      stopPeriodicCheck();
    };
  }, [checkBackendNow, startPeriodicCheck, stopPeriodicCheck]);

  // ─── AppState listener (pause checks when app backgrounded) ───────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        // App came to foreground — recheck
        checkBackendNow();
        startPeriodicCheck();
      } else if (nextState.match(/inactive|background/)) {
        stopPeriodicCheck();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [checkBackendNow, startPeriodicCheck, stopPeriodicCheck]);

  const value = {
    isConnected,
    isBackendReachable,
    connectionType,
    lastChecked,
    checkBackendNow,
    baseUrl: BASE_URL,
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

/**
 * Hook to access network state from any component.
 * @returns {{ isConnected, isBackendReachable, connectionType, lastChecked, checkBackendNow, baseUrl }}
 */
export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    // Graceful fallback if used outside provider
    return {
      isConnected: true,
      isBackendReachable: null,
      connectionType: 'unknown',
      lastChecked: null,
      checkBackendNow: async () => false,
      baseUrl: BASE_URL,
    };
  }
  return ctx;
}

export default NetworkContext;
