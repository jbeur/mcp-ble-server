const noble = require('@abandonware/noble');
const winston = require('winston');
const { BLEDeviceError, BLEScanError, BLEConnectionError, BLECharacteristicError, errorHandler } = require('../utils/bleErrors');

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
    this.errorRetries = {};
    this.retryTimeouts = new Map();

    // Increase max listeners to prevent warnings
    noble.setMaxListeners(20);

    // Bind methods
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleDeviceDiscover = this.handleDeviceDiscover.bind(this);
    this.handleDeviceDisconnect = this.handleDeviceDisconnect.bind(this);

    // Initialize noble event handlers
    noble.on('stateChange', this.handleStateChange);
    noble.on('discover', this.handleDeviceDiscover);
  }

  cleanup() {
    // Remove event listeners
    noble.removeListener('stateChange', this.handleStateChange);
    noble.removeListener('discover', this.handleDeviceDiscover);

    // Clear all timeouts
    for (const [operation, timeoutId] of this.retryTimeouts.entries()) {
      clearTimeout(timeoutId);
      this.retryTimeouts.delete(operation);
    }

    // Disconnect all devices
    Object.keys(this.connectedDevices).forEach(deviceId => {
      try {
        this.disconnectDevice(deviceId);
      } catch (error) {
        this.logger.error(`Failed to disconnect device ${deviceId} during cleanup:`, error);
      }
    });

    // Reset state
    this.isScanning = false;
    this.discoveredDevices = {};
    this.connectedDevices = {};
    this.reconnectionAttempts = {};
    this.errorRetries = {};
  }

  clearRetryTimeout(operation) {
    const timeoutId = this.retryTimeouts.get(operation);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.retryTimeouts.delete(operation);
    }
  }

  setRetryTimeout(operation, callback, delay) {
    this.clearRetryTimeout(operation);
    const timeoutId = setTimeout(() => {
      this.retryTimeouts.delete(operation);
      callback();
    }, delay);
    this.retryTimeouts.set(operation, timeoutId);
  }

  async initialize() {
    try {
      if (noble.state === 'poweredOn') {
        await this.startScanning();
      }
    } catch (error) {
      const { error: handledError, isRecoverable, shouldRetry, retryDelay } = 
        errorHandler.handleError(error, { operation: 'initialize' });
      
      if (shouldRetry) {
        this.logger.info(`Retrying initialization in ${retryDelay}ms`);
        this.setRetryTimeout('initialize', () => this.initialize(), retryDelay);
      }
      
      throw handledError;
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
    try {
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
    } catch (error) {
      errorHandler.handleError(new BLEDeviceError('Failed to process discovered device', device.id, { error }));
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
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(error, { deviceId, attempt: attempts + 1 });
      
      if (shouldRetry) {
        this.logger.info(`Retrying reconnection in ${retryDelay}ms`);
        this.setRetryTimeout(`reconnect-${deviceId}`, () => this.attemptReconnection(deviceId), retryDelay);
      }
      
      throw handledError;
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
        this.setRetryTimeout('scan-timeout', () => this.stopScanning(), this.config.scan_duration * 1000);
      }
    } catch (error) {
      const scanError = new BLEScanError('Failed to start scanning', { error });
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(scanError);
      
      if (shouldRetry) {
        this.logger.info(`Retrying scan start in ${retryDelay}ms`);
        this.setRetryTimeout('scan-retry', async () => {
          try {
            await noble.startScanningAsync();
            this.isScanning = true;
            this.logger.info('Started scanning for BLE devices after retry');
          } catch (retryError) {
            const { error: finalError } = errorHandler.handleError(
              new BLEScanError('Failed to start scanning after retry', { error: retryError })
            );
            throw finalError;
          }
        }, retryDelay);
      }
      
      throw handledError;
    }
  }

  async stopScanning() {
    if (!this.isScanning) return;

    try {
      await noble.stopScanningAsync();
      this.isScanning = false;
      this.logger.info('Stopped scanning for BLE devices');
    } catch (error) {
      const scanError = new BLEScanError('Failed to stop scanning', { error });
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(scanError);
      
      if (shouldRetry) {
        this.logger.info(`Retrying scan stop in ${retryDelay}ms`);
        this.setRetryTimeout('scan-stop-retry', () => this.stopScanning(), retryDelay);
      }
      
      throw handledError;
    }
  }

  async connectToDevice(deviceId) {
    const device = this.discoveredDevices[deviceId];
    if (!device) {
      throw new BLEDeviceError('Device not found', deviceId);
    }

    if (this.connectedDevices[deviceId]) {
      this.logger.warn(`Device already connected: ${deviceId}`);
      return;
    }

    try {
      // Set connection timeout
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          this.clearRetryTimeout(`connect-timeout-${deviceId}`);
          reject(new BLEConnectionError('Connection timeout', deviceId));
        }, this.config.connection_timeout * 1000);
        this.retryTimeouts.set(`connect-timeout-${deviceId}`, timeoutId);
      });

      // Connect to device
      await Promise.race([
        device.connect(),
        timeoutPromise
      ]);

      // Clear timeout since connection succeeded
      this.clearRetryTimeout(`connect-timeout-${deviceId}`);

      // Discover services
      const services = await device.discoverServices();
      this.logger.info(`Connected to device ${deviceId} and discovered ${services.length} services`);

      this.connectedDevices[deviceId] = device;
      device.on('disconnect', () => this.handleDeviceDisconnect(deviceId));
    } catch (error) {
      const connectionError = new BLEConnectionError('Failed to connect to device', deviceId, { error });
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(connectionError);
      
      if (shouldRetry) {
        this.logger.info(`Retrying connection in ${retryDelay}ms`);
        this.setRetryTimeout(`connect-retry-${deviceId}`, () => this.connectToDevice(deviceId), retryDelay);
      }
      
      throw handledError;
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
      const { error: handledError } = 
        errorHandler.handleError(new BLEDeviceError('Failed to disconnect from device', deviceId, { error }));
      throw handledError;
    }
  }

  getDiscoveredDevices() {
    return Object.values(this.discoveredDevices);
  }

  getConnectedDevices() {
    return Object.values(this.connectedDevices);
  }

  async readCharacteristic(deviceId, serviceId, characteristicId) {
    const device = this.connectedDevices[deviceId];
    if (!device) {
      throw new BLEDeviceError('Device not connected', deviceId);
    }

    try {
      const service = await device.discoverService(serviceId);
      if (!service) {
        throw new BLEDeviceError('Service not found', deviceId);
      }

      const characteristic = await service.discoverCharacteristic(characteristicId);
      if (!characteristic) {
        throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
      }

      const data = await characteristic.read();
      return data;
    } catch (error) {
      // If the error is already a BLEDeviceError or BLECharacteristicError, pass it through
      if (error instanceof BLEDeviceError || error instanceof BLECharacteristicError) {
        const { error: handledError, shouldRetry, retryDelay } = 
          errorHandler.handleError(error);
        
        if (shouldRetry) {
          this.logger.info(`Retrying characteristic read in ${retryDelay}ms`);
          this.setRetryTimeout(`read-char-${deviceId}-${characteristicId}`, () => this.readCharacteristic(deviceId, serviceId, characteristicId), retryDelay);
        }
        
        throw handledError;
      }

      // Otherwise, wrap it in a BLECharacteristicError
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(new BLECharacteristicError('Failed to read characteristic', deviceId, characteristicId, { error }));
      
      if (shouldRetry) {
        this.logger.info(`Retrying characteristic read in ${retryDelay}ms`);
        this.setRetryTimeout(`read-char-${deviceId}-${characteristicId}`, () => this.readCharacteristic(deviceId, serviceId, characteristicId), retryDelay);
      }
      
      throw handledError;
    }
  }

  async writeCharacteristic(deviceId, serviceId, characteristicId, data) {
    const device = this.connectedDevices[deviceId];
    if (!device) {
      throw new BLEDeviceError('Device not connected', deviceId);
    }

    try {
      const service = await device.discoverService(serviceId);
      if (!service) {
        throw new BLEDeviceError('Service not found', deviceId);
      }

      const characteristic = await service.discoverCharacteristic(characteristicId);
      if (!characteristic) {
        throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
      }

      await characteristic.write(data);
    } catch (error) {
      // If the error is already a BLEDeviceError or BLECharacteristicError, pass it through
      if (error instanceof BLEDeviceError || error instanceof BLECharacteristicError) {
        const { error: handledError, shouldRetry, retryDelay } = 
          errorHandler.handleError(error);
        
        if (shouldRetry) {
          this.logger.info(`Retrying characteristic write in ${retryDelay}ms`);
          this.setRetryTimeout(`write-char-${deviceId}-${characteristicId}`, () => this.writeCharacteristic(deviceId, serviceId, characteristicId, data), retryDelay);
        }
        
        throw handledError;
      }

      // Otherwise, wrap it in a BLECharacteristicError
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(new BLECharacteristicError('Failed to write characteristic', deviceId, characteristicId, { error }));
      
      if (shouldRetry) {
        this.logger.info(`Retrying characteristic write in ${retryDelay}ms`);
        this.setRetryTimeout(`write-char-${deviceId}-${characteristicId}`, () => this.writeCharacteristic(deviceId, serviceId, characteristicId, data), retryDelay);
      }
      
      throw handledError;
    }
  }

  async subscribeToCharacteristic(deviceId, serviceId, characteristicId, callback) {
    const device = this.connectedDevices[deviceId];
    if (!device) {
      throw new BLEDeviceError('Device not connected', deviceId);
    }

    try {
      const service = await device.discoverService(serviceId);
      if (!service) {
        throw new BLEDeviceError('Service not found', deviceId);
      }

      const characteristic = await service.discoverCharacteristic(characteristicId);
      if (!characteristic) {
        throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
      }

      await characteristic.subscribe();
      characteristic.on('data', callback);
    } catch (error) {
      // If the error is already a BLEDeviceError or BLECharacteristicError, pass it through
      if (error instanceof BLEDeviceError || error instanceof BLECharacteristicError) {
        const { error: handledError, shouldRetry, retryDelay } = 
          errorHandler.handleError(error);
        
        if (shouldRetry) {
          this.logger.info(`Retrying characteristic subscription in ${retryDelay}ms`);
          this.setRetryTimeout(`subscribe-char-${deviceId}-${characteristicId}`, () => this.subscribeToCharacteristic(deviceId, serviceId, characteristicId, callback), retryDelay);
        }
        
        throw handledError;
      }

      // Otherwise, wrap it in a BLECharacteristicError
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(new BLECharacteristicError('Failed to subscribe to characteristic', deviceId, characteristicId, { error }));
      
      if (shouldRetry) {
        this.logger.info(`Retrying characteristic subscription in ${retryDelay}ms`);
        this.setRetryTimeout(`subscribe-char-${deviceId}-${characteristicId}`, () => this.subscribeToCharacteristic(deviceId, serviceId, characteristicId, callback), retryDelay);
      }
      
      throw handledError;
    }
  }

  async unsubscribeFromCharacteristic(deviceId, serviceId, characteristicId, callback) {
    const device = this.connectedDevices[deviceId];
    if (!device) {
      throw new BLEDeviceError('Device not connected', deviceId);
    }

    try {
      const service = await device.discoverService(serviceId);
      if (!service) {
        throw new BLEDeviceError('Service not found', deviceId);
      }

      const characteristic = await service.discoverCharacteristic(characteristicId);
      if (!characteristic) {
        throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
      }

      characteristic.removeListener('data', callback);
      await characteristic.unsubscribe();
    } catch (error) {
      // If the error is already a BLEDeviceError or BLECharacteristicError, pass it through
      if (error instanceof BLEDeviceError || error instanceof BLECharacteristicError) {
        const { error: handledError, shouldRetry, retryDelay } = 
          errorHandler.handleError(error);
        
        if (shouldRetry) {
          this.logger.info(`Retrying characteristic unsubscription in ${retryDelay}ms`);
          this.setRetryTimeout(`unsubscribe-char-${deviceId}-${characteristicId}`, () => this.unsubscribeFromCharacteristic(deviceId, serviceId, characteristicId, callback), retryDelay);
        }
        
        throw handledError;
      }

      // Otherwise, wrap it in a BLECharacteristicError
      const { error: handledError, shouldRetry, retryDelay } = 
        errorHandler.handleError(new BLECharacteristicError('Failed to unsubscribe from characteristic', deviceId, characteristicId, { error }));
      
      if (shouldRetry) {
        this.logger.info(`Retrying characteristic unsubscription in ${retryDelay}ms`);
        this.setRetryTimeout(`unsubscribe-char-${deviceId}-${characteristicId}`, () => this.unsubscribeFromCharacteristic(deviceId, serviceId, characteristicId, callback), retryDelay);
      }
      
      throw handledError;
    }
  }
}

module.exports = BLEService; 