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
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
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
  fetchDealMessages,
  sendDealMessage,
  startDealCall,
  fetchDealCalls,
  requestDealConnection,
  markDealMessagesRead,
  requestAIVoiceCall,
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

function DealCard({ trade, onOpenComm, onAction, t, isCommActive }) {
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
        <TouchableOpacity
          style={[styles.linkBtn, isCommActive && styles.commBtnActive]}
          onPress={() => onOpenComm(trade.trade_id)}
        >
          <MaterialCommunityIcons name="chat-processing" size={14} color={COLORS.primary} />
          <Text style={styles.linkBtnText}>{t('deals.openComm')}</Text>
        </TouchableOpacity>
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
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const userId = user?.id || 1;

  const normalizeDialablePhone = useCallback((rawPhone) => {
    const raw = String(rawPhone || '').trim();
    if (!raw) return null;
    if (raw.startsWith('+')) {
      const cleaned = `+${raw.slice(1).replace(/\D/g, '')}`;
      return cleaned.length >= 11 ? cleaned : null;
    }
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length >= 11) return `+${digits}`;
    return null;
  }, []);

  const [tab, setTab] = useState('deals');
  const [trades, setTrades] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedTradeId, setSelectedTradeId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [commLoading, setCommLoading] = useState(false);
  const [connectionStatusByTrade, setConnectionStatusByTrade] = useState({});
  const [aiCallLoading, setAICallLoading] = useState(false);

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

  const loadCommunication = useCallback(async (tradeId) => {
    setCommLoading(true);
    try {
      const [msgs, calls] = await Promise.all([
        fetchDealMessages(tradeId),
        fetchDealCalls(tradeId),
      ]);
      setMessages(msgs || []);
      setCallLogs(calls || []);
      await markDealMessagesRead(tradeId);
      if ((msgs || []).length > 0 || (calls || []).length > 0) {
        setConnectionStatusByTrade((prev) => ({ ...prev, [tradeId]: 'connected' }));
      }
    } catch (e) {
      console.warn('[DealScreen] load communication failed:', e?.message);
    } finally {
      setCommLoading(false);
    }
  }, []);

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

  const handleOpenCommunication = useCallback(async (tradeId) => {
    setSelectedTradeId(tradeId);
    await loadCommunication(tradeId);
  }, [loadCommunication]);

  const handleRequestConnection = useCallback(async (tradeId) => {
    const result = await requestDealConnection(tradeId);
    if (!result) {
      Alert.alert(t('common.error'), t('deals.connectionFailed'));
      return;
    }

    if (result.already_connected) {
      setConnectionStatusByTrade((prev) => ({ ...prev, [tradeId]: 'connected' }));
      Alert.alert(t('common.ok'), t('deals.alreadyConnected'));
      return;
    }

    setConnectionStatusByTrade((prev) => ({ ...prev, [tradeId]: 'requested' }));
    Alert.alert(t('common.ok'), t('deals.connectionRequested'));
  }, [t]);

  const handleSendMessage = useCallback(async () => {
    if (!selectedTradeId || !messageInput.trim()) return;

    const sent = await sendDealMessage(selectedTradeId, messageInput.trim());
    if (!sent) {
      Alert.alert(t('common.error'), t('deals.messageFailed'));
      return;
    }

    setMessageInput('');
    await loadCommunication(selectedTradeId);
  }, [selectedTradeId, messageInput, loadCommunication, t]);

  const handleStartCall = useCallback(async (callType) => {
    if (!selectedTradeId) return;
    const call = await startDealCall(selectedTradeId, callType);
    if (!call?.room_url) {
      Alert.alert(t('common.error'), t('deals.callFailed'));
      return;
    }
    setConnectionStatusByTrade((prev) => ({ ...prev, [selectedTradeId]: 'connected' }));
    await loadCommunication(selectedTradeId);
    Linking.openURL(call.room_url);
  }, [selectedTradeId, loadCommunication, t]);

  const handleStartAICall = useCallback(async () => {
    setAICallLoading(true);
    try {
      const toPhone = normalizeDialablePhone(user?.phone);
      if (!toPhone) {
        Alert.alert(t('common.error'), t('deals.aiCallPhoneMissing'));
        return;
      }

      const result = await requestAIVoiceCall({
        toPhone,
        userId: Number.isFinite(Number(userId)) ? Number(userId) : undefined,
        languageCode: language || 'en',
        initialPrompt: 'Farmer requested AI assistance call from Deal section.',
      });

      if (!result?.ok) {
        Alert.alert(t('common.error'), t('deals.aiCallFailed'));
        return;
      }

      Alert.alert(t('common.ok'), t('deals.aiCallRequested'));
    } finally {
      setAICallLoading(false);
    }
  }, [language, normalizeDialablePhone, t, user?.phone, userId]);

  const selectedTrade = trades.find((item) => item.trade_id === selectedTradeId) || null;

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
                    onOpenComm={handleOpenCommunication}
                    onAction={handleAction}
                    t={t}
                    isCommActive={selectedTradeId === trade.trade_id}
                  />
                ))
              )}

              {selectedTrade && (
                <View style={styles.commPanel}>
                  <View style={styles.commHeader}>
                    <Text style={styles.commTitle}>{t('deals.communication')}</Text>
                    <StatusBadge
                      status={connectionStatusByTrade[selectedTrade.trade_id] || 'pending'}
                      label={
                        connectionStatusByTrade[selectedTrade.trade_id] === 'connected'
                          ? t('deals.connected')
                          : connectionStatusByTrade[selectedTrade.trade_id] === 'requested'
                            ? t('deals.requested')
                            : t('deals.pendingConnection')
                      }
                    />
                  </View>

                  <Text style={styles.commSubtext}>{t('deals.verifiedChannel')}</Text>

                  <View style={styles.commActionRow}>
                    <TouchableOpacity
                      style={styles.actionBtnSecondary}
                      onPress={() => handleRequestConnection(selectedTrade.trade_id)}
                    >
                      <MaterialCommunityIcons name="account-plus" size={16} color={COLORS.primary} />
                      <Text style={styles.actionBtnSecondaryText}>{t('deals.connect')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionBtnSecondary}
                      onPress={() => handleStartCall('audio')}
                    >
                      <MaterialCommunityIcons name="phone" size={16} color={COLORS.primary} />
                      <Text style={styles.actionBtnSecondaryText}>{t('deals.audioCall')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionBtnSecondary}
                      onPress={() => handleStartCall('video')}
                    >
                      <MaterialCommunityIcons name="video" size={16} color={COLORS.primary} />
                      <Text style={styles.actionBtnSecondaryText}>{t('deals.videoCall')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionBtnSecondary, aiCallLoading && styles.actionBtnDisabled]}
                      onPress={handleStartAICall}
                      disabled={aiCallLoading}
                    >
                      <MaterialCommunityIcons
                        name={aiCallLoading ? 'progress-clock' : 'robot-happy-outline'}
                        size={16}
                        color={COLORS.primary}
                      />
                      <Text style={styles.actionBtnSecondaryText}>
                        {aiCallLoading ? t('deals.calling') : t('deals.aiCall')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.commSection}>
                    <Text style={styles.commSectionTitle}>{t('deals.chat')}</Text>
                    {commLoading ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : messages.length === 0 ? (
                      <Text style={styles.emptySubtext}>{t('deals.noMessages')}</Text>
                    ) : (
                      messages.slice(-10).map((msg) => (
                        <View
                          key={msg.id}
                          style={[
                            styles.messageBubble,
                            msg.sender_id === userId ? styles.messageMine : styles.messageOther,
                          ]}
                        >
                          <Text style={styles.messageText}>{msg.message_text}</Text>
                          <Text style={styles.messageMeta}>{msg.status}</Text>
                        </View>
                      ))
                    )}

                    <View style={styles.messageInputRow}>
                      <TextInput
                        style={styles.messageInput}
                        value={messageInput}
                        onChangeText={setMessageInput}
                        placeholder={t('deals.typeMessage')}
                        placeholderTextColor={COLORS.outline}
                      />
                      <TouchableOpacity style={styles.actionBtn} onPress={handleSendMessage}>
                        <MaterialCommunityIcons name="send" size={16} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.commSection}>
                    <Text style={styles.commSectionTitle}>{t('deals.callHistory')}</Text>
                    {callLogs.length === 0 ? (
                      <Text style={styles.emptySubtext}>{t('deals.noCalls')}</Text>
                    ) : (
                      callLogs.slice(0, 5).map((call) => (
                        <View key={call.id} style={styles.callRow}>
                          <MaterialCommunityIcons
                            name={call.call_type === 'video' ? 'video' : 'phone'}
                            size={15}
                            color={COLORS.primary}
                          />
                          <Text style={styles.callText}>
                            {call.call_type} • {call.call_status}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
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
  commBtnActive: {
    borderWidth: 1,
    borderColor: COLORS.primary,
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
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionBtnDisabled: {
    opacity: 0.7,
  },
  actionBtnSecondaryText: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // ─── Communication ────────────────────────────────────────────
  commPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...ELEVATION.small,
  },
  commHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commTitle: {
    ...TYPOGRAPHY.titleSmall,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  commSubtext: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.outline,
    marginTop: 6,
  },
  commActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.sm,
    flexWrap: 'wrap',
  },
  commSection: {
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.outlineVariant,
    paddingTop: SPACING.sm,
  },
  commSectionTitle: {
    ...TYPOGRAPHY.labelMedium,
    color: COLORS.onSurface,
    fontWeight: '700',
    marginBottom: 8,
  },
  messageBubble: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS.md,
    marginBottom: 6,
    maxWidth: '90%',
  },
  messageMine: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.infoContainer,
  },
  messageOther: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surfaceVariant,
  },
  messageText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurface,
  },
  messageMeta: {
    ...TYPOGRAPHY.labelSmall,
    color: COLORS.outline,
    marginTop: 2,
  },
  messageInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.outlineVariant,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: COLORS.onSurface,
  },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  callText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.onSurface,
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
