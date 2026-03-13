/**
 * Khetwala-मित्र Connectivity Banner
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Global banner that appears at the top of the app when:
 * 1. Device has no internet connection
 * 2. Device has internet but backend is unreachable
 *
 * Automatically dismisses when connectivity is restored.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetwork } from '../context/NetworkContext';
import { useLanguage } from '../context/LanguageContext';

export default function ConnectivityBanner() {
  const { isConnected, isBackendReachable, checkBackendNow, connectionType } = useNetwork();
  const { t } = useLanguage();
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const isVisible = useRef(false);

  // Determine banner state
  const noInternet = !isConnected;
  const serverDown = isConnected && isBackendReachable === false;
  const showBanner = noInternet || serverDown;

  useEffect(() => {
    if (showBanner && !isVisible.current) {
      isVisible.current = true;
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else if (!showBanner && isVisible.current) {
      isVisible.current = false;
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [showBanner, slideAnim]);

  const getMessage = () => {
    if (noInternet) {
      return {
        icon: 'wifi-off',
        text: t('connectivity.noInternet') || '📵 No internet connection',
        subtext: t('connectivity.noInternetSub') || 'Check your WiFi or mobile data',
        color: '#C62828',
        bg: '#FFEBEE',
      };
    }
    if (serverDown) {
      return {
        icon: 'server-off',
        text: t('connectivity.serverDown') || '🔌 Server unreachable',
        subtext: t('connectivity.serverDownSub') || 'Backend not responding. Using cached data.',
        color: '#E65100',
        bg: '#FFF3E0',
      };
    }
    return null;
  };

  const info = getMessage();
  if (!info) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: info.bg, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.content}>
        <MaterialCommunityIcons name={info.icon} size={22} color={info.color} />
        <View style={styles.textWrap}>
          <Text style={[styles.mainText, { color: info.color }]}>{info.text}</Text>
          <Text style={styles.subText}>{info.subtext}</Text>
        </View>
        {serverDown && (
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: info.color }]}
            onPress={checkBackendNow}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="refresh" size={16} color={info.color} />
            <Text style={[styles.retryText, { color: info.color }]}>
              {t('connectivity.retry') || 'Retry'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {connectionType !== 'unknown' && (
        <Text style={styles.typeText}>
          {connectionType === 'wifi' ? '📶 WiFi' : connectionType === 'cellular' ? '📱 Mobile Data' : connectionType}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: 40, // account for status bar
    paddingBottom: 10,
    paddingHorizontal: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textWrap: {
    flex: 1,
    marginLeft: 10,
  },
  mainText: {
    fontSize: 14,
    fontWeight: '700',
  },
  subText: {
    fontSize: 12,
    color: '#666',
    marginTop: 1,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  typeText: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    textAlign: 'right',
  },
});
