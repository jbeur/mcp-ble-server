const { ConnectionParameters } = require('../../../src/ble/ConnectionParameters');
const assert = require('assert');

describe('Connection Parameters', () => {
  let connectionParams;

  beforeEach(() => {
    connectionParams = new ConnectionParameters();
  });

  describe('parameter optimization', () => {
    it('should set and get device-specific parameters', async () => {
      const params = {
        connectionInterval: 100,
        latency: 0,
        supervisionTimeout: 1000
      };
            
      await connectionParams.setDeviceParameters('device1', params);
      const currentParams = await connectionParams.getDeviceParameters('device1');
            
      assert.deepStrictEqual(currentParams, params);
    });

    it('should validate parameter ranges', async () => {
      const invalidParams = {
        connectionInterval: 5, // Too low
        latency: -1, // Invalid
        supervisionTimeout: 500 // Too low for given interval
      };

      await assert.rejects(
        () => connectionParams.setDeviceParameters('device1', invalidParams),
        { message: /Invalid connection parameters/ }
      );
    });

    it('should optimize parameters based on device usage', async () => {
      // Record some connection events
      const device = { id: 'device1', name: 'Test Device' };
            
      // Simulate high data transfer rate
      for (let i = 0; i < 10; i++) {
        await connectionParams.recordDataTransfer(device.id, 1000); // 1KB transfer
      }
            
      const optimizedParams = await connectionParams.getOptimizedParameters(device.id);
            
      // High data rate should result in shorter connection interval
      assert(optimizedParams.connectionInterval <= 100, 'Should have short connection interval for high data rate');
      assert(optimizedParams.latency === 0, 'Should have no latency for high data rate');
    });

    it('should adapt parameters based on battery level', async () => {
      const device = { id: 'device1', name: 'Test Device' };
            
      // Test with high battery
      await connectionParams.updateDeviceBattery(device.id, 90);
      let params = await connectionParams.getOptimizedParameters(device.id);
      const highBatteryInterval = params.connectionInterval;
            
      // Test with low battery
      await connectionParams.updateDeviceBattery(device.id, 20);
      params = await connectionParams.getOptimizedParameters(device.id);
            
      assert(params.connectionInterval > highBatteryInterval, 'Should increase interval for low battery');
      assert(params.latency > 0, 'Should allow latency for low battery');
    });

    it('should handle priority-based optimization', async () => {
      const devices = [
        { id: 'device1', priority: 'high' },
        { id: 'device2', priority: 'low' }
      ];
            
      // Set priorities and simulate some data transfers
      for (const device of devices) {
        await connectionParams.setPriority(device.id, device.priority);
        await connectionParams.recordDataTransfer(device.id, 500);
      }
            
      const highPriorityParams = await connectionParams.getOptimizedParameters(devices[0].id);
      const lowPriorityParams = await connectionParams.getOptimizedParameters(devices[1].id);
            
      assert(highPriorityParams.connectionInterval < lowPriorityParams.connectionInterval,
        'High priority should have shorter interval');
    });

    it('should optimize power consumption', async () => {
      const device = { id: 'device1', name: 'Test Device' };
            
      // Record power consumption metrics
      await connectionParams.recordPowerMetrics(device.id, {
        txPower: 100,
        rxPower: 80,
        batteryDrain: 0.5
      });
            
      const params = await connectionParams.getOptimizedParameters(device.id);
            
      // Verify power optimization
      assert(params.connectionInterval >= 50, 'Should not use very short intervals');
      assert(params.latency >= 0, 'Should use latency when appropriate');
      assert(params.supervisionTimeout >= params.connectionInterval * (params.latency + 1) * 2,
        'Supervision timeout should be appropriate');
    });

    it('should handle connection stability metrics', async () => {
      const device = { id: 'device1', name: 'Test Device' };
            
      // Simulate some connection drops
      await connectionParams.recordConnectionDrop(device.id, { reason: 'timeout' });
      await connectionParams.recordConnectionDrop(device.id, { reason: 'timeout' });
            
      const params = await connectionParams.getOptimizedParameters(device.id);
            
      // Should adjust for stability
      assert(params.supervisionTimeout > 2000, 'Should increase supervision timeout');
      assert(params.latency === 0, 'Should disable latency for unstable connections');
    });
  });
}); 