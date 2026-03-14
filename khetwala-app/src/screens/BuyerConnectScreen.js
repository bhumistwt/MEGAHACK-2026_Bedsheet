/**
 * [F13] Buyer Connect (B2B) Screen
 * Buyer orders listing and farmer interest expression
 * Material Design 3
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const BASE_URL = getBackendBaseUrl();

const STATUS_COLORS = {
  open: '#4CAF50', partially_filled: '#FF9800', fulfilled: '#2196F3', closed: '#9E9E9E',
};

const MOCK_ORDERS = [
  { id: 1, buyer_name: 'FreshBasket Retail', crop: 'Onion', quantity_quintals: 100, price_per_quintal: 2800, district: 'Nashik', delivery_date: '2025-02-15', quality_requirements: 'A-grade, 45-65mm', status: 'open', expressions_count: 3 },
  { id: 2, buyer_name: 'Taj Hotel Mumbai', crop: 'Tomato', quantity_quintals: 20, price_per_quintal: 4500, district: 'Nashik', delivery_date: '2025-02-10', quality_requirements: 'Premium, vine-ripened', status: 'open', expressions_count: 1 },
  { id: 3, buyer_name: 'MahaFood Processing', crop: 'Onion', quantity_quintals: 500, price_per_quintal: 2500, district: 'Nashik', delivery_date: '2025-03-01', quality_requirements: 'Dehydration-grade, any size', status: 'partially_filled', expressions_count: 8 },
  { id: 4, buyer_name: 'Reliance Fresh', crop: 'Potato', quantity_quintals: 200, price_per_quintal: 1800, district: 'Pune', delivery_date: '2025-02-20', quality_requirements: 'Medium size, no green', status: 'open', expressions_count: 2 },
];

const MOCK_MY_EXPRESSIONS = [
  { order_id: 1, buyer_name: 'FreshBasket Retail', crop: 'Onion', quantity_offered: 15, status: 'pending', created_at: '2025-01-20T10:00:00' },
];

export default function BuyerConnectScreen({ navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [orders, setOrders] = useState([]);
  const [myExpressions, setMyExpressions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('orders');
  const [showModal, setShowModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [quantityOffered, setQuantityOffered] = useState('');
  const [filterCrop, setFilterCrop] = useState('');

  const fetchOrders = useCallback(async () => {
    try {
      const url = filterCrop
        ? `${BASE_URL}/b2b/orders?crop=${filterCrop}`
        : `${BASE_URL}/b2b/orders`;
      const resp = await fetch(url);
      const data = await resp.json();
      setOrders(data.orders || []);
    } catch (e) {
      setOrders(MOCK_ORDERS);
    } finally { setLoading(false); setRefreshing(false); }
  }, [filterCrop]);

  const fetchMyExpressions = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/b2b/my-expressions/${user?.id || 1}`);
      const data = await resp.json();
      setMyExpressions(data.expressions || []);
    } catch (e) {
      setMyExpressions(MOCK_MY_EXPRESSIONS);
    }
  };

  useEffect(() => { fetchOrders(); fetchMyExpressions(); }, [fetchOrders]);

  const onRefresh = () => { setRefreshing(true); fetchOrders(); };

  const expressInterest = async () => {
    if (!selectedOrder || !quantityOffered) return;
    try {
      await fetch(`${BASE_URL}/b2b/express-interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          user_id: user?.id || 1,
          quantity_offered: parseFloat(quantityOffered),
        }),
      });
    } catch (e) {
      setMyExpressions(prev => [...prev, {
        order_id: selectedOrder.id, buyer_name: selectedOrder.buyer_name,
        crop: selectedOrder.crop, quantity_offered: parseFloat(quantityOffered),
        status: 'pending', created_at: new Date().toISOString(),
      }]);
    }
    setShowModal(false);
    setQuantityOffered('');
    fetchMyExpressions();
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const daysUntil = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    return Math.max(0, Math.ceil((d - now) / (1000 * 60 * 60 * 24)));
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D47A1" />
      <View style={[styles.header, { backgroundColor: '#0D47A1' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>🏢 Buyer Connect</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['orders', 'my-interest'].map(t2 => (
          <TouchableOpacity key={t2} style={[styles.tabBtn, tab === t2 && styles.tabActive]}
            onPress={() => setTab(t2)}>
            <Text style={[styles.tabText, tab === t2 && styles.tabTextActive]}>
              {t2 === 'orders' ? '📋 Buyer Orders' : '✋ My Interest'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

          {/* ── ORDERS TAB ── */}
          {tab === 'orders' && (
            <View style={{ padding: SPACING.md }}>
              {/* Crop filter */}
              <View style={styles.filterRow}>
                {['', 'Onion', 'Tomato', 'Potato'].map(crop => (
                  <TouchableOpacity key={crop}
                    style={[styles.filterChip, filterCrop === crop && styles.filterChipActive]}
                    onPress={() => setFilterCrop(crop)}>
                    <Text style={[styles.filterText, filterCrop === crop && styles.filterTextActive]}>
                      {crop || 'All'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {orders.map(order => (
                <View key={order.id} style={styles.orderCard}>
                  {/* Status badge */}
                  <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] || '#999') + '15' }]}>
                    <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[order.status] }]} />
                    <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] }]}>
                      {order.status.replace('_', ' ')}
                    </Text>
                  </View>

                  <Text style={styles.buyerName}>{order.buyer_name}</Text>

                  <View style={styles.orderDetails}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Crop</Text>
                      <Text style={styles.detailValue}>{order.crop}</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Quantity</Text>
                      <Text style={styles.detailValue}>{order.quantity_quintals}q</Text>
                    </View>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Price</Text>
                      <Text style={[styles.detailValue, { color: COLORS.primary }]}>₹{order.price_per_quintal}/q</Text>
                    </View>
                  </View>

                  <View style={styles.orderMetaRow}>
                    <MaterialCommunityIcons name="calendar" size={16} color={COLORS.onSurfaceVariant} />
                    <Text style={styles.orderMeta}> Delivery: {formatDate(order.delivery_date)} ({daysUntil(order.delivery_date)} days)</Text>
                  </View>

                  {order.quality_requirements && (
                    <View style={styles.orderMetaRow}>
                      <MaterialCommunityIcons name="check-decagram" size={16} color={COLORS.tertiary} />
                      <Text style={styles.orderMeta}> {order.quality_requirements}</Text>
                    </View>
                  )}

                  <View style={styles.orderFooter}>
                    <Text style={styles.expressionCount}>
                      {order.expressions_count || 0} farmers interested
                    </Text>
                    {order.status === 'open' && (
                      <TouchableOpacity style={styles.interestBtn}
                        onPress={() => { setSelectedOrder(order); setShowModal(true); }}>
                        <Text style={styles.interestBtnText}>Express Interest</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── MY INTEREST TAB ── */}
          {tab === 'my-interest' && (
            <View style={{ padding: SPACING.md }}>
              {myExpressions.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={{ fontSize: 48 }}>🤝</Text>
                  <Text style={styles.emptyTitle}>No Interest Expressed</Text>
                  <Text style={styles.emptyText}>Browse buyer orders and express interest to start selling directly.</Text>
                </View>
              ) : (
                myExpressions.map((expr, i) => (
                  <View key={i} style={styles.exprCard}>
                    <View style={styles.exprHeader}>
                      <MaterialCommunityIcons name="store" size={24} color={COLORS.primary} />
                      <View style={{ flex: 1, marginLeft: SPACING.md }}>
                        <Text style={styles.exprBuyer}>{expr.buyer_name}</Text>
                        <Text style={styles.exprCrop}>{expr.crop} • {expr.quantity_offered}q offered</Text>
                      </View>
                      <View style={[styles.exprStatus, { backgroundColor: expr.status === 'accepted' ? '#4CAF5015' : '#FF980015' }]}>
                        <Text style={[styles.exprStatusText, { color: expr.status === 'accepted' ? '#4CAF50' : '#FF9800' }]}>
                          {expr.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.exprDate}>Expressed on {formatDate(expr.created_at)}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      )}

      {/* ── EXPRESS INTEREST MODAL ── */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Express Interest</Text>
            {selectedOrder && (
              <>
                <View style={styles.modalOrderInfo}>
                  <Text style={styles.modalBuyer}>{selectedOrder.buyer_name}</Text>
                  <Text style={styles.modalCrop}>{selectedOrder.crop} @ ₹{selectedOrder.price_per_quintal}/q</Text>
                  <Text style={styles.modalQty}>Need: {selectedOrder.quantity_quintals} quintals</Text>
                </View>

                <Text style={styles.formLabel}>How much can you supply? (quintals)</Text>
                <TextInput style={styles.formInput} value={quantityOffered}
                  onChangeText={setQuantityOffered} keyboardType="numeric"
                  placeholder={`Max ${selectedOrder.quantity_quintals} quintals`} />

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={expressInterest}>
                    <Text style={styles.saveBtnText}>Submit Interest</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: 48, paddingBottom: 16, paddingHorizontal: SPACING.lg,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { marginRight: SPACING.md },
  headerTitle: { ...TYPOGRAPHY.titleLarge, flex: 1 },
  tabRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md, ...ELEVATION.level1,
  },
  tabBtn: { flex: 1, paddingVertical: SPACING.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant },
  tabTextActive: { color: COLORS.primary },
  filterRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  filterChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.outlineVariant,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant },
  filterTextActive: { color: COLORS.onPrimary },
  orderCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm, marginBottom: SPACING.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { ...TYPOGRAPHY.labelSmall, fontWeight: '600', textTransform: 'capitalize' },
  buyerName: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  orderDetails: {
    flexDirection: 'row', marginTop: SPACING.md, gap: SPACING.md,
    backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md, padding: SPACING.md,
  },
  detailItem: { flex: 1, alignItems: 'center' },
  detailLabel: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant },
  detailValue: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface, fontWeight: '700', marginTop: 2 },
  orderMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm },
  orderMeta: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  orderFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.outlineVariant,
  },
  expressionCount: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant },
  interestBtn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.md },
  interestBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onPrimary },
  emptyCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xxl,
    alignItems: 'center', ...ELEVATION.level2,
  },
  emptyTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, marginTop: SPACING.md },
  emptyText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant, textAlign: 'center', marginTop: SPACING.sm },
  exprCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  exprHeader: { flexDirection: 'row', alignItems: 'center' },
  exprBuyer: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  exprCrop: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  exprStatus: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm },
  exprStatusText: { ...TYPOGRAPHY.labelSmall, fontWeight: '600', textTransform: 'capitalize' },
  exprDate: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg },
  modalTitle: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface, marginBottom: SPACING.md },
  modalOrderInfo: { backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  modalBuyer: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  modalCrop: { ...TYPOGRAPHY.bodyMedium, color: COLORS.primary, marginTop: 2 },
  modalQty: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  formLabel: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant, marginBottom: 4 },
  formInput: {
    borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface,
  },
  modalActions: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  cancelBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  saveBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
});
