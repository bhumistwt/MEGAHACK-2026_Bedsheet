/**
 * [F16] IoT Sensor Service
 * Bluetooth communication wrapper for soil/storage sensors
 * In production: uses react-native-ble-plx for real BLE communication
 * Here: simulated sensor data with realistic patterns
 */

const SENSOR_TYPES = {
  SOIL_MOISTURE: 'soil_moisture',
  SOIL_PH: 'soil_ph',
  SOIL_TEMPERATURE: 'soil_temperature',
  SOIL_NITROGEN: 'soil_nitrogen',
  SOIL_PHOSPHORUS: 'soil_phosphorus',
  SOIL_POTASSIUM: 'soil_potassium',
  AIR_TEMPERATURE: 'air_temperature',
  AIR_HUMIDITY: 'air_humidity',
  STORAGE_TEMPERATURE: 'storage_temperature',
  STORAGE_HUMIDITY: 'storage_humidity',
};

const IDEAL_RANGES = {
  soil_moisture: { min: 40, max: 70, unit: '%', label: 'Soil Moisture' },
  soil_ph: { min: 6.0, max: 7.5, unit: 'pH', label: 'Soil pH' },
  soil_temperature: { min: 18, max: 30, unit: '°C', label: 'Soil Temp' },
  soil_nitrogen: { min: 200, max: 400, unit: 'kg/ha', label: 'Nitrogen (N)' },
  soil_phosphorus: { min: 20, max: 60, unit: 'kg/ha', label: 'Phosphorus (P)' },
  soil_potassium: { min: 150, max: 300, unit: 'kg/ha', label: 'Potassium (K)' },
  air_temperature: { min: 15, max: 35, unit: '°C', label: 'Air Temp' },
  air_humidity: { min: 40, max: 80, unit: '%', label: 'Air Humidity' },
  storage_temperature: { min: 0, max: 10, unit: '°C', label: 'Storage Temp' },
  storage_humidity: { min: 60, max: 95, unit: '%', label: 'Storage Humidity' },
};

class SensorService {
  constructor() {
    this.connectedSensors = [];
    this.readingCallbacks = [];
    this.pollingIntervals = {};
    this.isBluetoothAvailable = false;
  }

  /**
   * Initialize sensor service
   */
  async initialize() {
    console.log('[SensorService] Initializing...');
    // Check BLE availability (simulated)
    this.isBluetoothAvailable = false; // Would check real BLE in prod
    return {
      bluetooth_available: this.isBluetoothAvailable,
      simulated: true,
      message: 'Running in simulation mode. Connect real sensors via Bluetooth.',
    };
  }

