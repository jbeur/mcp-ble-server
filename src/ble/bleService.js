const noble = require('@abandonware/noble');
const { EventEmitter } = require('events');
const { BLEScanError, BLEConnectionError, BLECharacteristicError } = require('../utils/bleErrors');
const { logger } = require('../utils/logger');

class BLEService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.isScanning = false;
    this.discoveredDevices = new Map();
    this.connectedDevices = new Map();
    this.maxRetries = config.max_retries || 3;
    this.retryDelay = config.retry_delay || 1000;
    this.connectionTimeout = config.connection_timeout || 10000;
    this.autoReconnect = config.auto_reconnect || true;

    // Bind methods
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleDeviceDiscover = this.handleDeviceDiscover.bind(this);
    this.handleDeviceDisconnect = this.handleDeviceDisconnect.bind(this);

    // Set max listeners to prevent warnings
    noble.setMaxListeners(20);
  }

  async withRetry(operation, operationType) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error;
        logger.error(`${operationType} failed (attempt ${attempt}/${this.maxRetries}):`, error.message);
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }
    throw lastError;
  }

  async initialize() {
    try {
      await this.startScanning();
    } catch (error) {
      logger.error('Failed to initialize BLE service:', error.message);
      throw new BLEScanError('Failed to initialize BLE service', error);
    }
  }

  async cleanup() {
    try {
      // Stop scanning
      if (this.isScanning) {
        await this.stopScanning();
      }

      // Disconnect all devices
      const disconnectPromises = Array.from(this.connectedDevices.keys()).map(deviceId => 
        this.disconnectDevice(deviceId)
      );
      await Promise.all(disconnectPromises);

      // Clean up mock devices in test environment
      this.discoveredDevices.forEach(device => {
        if (typeof device.cleanup === 'function') {
          device.cleanup();
        }
      });

      // Clear device maps
      this.discoveredDevices.clear();
      this.connectedDevices.clear();

      // Remove noble listeners
      noble.removeListener('stateChange', this.handleStateChange);
      noble.removeListener('discover', this.handleDeviceDiscover);

      // Remove all event listeners from this instance
      this.removeAllListeners();
    } catch (error) {
      logger.error('Failed to cleanup BLE service:', error.message);
      throw new BLEScanError('Failed to cleanup BLE service', error);
    }
  }

  async startScanning() {
    return this.withRetry(async () => {
      if (this.isScanning) return;
      
      noble.on('stateChange', this.handleStateChange);
      noble.on('discover', this.handleDeviceDiscover);
      
      try {
        await noble.startScanningAsync();
        this.isScanning = true;
        logger.info('BLE scanning started');
      } catch (error) {
        throw new BLEScanError('Failed to start scanning', error);
      }
    }, 'scan start');
  }

  async stopScanning() {
    return this.withRetry(async () => {
      if (!this.isScanning) return;
      
      try {
        await noble.stopScanningAsync();
        this.isScanning = false;
        logger.info('BLE scanning stopped');
      } catch (error) {
        throw new BLEScanError('Failed to stop scanning', error);
      }
    }, 'scan stop');
  }

  handleStateChange(state) {
    logger.info('BLE state changed:', state);
  }

  handleDeviceDiscover(device) {
    this.discoveredDevices.set(device.id, device);
    logger.info('Device discovered:', device.id);
  }

  async connectToDevice(deviceId) {
    const device = this.discoveredDevices.get(deviceId);
    if (!device) {
      throw new BLEConnectionError('Device not found', deviceId);
    }

    return this.withRetry(async () => {
      try {
        const connectionPromise = device.connect();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout);
        });

        await Promise.race([connectionPromise, timeoutPromise]);
        this.connectedDevices.set(deviceId, device);
        logger.info('Connected to device:', deviceId);

        device.once('disconnect', () => this.handleDeviceDisconnect(deviceId));
      } catch (error) {
        if (error.message === 'Connection timeout') {
          throw error;
        }
        throw new BLEConnectionError('Failed to connect', deviceId, error);
      }
    }, 'connection');
  }

  handleDeviceDisconnect = async (deviceId) => {
    const device = this.connectedDevices.get(deviceId);
    if (device) {
      this.connectedDevices.delete(deviceId);
      logger.info('Device disconnected:', deviceId);

      if (this.autoReconnect) {
        try {
          await this.connectToDevice(deviceId);
        } catch (error) {
          logger.error('Failed to reconnect to device:', error.message);
        }
      }
    }
  };

  async readCharacteristic(deviceId, serviceId, characteristicId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      throw new BLEConnectionError('Device not connected', deviceId);
    }

    return this.withRetry(async () => {
      try {
        const services = await device.discoverServices();
        const targetService = services.find(s => s.uuid === serviceId);
        if (!targetService) {
          throw new BLECharacteristicError('Service not found', deviceId, characteristicId);
        }

        const characteristics = await targetService.discoverCharacteristics();
        const targetCharacteristic = characteristics.find(c => c.uuid === characteristicId);
        if (!targetCharacteristic) {
          throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
        }

        const value = await targetCharacteristic.read();
        return value;
      } catch (error) {
        throw new BLECharacteristicError('Read failed', deviceId, characteristicId, error);
      }
    }, 'read characteristic');
  }

  async writeCharacteristic(deviceId, serviceId, characteristicId, data) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      throw new BLEConnectionError('Device not connected', deviceId);
    }

    return this.withRetry(async () => {
      try {
        const services = await device.discoverServices();
        const targetService = services.find(s => s.uuid === serviceId);
        if (!targetService) {
          throw new BLECharacteristicError('Service not found', deviceId, characteristicId);
        }

        const characteristics = await targetService.discoverCharacteristics();
        const targetCharacteristic = characteristics.find(c => c.uuid === characteristicId);
        if (!targetCharacteristic) {
          throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
        }

        await targetCharacteristic.write(data);
      } catch (error) {
        throw new BLECharacteristicError('Write failed', deviceId, characteristicId, error);
      }
    }, 'write characteristic');
  }

  async subscribeToCharacteristic(deviceId, serviceId, characteristicId, callback) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      throw new BLEConnectionError('Device not connected', deviceId);
    }

    return this.withRetry(async () => {
      try {
        const services = await device.discoverServices();
        const targetService = services.find(s => s.uuid === serviceId);
        if (!targetService) {
          throw new BLECharacteristicError('Service not found', deviceId, characteristicId);
        }

        const characteristics = await targetService.discoverCharacteristics();
        const targetCharacteristic = characteristics.find(c => c.uuid === characteristicId);
        if (!targetCharacteristic) {
          throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
        }

        targetCharacteristic.on('data', callback);
        await targetCharacteristic.subscribe();
      } catch (error) {
        throw new BLECharacteristicError('Subscribe failed', deviceId, characteristicId, error);
      }
    }, 'subscribe to characteristic');
  }

  async unsubscribeFromCharacteristic(deviceId, serviceId, characteristicId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      throw new BLEConnectionError('Device not connected', deviceId);
    }

    return this.withRetry(async () => {
      try {
        const services = await device.discoverServices();
        const targetService = services.find(s => s.uuid === serviceId);
        if (!targetService) {
          throw new BLECharacteristicError('Service not found', deviceId, characteristicId);
        }

        const characteristics = await targetService.discoverCharacteristics();
        const targetCharacteristic = characteristics.find(c => c.uuid === characteristicId);
        if (!targetCharacteristic) {
          throw new BLECharacteristicError('Characteristic not found', deviceId, characteristicId);
        }

        await targetCharacteristic.unsubscribe();
        targetCharacteristic.removeAllListeners('data');
      } catch (error) {
        throw new BLECharacteristicError('Unsubscribe failed', deviceId, characteristicId, error);
      }
    }, 'unsubscribe from characteristic');
  }

  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  getConnectedDevices() {
    return Array.from(this.connectedDevices.values());
  }

  async disconnectDevice(deviceId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      return;
    }

    try {
      await device.disconnect();
      this.connectedDevices.delete(deviceId);
      logger.info('Device disconnected:', deviceId);
    } catch (error) {
      logger.error('Failed to disconnect device:', error.message);
      throw new BLEConnectionError('Failed to disconnect', deviceId, error);
    }
  }

  /**
   * Get the number of active BLE connections
   * @returns {number} Number of active BLE connections
   */
  getActiveConnections() {
    return this.connectedDevices.size;
  }
}

module.exports = { BLEService }; 