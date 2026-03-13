/**
 * DealScreen — Blockchain Trust Dashboard
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Farmer-friendly view of blockchain-anchored deals.
 * Zero blockchain terminology — farmer sees only:
 *   • Deal Confirmed ✅
 *   • Payment Locked 🔒
 *   • Money Released 💰
 *
 * Tabs:
 *   1. My Deals   — active / past trade agreements
 *   2. Proofs     — AI recommendation audit trail
 *   3. Stats      — trust score & volume
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import {
  fetchBlockchainStats,
  fetchUserTrades,
  fetchUserProofs,
  fetchTradeStatus,
  confirmTradeDelivery,
  lockTradeEscrow,
  releaseTradeEscrow,
} from '../services/apiService';


// ═══════════════════════════════════════════════════════════════════════════════
// Status Badge Component
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status, label }) {
  const colors = {
    'confirmed':  { bg: '#E8F5E9', text: '#2E7D32' },
    'delivered':  { bg: '#E3F2FD', text: '#1565C0' },
    'locked':     { bg: '#FFF3E0', text: '#E65100' },
    'released':   { bg: '#E8F5E9', text: '#1B5E20' },
    'created':    { bg: '#F3E5F5', text: '#6A1B9A' },
    'cancelled':  { bg: '#FFEBEE', text: '#C62828' },
    'disputed':   { bg: '#FFF9C4', text: '#F57F17' },
    'simulated':  { bg: '#E0F7FA', text: '#00838F' },
    'pending':    { bg: '#FFF8E1', text: '#FF8F00' },
    'penalized':  { bg: '#FCE4EC', text: '#AD1457' },
    'refunded':   { bg: '#E0E0E0', text: '#424242' },
  };
  const c = colors[status] || { bg: '#F5F5F5', text: '#757575' };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{label || status}</Text>
    </View>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Deal Card Component
// ═══════════════════════════════════════════════════════════════════════════════

function DealCard({ trade, onViewDetails, onAction, t }) {
  return (
    <View style={styles.dealCard}>
      <View style={styles.dealHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dealCrop}>
            {trade.crop?.charAt(0).toUpperCase() + trade.crop?.slice(1)}
          </Text>
          <Text style={styles.dealMeta}>
            {trade.quantity_kg} kg  ×  ₹{trade.price_per_kg}/kg
          </Text>
        </View>
        <StatusBadge status={trade.status} label={trade.farmer_status} />
      </View>

      <View style={styles.dealBody}>
        <View style={styles.dealRow}>
          <Text style={styles.dealLabel}>{t('deals.totalAmount')}</Text>
          <Text style={styles.dealValue}>₹{trade.total_amount?.toLocaleString('en-IN')}</Text>
        </View>
        {trade.quality_grade && (
          <View style={styles.dealRow}>
            <Text style={styles.dealLabel}>{t('deals.grade')}</Text>
            <Text style={styles.dealValue}>Grade {trade.quality_grade}</Text>
          </View>
        )}
        <View style={styles.dealRow}>
          <Text style={styles.dealLabel}>{t('deals.role')}</Text>
          <Text style={styles.dealValue}>
            {trade.role === 'seller' ? t('deals.seller') : t('deals.buyer')}
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.dealActions}>
        {trade.explorer_url && (
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => Linking.openURL(trade.explorer_url)}
          >
            <MaterialCommunityIcons name="open-in-new" size={14} color={COLORS.primary} />
            <Text style={styles.linkBtnText}>{t('deals.viewOnChain')}</Text>
          </TouchableOpacity>
        )}
        {trade.status === 'confirmed' && trade.role === 'seller' && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onAction('confirm_delivery', trade.trade_id)}
          >
            <MaterialCommunityIcons name="truck-check" size={16} color="#FFF" />
            <Text style={styles.actionBtnText}>{t('deals.confirmDelivery')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {trade.created_at && (
        <Text style={styles.dealDate}>
          {new Date(trade.created_at).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
          })}
        </Text>
      )}
    </View>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Proof Card Component
// ═══════════════════════════════════════════════════════════════════════════════

function ProofCard({ proof, t }) {
  return (
    <View style={styles.proofCard}>
      <View style={styles.proofHeader}>
        <MaterialCommunityIcons name="shield-check" size={20} color={COLORS.primary} />
        <Text style={styles.proofCrop}>
          {proof.crop?.charAt(0).toUpperCase() + proof.crop?.slice(1)}
        </Text>
        <StatusBadge status={proof.status} label={proof.status} />
      </View>
      <View style={styles.proofBody}>
        <Text style={styles.proofMeta}>
          {t('deals.region')}: {proof.region}  •  v{proof.model_version}
        </Text>
        {proof.created_at && (
          <Text style={styles.proofDate}>
            {new Date(proof.created_at).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </Text>
        )}
      </View>
      {proof.explorer_url && (
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openURL(proof.explorer_url)}
        >
          <MaterialCommunityIcons name="open-in-new" size={14} color={COLORS.primary} />
          <Text style={styles.linkBtnText}>{t('deals.viewProof')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════════════════════════════════

export default function DealScreen({ navigation }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const userId = user?.id || 1;

  const [tab, setTab] = useState('deals');
  const [trades, setTrades] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  // ─── Data Fetching ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [tradeData, proofData, statsData] = await Promise.all([
        fetchUserTrades(userId),
        fetchUserProofs(userId),
        fetchBlockchainStats(userId),
      ]);
      setTrades(tradeData);
      setProofs(proofData);
      setStats(statsData);
    } catch (e) {
      console.warn('[DealScreen] load failed:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // ─── Trade Actions ─────────────────────────────────────────────────────

  const handleAction = useCallback(async (action, tradeId) => {
    setActionLoading(tradeId);
    try {
      if (action === 'confirm_delivery') {
        await confirmTradeDelivery(tradeId);
      } else if (action === 'lock_escrow') {
        await lockTradeEscrow(tradeId);
      } else if (action === 'release_escrow') {
        await releaseTradeEscrow(tradeId);
      }
      await loadData(); // Refresh after action
    } catch (e) {
      console.warn(`[DealScreen] action ${action} failed:`, e?.message);
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  // ─── Render ────────────────────────────────────────────────────────────

  const TABS = [
    { key: 'deals', icon: 'handshake', label: t('deals.tabDeals') },
    { key: 'proofs', icon: 'shield-check', label: t('deals.tabProofs') },
    { key: 'stats', icon: 'chart-box', label: t('deals.tabStats') },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('deals.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tb) => (
          <TouchableOpacity
            key={tb.key}
            style={[styles.tab, tab === tb.key && styles.tabActive]}
            onPress={() => setTab(tb.key)}
          >
            <MaterialCommunityIcons
              name={tb.icon}
              size={18}
              color={tab === tb.key ? COLORS.primary : COLORS.outline}
            />
            <Text style={[styles.tabText, tab === tb.key && styles.tabTextActive]}>
              {tb.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── DEALS TAB ── */}
          {tab === 'deals' && (
            <View style={{ padding: SPACING.md }}>
              {trades.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="handshake-outline" size={48} color={COLORS.outline} />
                  <Text style={styles.emptyText}>{t('deals.noDeals')}</Text>
                  <Text style={styles.emptySubtext}>{t('deals.noDealsHint')}</Text>
                </View>
              ) : (
                trades.map((trade) => (
                  <DealCard
                    key={trade.trade_id}
                    trade={trade}
                    onAction={handleAction}
                    t={t}
                  />
                ))
              )}
            </View>
          )}

          {/* ── PROOFS TAB ── */}
          {tab === 'proofs' && (
            <View style={{ padding: SPACING.md }}>
              {proofs.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="shield-outline" size={48} color={COLORS.outline} />
                  <Text style={styles.emptyText}>{t('deals.noProofs')}</Text>
                  <Text style={styles.emptySubtext}>{t('deals.noProofsHint')}</Text>
                </View>
              ) : (
                proofs.map((proof) => (
                  <ProofCard key={proof.proof_id} proof={proof} t={t} />
                ))
              )}
            </View>
          )}

          {/* ── STATS TAB ── */}
          {tab === 'stats' && stats && (
            <View style={{ padding: SPACING.md }}>
              {/* Network status */}
              <View style={styles.networkCard}>
                <View style={styles.networkDot(stats.blockchain_live)} />
                <Text style={styles.networkText}>
                  {stats.network} — {stats.blockchain_live ? t('deals.connected') : t('deals.simulation')}
                </Text>
              </View>

              {/* Stats grid */}
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <MaterialCommunityIcons name="handshake" size={28} color={COLORS.primary} />
                  <Text style={styles.statNumber}>{stats.trades}</Text>
                  <Text style={styles.statLabel}>{t('deals.totalTrades')}</Text>
                </View>
                <View style={styles.statCard}>
                  <MaterialCommunityIcons name="shield-check" size={28} color="#4CAF50" />
                  <Text style={styles.statNumber}>{stats.proofs}</Text>
                  <Text style={styles.statLabel}>{t('deals.totalProofs')}</Text>
                </View>
                <View style={styles.statCard}>
                  <MaterialCommunityIcons name="cash-multiple" size={28} color="#FF9800" />
                  <Text style={styles.statNumber}>₹{(stats.total_volume || 0).toLocaleString('en-IN')}</Text>
                  <Text style={styles.statLabel}>{t('deals.volumeTraded')}</Text>
                </View>
                <View style={styles.statCard}>
                  <MaterialCommunityIcons name="lock" size={28} color="#E91E63" />
                  <Text style={styles.statNumber}>₹{(stats.locked_amount || 0).toLocaleString('en-IN')}</Text>
                  <Text style={styles.statLabel}>{t('deals.lockedInEscrow')}</Text>
                </View>
              </View>

              {/* Trust explanation */}
              <View style={styles.trustCard}>
                <MaterialCommunityIcons name="information-outline" size={20} color={COLORS.primary} />
                <Text style={styles.trustText}>{t('deals.trustExplainer')}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
  },
  headerTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: '#FFF',
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    ...ELEVATION.small,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.outline,
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  // ─── Deal Card ─────────────────────────────────────────────────────────
  dealCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...ELEVATION.small,
  },
  dealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dealCrop: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  dealMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.outline,
    marginTop: 2,
  },
  dealBody: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 8,
  },
  dealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  dealLabel: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.outline,
  },
  dealValue: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.onSurface,
  },
  dealActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  dealDate: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.outline,
    marginTop: 6,
    textAlign: 'right',
  },

  // ─── Proof Card ────────────────────────────────────────────────────────
  proofCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    ...ELEVATION.small,
  },
  proofHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  proofCrop: {
    ...TYPOGRAPHY.titleSmall,
    fontWeight: '700',
    flex: 1,
    color: COLORS.onSurface,
  },
  proofBody: {
    marginTop: 4,
  },
  proofMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.outline,
  },
  proofDate: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.outline,
    marginTop: 4,
  },

  // ─── Stats ─────────────────────────────────────────────────────────────
  networkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    ...ELEVATION.small,
  },
  networkDot: (live) => ({
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: live ? '#4CAF50' : '#FF9800',
    marginRight: 8,
  }),
  networkText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurface,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  statCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    ...ELEVATION.small,
  },
  statNumber: {
    ...TYPOGRAPHY.headlineSmall,
    fontWeight: '700',
    color: COLORS.onSurface,
    marginTop: 6,
  },
  statLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.outline,
    marginTop: 2,
    textAlign: 'center',
  },
  trustCard: {
    flexDirection: 'row',
    backgroundColor: '#E8F5E9',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    gap: 8,
    alignItems: 'flex-start',
  },
  trustText: {
    ...TYPOGRAPHY.bodySmall,
    color: '#2E7D32',
    flex: 1,
    lineHeight: 18,
  },

  // ─── Buttons ───────────────────────────────────────────────────────────
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F3E5F5',
    borderRadius: RADIUS.sm,
  },
  linkBtnText: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.primary,
    fontWeight: '600',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
  },
  actionBtnText: {
    ...TYPOGRAPHY.labelSmall,
    color: '#FFF',
    fontWeight: '600',
  },

  // ─── Badge ─────────────────────────────────────────────────────────────
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: '700',
    fontSize: 11,
  },

  // ─── Empty State ───────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    ...TYPOGRAPHY.titleMedium,
    color: COLORS.outline,
    marginTop: 12,
  },
  emptySubtext: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.outline,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