  /**
   * Scan for nearby sensors
   * Returns list of discoverable sensor devices
   */
  async scanForSensors(timeoutMs = 5000) {
    // Simulated sensor discovery
    const mockSensors = [
      { id: 'SOIL-001', name: 'AgriSense Soil Kit', type: 'soil', battery: 78, rssi: -62 },
      { id: 'SOIL-002', name: 'FarmIoT Probe', type: 'soil', battery: 92, rssi: -71 },
      { id: 'STOR-001', name: 'ColdWatch Pro', type: 'storage', battery: 65, rssi: -55 },
      { id: 'WTHR-001', name: 'WeatherNode Mini', type: 'weather', battery: 85, rssi: -68 },
    ];

    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          sensors: mockSensors,
          scan_duration_ms: timeoutMs,
          simulated: true,
        });
      }, Math.min(timeoutMs, 2000));
    });
  }

  /**
   * Connect to a specific sensor
   */
  async connectSensor(sensorId) {
    const existing = this.connectedSensors.find(s => s.id === sensorId);
    if (existing) return { success: true, already_connected: true, sensor: existing };

    const sensor = {
      id: sensorId,
      connected: true,
      connected_at: new Date().toISOString(),
      last_reading: null,
    };
    this.connectedSensors.push(sensor);
    console.log(`[SensorService] Connected to ${sensorId}`);

    return { success: true, sensor };
  }

  /**
   * Disconnect a sensor
   */
  disconnectSensor(sensorId) {
    this.stopPolling(sensorId);
    this.connectedSensors = this.connectedSensors.filter(s => s.id !== sensorId);
    console.log(`[SensorService] Disconnected ${sensorId}`);
    return { success: true };
  }

  /**
   * Get a single reading from a sensor
   * Simulates realistic sensor data with noise
   */
  async getReading(sensorId, sensorType = 'soil') {
    const reading = this._generateReading(sensorType);
    reading.sensor_id = sensorId;
    reading.timestamp = new Date().toISOString();

    // Update connected sensor state
    const sensor = this.connectedSensors.find(s => s.id === sensorId);
    if (sensor) sensor.last_reading = reading;

    return reading;
  }

  /**
   * Start polling a sensor at regular intervals
   */
  startPolling(sensorId, sensorType, intervalMs = 60000) {
    if (this.pollingIntervals[sensorId]) return;

    const poll = async () => {
      const reading = await this.getReading(sensorId, sensorType);
      this._notifyCallbacks(sensorId, reading);
    };

    poll(); // Immediate first read
    this.pollingIntervals[sensorId] = setInterval(poll, intervalMs);
    console.log(`[SensorService] Polling ${sensorId} every ${intervalMs}ms`);
  }

  /**
   * Stop polling a sensor
   */
  stopPolling(sensorId) {
    if (this.pollingIntervals[sensorId]) {
      clearInterval(this.pollingIntervals[sensorId]);
      delete this.pollingIntervals[sensorId];
      console.log(`[SensorService] Stopped polling ${sensorId}`);
    }
  }

  /**
   * Register callback for sensor readings
   */
  onReading(callback) {
    this.readingCallbacks.push(callback);
    return () => {
      this.readingCallbacks = this.readingCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Get ideal ranges for display
   */
  getIdealRanges() {
    return { ...IDEAL_RANGES };
  }

  /**
   * Evaluate reading health against ideal ranges
   */
  evaluateReading(type, value) {
    const range = IDEAL_RANGES[type];
    if (!range) return { status: 'unknown', message: 'No reference data' };

    if (value < range.min) {
      return {
        status: 'low',
        message: `${range.label} is below ideal (${value}${range.unit} < ${range.min}${range.unit})`,
        severity: value < range.min * 0.7 ? 'critical' : 'warning',
      };
    }
    if (value > range.max) {
      return {
        status: 'high',
        message: `${range.label} is above ideal (${value}${range.unit} > ${range.max}${range.unit})`,
        severity: value > range.max * 1.3 ? 'critical' : 'warning',
      };
    }
    return { status: 'normal', message: `${range.label} is within ideal range`, severity: 'ok' };
  }

  /**
   * Get connected sensors list
   */
  getConnectedSensors() {
    return [...this.connectedSensors];
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      bluetooth_available: this.isBluetoothAvailable,
      connected_sensors: this.connectedSensors.length,
      polling_active: Object.keys(this.pollingIntervals).length,
      simulated: true,
    };
  }

  // ── Internal helpers ──

  _generateReading(sensorType) {
    const base = {
      soil: {
        soil_moisture: 50 + (Math.random() - 0.5) * 30,
        soil_ph: 6.5 + (Math.random() - 0.5) * 1.5,
        soil_temperature: 24 + (Math.random() - 0.5) * 10,
        soil_nitrogen: 280 + (Math.random() - 0.5) * 150,
        soil_phosphorus: 35 + (Math.random() - 0.5) * 25,
        soil_potassium: 220 + (Math.random() - 0.5) * 100,
      },
      storage: {
        storage_temperature: 4 + (Math.random() - 0.5) * 8,
        storage_humidity: 75 + (Math.random() - 0.5) * 20,
      },
      weather: {
        air_temperature: 28 + (Math.random() - 0.5) * 15,
        air_humidity: 60 + (Math.random() - 0.5) * 30,
      },
    };

    const readings = base[sensorType] || base.soil;

    // Round values
    for (const key in readings) {
      readings[key] = Math.round(readings[key] * 10) / 10;
    }

    // Evaluate each reading
    const evaluations = {};
    for (const [key, value] of Object.entries(readings)) {
      evaluations[key] = this.evaluateReading(key, value);
    }

    return {
      values: readings,
      evaluations,
      overall_health: Object.values(evaluations).every(e => e.severity === 'ok') ? 'good' : 'needs_attention',
    };
  }

  _notifyCallbacks(sensorId, reading) {
    this.readingCallbacks.forEach(cb => {
      try { cb(sensorId, reading); } catch (e) { /* ignore */ }
    });
  }
}

// Singleton
const sensorService = new SensorService();
export { SENSOR_TYPES, IDEAL_RANGES };
export default sensorService;
