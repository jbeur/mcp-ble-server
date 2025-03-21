const BLEService = require('../../../src/ble/bleService');
const { BLEDeviceError, BLECharacteristicError, errorHandler } = require('../../../src/utils/bleErrors');
const noble = require('@abandonware/noble');

jest.mock('@abandonware/noble');
jest.mock('winston', () => ({
  format: {
    combine: jest.fn().mockReturnValue({}),
    timestamp: jest.fn().mockReturnValue({}),
    json: jest.fn().mockReturnValue({}),
    simple: jest.fn().mockReturnValue({})
  },
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }),
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  }
}));

describe('BLEService', () => {
  let bleService;
  let mockDevice;
  let mockService;
  let mockCharacteristic;
  let handleErrorSpy;

  beforeEach(() => {
    // Reset noble mock
    noble.state = 'poweredOn';
    noble.startScanningAsync.mockResolvedValue();
    noble.stopScanningAsync.mockResolvedValue();

    // Create mock characteristic
    mockCharacteristic = {
      id: 'test-characteristic',
      read: jest.fn().mockResolvedValue(Buffer.from('test-data')),
      write: jest.fn().mockResolvedValue(),
      subscribe: jest.fn().mockResolvedValue(),
      unsubscribe: jest.fn().mockResolvedValue(),
      on: jest.fn(),
      removeListener: jest.fn()
    };

    // Create mock service
    mockService = {
      id: 'test-service',
      discoverCharacteristic: jest.fn().mockResolvedValue(mockCharacteristic)
    };

    // Create mock device
    mockDevice = {
      id: 'test-device',
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      discoverService: jest.fn().mockResolvedValue(mockService),
      discoverServices: jest.fn().mockResolvedValue([mockService]),
      on: jest.fn(),
      removeListener: jest.fn()
    };

    // Initialize BLE service
    bleService = new BLEService({
      ble: {
        scan_duration: 0,
        connection_timeout: 5,
        reconnection_attempts: 3,
        auto_reconnect: true,
        device_filters: []
      }
    });

    // Add mock device to discovered devices and connected devices
    bleService.discoveredDevices['test-device'] = mockDevice;
    bleService.connectedDevices['test-device'] = mockDevice;

    // Mock error handler
    handleErrorSpy = jest.spyOn(errorHandler, 'handleError').mockImplementation((error) => {
      // Return the original error to ensure proper error type propagation
      return {
        error,
        isRecoverable: true,
        shouldRetry: false,
        retryDelay: 1000
      };
    });
  });

  afterEach(() => {
    handleErrorSpy.mockRestore();
  });

  describe('readCharacteristic', () => {
    it('should successfully read characteristic data', async () => {
      const data = await bleService.readCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic'
      );

      expect(data).toEqual(Buffer.from('test-data'));
      expect(mockDevice.discoverService).toHaveBeenCalledWith('test-service');
      expect(mockService.discoverCharacteristic).toHaveBeenCalledWith('test-characteristic');
      expect(mockCharacteristic.read).toHaveBeenCalled();
    });

    it('should throw error if device not connected', async () => {
      delete bleService.connectedDevices['test-device'];

      await expect(bleService.readCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic'
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if service not found', async () => {
      mockDevice.discoverService.mockResolvedValue(null);

      await expect(bleService.readCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic'
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if characteristic not found', async () => {
      mockService.discoverCharacteristic.mockResolvedValue(null);

      await expect(bleService.readCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic'
      )).rejects.toThrow(BLECharacteristicError);
    });
  });

  describe('writeCharacteristic', () => {
    it('should successfully write characteristic data', async () => {
      const data = Buffer.from('test-data');

      await bleService.writeCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        data
      );

      expect(mockDevice.discoverService).toHaveBeenCalledWith('test-service');
      expect(mockService.discoverCharacteristic).toHaveBeenCalledWith('test-characteristic');
      expect(mockCharacteristic.write).toHaveBeenCalledWith(data);
    });

    it('should throw error if device not connected', async () => {
      delete bleService.connectedDevices['test-device'];

      await expect(bleService.writeCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        Buffer.from('test-data')
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if service not found', async () => {
      mockDevice.discoverService.mockResolvedValue(null);

      await expect(bleService.writeCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        Buffer.from('test-data')
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if characteristic not found', async () => {
      mockService.discoverCharacteristic.mockResolvedValue(null);

      await expect(bleService.writeCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        Buffer.from('test-data')
      )).rejects.toThrow(BLECharacteristicError);
    });
  });

  describe('subscribeToCharacteristic', () => {
    it('should successfully subscribe to characteristic', async () => {
      const callback = jest.fn();

      await bleService.subscribeToCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        callback
      );

      expect(mockDevice.discoverService).toHaveBeenCalledWith('test-service');
      expect(mockService.discoverCharacteristic).toHaveBeenCalledWith('test-characteristic');
      expect(mockCharacteristic.subscribe).toHaveBeenCalled();
      expect(mockCharacteristic.on).toHaveBeenCalledWith('data', callback);
    });

    it('should throw error if device not connected', async () => {
      delete bleService.connectedDevices['test-device'];

      await expect(bleService.subscribeToCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if service not found', async () => {
      mockDevice.discoverService.mockResolvedValue(null);

      await expect(bleService.subscribeToCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if characteristic not found', async () => {
      mockService.discoverCharacteristic.mockResolvedValue(null);

      await expect(bleService.subscribeToCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLECharacteristicError);
    });
  });

  describe('unsubscribeFromCharacteristic', () => {
    it('should successfully unsubscribe from characteristic', async () => {
      const callback = jest.fn();

      await bleService.unsubscribeFromCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        callback
      );

      expect(mockDevice.discoverService).toHaveBeenCalledWith('test-service');
      expect(mockService.discoverCharacteristic).toHaveBeenCalledWith('test-characteristic');
      expect(mockCharacteristic.removeListener).toHaveBeenCalledWith('data', callback);
      expect(mockCharacteristic.unsubscribe).toHaveBeenCalled();
    });

    it('should throw error if device not connected', async () => {
      delete bleService.connectedDevices['test-device'];

      await expect(bleService.unsubscribeFromCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if service not found', async () => {
      mockDevice.discoverService.mockResolvedValue(null);

      await expect(bleService.unsubscribeFromCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLEDeviceError);
    });

    it('should throw error if characteristic not found', async () => {
      mockService.discoverCharacteristic.mockResolvedValue(null);

      await expect(bleService.unsubscribeFromCharacteristic(
        'test-device',
        'test-service',
        'test-characteristic',
        jest.fn()
      )).rejects.toThrow(BLECharacteristicError);
    });
  });
}); 