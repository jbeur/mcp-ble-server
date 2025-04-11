const noble = require('@abandonware/noble');
const { EventEmitter } = require('events');
const { BLEService } = require('../../../src/ble/bleService');
const { BLEScanError, BLEConnectionError, BLECharacteristicError } = require('../../../src/utils/bleErrors');
const { logger } = require('../../../src/utils/logger');

// Mock noble module
jest.mock('@abandonware/noble', () => {
  const EventEmitter = require('events');
  const mockNoble = new EventEmitter();
  mockNoble.startScanningAsync = jest.fn().mockResolvedValue();
  mockNoble.stopScanningAsync = jest.fn().mockResolvedValue();
  mockNoble.state = 'poweredOn';
  return mockNoble;
});

jest.mock('../../../src/utils/logger');

// Increase Jest timeout for all tests
jest.setTimeout(60000);

describe('BLEService', () => {
  let bleService;
  let mockDevice;
  let mockService;
  let mockCharacteristic;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock device extending EventEmitter
    mockDevice = new EventEmitter();
    mockDevice.id = 'test-device';
    mockDevice.connect = jest.fn();
    mockDevice.discoverServices = jest.fn();
    mockDevice.once = jest.fn();
    mockDevice.disconnect = jest.fn();

    // Create mock service
    mockService = {
      uuid: 'test-service',
      discoverCharacteristics: jest.fn()
    };

    // Create mock characteristic
    mockCharacteristic = {
      uuid: 'test-characteristic',
      read: jest.fn(),
      write: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn()
    };

    // Initialize BLEService with proper configuration
    bleService = new BLEService({
      max_retries: 3,
      retry_delay: 100,
      connection_timeout: 500,
      auto_reconnect: true
    });

    // Setup default mock behaviors
    noble.startScanningAsync.mockResolvedValue();
    noble.stopScanningAsync.mockResolvedValue();
    mockDevice.connect.mockResolvedValue();
    mockDevice.discoverServices.mockResolvedValue([mockService]);
    mockService.discoverCharacteristics.mockResolvedValue([mockCharacteristic]);
    mockCharacteristic.read.mockResolvedValue(Buffer.from('test'));
    mockCharacteristic.write.mockResolvedValue();
    mockCharacteristic.subscribe.mockResolvedValue();
    mockCharacteristic.unsubscribe.mockResolvedValue();
  });

  afterEach(async () => {
    // Skip cleanup if we're in the cleanup error test
    if (bleService && !bleService._testSkipCleanup) {
      await bleService.cleanup();
    }
  });

  describe('initialization', () => {
    it('should initialize and start scanning', async () => {
      await bleService.initialize();
      expect(noble.startScanningAsync).toHaveBeenCalled();
      expect(bleService.isScanning).toBe(true);
    });

    it('should handle initialization errors', async () => {
      noble.startScanningAsync.mockRejectedValue(new Error('Scan failed'));
      await expect(bleService.initialize()).rejects.toThrow(BLEScanError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup properly', async () => {
      bleService.isScanning = true;
      await bleService.cleanup();
      expect(noble.stopScanningAsync).toHaveBeenCalled();
      expect(bleService.isScanning).toBe(false);
    });

    it('should handle cleanup errors gracefully', async () => {
      bleService.isScanning = true;
      bleService._testSkipCleanup = true; // Skip afterEach cleanup
      noble.stopScanningAsync.mockRejectedValue(new Error('Stop failed'));
      await expect(bleService.cleanup()).rejects.toThrow(BLEScanError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('device connection', () => {
    const deviceId = 'test-device';

    beforeEach(() => {
      bleService.discoveredDevices.set(deviceId, mockDevice);
    });

    it('should connect to device successfully', async () => {
      await bleService.connectToDevice(deviceId);
      expect(mockDevice.connect).toHaveBeenCalled();
      expect(bleService.connectedDevices.has(deviceId)).toBe(true);
      expect(mockDevice.once).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should handle connection timeout', async () => {
      mockDevice.connect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      await expect(bleService.connectToDevice(deviceId)).rejects.toThrow('Connection timeout');
    });

    it('should handle connection errors with retries', async () => {
      const error = new Error('Connection failed');
      mockDevice.connect
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce();

      await bleService.connectToDevice(deviceId);
      expect(mockDevice.connect).toHaveBeenCalledTimes(3);
      expect(bleService.connectedDevices.has(deviceId)).toBe(true);
    });
  });

  describe('characteristic operations', () => {
    const deviceId = 'test-device';
    const serviceId = 'test-service';
    const characteristicId = 'test-characteristic';

    beforeEach(() => {
      bleService.connectedDevices.set(deviceId, mockDevice);
    });

    it('should read characteristic successfully', async () => {
      const mockValue = Buffer.from('test');
      mockCharacteristic.read.mockResolvedValue(mockValue);

      const result = await bleService.readCharacteristic(deviceId, serviceId, characteristicId);
      expect(result).toBe(mockValue);
      expect(mockDevice.discoverServices).toHaveBeenCalled();
      expect(mockService.discoverCharacteristics).toHaveBeenCalled();
    });

    it('should handle read errors with retries', async () => {
      const error = new Error('Read failed');
      mockCharacteristic.read
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue(Buffer.from('test'));

      const result = await bleService.readCharacteristic(deviceId, serviceId, characteristicId);
      expect(mockCharacteristic.read).toHaveBeenCalledTimes(3);
      expect(result).toEqual(Buffer.from('test'));
    });

    it('should write characteristic successfully', async () => {
      const data = Buffer.from('test');
      await bleService.writeCharacteristic(deviceId, serviceId, characteristicId, data);
      expect(mockCharacteristic.write).toHaveBeenCalledWith(data);
      expect(mockDevice.discoverServices).toHaveBeenCalled();
      expect(mockService.discoverCharacteristics).toHaveBeenCalled();
    });

    it('should handle write errors with retries', async () => {
      const error = new Error('Write failed');
      mockCharacteristic.write
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue();

      await bleService.writeCharacteristic(deviceId, serviceId, characteristicId, Buffer.from('test'));
      expect(mockCharacteristic.write).toHaveBeenCalledTimes(3);
    });

    it('should handle subscribe errors with retries', async () => {
      const error = new Error('Subscribe failed');
      mockCharacteristic.subscribe
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue();

      await bleService.subscribeToCharacteristic(deviceId, serviceId, characteristicId, () => {});
      expect(mockCharacteristic.subscribe).toHaveBeenCalledTimes(3);
    });

    it('should handle unsubscribe errors with retries', async () => {
      const error = new Error('Unsubscribe failed');
      mockCharacteristic.unsubscribe
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue();

      await bleService.unsubscribeFromCharacteristic(deviceId, serviceId, characteristicId);
      expect(mockCharacteristic.unsubscribe).toHaveBeenCalledTimes(3);
    });
  });

  describe('device management', () => {
    it('should return discovered devices', () => {
      bleService.discoveredDevices.set(mockDevice.id, mockDevice);
      const devices = bleService.getDiscoveredDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toBe(mockDevice);
    });

    it('should return connected devices', () => {
      bleService.connectedDevices.set(mockDevice.id, mockDevice);
      const devices = bleService.getConnectedDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toBe(mockDevice);
    });
  });
}); 