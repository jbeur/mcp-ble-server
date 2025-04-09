const BLEService = require('../../src/ble/bleService');
const logger = require('../../src/utils/logger');

// Mock device data
const mockDevices = [
  { id: 'device1', name: 'Mock Device 1', address: '00:11:22:33:44:55' },
  { id: 'device2', name: 'Mock Device 2', address: '11:22:33:44:55:66' },
  { id: 'device3', name: 'Mock Device 3', address: '22:33:44:55:66:77' },
  { id: 'device4', name: 'Mock Device 4', address: '33:44:55:66:77:88' },
  { id: 'device5', name: 'Mock Device 5', address: '44:55:66:77:88:99' }
];

// Mock characteristic data
const mockCharacteristics = {
  'char1': Buffer.from('test data 1'),
  'char2': Buffer.from('test data 2'),
  'char3': Buffer.from('test data 3')
};

describe('BLEService Performance Tests', () => {
  let bleService;

  beforeEach(() => {
    // Create BLEService with mock config
    const mockConfig = {
      max_retries: 3,
      retry_delay: 100,
      connection_timeout: 1000,
      auto_reconnect: true
    };

    bleService = new BLEService(mockConfig);

    // Mock the discovery method
    bleService.startDiscovery = jest.fn().mockImplementation(() => {
      bleService.emit('deviceDiscovered', mockDevices[0]);
      bleService.emit('deviceDiscovered', mockDevices[1]);
      bleService.emit('deviceDiscovered', mockDevices[2]);
      return Promise.resolve();
    });

    // Mock the connect method
    bleService.connectToDevice = jest.fn().mockImplementation((deviceId) => {
      const device = mockDevices.find(d => d.id === deviceId);
      if (!device) {
        throw new Error('Device not found');
      }
      bleService.connectedDevices.set(deviceId, device);
      return Promise.resolve(device);
    });

    // Mock characteristic operations
    bleService.readCharacteristic = jest.fn().mockImplementation((deviceId, charId) => {
      if (!bleService.connectedDevices.has(deviceId)) {
        throw new Error('Device not connected');
      }
      return Promise.resolve(mockCharacteristics[charId] || Buffer.from('default data'));
    });

    bleService.writeCharacteristic = jest.fn().mockImplementation((deviceId, charId, data) => {
      if (!bleService.connectedDevices.has(deviceId)) {
        throw new Error('Device not connected');
      }
      mockCharacteristics[charId] = data;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection Performance', () => {
    it('should handle multiple concurrent connections efficiently', async () => {
      const numConnections = 5;
      const startTime = Date.now();
      const connections = [];

      for (let i = 0; i < numConnections; i++) {
        connections.push(bleService.connectToDevice(`device${i + 1}`));
      }

      await Promise.all(connections);
      const totalTime = Date.now() - startTime;

      console.log('Connection Performance:', {
        numConnections,
        totalTime,
        avgTimePerConnection: totalTime / numConnections,
        timestamp: new Date().toISOString()
      });

      expect(totalTime).toBeLessThan(5000);
      expect(bleService.connectedDevices.size).toBe(numConnections);
    });

    it('should handle rapid connect/disconnect cycles efficiently', async () => {
      const numCycles = 20;
      const deviceId = 'device1';
      const cycleTimes = [];

      for (let i = 0; i < numCycles; i++) {
        const cycleStart = Date.now();
        await bleService.connectToDevice(deviceId);
        await bleService.disconnectDevice(deviceId);
        cycleTimes.push(Date.now() - cycleStart);
      }

      const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / numCycles;
      const maxCycleTime = Math.max(...cycleTimes);

      console.log('Connect/Disconnect Cycle Performance:', {
        numCycles,
        avgCycleTime,
        maxCycleTime,
        timestamp: new Date().toISOString()
      });

      expect(avgCycleTime).toBeLessThan(200);
      expect(maxCycleTime).toBeLessThan(500);
    });
  });

  describe('Characteristic Operation Performance', () => {
    it('should handle multiple concurrent characteristic operations efficiently', async () => {
      const deviceId = 'device1';
      const numOperations = 10;
      const operations = [];

      await bleService.connectToDevice(deviceId);

      const startTime = Date.now();

      for (let i = 0; i < numOperations; i++) {
        operations.push(bleService.readCharacteristic(deviceId, `char${(i % 3) + 1}`));
        operations.push(bleService.writeCharacteristic(deviceId, `char${(i % 3) + 1}`, Buffer.from(`test data ${i}`)));
      }

      await Promise.all(operations);
      const totalTime = Date.now() - startTime;

      console.log('Characteristic Operations Performance:', {
        numOperations: operations.length,
        totalTime,
        avgTimePerOperation: totalTime / operations.length,
        timestamp: new Date().toISOString()
      });

      expect(totalTime).toBeLessThan(3000);
    });

    it('should handle rapid read/write cycles efficiently', async () => {
      const deviceId = 'device1';
      const numCycles = 50;
      const cycleTimes = [];

      await bleService.connectToDevice(deviceId);

      for (let i = 0; i < numCycles; i++) {
        const cycleStart = Date.now();
        await bleService.writeCharacteristic(deviceId, 'char1', Buffer.from(`test data ${i}`));
        await bleService.readCharacteristic(deviceId, 'char1');
        cycleTimes.push(Date.now() - cycleStart);
      }

      const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / numCycles;
      const maxCycleTime = Math.max(...cycleTimes);

      console.log('Read/Write Cycle Performance:', {
        numCycles,
        avgCycleTime,
        maxCycleTime,
        timestamp: new Date().toISOString()
      });

      expect(avgCycleTime).toBeLessThan(100);
      expect(maxCycleTime).toBeLessThan(200);
    });
  });

  describe('Device Discovery Performance', () => {
    it('should handle multiple concurrent device discoveries efficiently', async () => {
      const numDiscoveries = 3;
      const discoveries = [];
      const startTime = Date.now();

      for (let i = 0; i < numDiscoveries; i++) {
        discoveries.push(bleService.startDiscovery());
      }

      await Promise.all(discoveries);
      const totalTime = Date.now() - startTime;

      console.log('Device Discovery Performance:', {
        numDiscoveries,
        totalTime,
        avgTimePerDiscovery: totalTime / numDiscoveries,
        timestamp: new Date().toISOString()
      });

      expect(totalTime).toBeLessThan(5000);
      expect(bleService.startDiscovery).toHaveBeenCalledTimes(numDiscoveries);
    });
  });
});