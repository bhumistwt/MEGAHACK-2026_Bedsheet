import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  NavigationContainer,
  DefaultTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Provider as PaperProvider, MD3LightTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import AlertsScreen from './src/screens/AlertsScreen';
import ARIAScreen from './src/screens/AriaScreen';
import CropInputScreen from './src/screens/CropInputScreen';
import DiseaseScreen from './src/screens/DiseaseScreen';
import HomeScreen from './src/screens/HomeScreen';
import MarketScreen from './src/screens/MarketScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import RecommendationScreen from './src/screens/RecommendationScreen';
import SchemesScreen from './src/screens/SchemesScreen';
import SpoilageScreen from './src/screens/SpoilageScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import DashboardScreen from './src/screens/DashboardScreen';
// ── F1-F17 New Feature Screens ──
import DigitalTwinScreen from './src/screens/DigitalTwinScreen';
import PhotoDiagnosticScreen from './src/screens/PhotoDiagnosticScreen';
import NegotiationSimulatorScreen from './src/screens/NegotiationSimulatorScreen';
import CropDiaryScreen from './src/screens/CropDiaryScreen';
import MarketplaceScreen from './src/screens/MarketplaceScreen';
import BuyerConnectScreen from './src/screens/BuyerConnectScreen';
import ColdStorageScreen from './src/screens/ColdStorageScreen';
import SoilHealthScreen from './src/screens/SoilHealthScreen';
import DealScreen from './src/screens/DealScreen';
import { COLORS, ELEVATION } from './src/theme/colors';
import { setupNotifications, showPermissionResult } from './src/services/notificationService';
import { AriaProvider } from './src/context/AriaContext';
import AriaOverlay from './src/components/AriaOverlay';
import { LanguageProvider } from './src/context/LanguageContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { NetworkProvider } from './src/context/NetworkContext';
import ConnectivityBanner from './src/components/ConnectivityBanner';

const navigationRef = createNavigationContainerRef();

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// ─── MD3 Paper Theme ──────────────────────────────────────────────────────────
const paperTheme = {
  ...MD3LightTheme,
  roundness: 12,
  colors: {
    ...MD3LightTheme.colors,
    primary: COLORS.primary,
    primaryContainer: COLORS.primaryContainer,
    secondary: COLORS.secondary,
    secondaryContainer: COLORS.secondaryContainer,
    tertiary: COLORS.tertiary,
    tertiaryContainer: COLORS.tertiaryContainer,
    background: COLORS.background,
    surface: COLORS.surface,
    surfaceVariant: COLORS.surfaceVariant,
    onSurface: COLORS.onSurface,
    onSurfaceVariant: COLORS.onSurfaceVariant,
    error: COLORS.error,
    errorContainer: COLORS.errorContainer,
    outline: COLORS.outline,
    outlineVariant: COLORS.outlineVariant,
  },
};

// ─── Navigation Theme ─────────────────────────────────────────────────────────
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: COLORS.primary,
    background: COLORS.background,
    card: COLORS.surface,
    text: COLORS.onSurface,
    border: COLORS.outlineVariant,
    notification: COLORS.error,
  },
};

const TAB_ICONS = {
  Home:    { active: 'home',        inactive: 'home-outline' },
  Market:  { active: 'chart-line',  inactive: 'chart-line-variant' },
  Disease: { active: 'leaf-circle', inactive: 'leaf-circle-outline' },
  ARIA:    { active: 'microphone',  inactive: 'microphone-outline' },
  Profile: { active: 'account-circle', inactive: 'account-circle-outline' },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.onSurfaceVariant,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.4,
        },
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 0,
          height: 68,
          paddingTop: 6,
          paddingBottom: 10,
          ...ELEVATION.level2,
        },
        tabBarIcon: ({ color, focused }) => {
          const icons = TAB_ICONS[route.name] || { active: 'circle', inactive: 'circle-outline' };
          return (
            <View style={focused ? {
              backgroundColor: COLORS.primaryContainer,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 4,
            } : undefined}>
              <MaterialCommunityIcons
                name={focused ? icons.active : icons.inactive}
                size={24}
                color={color}
              />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Market" component={MarketScreen} />
      <Tab.Screen name="Disease" component={DiseaseScreen} options={{ tabBarLabel: 'Scan' }} />
      <Tab.Screen name="ARIA" component={ARIAScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
        </>
      ) : (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
      <Stack.Screen name="CropInput" component={CropInputScreen} />
      <Stack.Screen name="Recommendation" component={RecommendationScreen} />
      <Stack.Screen name="Spoilage" component={SpoilageScreen} />
      <Stack.Screen name="Alerts" component={AlertsScreen} />
      <Stack.Screen name="Schemes" component={SchemesScreen} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      {/* F1-F17 New Feature Screens */}
      <Stack.Screen name="DigitalTwin" component={DigitalTwinScreen} />
      <Stack.Screen name="PhotoDiagnostic" component={PhotoDiagnosticScreen} />
      <Stack.Screen name="NegotiationSimulator" component={NegotiationSimulatorScreen} />
      <Stack.Screen name="CropDiary" component={CropDiaryScreen} />
      <Stack.Screen name="Marketplace" component={MarketplaceScreen} />
      <Stack.Screen name="BuyerConnect" component={BuyerConnectScreen} />
      <Stack.Screen name="ColdStorage" component={ColdStorageScreen} />
      <Stack.Screen name="SoilHealth" component={SoilHealthScreen} />
      <Stack.Screen name="Deals" component={DealScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  useEffect(() => {
    (async () => {
      const granted = await setupNotifications();
      showPermissionResult(granted);
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <LanguageProvider>
          <NetworkProvider>
            <AuthProvider>
              <AriaProvider navigationRef={navigationRef}>
                <NavigationContainer theme={navTheme} ref={navigationRef}>
                  <AppNavigator />
                  <AriaOverlay />
                  <ConnectivityBanner />
                </NavigationContainer>
              </AriaProvider>
            </AuthProvider>
          </NetworkProvider>
        </LanguageProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
