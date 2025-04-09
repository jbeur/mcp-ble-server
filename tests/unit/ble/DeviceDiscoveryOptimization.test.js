const { DeviceDiscoveryOptimization } = require('../../../src/ble/DeviceDiscoveryOptimization');
const assert = require('assert');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

describe('Device Discovery Optimization', () => {
  let discoveryOptimization;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    discoveryOptimization = new DeviceDiscoveryOptimization();
  });

  describe('scan window optimization', () => {
    it('should calculate optimal scan window based on device density', async () => {
      const deviceDensity = 10; // 10 devices per scan
      const scanWindow = await discoveryOptimization.calculateOptimalScanWindow(deviceDensity);
            
      assert(scanWindow > 0, 'Scan window should be positive');
      assert(scanWindow <= 10000, 'Scan window should not exceed 10 seconds');
    });

    it('should adjust scan window based on discovery success rate', async () => {
      // Simulate different discovery success rates
      const successRates = [0.2, 0.5, 0.8];
      const scanWindows = await Promise.all(
        successRates.map(rate => discoveryOptimization.adjustScanWindow(rate))
      );

      // Verify scan windows increase with lower success rates
      assert(scanWindows[0] > scanWindows[1], 'Lower success rate should result in longer scan window');
      assert(scanWindows[1] > scanWindows[2], 'Lower success rate should result in longer scan window');
    });

    it('should maintain scan window within configured bounds', async () => {
      const minWindow = 100; // 100ms
      const maxWindow = 10000; // 10s
            
      // Test with extreme values
      const lowDensity = 1;
      const highDensity = 100;
            
      const lowWindow = await discoveryOptimization.calculateOptimalScanWindow(lowDensity);
      const highWindow = await discoveryOptimization.calculateOptimalScanWindow(highDensity);
            
      assert(lowWindow >= minWindow, 'Scan window should not be below minimum');
      assert(highWindow <= maxWindow, 'Scan window should not exceed maximum');
    });

    it('should track scan window performance metrics', async () => {
      const deviceDensity = 5;
      await discoveryOptimization.calculateOptimalScanWindow(deviceDensity);
            
      const metrics = discoveryOptimization.getScanWindowMetrics();
      assert(metrics.totalScans > 0, 'Should track total number of scans');
      assert(metrics.averageWindow > 0, 'Should track average scan window');
      assert(metrics.successRate >= 0 && metrics.successRate <= 1, 'Should track success rate');
    });

    it('should handle dynamic device density changes', async () => {
      const initialDensity = 5;
      const finalDensity = 20;
            
      // Simulate changing device density
      const initialWindow = await discoveryOptimization.calculateOptimalScanWindow(initialDensity);
      const finalWindow = await discoveryOptimization.calculateOptimalScanWindow(finalDensity);
            
      assert(finalWindow !== initialWindow, 'Scan window should adjust to density changes');
    });
  });
}); 