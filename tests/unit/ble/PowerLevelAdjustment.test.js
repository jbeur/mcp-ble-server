const { PowerLevelAdjustment } = require('../../../src/ble/PowerLevelAdjustment');
const assert = require('assert');

describe('Power Level Adjustment', () => {
  let powerAdjustment;

  beforeEach(() => {
    powerAdjustment = new PowerLevelAdjustment();
  });

  describe('power level management', () => {
    it('should set and get device-specific power levels', async () => {
      const deviceId = 'device1';
      const powerLevel = 0; // 0 dBm
            
      await powerAdjustment.setDevicePowerLevel(deviceId, powerLevel);
      const currentLevel = await powerAdjustment.getDevicePowerLevel(deviceId);
            
      assert.strictEqual(currentLevel, powerLevel);
    });

    it('should validate power level ranges', async () => {
      const deviceId = 'device1';
      const invalidLevel = 5; // Invalid power level
            
      await assert.rejects(
        () => powerAdjustment.setDevicePowerLevel(deviceId, invalidLevel),
        { message: /Invalid power level/ }
      );
    });

    it('should optimize power level based on RSSI', async () => {
      const deviceId = 'device1';
            
      // Test with strong signal
      await powerAdjustment.recordRSSI(deviceId, -50);
      let powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
      const strongSignalLevel = powerLevel;
            
      // Test with weak signal
      await powerAdjustment.recordRSSI(deviceId, -90);
      powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
            
      assert(powerLevel > strongSignalLevel, 'Should increase power for weak signal');
    });

    it('should adapt power level based on battery level', async () => {
      const deviceId = 'device1';
            
      // Test with high battery
      await powerAdjustment.updateDeviceBattery(deviceId, 90);
      let powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
      const highBatteryLevel = powerLevel;
            
      // Test with low battery
      await powerAdjustment.updateDeviceBattery(deviceId, 20);
      powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
            
      assert(powerLevel < highBatteryLevel, 'Should decrease power for low battery');
    });

    it('should handle priority-based power adjustment', async () => {
      const devices = [
        { id: 'device1', priority: 'high' },
        { id: 'device2', priority: 'low' }
      ];
            
      // Set priorities and simulate some RSSI values
      for (const device of devices) {
        await powerAdjustment.setPriority(device.id, device.priority);
        await powerAdjustment.recordRSSI(device.id, -70);
      }
            
      const highPriorityLevel = await powerAdjustment.getOptimizedPowerLevel(devices[0].id);
      const lowPriorityLevel = await powerAdjustment.getOptimizedPowerLevel(devices[1].id);
            
      assert(highPriorityLevel > lowPriorityLevel,
        'High priority should have higher power level');
    });

    it('should optimize power consumption', async () => {
      const deviceId = 'device1';
            
      // Record power consumption metrics
      await powerAdjustment.recordPowerMetrics(deviceId, {
        txPower: 100,
        rxPower: 80,
        batteryDrain: 0.5
      });
            
      const powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
            
      // Verify power optimization
      assert(powerLevel <= 0, 'Should not use maximum power unnecessarily');
    });

    it('should handle connection stability metrics', async () => {
      const deviceId = 'device1';
            
      // Simulate some connection drops
      await powerAdjustment.recordConnectionDrop(deviceId, { reason: 'timeout' });
      await powerAdjustment.recordConnectionDrop(deviceId, { reason: 'timeout' });
            
      const powerLevel = await powerAdjustment.getOptimizedPowerLevel(deviceId);
            
      // Should increase power for unstable connections
      assert(powerLevel >= 0, 'Should use maximum power for unstable connections');
    });

    it('should track power level history', async () => {
      const deviceId = 'device1';
            
      // Record some power level changes
      await powerAdjustment.setDevicePowerLevel(deviceId, -20);
      await powerAdjustment.setDevicePowerLevel(deviceId, -10);
      await powerAdjustment.setDevicePowerLevel(deviceId, 0);
            
      const history = await powerAdjustment.getPowerLevelHistory(deviceId);
            
      assert.strictEqual(history.length, 3);
      assert.deepStrictEqual(history, [-20, -10, 0]);
    });
  });
}); 