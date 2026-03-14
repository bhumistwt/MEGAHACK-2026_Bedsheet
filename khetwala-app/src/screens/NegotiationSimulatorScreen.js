/**
 * [F5] Negotiation Simulator Screen
 * Interactive mandi negotiation practice game
 * Material Design 3
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, StatusBar, Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, ELEVATION, RADIUS, SPACING, TYPOGRAPHY } from '../theme/colors';
import { useLanguage } from '../context/LanguageContext';
import { getBackendBaseUrl } from '../config/backend';

const BASE_URL = getBackendBaseUrl();

const BUYER_TYPES = [
  { id: 'tough_trader', label: 'Tough Trader', icon: 'account-tie', color: '#D32F2F' },
  { id: 'fair_dealer', label: 'Fair Dealer', icon: 'handshake', color: '#1565C0' },
  { id: 'quality_buyer', label: 'Quality Buyer', icon: 'star-circle', color: '#2E7D32' },
];

export default function NegotiationSimulatorScreen({ navigation }) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState('setup'); // setup | negotiating | result
  const [crop, setCrop] = useState('Onion');
  const [marketPrice, setMarketPrice] = useState('2500');
  const [quantity, setQuantity] = useState('10');
  const [buyerType, setBuyerType] = useState('tough_trader');
  const [sessionId, setSessionId] = useState(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerOffer, setBuyerOffer] = useState(0);
  const [farmerOffer, setFarmerOffer] = useState('');
  const [roundNum, setRoundNum] = useState(1);
  const [chat, setChat] = useState([]);
  const [result, setResult] = useState(null);
  const [tip, setTip] = useState('');

  const startNegotiation = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/simulator/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crop, market_price: parseFloat(marketPrice),
          quantity_quintals: parseFloat(quantity), buyer_type: buyerType,
        }),
      });
      const data = await resp.json();
      setSessionId(data.session_id);
      setBuyerName(data.buyer_name);
      setBuyerOffer(data.buyer_opening_offer);
      setTip(data.tip || '');
      setChat([{ sender: 'buyer', text: data.buyer_message }]);
      setPhase('negotiating');
      setRoundNum(1);
    } catch (e) {
      // Mock start
      setSessionId('mock_session');
      setBuyerName('Rajesh Seth (Tough Trader)');
      setBuyerOffer(2000);
      setChat([{ sender: 'buyer', text: 'Namaste! ₹2,000/quintal dunga. Ye best price hai.' }]);
      setTip('Kabhi pehla offer accept mat karo!');
      setPhase('negotiating');
    }
  };

  const submitOffer = async () => {
    const offer = parseFloat(farmerOffer);
    if (!offer || offer <= 0) return;

    setChat(prev => [...prev, { sender: 'farmer', text: `₹${offer.toLocaleString()}/quintal` }]);
    setFarmerOffer('');

    try {
      const resp = await fetch(`${BASE_URL}/simulator/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId, farmer_offer: offer, round_number: roundNum,
        }),
      });
      const data = await resp.json();

      setChat(prev => [...prev, { sender: 'buyer', text: data.buyer_message }]);
      setBuyerOffer(data.buyer_counter_offer);
      setTip(data.tip || '');
      setRoundNum(roundNum + 1);

      if (data.deal_status !== 'negotiating') {
        setResult(data);
        setPhase('result');
      }
    } catch (e) {
      setChat(prev => [...prev, { sender: 'buyer', text: 'Hmm... ₹2,200 tak aa sakta hun. Final.' }]);
    }
  };

  const resetGame = () => {
    setPhase('setup');
    setChat([]);
    setResult(null);
    setSessionId(null);
    setRoundNum(1);
  };

  const gradeColor = (grade) => {
    if (grade === 'A+' || grade === 'A') return COLORS.success;
    if (grade === 'B') return COLORS.tertiary;
    return COLORS.error;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#5D4037" />
      <View style={[styles.header, { backgroundColor: '#5D4037' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: '#FFF' }]}>🤝 Negotiation Simulator</Text>
      </View>

      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {/* ── SETUP PHASE ── */}
        {phase === 'setup' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Setup Negotiation</Text>
              <Text style={styles.subtitle}>Practice mandi negotiation with AI buyers</Text>

              <Text style={styles.label}>Crop</Text>
              <TextInput style={styles.input} value={crop} onChangeText={setCrop} placeholder="e.g. Onion" />

              <Text style={styles.label}>Market Price (₹/quintal)</Text>
              <TextInput style={styles.input} value={marketPrice} onChangeText={setMarketPrice}
                keyboardType="numeric" placeholder="2500" />

              <Text style={styles.label}>Quantity (quintals)</Text>
              <TextInput style={styles.input} value={quantity} onChangeText={setQuantity}
                keyboardType="numeric" placeholder="10" />

              <Text style={[styles.label, { marginTop: SPACING.md }]}>Select Buyer Type</Text>
              {BUYER_TYPES.map(bt => (
                <TouchableOpacity key={bt.id}
                  style={[styles.buyerOption, buyerType === bt.id && { borderColor: bt.color, backgroundColor: bt.color + '10' }]}
                  onPress={() => setBuyerType(bt.id)}>
                  <MaterialCommunityIcons name={bt.icon} size={24} color={bt.color} />
                  <Text style={[styles.buyerLabel, buyerType === bt.id && { color: bt.color, fontWeight: '700' }]}>
                    {bt.label}
                  </Text>
                  {buyerType === bt.id && <MaterialCommunityIcons name="check-circle" size={20} color={bt.color} />}
                </TouchableOpacity>
              ))}

              <TouchableOpacity style={styles.startBtn} onPress={startNegotiation}>
                <MaterialCommunityIcons name="play-circle" size={24} color={COLORS.onPrimary} />
                <Text style={styles.startBtnText}>  Start Negotiation</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── NEGOTIATING PHASE ── */}
        {phase === 'negotiating' && (
          <View>
            {/* Buyer info */}
            <View style={styles.negotiateHeader}>
              <Text style={styles.buyerNameText}>{buyerName}</Text>
              <Text style={styles.roundText}>Round {roundNum} • Market: ₹{parseFloat(marketPrice).toLocaleString()}/q</Text>
            </View>

            {/* Chat */}
            {chat.map((msg, i) => (
              <View key={i} style={[styles.chatBubble,
                msg.sender === 'farmer' ? styles.farmerBubble : styles.buyerBubble]}>
                <Text style={styles.chatSender}>{msg.sender === 'farmer' ? '🧑‍🌾 You' : '🏪 Buyer'}</Text>
                <Text style={styles.chatText}>{msg.text}</Text>
              </View>
            ))}

            {/* Tip */}
            {tip ? (
              <View style={styles.tipCard}>
                <MaterialCommunityIcons name="lightbulb-outline" size={18} color={COLORS.tertiary} />
                <Text style={styles.tipText}>  {tip}</Text>
              </View>
            ) : null}

            {/* Input */}
            <View style={styles.inputRow}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0, marginRight: SPACING.sm }]}
                placeholder="Your price (₹/quintal)" value={farmerOffer}
                onChangeText={setFarmerOffer} keyboardType="numeric" />
              <TouchableOpacity style={styles.sendBtn} onPress={submitOffer}>
                <MaterialCommunityIcons name="send" size={24} color={COLORS.onPrimary} />
              </TouchableOpacity>
            </View>

            {/* Quick offers */}
            <View style={styles.quickOffers}>
              {[buyerOffer + 100, Math.round((buyerOffer + parseFloat(marketPrice)) / 2), parseFloat(marketPrice)].map((p, i) => (
                <TouchableOpacity key={i} style={styles.quickBtn} onPress={() => setFarmerOffer(String(p))}>
                  <Text style={styles.quickBtnText}>₹{p.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── RESULT PHASE ── */}
        {phase === 'result' && result && (
          <View>
            <View style={[styles.card, { alignItems: 'center' }]}>
              <Text style={{ fontSize: 48 }}>
                {result.deal_status === 'deal_done' ? '🤝' : '🚶'}
              </Text>
              <Text style={styles.resultTitle}>
                {result.deal_status === 'deal_done' ? 'Deal Done!' : 'Buyer Walked Away'}
              </Text>

              {result.final_price && (
                <Text style={styles.resultPrice}>₹{result.final_price.toLocaleString()}/quintal</Text>
              )}

              {result.total_value && (
                <Text style={styles.resultTotal}>Total: ₹{result.total_value.toLocaleString()}</Text>
              )}
            </View>

            {/* Score card */}
            {result.total_score !== undefined && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Your Score</Text>
                <View style={styles.scoreRow}>
                  <View style={[styles.gradeBadge, { backgroundColor: gradeColor(result.grade) + '15' }]}>
                    <Text style={[styles.gradeText, { color: gradeColor(result.grade) }]}>{result.grade}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: SPACING.md }}>
                    <Text style={styles.totalScore}>{result.total_score}/100</Text>
                    <Text style={styles.scoreDetail}>Price: {result.price_score} • Efficiency: {result.efficiency_score}</Text>
                  </View>
                </View>
                {result.tip && (
                  <View style={styles.tipCard}>
                    <Text style={styles.tipText}>💡 {result.tip}</Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity style={styles.startBtn} onPress={resetGame}>
              <MaterialCommunityIcons name="restart" size={24} color={COLORS.onPrimary} />
              <Text style={styles.startBtnText}>  Play Again</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
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
  scrollView: { flex: 1, padding: SPACING.md },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    marginBottom: SPACING.md, ...ELEVATION.level2,
  },
  cardTitle: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  subtitle: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurfaceVariant, marginTop: 4, marginBottom: SPACING.md },
  label: { ...TYPOGRAPHY.labelLarge, color: COLORS.onSurfaceVariant, marginBottom: 4, marginTop: SPACING.sm },
  input: {
    borderWidth: 1, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    padding: SPACING.md, ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface, marginBottom: SPACING.sm,
  },
  buyerOption: {
    flexDirection: 'row', alignItems: 'center', padding: SPACING.md,
    borderWidth: 1.5, borderColor: COLORS.outlineVariant, borderRadius: RADIUS.md,
    marginBottom: SPACING.sm, gap: SPACING.md,
  },
  buyerLabel: { ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurface, flex: 1 },
  startBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md,
  },
  startBtnText: { ...TYPOGRAPHY.labelLarge, color: COLORS.onPrimary },
  negotiateHeader: {
    backgroundColor: COLORS.surfaceContainerLow, borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  buyerNameText: { ...TYPOGRAPHY.titleMedium, color: COLORS.onSurface },
  roundText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
  chatBubble: { padding: SPACING.md, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, maxWidth: '85%' },
  farmerBubble: { backgroundColor: COLORS.primaryContainer, alignSelf: 'flex-end' },
  buyerBubble: { backgroundColor: COLORS.surfaceContainerHigh, alignSelf: 'flex-start' },
  chatSender: { ...TYPOGRAPHY.labelSmall, color: COLORS.onSurfaceVariant, marginBottom: 4 },
  chatText: { ...TYPOGRAPHY.bodyMedium, color: COLORS.onSurface, lineHeight: 22 },
  tipCard: {
    backgroundColor: COLORS.tertiaryContainer, borderRadius: RADIUS.md,
    padding: SPACING.md, flexDirection: 'row', alignItems: 'flex-start', marginVertical: SPACING.sm,
  },
  tipText: { ...TYPOGRAPHY.bodySmall, color: COLORS.onTertiaryContainer, flex: 1, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm },
  sendBtn: {
    backgroundColor: COLORS.primary, width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  quickOffers: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  quickBtn: { flex: 1, backgroundColor: COLORS.surfaceContainerHigh, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center' },
  quickBtnText: { ...TYPOGRAPHY.labelMedium, color: COLORS.primary },
  resultTitle: { ...TYPOGRAPHY.headlineSmall, color: COLORS.onSurface, marginTop: SPACING.md },
  resultPrice: { ...TYPOGRAPHY.headlineMedium, color: COLORS.primary, marginTop: SPACING.sm, fontWeight: '700' },
  resultTotal: { ...TYPOGRAPHY.bodyLarge, color: COLORS.onSurfaceVariant, marginTop: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md },
  gradeBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  gradeText: { fontSize: 24, fontWeight: '800' },
  totalScore: { ...TYPOGRAPHY.titleLarge, color: COLORS.onSurface },
  scoreDetail: { ...TYPOGRAPHY.bodySmall, color: COLORS.onSurfaceVariant, marginTop: 2 },
});
