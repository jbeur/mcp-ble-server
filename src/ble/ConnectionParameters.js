const { logger } = require('../utils/logger');

class ConnectionParameters {
  constructor(config = {}) {
    this.config = {
      minConnectionInterval: 20,    // 20ms
      maxConnectionInterval: 1000,  // 1000ms
      minSupervisionTimeout: 1000,  // 1000ms
      maxSupervisionTimeout: 10000, // 10000ms
      maxLatency: 10,              // Maximum slave latency
      batteryThresholds: {
        low: 20,     // Below 20% is low
        medium: 50,  // Below 50% is medium
        high: 100    // Below 100% is high
      },
      dataRateThresholds: {
        low: 100,    // Below 100 bytes/s is low
        medium: 500, // Below 500 bytes/s is medium
        high: 1000   // Above 1000 bytes/s is high
      },
      ...config
    };

    this.deviceParameters = new Map();
    this.deviceMetrics = new Map();
    this.devicePriorities = new Map();
  }

  async setDeviceParameters(deviceId, params) {
    try {
      this._validateParameters(params);
      this.deviceParameters.set(deviceId, { ...params });
      logger.debug('Device parameters updated:', { deviceId, params });
    } catch (error) {
      logger.error('Error setting device parameters:', error);
      throw error;
    }
  }

  async getDeviceParameters(deviceId) {
    return this.deviceParameters.get(deviceId) || this._getDefaultParameters();
  }

  async recordDataTransfer(deviceId, bytes) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      const now = Date.now();

      metrics.dataTransfers.push({
        timestamp: now,
        bytes
      });

      // Keep only last minute of transfers
      const oneMinuteAgo = now - 60000;
      metrics.dataTransfers = metrics.dataTransfers.filter(t => t.timestamp > oneMinuteAgo);

      this.deviceMetrics.set(deviceId, metrics);
      logger.debug('Data transfer recorded:', { deviceId, bytes });
    } catch (error) {
      logger.error('Error recording data transfer:', error);
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

  async getOptimizedParameters(deviceId) {
    try {
      const metrics = this._getDeviceMetrics(deviceId);
      const priority = this.devicePriorities.get(deviceId) || 'medium';
            
      // Calculate data rate (bytes/second)
      const dataRate = this._calculateDataRate(metrics.dataTransfers);
            
      // Base parameters adjusted for priority
      let params = this._getBaseParameters(priority);
            
      // Adjust for data rate
      params = this._adjustForDataRate(params, dataRate);
            
      // Adjust for battery level
      if (metrics.batteryLevel !== undefined) {
        params = this._adjustForBattery(params, metrics.batteryLevel);
      }
            
      // Adjust for connection stability
      if (metrics.connectionDrops.length > 0) {
        params = this._adjustForStability(params, metrics.connectionDrops);
      }
            
      // Adjust for power consumption
      if (metrics.powerMetrics) {
        params = this._adjustForPower(params, metrics.powerMetrics);
      }
            
      // Validate final parameters
      this._validateParameters(params);
            
      logger.debug('Optimized parameters:', { deviceId, params });
      return params;
    } catch (error) {
      logger.error('Error optimizing parameters:', error);
      throw error;
    }
  }

  _validateParameters(params) {
    const { connectionInterval, latency, supervisionTimeout } = params;

    if (connectionInterval < this.config.minConnectionInterval || 
            connectionInterval > this.config.maxConnectionInterval) {
      throw new Error('Invalid connection parameters: connection interval out of range');
    }

    if (latency < 0 || latency > this.config.maxLatency) {
      throw new Error('Invalid connection parameters: latency out of range');
    }

    if (supervisionTimeout < this.config.minSupervisionTimeout || 
            supervisionTimeout > this.config.maxSupervisionTimeout) {
      throw new Error('Invalid connection parameters: supervision timeout out of range');
    }

    // Supervision timeout must be greater than connectionInterval * (latency + 1) * 2
    const minTimeout = connectionInterval * (latency + 1) * 2;
    if (supervisionTimeout < minTimeout) {
      throw new Error('Invalid connection parameters: supervision timeout too low');
    }
  }

  _getDeviceMetrics(deviceId) {
    return this.deviceMetrics.get(deviceId) || {
      dataTransfers: [],
      connectionDrops: [],
      batteryLevel: undefined,
      powerMetrics: undefined
    };
  }

  _getDefaultParameters() {
    return {
      connectionInterval: 100,
      latency: 0,
      supervisionTimeout: 2000 // Increased default supervision timeout
    };
  }

  _getBaseParameters(priority) {
    const base = this._getDefaultParameters();
        
    switch (priority) {
    case 'high':
      return {
        ...base,
        connectionInterval: 50,
        latency: 0
      };
    case 'low':
      return {
        ...base,
        connectionInterval: 200,
        latency: 2
      };
    default: // medium
      return base;
    }
  }

  _calculateDataRate(transfers) {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
        
    const recentTransfers = transfers.filter(t => t.timestamp > oneSecondAgo);
    const totalBytes = recentTransfers.reduce((sum, t) => sum + t.bytes, 0);
        
    return totalBytes; // bytes per second
  }

  _adjustForDataRate(params, dataRate) {
    const { dataRateThresholds } = this.config;
        
    if (dataRate >= dataRateThresholds.high) {
      return {
        ...params,
        connectionInterval: Math.min(params.connectionInterval, 50),
        latency: 0
      };
    } else if (dataRate <= dataRateThresholds.low) {
      return {
        ...params,
        connectionInterval: Math.max(params.connectionInterval, 200),
        latency: Math.min(params.latency + 1, this.config.maxLatency)
      };
    }
        
    return params;
  }

  _adjustForBattery(params, batteryLevel) {
    const { batteryThresholds } = this.config;
        
    if (batteryLevel <= batteryThresholds.low) {
      return {
        ...params,
        connectionInterval: Math.max(params.connectionInterval * 2, this.config.minConnectionInterval),
        latency: Math.min(params.latency + 2, this.config.maxLatency),
        supervisionTimeout: Math.min(params.supervisionTimeout * 2, this.config.maxSupervisionTimeout)
      };
    } else if (batteryLevel >= batteryThresholds.high) {
      return {
        ...params,
        connectionInterval: Math.max(params.connectionInterval / 2, this.config.minConnectionInterval),
        supervisionTimeout: Math.max(params.connectionInterval * 4, this.config.minSupervisionTimeout)
      };
    }
        
    return params;
  }

  _adjustForStability(params, drops) {
    const recentDrops = drops.filter(d => 
      d.timestamp > Date.now() - 300000 // Last 5 minutes
    ).length;

    if (recentDrops >= 2) {
      return {
        ...params,
        supervisionTimeout: Math.min(params.supervisionTimeout * 4, this.config.maxSupervisionTimeout), // More aggressive increase
        latency: 0 // Disable latency for unstable connections
      };
    }
        
    return params;
  }

  _adjustForPower(params, powerMetrics) {
    const { batteryDrain } = powerMetrics;
        
    if (batteryDrain > 1.0) { // High power consumption
      return {
        ...params,
        connectionInterval: Math.min(params.connectionInterval * 1.5, this.config.maxConnectionInterval),
        latency: Math.min(params.latency + 1, this.config.maxLatency)
      };
    }
        
    return params;
  }
}

module.exports = {
  ConnectionParameters
}; 