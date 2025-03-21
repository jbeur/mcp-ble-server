/**
 * MCP Protocol Message Types
 */
const MessageTypes = {
  // Connection Messages
  CONNECTION_ACK: 'connection_ack',
  DISCONNECT: 'disconnect',

  // BLE Device Discovery
  START_SCAN: 'start_scan',
  STOP_SCAN: 'stop_scan',
  DEVICE_FOUND: 'device_found',
  SCAN_COMPLETE: 'scan_complete',

  // BLE Device Connection
  CONNECT_DEVICE: 'connect_device',
  DISCONNECT_DEVICE: 'disconnect_device',
  DEVICE_CONNECTED: 'device_connected',
  DEVICE_DISCONNECTED: 'device_disconnected',

  // BLE Data Transfer
  READ_CHARACTERISTIC: 'read_characteristic',
  WRITE_CHARACTERISTIC: 'write_characteristic',
  SUBSCRIBE_CHARACTERISTIC: 'subscribe_characteristic',
  UNSUBSCRIBE_CHARACTERISTIC: 'unsubscribe_characteristic',
  CHARACTERISTIC_VALUE: 'characteristic_value',
  CHARACTERISTIC_CHANGED: 'characteristic_changed',

  // Error Messages
  ERROR: 'error'
};

/**
 * MCP Protocol Error Codes
 */
const ErrorCodes = {
  // General Errors
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // BLE Errors
  BLE_NOT_AVAILABLE: 'BLE_NOT_AVAILABLE',
  SCAN_ERROR: 'SCAN_ERROR',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  DISCONNECTION_ERROR: 'DISCONNECTION_ERROR',
  READ_ERROR: 'READ_ERROR',
  WRITE_ERROR: 'WRITE_ERROR',
  SUBSCRIBE_ERROR: 'SUBSCRIBE_ERROR',
  UNSUBSCRIBE_ERROR: 'UNSUBSCRIBE_ERROR'
};

/**
 * Message Validators
 */
const Validators = {
  /**
   * Validate start scan parameters
   */
  validateStartScan(params) {
    const { duration, filters } = params || {};
    
    if (duration && typeof duration !== 'number') {
      throw new Error('Duration must be a number');
    }

    if (filters) {
      if (!Array.isArray(filters)) {
        throw new Error('Filters must be an array');
      }

      filters.forEach(filter => {
        if (!filter.name && !filter.serviceUuids && !filter.manufacturerData) {
          throw new Error('Filter must contain at least one of: name, serviceUuids, or manufacturerData');
        }
      });
    }

    return true;
  },

  /**
   * Validate connect device parameters
   */
  validateConnectDevice(params) {
    const { deviceId } = params || {};

    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error('Device ID is required and must be a string');
    }

    return true;
  },

  /**
   * Validate characteristic operation parameters
   */
  validateCharacteristicOperation(params) {
    const { deviceId, serviceUuid, characteristicUuid } = params || {};

    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error('Device ID is required and must be a string');
    }

    if (!serviceUuid || typeof serviceUuid !== 'string') {
      throw new Error('Service UUID is required and must be a string');
    }

    if (!characteristicUuid || typeof characteristicUuid !== 'string') {
      throw new Error('Characteristic UUID is required and must be a string');
    }

    return true;
  },

  /**
   * Validate write characteristic parameters
   */
  validateWriteCharacteristic(params) {
    this.validateCharacteristicOperation(params);

    const { value } = params || {};
    if (!value || !Buffer.isBuffer(value)) {
      throw new Error('Value is required and must be a Buffer');
    }

    return true;
  }
};

/**
 * Message Builders
 */
const MessageBuilder = {
  /**
   * Build a connection acknowledgment message
   */
  buildConnectionAck(clientId) {
    return {
      type: MessageTypes.CONNECTION_ACK,
      clientId,
      timestamp: Date.now()
    };
  },

  /**
   * Build a device found message
   */
  buildDeviceFound(device) {
    return {
      type: MessageTypes.DEVICE_FOUND,
      device: {
        id: device.id,
        name: device.name,
        address: device.address,
        rssi: device.rssi,
        manufacturerData: device.manufacturerData,
        serviceUuids: device.serviceUuids
      },
      timestamp: Date.now()
    };
  },

  /**
   * Build a device connected message
   */
  buildDeviceConnected(deviceId) {
    return {
      type: MessageTypes.DEVICE_CONNECTED,
      deviceId,
      timestamp: Date.now()
    };
  },

  /**
   * Build a characteristic value message
   */
  buildCharacteristicValue(params) {
    const { deviceId, serviceUuid, characteristicUuid, value } = params;
    return {
      type: MessageTypes.CHARACTERISTIC_VALUE,
      deviceId,
      serviceUuid,
      characteristicUuid,
      value: value.toString('base64'),
      timestamp: Date.now()
    };
  },

  /**
   * Build an error message
   */
  buildError(code, message) {
    return {
      type: MessageTypes.ERROR,
      code,
      message,
      timestamp: Date.now()
    };
  }
};

module.exports = {
  MessageTypes,
  ErrorCodes,
  Validators,
  MessageBuilder
}; 