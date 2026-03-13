/**
 * Khetwala Design System — Material Design 3
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Color Palette: Nature-inspired green tones with warm neutrals
 * Typography: System default (San Francisco / Roboto) with clear hierarchy
 * Spacing: 8dp grid system
 * Elevation: MD3 shadow levels
 */

// ─── Color Tokens ────────────────────────────────────────────────────────────
export const COLORS = {
  // Primary (Deep Forest Green)
  primary:          '#1B5E20',
  primaryContainer: '#C8E6C9',
  onPrimary:        '#FFFFFF',
  onPrimaryContainer: '#0A3A0D',

  // Secondary (Teal)
  secondary:          '#00695C',
  secondaryContainer: '#B2DFDB',
  onSecondary:        '#FFFFFF',
  onSecondaryContainer: '#00251A',

  // Tertiary (Warm Amber)
  tertiary:          '#F57F17',
  tertiaryContainer: '#FFF9C4',
  onTertiary:        '#FFFFFF',
  onTertiaryContainer: '#3E2100',

  // Surface / Background
  background:       '#F6F7F9',
  surface:          '#FFFFFF',
  surfaceVariant:   '#F0F2F5',
  surfaceTint:      '#1B5E20',
  surfaceContainer: '#ECEEF1',
  surfaceContainerHigh: '#E2E4E7',
  surfaceContainerLow: '#F3F5F7',

  // Text / On-Surface
  onSurface:        '#1C1B1F',
  onSurfaceVariant: '#49454F',
  outline:          '#79747E',
  outlineVariant:   '#CAC4D0',

  // Error
  error:            '#BA1A1A',
  errorContainer:   '#FFDAD6',
  onError:          '#FFFFFF',
  onErrorContainer: '#410002',

  // Success
  success:          '#2E7D32',
  successContainer: '#C8E6C9',

  // Warning
  warning:          '#E65100',
  warningContainer: '#FFE0B2',

  // Info
  info:             '#0277BD',
  infoContainer:    '#B3E5FC',

  // Semantic aliases (backward compat)
  accent:           '#4CAF50',
  card:             '#FFFFFF',
  text:             '#1C1B1F',
  safe:             '#2E7D32',
  chain:            '#7B2FBE',

  // Scrim / overlay
  scrim:            '#000000',
  inverseSurface:   '#313033',
  inverseOnSurface: '#F4EFF4',
  inversePrimary:   '#A5D6A7',

  // Transparent helpers
  ripple:           'rgba(27, 94, 32, 0.12)',
  backdrop:         'rgba(0, 0, 0, 0.4)',
};

// ─── Typography Scale (MD3) ───────────────────────────────────────────────────
export const TYPOGRAPHY = {
  displayLarge:  { fontSize: 57, fontWeight: '400', lineHeight: 64, letterSpacing: -0.25 },
  displayMedium: { fontSize: 45, fontWeight: '400', lineHeight: 52 },
  displaySmall:  { fontSize: 36, fontWeight: '400', lineHeight: 44 },

  headlineLarge:  { fontSize: 32, fontWeight: '600', lineHeight: 40 },
  headlineMedium: { fontSize: 28, fontWeight: '600', lineHeight: 36 },
  headlineSmall:  { fontSize: 24, fontWeight: '600', lineHeight: 32 },

  titleLarge:  { fontSize: 22, fontWeight: '600', lineHeight: 28 },
  titleMedium: { fontSize: 16, fontWeight: '600', lineHeight: 24, letterSpacing: 0.15 },
  titleSmall:  { fontSize: 14, fontWeight: '600', lineHeight: 20, letterSpacing: 0.1 },

  bodyLarge:  { fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0.5 },
  bodyMedium: { fontSize: 14, fontWeight: '400', lineHeight: 20, letterSpacing: 0.25 },
  bodySmall:  { fontSize: 12, fontWeight: '400', lineHeight: 16, letterSpacing: 0.4 },

  labelLarge:  { fontSize: 14, fontWeight: '500', lineHeight: 20, letterSpacing: 0.1 },
  labelMedium: { fontSize: 12, fontWeight: '500', lineHeight: 16, letterSpacing: 0.5 },
  labelSmall:  { fontSize: 11, fontWeight: '500', lineHeight: 16, letterSpacing: 0.5 },
};

// ─── Spacing (8dp grid) ───────────────────────────────────────────────────────
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Border Radius ────────────────────────────────────────────────────────────
export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 999,
};

// ─── Elevation / Shadows (MD3) ────────────────────────────────────────────────
export const ELEVATION = {
  level0: {},
  level1: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  level2: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  level3: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  level4: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
};
