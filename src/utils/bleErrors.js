const winston = require('winston');

// Custom error classes for BLE operations
class BLEError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'BLEError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date();
    }
}

class BLEDeviceError extends BLEError {
    constructor(message, deviceId, details = {}) {
        super(message, 'DEVICE_ERROR', { deviceId, ...details });
        this.name = 'BLEDeviceError';
    }
}

class BLEScanError extends BLEError {
    constructor(message, details = {}) {
        super(message, 'SCAN_ERROR', details);
        this.name = 'BLEScanError';
    }
}

class BLEConnectionError extends BLEError {
    constructor(message, deviceId, details = {}) {
        super(message, 'CONNECTION_ERROR', { deviceId, ...details });
        this.name = 'BLEConnectionError';
    }
}

// Error handling utilities
const errorHandler = {
    logger: winston.createLogger({
        level: 'error',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: 'logs/ble-error.log' }),
            new winston.transports.Console({
                format: winston.format.simple()
            })
        ]
    }),

    handleError(error, context = {}) {
        // Log the error with context
        this.logger.error({
            message: error.message,
            code: error.code,
            details: { ...error.details, ...context },
            stack: error.stack,
            timestamp: error.timestamp
        });

        // Determine if error is recoverable
        const isRecoverable = this.isRecoverableError(error);

        return {
            error,
            isRecoverable,
            shouldRetry: isRecoverable && this.shouldRetry(error),
            retryDelay: this.getRetryDelay(error)
        };
    },

    isRecoverableError(error) {
        // Define which errors are recoverable
        const recoverableCodes = [
            'CONNECTION_ERROR',
            'SCAN_ERROR',
            'DEVICE_ERROR'
        ];

        return recoverableCodes.includes(error.code);
    },

    shouldRetry(error) {
        // Define retry conditions based on error type
        if (error instanceof BLEConnectionError) {
            return true; // Always retry connection errors
        }
        if (error instanceof BLEScanError) {
            return true; // Always retry scan errors
        }
        return false;
    },

    getRetryDelay(error) {
        // Define retry delays based on error type
        if (error instanceof BLEConnectionError) {
            return 2000; // 2 seconds for connection errors
        }
        if (error instanceof BLEScanError) {
            return 1000; // 1 second for scan errors
        }
        return 5000; // Default 5 seconds
    }
};

module.exports = {
    BLEError,
    BLEDeviceError,
    BLEScanError,
    BLEConnectionError,
    errorHandler
}; 