const noble = require('noble');
const winston = require('winston');

class BLEService {
  constructor(config) {
    this.config = config;
    this.logger = winston.createLogger({
      level: config.logging.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ 
          filename: config.logging.file,
          maxsize: config.logging.max_size,
          maxFiles: config.logging.backup_count
        }),
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.isScanning = false;
    this.connectedDevices = new Map();
    this.discoveredDevices = new Map();
    this.scanTimeout = null;

    // Bind methods to maintain context
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleDeviceDiscover = this.handleDeviceDiscover.bind(this);
    this.handleDeviceConnect = this.handleDeviceConnect.bind(this);
    this.handleDeviceDisconnect = this.handleDeviceDisconnect.bind(this);
  }

  async initialize() {
    try {
      this.logger.info('Initializing BLE Service...');
      
      // Set up noble event handlers
      noble.on('stateChange', this.handleStateChange);
      noble.on('discover', this.handleDeviceDiscover);
      
      // Initialize BLE state
      const state = noble.state;
      this.logger.info(`Current BLE state: ${state}`);
      
      if (state === 'poweredOn') {
        await this.startScanning();
      }

      this.logger.info('BLE Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize BLE Service:', error);
      throw error;
    }
  }

  handleStateChange(state) {
    this.logger.info(`BLE state changed to: ${state}`);
    if (state === 'poweredOn') {
      this.startScanning();
    } else {
      this.stopScanning();
    }
  }

  async startScanning() {
    try {
      if (!this.isScanning) {
        this.isScanning = true;
        noble.startScanning();
        this.logger.info('Started BLE scanning');

        // Set scan timeout based on configuration
        this.scanTimeout = setTimeout(() => {
          this.stopScanning();
        }, this.config.ble.scan_duration * 1000);
      }
    } catch (error) {
      this.logger.error('Failed to start scanning:', error);
      throw error;
    }
  }

  stopScanning() {
    try {
      if (this.isScanning) {
        this.isScanning = false;
        noble.stopScanning();
        if (this.scanTimeout) {
          clearTimeout(this.scanTimeout);
          this.scanTimeout = null;
        }
        this.logger.info('Stopped BLE scanning');
      }
    } catch (error) {
      this.logger.error('Failed to stop scanning:', error);
      throw error;
    }
  }

  handleDeviceDiscover(peripheral) {
    try {
      const deviceInfo = {
        id: peripheral.id,
        address: peripheral.address,
        addressType: peripheral.addressType,
        advertisement: peripheral.advertisement,
        rssi: peripheral.rssi,
        state: peripheral.state,
        discoveredAt: new Date()
      };

      this.discoveredDevices.set(peripheral.id, deviceInfo);
      this.logger.info(`Discovered device: ${peripheral.address} (${peripheral.advertisement.localName || 'Unknown'})`);

      // Check if device matches any configured filters
      this.checkDeviceFilters(peripheral);
    } catch (error) {
      this.logger.error('Error handling device discovery:', error);
    }
  }

  checkDeviceFilters(peripheral) {
    const { devices } = this.config;
    
    for (const filter of devices) {
      if (filter.name && peripheral.advertisement.localName === filter.name) {
        this.logger.info(`Found matching device by name: ${filter.name}`);
        if (filter.auto_connect) {
          this.connectToDevice(peripheral);
        }
        break;
      }

      if (filter.name_pattern) {
        const regex = new RegExp(filter.name_pattern);
        if (peripheral.advertisement.localName && regex.test(peripheral.advertisement.localName)) {
          this.logger.info(`Found matching device by pattern: ${filter.name_pattern}`);
          if (filter.auto_connect) {
            this.connectToDevice(peripheral);
          }
          break;
        }
      }
    }
  }

  async connectToDevice(peripheral) {
    try {
      if (this.connectedDevices.has(peripheral.id)) {
        this.logger.info(`Device ${peripheral.address} is already connected`);
        return;
      }

      this.logger.info(`Connecting to device: ${peripheral.address}`);
      
      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        this.logger.error(`Connection timeout for device: ${peripheral.address}`);
        peripheral.disconnect();
      }, this.config.ble.connection_timeout * 1000);

      // Connect to device
      await new Promise((resolve, reject) => {
        peripheral.connect((error) => {
          clearTimeout(connectionTimeout);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Discover services and characteristics
      await this.discoverServices(peripheral);
      
      this.connectedDevices.set(peripheral.id, peripheral);
      this.logger.info(`Successfully connected to device: ${peripheral.address}`);

      // Set up disconnect handler
      peripheral.on('disconnect', () => this.handleDeviceDisconnect(peripheral));

    } catch (error) {
      this.logger.error(`Failed to connect to device ${peripheral.address}:`, error);
      throw error;
    }
  }

  async discoverServices(peripheral) {
    try {
      this.logger.info(`Discovering services for device: ${peripheral.address}`);
      
      await new Promise((resolve, reject) => {
        peripheral.discoverAllServicesAndCharacteristics((error, services, characteristics) => {
          if (error) {
            reject(error);
          } else {
            this.logger.info(`Discovered ${services.length} services and ${characteristics.length} characteristics`);
            resolve({ services, characteristics });
          }
        });
      });

      // Log discovered services and characteristics
      peripheral.services.forEach(service => {
        this.logger.info(`Service: ${service.uuid}`);
        service.characteristics.forEach(characteristic => {
          this.logger.info(`  Characteristic: ${characteristic.uuid}`);
        });
      });

    } catch (error) {
      this.logger.error(`Failed to discover services for device ${peripheral.address}:`, error);
      throw error;
    }
  }

  handleDeviceDisconnect(peripheral) {
    try {
      this.logger.info(`Device disconnected: ${peripheral.address}`);
      this.connectedDevices.delete(peripheral.id);

      // Handle reconnection if configured
      if (this.config.ble.auto_reconnect) {
        this.handleReconnection(peripheral);
      }
    } catch (error) {
      this.logger.error(`Error handling device disconnect for ${peripheral.address}:`, error);
    }
  }

  async handleReconnection(peripheral) {
    let attempts = 0;
    const maxAttempts = this.config.ble.reconnect_attempts;
    const delay = this.config.ble.reconnect_delay * 1000;

    const attemptReconnect = async () => {
      try {
        attempts++;
        this.logger.info(`Reconnection attempt ${attempts}/${maxAttempts} for device: ${peripheral.address}`);
        
        await this.connectToDevice(peripheral);
        this.logger.info(`Successfully reconnected to device: ${peripheral.address}`);
        return true;
      } catch (error) {
        this.logger.error(`Reconnection attempt ${attempts} failed:`, error);
        if (attempts < maxAttempts) {
          setTimeout(attemptReconnect, delay);
        } else {
          this.logger.error(`Max reconnection attempts reached for device: ${peripheral.address}`);
        }
        return false;
      }
    };

    await attemptReconnect();
  }

  getConnectedDevices() {
    return Array.from(this.connectedDevices.values());
  }

  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  async disconnectDevice(peripheralId) {
    try {
      const peripheral = this.connectedDevices.get(peripheralId);
      if (peripheral) {
        await new Promise((resolve, reject) => {
          peripheral.disconnect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
        this.logger.info(`Successfully disconnected device: ${peripheral.address}`);
      }
    } catch (error) {
      this.logger.error(`Failed to disconnect device:`, error);
      throw error;
    }
  }
}

module.exports = BLEService; 