/**
 * [F15] Bluetooth Mesh Sync Service
 * Simulates peer-to-peer data sharing between nearby farmers
 * In production: uses react-native-ble-plx or similar
 * Here: graceful degradation with local cache sync
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MESH_CACHE_KEY = '@khetwala_mesh_cache';
const SYNC_INTERVAL = 30000; // 30 seconds

class MeshSyncService {
  constructor() {
    this.peers = [];
    this.syncCallbacks = [];
    this.isScanning = false;
    this.cachedData = {};
  }

  /**
   * Initialize mesh network (simulated)
   * In production: initialize BLE adapter, request permissions
   */
  async initialize() {
    try {
      const cached = await AsyncStorage.getItem(MESH_CACHE_KEY);
      if (cached) {
        this.cachedData = JSON.parse(cached);
      }
      console.log('[MeshSync] Initialized with', Object.keys(this.cachedData).length, 'cached items');
      return { success: true, cached_items: Object.keys(this.cachedData).length };
    } catch (err) {
      console.warn('[MeshSync] Init failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Start scanning for nearby peers
   * Simulated: generates mock peer discovery events
   */
  async startScanning() {
    if (this.isScanning) return;
    this.isScanning = true;

    // Simulate peer discovery
    const mockPeers = [
      { id: 'peer_001', name: 'Sharad\'s Phone', distance_m: 15, signal: -65 },
      { id: 'peer_002', name: 'Mangesh\'s Phone', distance_m: 30, signal: -78 },
      { id: 'peer_003', name: 'Sunita\'s Phone', distance_m: 50, signal: -85 },
    ];

    // Simulate gradual discovery
    setTimeout(() => {
      this.peers = mockPeers.slice(0, 1);
      this._notifyCallbacks('peer_discovered', this.peers);
    }, 1000);

    setTimeout(() => {
      this.peers = mockPeers.slice(0, 2);
      this._notifyCallbacks('peer_discovered', this.peers);
    }, 2500);

    setTimeout(() => {
      this.peers = mockPeers;
      this._notifyCallbacks('peer_discovered', this.peers);
    }, 4000);

    console.log('[MeshSync] Scanning started');
    return { scanning: true };
  }

  /**
   * Stop scanning
   */
  stopScanning() {
    this.isScanning = false;
    console.log('[MeshSync] Scanning stopped');
  }

  /**
   * Share data with nearby peers (broadcast)
   * In production: BLE characteristic write
   */
  async broadcastData(dataType, payload) {
    const packet = {
      type: dataType, // 'market_price', 'weather_alert', 'disease_warning', 'crowd_outcome'
      data: payload,
      timestamp: new Date().toISOString(),
      sender: 'self',
      ttl: 3, // max hops
    };

    // Cache locally
    const key = `${dataType}_${Date.now()}`;
    this.cachedData[key] = packet;
    await this._persistCache();

    // Simulate broadcast success to connected peers
    const sent = this.peers.length;
    this._notifyCallbacks('data_sent', { type: dataType, peers_reached: sent });

    console.log(`[MeshSync] Broadcast ${dataType} to ${sent} peers`);
    return { sent_to: sent, packet_id: key };
  }

  /**
   * Receive data from peers (simulated)
   * In production: BLE notification handler
   */
  async simulateReceive(dataType) {
    const mockMessages = {
      market_price: {
        type: 'market_price',
        data: { commodity: 'Onion', price: 2800, market: 'Lasalgaon', time: '2h ago' },
        sender: 'Sharad',
      },
      weather_alert: {
        type: 'weather_alert',
        data: { alert: 'Heavy rain expected', area: 'Nashik', severity: 'high' },
        sender: 'Mangesh',
      },
      disease_warning: {
        type: 'disease_warning',
        data: { disease: 'Thrips outbreak', crop: 'Onion', area: 'Dindori taluka' },
        sender: 'Sunita',
      },
    };

    const msg = mockMessages[dataType] || mockMessages.market_price;
    msg.timestamp = new Date().toISOString();
    msg.received = true;

    // Cache received data
    const key = `recv_${dataType}_${Date.now()}`;
    this.cachedData[key] = msg;
    await this._persistCache();

    this._notifyCallbacks('data_received', msg);
    return msg;
  }

  /**
   * Get all cached data (for offline access)
   */
  getCachedData(dataType = null) {
    if (!dataType) return Object.values(this.cachedData);
    return Object.values(this.cachedData).filter(d => d.type === dataType);
  }

  /**
   * Get list of discovered peers
   */
  getPeers() {
    return [...this.peers];
  }

  /**
   * Register callback for sync events
   */
  onEvent(callback) {
    this.syncCallbacks.push(callback);
    return () => {
      this.syncCallbacks = this.syncCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Clear old cached data (older than 24h)
   */
  async clearOldCache() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const filtered = {};
    for (const [key, val] of Object.entries(this.cachedData)) {
      if (new Date(val.timestamp).getTime() > cutoff) {
        filtered[key] = val;
      }
    }
    this.cachedData = filtered;
    await this._persistCache();
    console.log('[MeshSync] Cache cleaned');
  }

  /**
   * Get mesh network status
   */
  getStatus() {
    return {
      initialized: true,
      scanning: this.isScanning,
      peers_connected: this.peers.length,
      cached_items: Object.keys(this.cachedData).length,
      bluetooth_available: false, // Simulated
    };
  }

  // ── Internal helpers ──

  _notifyCallbacks(event, data) {
    this.syncCallbacks.forEach(cb => {
      try { cb(event, data); } catch (e) { /* ignore */ }
    });
  }

  async _persistCache() {
    try {
      await AsyncStorage.setItem(MESH_CACHE_KEY, JSON.stringify(this.cachedData));
    } catch (e) {
      console.warn('[MeshSync] Cache persist failed:', e.message);
    }
  }
}

// Singleton instance
const meshSync = new MeshSyncService();
export default meshSync;
