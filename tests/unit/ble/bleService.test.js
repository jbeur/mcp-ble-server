const noble = require('@abandonware/noble');
const BLEService = require('../../../src/ble/bleService');
const { BLEScanError, BLEConnectionError, BLECharacteristicError } = require('../../../src/utils/bleErrors');
const { logger } = require('../../../src/utils/logger');

jest.mock('@abandonware/noble');
jest.mock('../../../src/utils/logger');

// Increase Jest timeout for all tests
jest.setTimeout(60000);

describe('BLEService', () => {
  let bleService;
  const mockDevice = {
    id: 'test-device',
    connect: jest.fn(),
    on: jest.fn(),
    discoverService: jest.fn(),
  };
  const mockService = {
    discoverCharacteristic: jest.fn(),
  };
  const mockCharacteristic = {
    read: jest.fn(),
    write: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bleService = new BLEService({
      max_retries: 3,
      retry_delay: 100,
      connection_timeout: 500,
    });
    noble.startScanningAsync.mockResolvedValue();
    noble.stopScanningAsync.mockResolvedValue();
    mockDevice.connect.mockResolvedValue();
    mockDevice.discoverService.mockResolvedValue(mockService);
    mockService.discoverCharacteristic.mockResolvedValue(mockCharacteristic);
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
    });

    it('should handle connection timeout', async () => {
      mockDevice.connect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      await expect(bleService.connectToDevice(deviceId)).rejects.toThrow(BLEConnectionError);
    });

    it('should handle connection errors with retries', async () => {
      mockDevice.connect
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValue();

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
    });

    it('should handle read errors with retries', async () => {
      mockCharacteristic.read
        .mockRejectedValueOnce(new Error('Read failed'))
        .mockRejectedValueOnce(new Error('Read failed'))
        .mockResolvedValue(Buffer.from('test'));

      await bleService.readCharacteristic(deviceId, serviceId, characteristicId);
      expect(mockCharacteristic.read).toHaveBeenCalledTimes(3);
    });

    it('should write characteristic successfully', async () => {
      const data = Buffer.from('test');
      await bleService.writeCharacteristic(deviceId, serviceId, characteristicId, data);
      expect(mockCharacteristic.write).toHaveBeenCalledWith(data);
    });

    it('should handle write errors with retries', async () => {
      mockCharacteristic.write
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValue();

      await bleService.writeCharacteristic(deviceId, serviceId, characteristicId, Buffer.from('test'));
      expect(mockCharacteristic.write).toHaveBeenCalledTimes(3);
    });

    it('should handle subscribe errors with retries', async () => {
      mockCharacteristic.subscribe
        .mockRejectedValueOnce(new Error('Subscribe failed'))
        .mockRejectedValueOnce(new Error('Subscribe failed'))
        .mockResolvedValue();

      await bleService.subscribeToCharacteristic(deviceId, serviceId, characteristicId);
      expect(mockCharacteristic.subscribe).toHaveBeenCalledTimes(3);
    });

    it('should handle unsubscribe errors with retries', async () => {
      mockCharacteristic.unsubscribe
        .mockRejectedValueOnce(new Error('Unsubscribe failed'))
        .mockRejectedValueOnce(new Error('Unsubscribe failed'))
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