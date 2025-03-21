const noble = require('@abandonware/noble');
const winston = require('winston');

class BLEService {
  constructor(config) {
    this.config = config.ble;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/ble-error.log', level: 'error' }),
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.isScanning = false;
    this.discoveredDevices = {};
    this.connectedDevices = {};
    this.reconnectionAttempts = {};

    // Bind methods
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleDeviceDiscover = this.handleDeviceDiscover.bind(this);
    this.handleDeviceDisconnect = this.handleDeviceDisconnect.bind(this);

    // Initialize noble event handlers
    noble.on('stateChange', this.handleStateChange);
    noble.on('discover', this.handleDeviceDiscover);
  }

  async initialize() {
    try {
      if (noble.state === 'poweredOn') {
        await this.startScanning();
      }
    } catch (error) {
      this.logger.error('Failed to initialize BLE service:', error);
      throw error;
    }
  }

  handleStateChange(state) {
    this.logger.info(`BLE state changed to: ${state}`);
    if (state === 'poweredOn') {
      this.startScanning();
    } else if (state === 'poweredOff') {
      this.stopScanning();
    }
  }

  handleDeviceDiscover(device) {
    this.logger.info(`Discovered device: ${device.id}`);
    this.discoveredDevices[device.id] = device;

    // Check if device matches any filters
    const filter = this.config.device_filters.find(f => 
      (f.name && device.advertisement.localName === f.name) ||
      (f.address && device.address === f.address) ||
      (f.services && f.services.some(s => device.advertisement.serviceUuids.includes(s)))
    );

    if (filter) {
      device.alias = filter.alias || device.id;
      this.logger.info(`Device ${device.id} matched filter: ${device.alias}`);
    }
  }

  handleDeviceDisconnect(deviceId) {
    this.logger.info(`Device disconnected: ${deviceId}`);
    const device = this.connectedDevices[deviceId];
    if (device) {
      delete this.connectedDevices[deviceId];
      
      // Handle reconnection if enabled
      if (this.config.auto_reconnect) {
        this.attemptReconnection(deviceId);
      }
    }
  }

  async attemptReconnection(deviceId) {
    const attempts = this.reconnectionAttempts[deviceId] || 0;
    if (attempts >= this.config.reconnection_attempts) {
      this.logger.error(`Max reconnection attempts reached for device: ${deviceId}`);
      return;
    }

    this.reconnectionAttempts[deviceId] = attempts + 1;
    this.logger.info(`Attempting reconnection ${attempts + 1}/${this.config.reconnection_attempts} for device: ${deviceId}`);

    try {
      await this.connectToDevice(deviceId);
      delete this.reconnectionAttempts[deviceId];
    } catch (error) {
      this.logger.error(`Reconnection attempt failed for device ${deviceId}:`, error);
      setTimeout(() => this.attemptReconnection(deviceId), 2000);
    }
  }

  async startScanning() {
    if (this.isScanning) return;

    try {
      await noble.startScanningAsync();
      this.isScanning = true;
      this.logger.info('Started scanning for BLE devices');

      // Set scan timeout if configured
      if (this.config.scan_duration > 0) {
        setTimeout(() => this.stopScanning(), this.config.scan_duration * 1000);
      }
    } catch (error) {
      this.logger.error('Failed to start scanning:', error);
      throw error;
    }
  }

  async stopScanning() {
    if (!this.isScanning) return;

    try {
      await noble.stopScanningAsync();
      this.isScanning = false;
      this.logger.info('Stopped scanning for BLE devices');
    } catch (error) {
      this.logger.error('Failed to stop scanning:', error);
      throw error;
    }
  }

  async connectToDevice(deviceId) {
    const device = this.discoveredDevices[deviceId];
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (this.connectedDevices[deviceId]) {
      this.logger.warn(`Device already connected: ${deviceId}`);
      return;
    }

    try {
      // Set connection timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), this.config.connection_timeout * 1000);
      });

      // Connect to device
      await Promise.race([
        device.connect(),
        timeoutPromise
      ]);

      // Discover services
      const services = await device.discoverServices();
      this.logger.info(`Connected to device ${deviceId} and discovered ${services.length} services`);

      this.connectedDevices[deviceId] = device;
      device.on('disconnect', () => this.handleDeviceDisconnect(deviceId));
    } catch (error) {
      this.logger.error(`Failed to connect to device ${deviceId}:`, error);
      throw error;
    }
  }

  async disconnectDevice(deviceId) {
    const device = this.connectedDevices[deviceId];
    if (!device) {
      this.logger.warn(`Device not connected: ${deviceId}`);
      return;
    }

    try {
      await device.disconnect();
      delete this.connectedDevices[deviceId];
      this.logger.info(`Disconnected from device: ${deviceId}`);
    } catch (error) {
      this.logger.error(`Failed to disconnect from device ${deviceId}:`, error);
      throw error;
    }
  }

  getDiscoveredDevices() {
    return Object.values(this.discoveredDevices);
  }

  getConnectedDevices() {
    return Object.values(this.connectedDevices);
  }
}

module.exports = BLEService; 