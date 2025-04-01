const BLEService = require('../../../src/ble/bleService');
const { MockDevice, MockService, MockCharacteristic } = require('../../helpers/mockDevice');
const { logger } = require('../../../src/utils/logger');

jest.mock('../../../src/utils/logger');

describe('BLE Device Communication Integration', () => {
  let bleService;
  let mockDevice;
  let mockService;
  let mockCharacteristic;

  const TEST_SERVICE_UUID = '180f';
  const TEST_CHARACTERISTIC_UUID = '2a19';
  const TEST_DEVICE_ID = 'test-device-1';
  const TEST_DEVICE_NAME = 'Test Device';

  beforeEach(() => {
    // Create mock characteristic
    mockCharacteristic = new MockCharacteristic(TEST_CHARACTERISTIC_UUID, ['read', 'write', 'notify']);
    
    // Create mock service
    mockService = new MockService(TEST_SERVICE_UUID, [mockCharacteristic]);
    
    // Create mock device
    mockDevice = new MockDevice(TEST_DEVICE_ID, TEST_DEVICE_NAME, [mockService]);
    
    // Initialize BLE service
    bleService = new BLEService({
      max_retries: 3,
      retry_delay: 100,
      connection_timeout: 500,
    });
  });

  afterEach(async () => {
    // Clean up BLE service
    await bleService.cleanup();
    
    // Clean up mocks
    if (mockDevice) {
      mockDevice.cleanup();
    }
    if (mockService) {
      mockService.cleanup();
    }
    if (mockCharacteristic) {
      mockCharacteristic.cleanup();
    }
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Device Discovery and Connection', () => {
    it('should discover and connect to a device', async () => {
      // Initialize BLE service
      await bleService.initialize();
      
      // Simulate device discovery
      bleService.discoveredDevices.set(TEST_DEVICE_ID, mockDevice);
      
      // Connect to device
      await bleService.connectToDevice(TEST_DEVICE_ID);
      
      // Verify connection
      expect(mockDevice.isConnected).toBe(true);
      expect(bleService.connectedDevices.has(TEST_DEVICE_ID)).toBe(true);
    });

    it('should handle device disconnection', async () => {
      // Initialize and connect
      await bleService.initialize();
      bleService.discoveredDevices.set(TEST_DEVICE_ID, mockDevice);
      await bleService.connectToDevice(TEST_DEVICE_ID);
      
      // Verify initial connection
      expect(mockDevice.isConnected).toBe(true);
      expect(bleService.connectedDevices.has(TEST_DEVICE_ID)).toBe(true);
      
      // Disconnect device
      await bleService.disconnectDevice(TEST_DEVICE_ID);
      
      // Wait for disconnect event to be processed
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify disconnection
      expect(mockDevice.isConnected).toBe(false);
      expect(bleService.connectedDevices.has(TEST_DEVICE_ID)).toBe(false);
    });
  });

  describe('Characteristic Operations', () => {
    beforeEach(async () => {
      // Setup connection
      await bleService.initialize();
      bleService.discoveredDevices.set(TEST_DEVICE_ID, mockDevice);
      await bleService.connectToDevice(TEST_DEVICE_ID);
    });

    it('should read characteristic value', async () => {
      const testValue = Buffer.from('test data');
      mockCharacteristic.value = testValue;
      
      const result = await bleService.readCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID
      );
      
      expect(result).toEqual(testValue);
    });

    it('should write characteristic value', async () => {
      const testData = Buffer.from('write test');
      
      await bleService.writeCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID,
        testData
      );
      
      expect(mockCharacteristic.value).toEqual(testData);
    });

    it('should handle characteristic notifications', async () => {
      const notificationData = Buffer.from('notification test');
      let receivedData = null;
      
      // Subscribe to notifications
      await bleService.subscribeToCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID,
        (data) => {
          receivedData = data;
        }
      );
      
      // Simulate notification
      mockCharacteristic.notify(notificationData);
      
      // Verify notification was received
      expect(receivedData).toEqual(notificationData);
      
      // Unsubscribe
      await bleService.unsubscribeFromCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID
      );
      
      // Verify unsubscribed
      expect(mockCharacteristic.subscribers.size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await bleService.initialize();
      bleService.discoveredDevices.set(TEST_DEVICE_ID, mockDevice);
    });

    it('should handle connection timeout', async () => {
      // Simulate slow connection
      mockDevice.connect = () => new Promise(resolve => setTimeout(resolve, 1000));
      
      await expect(bleService.connectToDevice(TEST_DEVICE_ID))
        .rejects
        .toThrow('Connection timeout');
    });

    it('should handle read errors with retries', async () => {
      await bleService.connectToDevice(TEST_DEVICE_ID);
      let readAttempts = 0;
      mockCharacteristic.read = () => {
        readAttempts++;
        if (readAttempts < 3) {
          return Promise.reject(new Error('Read failed'));
        }
        return Promise.resolve(Buffer.from('success'));
      };
      
      const result = await bleService.readCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID
      );
      
      expect(readAttempts).toBe(3);
      expect(result).toEqual(Buffer.from('success'));
    });

    it('should handle write errors with retries', async () => {
      await bleService.connectToDevice(TEST_DEVICE_ID);
      let writeAttempts = 0;
      mockCharacteristic.write = (data) => {
        writeAttempts++;
        if (writeAttempts < 3) {
          return Promise.reject(new Error('Write failed'));
        }
        return Promise.resolve();
      };
      
      await bleService.writeCharacteristic(
        TEST_DEVICE_ID,
        TEST_SERVICE_UUID,
        TEST_CHARACTERISTIC_UUID,
        Buffer.from('test')
      );
      
      expect(writeAttempts).toBe(3);
    });
  });
}); 