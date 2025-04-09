const { logger } = require('../utils/logger');

class PowerLevelAdjustment {
  constructor(config = {}) {
    this.config = {
      minPowerLevel: -20,  // -20 dBm
      maxPowerLevel: 0,    // 0 dBm
      rssiThresholds: {
        excellent: -50,  // Above -50 dBm
        good: -70,       // Above -70 dBm
        fair: -85,       // Above -85 dBm
        poor: -100       // Above -100 dBm
      },
      batteryThresholds: {
        low: 20,     // Below 20% is low
        medium: 50,  // Below 50% is medium
        high: 100    // Below 100% is high
      },
      ...config
    };

    this.devicePowerLevels = new Map();
    this.deviceMetrics = new Map();
    this.devicePriorities = new Map();
    this.powerLevelHistory = new Map();
  }

  async setDevicePowerLevel(deviceId, powerLevel) {
    try {
      this._validatePowerLevel(powerLevel);
      this.devicePowerLevels.set(deviceId, powerLevel);
            
      // Track power level history
      if (!this.powerLevelHistory.has(deviceId)) {
        this.powerLevelHistory.set(deviceId, []);
      }
      this.powerLevelHistory.get(deviceId).push(powerLevel);
            
      // Keep only last 10 power levels
      if (this.powerLevelHistory.get(deviceId).length > 10) {
        this.powerLevelHistory.get(deviceId).shift();
      }
            
      logger.debug('Device power level updated:', { deviceId, powerLevel });
    } catch (error) {
      logger.error('Error setting device power level:', error);
      throw error;
    }
  }

  async getDevicePowerLevel(deviceId) {
    const powerLevel = this.devicePowerLevels.get(deviceId);
    return powerLevel !== undefined ? powerLevel : this.config.minPowerLevel;
  }

  async recordRSSI(deviceId, rssi) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      const now = Date.now();

      metrics.rssiReadings.push({
        timestamp: now,
        value: rssi
      });

      // Keep only last minute of readings
      const oneMinuteAgo = now - 60000;
      metrics.rssiReadings = metrics.rssiReadings.filter(r => r.timestamp > oneMinuteAgo);

