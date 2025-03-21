/**
 * MCP Protocol Message Types
 */
const MESSAGE_TYPES = {
  // Authentication messages
  AUTHENTICATE: 'AUTHENTICATE',
  AUTHENTICATED: 'AUTHENTICATED',
  SESSION_VALID: 'SESSION_VALID',
  LOGOUT: 'LOGOUT',
  LOGGED_OUT: 'LOGGED_OUT',
  START_SCAN: 'START_SCAN',
  STOP_SCAN: 'STOP_SCAN',
  DEVICE_FOUND: 'DEVICE_FOUND',
  CONNECT: 'CONNECT',
  DISCONNECT: 'DISCONNECT',
  CHARACTERISTIC_READ: 'CHARACTERISTIC_READ',
  CHARACTERISTIC_WRITE: 'CHARACTERISTIC_WRITE',
  ERROR: 'ERROR',
  CONNECTION_ACK: 'CONNECTION_ACK'
};

/**
 * MCP Protocol Error Codes
 */
const ERROR_CODES = {
  // Authentication errors
  INVALID_API_KEY: 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',

  // BLE errors
  SCAN_ALREADY_ACTIVE: 'SCAN_ALREADY_ACTIVE',
  SCAN_NOT_ACTIVE: 'SCAN_NOT_ACTIVE',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
  NOT_CONNECTED: 'NOT_CONNECTED',
  INVALID_PARAMS: 'INVALID_PARAMS',
  OPERATION_FAILED: 'OPERATION_FAILED',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  BLE_NOT_AVAILABLE: 'BLE_NOT_AVAILABLE',
  CONNECTION_ERROR: 'CONNECTION_ERROR'
};

/**
 * Message Validators
 */
const validateStartScan = (params) => {
    if (!params.duration || typeof params.duration !== 'number' || params.duration <= 0) {
        throw new Error('Duration must be a positive number');
    }

    if (params.filters) {
        if (typeof params.filters !== 'object') {
            throw new Error('Filters must be an object');
        }

        const validFilters = ['name', 'services'];
        const hasValidFilter = Object.keys(params.filters).some(key => validFilters.includes(key));
        if (!hasValidFilter) {
            throw new Error('Invalid filter criteria');
        }

        if (params.filters.services && !Array.isArray(params.filters.services)) {
            throw new Error('Invalid service UUIDs');
        }
    }
};

const validateConnectDevice = (params) => {
    if (!params.deviceId || typeof params.deviceId !== 'string') {
        throw new Error('Device ID is required and must be a string');
    }
};

const validateCharacteristicOperation = (params) => {
    if (!params.deviceId || typeof params.deviceId !== 'string') {
        throw new Error('Device ID is required and must be a string');
    }
    if (!params.serviceUuid || typeof params.serviceUuid !== 'string') {
        throw new Error('Service UUID is required and must be a string');
    }
    if (!params.characteristicUuid || typeof params.characteristicUuid !== 'string') {
        throw new Error('Characteristic UUID is required and must be a string');
    }
};

const validateWriteCharacteristic = (params) => {
    validateCharacteristicOperation(params);
    if (!params.value || typeof params.value !== 'string') {
        throw new Error('Value is required and must be a base64 encoded string');
    }
    
    // Validate base64 format
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(params.value)) {
        throw new Error('Value is required and must be a base64 encoded string');
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
            type: MESSAGE_TYPES.CONNECTION_ACK,
            clientId,
            timestamp: Date.now()
        };
    },

    /**
     * Build a device found message
     */
    buildDeviceFound(device) {
        return {
            type: MESSAGE_TYPES.DEVICE_FOUND,
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
            type: MESSAGE_TYPES.DEVICE_CONNECTED,
            deviceId,
            timestamp: Date.now()
        };
    },

    /**
     * Build a characteristic value message
     */
    buildCharacteristicValue(params) {
        return {
            type: MESSAGE_TYPES.CHARACTERISTIC_VALUE,
            deviceId: params.deviceId,
            serviceUuid: params.serviceUuid,
            characteristicUuid: params.characteristicUuid,
            value: params.value,
            timestamp: Date.now()
        };
    },

    /**
     * Build an error message
     */
    buildError(code, message) {
        return {
            type: MESSAGE_TYPES.ERROR,
            code,
            message,
            timestamp: Date.now()
        };
    }
};

module.exports = {
    MESSAGE_TYPES,
    ERROR_CODES,
    validateStartScan,
    validateConnectDevice,
    validateCharacteristicOperation,
    validateWriteCharacteristic,
    MessageBuilder
}; 