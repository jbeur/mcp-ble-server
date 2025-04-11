const { logger } = require('../utils/logger');

class DeviceDiscoveryOptimization {
  constructor(config = {}) {
    this.config = {
      minScanWindow: 100, // 100ms
      maxScanWindow: 10000, // 10s
      defaultScanWindow: 1000, // 1s
      successRateThreshold: 0.7,
      adjustmentFactor: 0.2,
      ...config
    };

    this.metrics = {
      totalScans: 0,
      successfulScans: 0,
      totalWindowTime: 0,
      deviceDensityHistory: [],
      successRateHistory: []
    };

    // Track current window size
    this.currentWindow = this.config.defaultScanWindow;
  }

  async calculateOptimalScanWindow(deviceDensity) {
    try {
      if (typeof deviceDensity !== 'number' || deviceDensity < 0) {
        throw new Error('Invalid device density value');
      }

      // Base window calculation on device density
      let baseWindow = this.config.defaultScanWindow;
            
      // Adjust window based on device density
      if (deviceDensity > 10) {
        baseWindow *= 1.5; // Increase window for high density
      } else if (deviceDensity < 5) {
        baseWindow *= 0.8; // Decrease window for low density
      }

      // Ensure window stays within bounds
      const scanWindow = Math.min(
        Math.max(baseWindow, this.config.minScanWindow),
        this.config.maxScanWindow
      );

      // Update metrics and current window
      this.metrics.totalScans++;
      this.metrics.totalWindowTime += scanWindow;
      this.metrics.deviceDensityHistory.push(deviceDensity);
      this.currentWindow = scanWindow;

      logger.debug('Scan window optimization:', {
        deviceDensity,
        calculatedWindow: scanWindow,
        metrics: this.getScanWindowMetrics()
      });

      return scanWindow;
    } catch (error) {
      logger.error('Error calculating optimal scan window:', error);
      return this.config.defaultScanWindow;
    }
  }

  async adjustScanWindow(successRate) {
    try {
      if (typeof successRate !== 'number' || successRate < 0 || successRate > 1) {
        throw new Error('Invalid success rate value');
      }

      // Calculate base window size inversely proportional to success rate
      const baseWindow = this.config.defaultScanWindow * (1 / (successRate || 0.1));
            
      // Apply adjustment factor
      const adjustmentFactor = Math.max(0, this.config.successRateThreshold - successRate);
      const adjustedWindow = baseWindow * (1 + adjustmentFactor);

      // Ensure window stays within bounds
      const newWindow = Math.min(
        Math.max(adjustedWindow, this.config.minScanWindow),
        this.config.maxScanWindow
      );

      // Update metrics
      this.metrics.successRateHistory.push(successRate);
      if (successRate >= this.config.successRateThreshold) {
        this.metrics.successfulScans++;
      }
      this.currentWindow = newWindow;

      logger.debug('Scan window adjustment:', {
        successRate,
        baseWindow,
        adjustmentFactor,
        newWindow,
        metrics: this.getScanWindowMetrics()
      });

      return newWindow;
    } catch (error) {
      logger.error('Error adjusting scan window:', error);
      return this.config.defaultScanWindow;
    }
  }

  getScanWindowMetrics() {
    const totalScans = this.metrics.totalScans || 0;
    const successfulScans = this.metrics.successfulScans || 0;
    const totalWindowTime = this.metrics.totalWindowTime || 0;
    const deviceDensityHistory = this.metrics.deviceDensityHistory || [];
    const successRateHistory = this.metrics.successRateHistory || [];

    return {
      totalScans,
      successfulScans,
      averageWindow: totalScans > 0 ? totalWindowTime / totalScans : 0,
      successRate: totalScans > 0 ? successfulScans / totalScans : 0,
      averageDeviceDensity: deviceDensityHistory.length > 0
        ? deviceDensityHistory.reduce((a, b) => a + b, 0) / deviceDensityHistory.length
        : 0,
      averageSuccessRate: successRateHistory.length > 0
        ? successRateHistory.reduce((a, b) => a + b, 0) / successRateHistory.length
        : 0,
      currentWindow: this.currentWindow,
      minWindow: this.config.minScanWindow,
      maxWindow: this.config.maxScanWindow
    };
  }
}

module.exports = {
  DeviceDiscoveryOptimization
}; 