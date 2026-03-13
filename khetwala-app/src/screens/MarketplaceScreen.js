/**
 * [F11] Input Marketplace Screen
 * Agricultural product recommendations & local shop discovery
 * Material Design 3
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, RefreshControl, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000';

const CATEGORY_ICONS = {
  fungicide: { icon: 'shield-bug', color: '#D32F2F' },
  insecticide: { icon: 'bug', color: '#F57F17' },
  organic: { icon: 'leaf', color: '#2E7D32' },
  fertilizer: { icon: 'flask', color: '#1565C0' },
  bio_agent: { icon: 'bacteria', color: '#00838F' },
  micronutrient: { icon: 'grain', color: '#6A1B9A' },
};

const MOCK_PRODUCTS = [
  { id: 1, name: 'Mancozeb 75% WP', category: 'fungicide', price_range: '₹200-300/kg', description: 'Broad-spectrum fungicide for blight, downy mildew. Safe for most crops.', recommended_for: ['blight', 'fungal'] },
  { id: 2, name: 'Neem Oil 1500 PPM', category: 'organic', price_range: '₹350-500/L', description: 'Natural pest deterrent. Effective against aphids, whitefly, mites.', recommended_for: ['pest', 'organic'] },
  { id: 3, name: 'DAP (Diammonium Phosphate)', category: 'fertilizer', price_range: '₹1350/50kg', description: 'Phosphorus-rich fertilizer. Best for root development and flowering.', recommended_for: ['deficiency', 'phosphorus'] },
  { id: 4, name: 'Trichoderma Viride', category: 'bio_agent', price_range: '₹150-250/kg', description: 'Biological fungicide. Prevents soil-borne diseases naturally.', recommended_for: ['wilt', 'organic'] },
  { id: 5, name: 'Imidacloprid 17.8% SL', category: 'insecticide', price_range: '₹450-600/250ml', description: 'Systemic insecticide for sucking pests. Use with caution.', recommended_for: ['pest', 'thrips'] },
];

const MOCK_SHOPS = [
  { id: 1, name: 'Krishi Kendra Nashik', district: 'Nashik', address: 'APMC Road, Panchavati', phone: '0253-2345678', rating: 4.5 },
  { id: 2, name: 'Shree Agro Traders', district: 'Nashik', address: 'Station Road, Nashik City', phone: '0253-3456789', rating: 4.2 },
];

export default function MarketplaceScreen({ navigation }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [products, setProducts] = useState([]);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [showRecommend, setShowRecommend] = useState(false);
  const [diseaseInput, setDiseaseInput] = useState('');

  const fetchProducts = useCallback(async () => {
    try {
      const url = selectedCategory
        ? `${BASE_URL}/marketplace/products?category=${selectedCategory}`
        : `${BASE_URL}/marketplace/products`;
      const resp = await fetch(url);
      const data = await resp.json();
      setProducts(data.products || []);
    } catch (e) {
      setProducts(MOCK_PRODUCTS);
    } finally { setLoading(false); setRefreshing(false); }
  }, [selectedCategory]);

  const fetchShops = async () => {
    try {
      const district = user?.district || 'Nashik';
      const resp = await fetch(`${BASE_URL}/marketplace/shops/${district}`);
      const data = await resp.json();
      setShops(data.shops || []);
    } catch (e) {
      setShops(MOCK_SHOPS);
    }
  };

  useEffect(() => { fetchProducts(); fetchShops(); }, [fetchProducts]);

  const onRefresh = () => { setRefreshing(true); fetchProducts(); };

  const getRecommendations = async () => {
    if (!diseaseInput.trim()) return;
    try {
      const resp = await fetch(`${BASE_URL}/marketplace/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disease_or_deficiency: diseaseInput }),
      });
      const data = await resp.json();
      setRecommendations(data.recommendations || []);
    } catch (e) {
      setRecommendations(MOCK_PRODUCTS.filter(p =>
        p.recommended_for.some(r => diseaseInput.toLowerCase().includes(r))
      ));
    }
    setShowRecommend(true);
  };

  const filtered = products.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const catInfo = (category) => CATEGORY_ICONS[category] || { icon: 'package-variant', color: '#999' };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#E65100" />
      <View style={[styles.header, { backgroundColor: '#E65100' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>🛒 Input Marketplace</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {['products', 'shops', 'recommend'].map(t2 => (
          <TouchableOpacity key={t2} style={[styles.tabBtn, tab === t2 && styles.tabActive]}
            onPress={() => setTab(t2)}>
            <Text style={[styles.tabText, tab === t2 && styles.tabTextActive]}>
              {t2 === 'products' ? '📦 Products' : t2 === 'shops' ? '🏪 Shops' : '💡 AI Suggest'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled">

          {/* ── PRODUCTS TAB ── */}
          {tab === 'products' && (
            <View style={{ padding: SPACING.md }}>
              {/* Search */}
              <View style={styles.searchBar}>
                <MaterialCommunityIcons name="magnify" size={20} color={COLORS.onSurfaceVariant} />
                <TextInput style={styles.searchInput} placeholder="Search products..."
                  value={searchQuery} onChangeText={setSearchQuery} />
              </View>

              {/* Category chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.md }}>
                <TouchableOpacity style={[styles.chip, !selectedCategory && styles.chipActive]}
                  onPress={() => setSelectedCategory(null)}>
                  <Text style={[styles.chipText, !selectedCategory && styles.chipTextActive]}>All</Text>
                </TouchableOpacity>
                {Object.entries(CATEGORY_ICONS).map(([cat, info]) => (
                  <TouchableOpacity key={cat}
                    style={[styles.chip, selectedCategory === cat && styles.chipActive]}
                    onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}>
                    <MaterialCommunityIcons name={info.icon} size={16} color={selectedCategory === cat ? COLORS.onPrimary : info.color} />
                    <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}> {cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {filtered.map(product => {
                const ci = catInfo(product.category);
                return (
                  <View key={product.id} style={styles.productCard}>
                    <View style={styles.productHeader}>
                      <View style={[styles.productIcon, { backgroundColor: ci.color + '15' }]}>
                        <MaterialCommunityIcons name={ci.icon} size={24} color={ci.color} />
                      </View>
                      <View style={{ flex: 1, marginLeft: SPACING.md }}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productCat}>{product.category}</Text>
                      </View>
                      <Text style={styles.productPrice}>{product.price_range}</Text>
                    </View>
                    <Text style={styles.productDesc}>{product.description}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── SHOPS TAB ── */}
          {tab === 'shops' && (
            <View style={{ padding: SPACING.md }}>
              <Text style={styles.sectionTitle}>Nearby Agricultural Shops</Text>
              {shops.map(shop => (
                <View key={shop.id} style={styles.shopCard}>
                  <View style={[styles.shopIcon, { backgroundColor: COLORS.primaryContainer }]}>
                    <MaterialCommunityIcons name="store" size={28} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: SPACING.md }}>
                    <Text style={styles.shopName}>{shop.name}</Text>
                    <Text style={styles.shopAddress}>{shop.address}</Text>
                    <Text style={styles.shopPhone}>📞 {shop.phone}</Text>
                    <View style={styles.ratingRow}>
                      <MaterialCommunityIcons name="star" size={16} color="#FFD600" />
                      <Text style={styles.ratingText}> {shop.rating}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── AI RECOMMEND TAB ── */}
          {tab === 'recommend' && (
            <View style={{ padding: SPACING.md }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>🤖 AI Product Recommendation</Text>
                <Text style={styles.subtitle}>Describe your crop problem and get product suggestions</Text>
                <TextInput style={[styles.formInput, { height: 80, textAlignVertical: 'top' }]}
                  value={diseaseInput} onChangeText={setDiseaseInput}
                  placeholder="e.g. blight on tomato, nitrogen deficiency, thrips attack..."
                  multiline />
                <TouchableOpacity style={styles.recommendBtn} onPress={getRecommendations}>
                  <MaterialCommunityIcons name="auto-fix" size={20} color={COLORS.onPrimary} />
                  <Text style={styles.recommendBtnText}>  Get Recommendations</Text>
                </TouchableOpacity>
              </View>

              {showRecommend && recommendations.length > 0 && (
                <View>
                  <Text style={styles.sectionTitle}>Recommended Products</Text>
                  {recommendations.map((product, idx) => {
                    const ci = catInfo(product.category);
                    return (
                      <View key={idx} style={styles.productCard}>
                        <View style={styles.productHeader}>
                          <View style={[styles.productIcon, { backgroundColor: ci.color + '15' }]}>
                            <MaterialCommunityIcons name={ci.icon} size={24} color={ci.color} />
                          </View>
                          <View style={{ flex: 1, marginLeft: SPACING.md }}>
                            <Text style={styles.productName}>{product.name}</Text>
                            <Text style={styles.productPrice}>{product.price_range}</Text>
                          </View>
                          {product.match_score && (
                            <View style={styles.matchBadge}>
                              <Text style={styles.matchText}>{product.match_score}% match</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.productDesc}>{product.description}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      )}
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
  tabText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant },
  tabTextActive: { color: COLORS.primary },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  subtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 4, marginBottom: SPACING.md },
  sectionTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface, marginBottom: SPACING.md },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceContainerHigh,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm,
  },
  searchInput: { flex: 1, ...TYPOGRAPHY.bodyLarge, marginLeft: SPACING.sm, paddingVertical: SPACING.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.outlineVariant, marginRight: SPACING.sm,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant },
  chipTextActive: { color: COLORS.onPrimary },
  productCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  productHeader: { flexDirection: 'row', alignItems: 'center' },
  productIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  productName: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  productCat: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, textTransform: 'capitalize' },
  productPrice: { ...TYPOGRAPHY.labelLarge, color: COLORS.primary, fontWeight: '700' },
  productDesc: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: SPACING.sm, lineHeight: 20 },
  shopCard: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.sm, ...ELEVATION.level1,
  },
  shopIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  shopName: { ...TYPOGRAPHY.titleSmall, color: COLORS.onSurface },
  shopAddress: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  shopPhone: { ...TYPOGRAPHY.bodySmall, color: COLORS.primary, marginTop: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  ratingText: { ...TYPOGRAPHY.labelMedium, color: COLORS.onSurfaceVariant },
  formInput: {
    borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface,
  },
  recommendBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md,
  },
  recommendBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
  matchBadge: { backgroundColor: COLORS.tertiaryContainer, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  matchText: { ...TYPOGRAPHY.labelSmall, color: COLORS.onTertiaryContainer },
});
