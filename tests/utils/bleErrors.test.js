const fs = require('fs');
const path = require('path');
const winston = require('winston');
const {
  BLEError,
  BLEDeviceError,
  BLEScanError,
  BLEConnectionError,
  errorHandler
} = require('../../src/utils/bleErrors');

// Mock winston
jest.mock('winston', () => ({
  format: {
    timestamp: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    simple: jest.fn().mockReturnThis(),
    combine: jest.fn().mockReturnThis()
  },
  createLogger: jest.fn().mockReturnValue({
    error: jest.fn()
  }),
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}));

describe('BLE Error Classes', () => {
  describe('BLEError', () => {
    it('should create a base BLE error', () => {
      const error = new BLEError('Test error', 'TEST_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('BLEError');
      expect(error.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('BLEDeviceError', () => {
    it('should create a device error with device ID', () => {
      const error = new BLEDeviceError('Device error', 'device123');
      expect(error.message).toBe('Device error');
      expect(error.code).toBe('DEVICE_ERROR');
      expect(error.name).toBe('BLEDeviceError');
      expect(error.details.deviceId).toBe('device123');
    });
  });

  describe('BLEScanError', () => {
    it('should create a scan error', () => {
      const error = new BLEScanError('Scan error');
      expect(error.message).toBe('Scan error');
      expect(error.code).toBe('SCAN_ERROR');
      expect(error.name).toBe('BLEScanError');
    });
  });

  describe('BLEConnectionError', () => {
    it('should create a connection error with device ID', () => {
      const error = new BLEConnectionError('Connection error', 'device123');
      expect(error.message).toBe('Connection error');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.name).toBe('BLEConnectionError');
      expect(error.details.deviceId).toBe('device123');
    });
  });
});

describe('Error Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleError', () => {
    it('should handle a recoverable error', () => {
      const error = new BLEConnectionError('Connection failed', 'device123');
      const result = errorHandler.handleError(error, { operation: 'connect' });

      expect(result.error).toBe(error);
      expect(result.isRecoverable).toBe(true);
      expect(result.shouldRetry).toBe(true);
      expect(result.retryDelay).toBe(2000);
      expect(errorHandler.logger.error).toHaveBeenCalled();
    });

    it('should handle a non-recoverable error', () => {
      const error = new Error('Unknown error');
      const result = errorHandler.handleError(error);

      expect(result.error).toBe(error);
      expect(result.isRecoverable).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(errorHandler.logger.error).toHaveBeenCalled();
    });
  });

  describe('isRecoverableError', () => {
    it('should identify recoverable errors', () => {
      const recoverableErrors = [
        new BLEConnectionError('Connection error', 'device123'),
        new BLEScanError('Scan error'),
        new BLEDeviceError('Device error', 'device123')
      ];

      recoverableErrors.forEach(error => {
        expect(errorHandler.isRecoverableError(error)).toBe(true);
      });
    });

    it('should identify non-recoverable errors', () => {
      const nonRecoverableErrors = [
        new Error('Unknown error'),
        new BLEError('Custom error', 'UNKNOWN_CODE')
      ];

      nonRecoverableErrors.forEach(error => {
        expect(errorHandler.isRecoverableError(error)).toBe(false);
      });
    });
  });

  describe('shouldRetry', () => {
    it('should determine retry conditions', () => {
      const connectionError = new BLEConnectionError('Connection error', 'device123');
      const scanError = new BLEScanError('Scan error');
      const deviceError = new BLEDeviceError('Device error', 'device123');

      expect(errorHandler.shouldRetry(connectionError)).toBe(true);
      expect(errorHandler.shouldRetry(scanError)).toBe(true);
      expect(errorHandler.shouldRetry(deviceError)).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('should return appropriate retry delays', () => {
      const connectionError = new BLEConnectionError('Connection error', 'device123');
      const scanError = new BLEScanError('Scan error');
      const deviceError = new BLEDeviceError('Device error', 'device123');

      expect(errorHandler.getRetryDelay(connectionError)).toBe(2000);
      expect(errorHandler.getRetryDelay(scanError)).toBe(1000);
      expect(errorHandler.getRetryDelay(deviceError)).toBe(5000);
    });
  });
}); 