      this.deviceMetrics.set(deviceId, metrics);
      logger.debug('RSSI recorded:', { deviceId, rssi });
    } catch (error) {
      logger.error('Error recording RSSI:', error);
      throw error;
    }
  }

  async updateDeviceBattery(deviceId, level) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      metrics.batteryLevel = level;
      this.deviceMetrics.set(deviceId, metrics);
      logger.debug('Battery level updated:', { deviceId, level });
    } catch (error) {
      logger.error('Error updating battery level:', error);
      throw error;
    }
  }

  async setPriority(deviceId, priority) {
    try {
      if (!['high', 'medium', 'low'].includes(priority)) {
        throw new Error(`Invalid priority value: ${priority}`);
      }
      this.devicePriorities.set(deviceId, priority);
      logger.debug('Device priority set:', { deviceId, priority });
    } catch (error) {
      logger.error('Error setting device priority:', error);
      throw error;
    }
  }

  async recordPowerMetrics(deviceId, metrics) {
    try {
      const deviceMetrics = this._getDeviceMetrics(deviceId);
      deviceMetrics.powerMetrics = {
        timestamp: Date.now(),
        ...metrics
      };
      this.deviceMetrics.set(deviceId, deviceMetrics);
      logger.debug('Power metrics recorded:', { deviceId, metrics });
    } catch (error) {
      logger.error('Error recording power metrics:', error);
      throw error;
    }
  }

  async recordConnectionDrop(deviceId, details) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      metrics.connectionDrops.push({
        timestamp: Date.now(),
        ...details
      });

      // Keep only last 10 drops
      if (metrics.connectionDrops.length > 10) {
        metrics.connectionDrops.shift();
      }

      this.deviceMetrics.set(deviceId, metrics);
      logger.debug('Connection drop recorded:', { deviceId, details });
    } catch (error) {
      logger.error('Error recording connection drop:', error);
      throw error;
    }
  }

  async getOptimizedPowerLevel(deviceId) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      const priority = this.devicePriorities.get(deviceId) || 'medium';
            
      // Calculate average RSSI
      const avgRSSI = this._calculateAverageRSSI(metrics.rssiReadings);
            
      // Base power level based on priority
      let powerLevel = this._getBasePowerLevel(priority);
            
      // Adjust for RSSI
      if (avgRSSI !== undefined) {
        powerLevel = this._adjustForRSSI(powerLevel, avgRSSI);
      }
            
      // Adjust for battery level
      if (metrics.batteryLevel !== undefined) {
        powerLevel = this._adjustForBattery(powerLevel, metrics.batteryLevel);
      }
            
      // Adjust for connection stability
      if (metrics.connectionDrops.length > 0) {
        powerLevel = this._adjustForStability(powerLevel, metrics.connectionDrops);
      }
            
      // Adjust for power consumption
      if (metrics.powerMetrics) {
        powerLevel = this._adjustForPower(powerLevel, metrics.powerMetrics);
      }
            
      // Validate final power level
      this._validatePowerLevel(powerLevel);
            
      logger.debug('Optimized power level:', { deviceId, powerLevel });
      return powerLevel;
    } catch (error) {
      logger.error('Error optimizing power level:', error);
      throw error;
    }
  }

  async getPowerLevelHistory(deviceId) {
    return this.powerLevelHistory.get(deviceId) || [];
  }

  _validatePowerLevel(powerLevel) {
    if (powerLevel < this.config.minPowerLevel || powerLevel > this.config.maxPowerLevel) {
      throw new Error('Invalid power level');
    }
  }

  _getDeviceMetrics(deviceId) {
    return this.deviceMetrics.get(deviceId) || {
      rssiReadings: [],
      connectionDrops: [],
      batteryLevel: undefined,
      powerMetrics: undefined
    };
  }

  _getBasePowerLevel(priority) {
    switch (priority) {
    case 'high':
      return 0; // Maximum power
    case 'low':
      return -10; // Lower power
    default: // medium
      return -5; // Medium power
    }
  }

  _calculateAverageRSSI(readings) {
    if (!readings || readings.length === 0) return undefined;
        
    const sum = readings.reduce((acc, r) => acc + r.value, 0);
    return sum / readings.length;
  }

  _adjustForRSSI(powerLevel, rssi) {
    const { rssiThresholds } = this.config;
        
    if (rssi <= rssiThresholds.poor) {
      return this.config.maxPowerLevel; // Maximum power for poor signal
    } else if (rssi <= rssiThresholds.fair) {
      return Math.max(powerLevel, -5); // Higher power for fair signal
    } else if (rssi <= rssiThresholds.good) {
      return Math.max(powerLevel, -10); // Medium power for good signal
    } else {
      return Math.min(powerLevel, -15); // Lower power for excellent signal
    }
  }

  _adjustForBattery(powerLevel, batteryLevel) {
    const { batteryThresholds } = this.config;
        
    if (batteryLevel <= batteryThresholds.low) {
      return Math.min(powerLevel, -15); // Lower power for low battery
    } else if (batteryLevel >= batteryThresholds.high) {
      return powerLevel; // No adjustment for high battery
    }
        
    return powerLevel;
  }

  _adjustForStability(powerLevel, drops) {
    const recentDrops = drops.filter(d => 
      d.timestamp > Date.now() - 300000 // Last 5 minutes
    ).length;

    if (recentDrops >= 2) {
      return this.config.maxPowerLevel; // Maximum power for unstable connections
    }
        
    return powerLevel;
  }

  _adjustForPower(powerLevel, powerMetrics) {
    const { batteryDrain } = powerMetrics;
        
    if (batteryDrain > 1.0) { // High power consumption
      return Math.min(powerLevel, -10); // Lower power to reduce consumption
    }
        
    return powerLevel;
  }
}

module.exports = {
  PowerLevelAdjustment
}; 