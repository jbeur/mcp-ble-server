const { logger } = require('../utils/logger');

class RSSIThresholds {
  constructor(config = {}) {
    this.config = {
      minRSSI: -100,
      maxRSSI: -30,
      adaptationThreshold: 0.7, // 70% of readings in different category triggers adaptation
      anomalyThreshold: 2, // Standard deviations from mean for anomaly detection
      movingAverageWindow: 5,
      adaptationFactor: 0.3, // 30% adjustment towards moving average
      ...config
    };

    this.thresholds = {
      excellent: -50,
      good: -70,
      fair: -85,
      poor: -100
    };

    this.rssiHistory = [];
    this.stats = {
      totalReadings: 0,
      sumRSSI: 0,
      categoryDistribution: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
        unusable: 0
      }
    };
  }

  async setThresholds(thresholds) {
    try {
      // Validate individual thresholds
      Object.entries(thresholds).forEach(([category, value]) => {
        if (!this._isValidRSSI(value)) {
          throw new Error(`Invalid RSSI value for ${category}: ${value}`);
        }
      });

      // Validate threshold order
      if (thresholds.excellent && thresholds.good && thresholds.excellent <= thresholds.good) {
        throw new Error('Invalid threshold order: excellent should be higher than good');
      }
      if (thresholds.good && thresholds.fair && thresholds.good <= thresholds.fair) {
        throw new Error('Invalid threshold order: good should be higher than fair');
      }
      if (thresholds.fair && thresholds.poor && thresholds.fair <= thresholds.poor) {
        throw new Error('Invalid threshold order: fair should be higher than poor');
      }

      this.thresholds = { ...this.thresholds, ...thresholds };
      logger.debug('RSSI thresholds updated:', this.thresholds);
    } catch (error) {
      logger.error('Error setting RSSI thresholds:', error);
      throw error;
    }
  }

  _isValidRSSI(value) {
    return typeof value === 'number' && 
               value <= this.config.maxRSSI && 
               value >= this.config.minRSSI;
  }

  getThresholds() {
    return { ...this.thresholds };
  }

  classifySignalStrength(rssi) {
    if (rssi >= this.thresholds.excellent) return 'excellent';
    if (rssi >= this.thresholds.good) return 'good';
    if (rssi >= this.thresholds.fair) return 'fair';
    if (rssi >= this.thresholds.poor) return 'poor';
    return 'unusable';
  }

  recordRSSI(rssi) {
    try {
      if (!this._isValidRSSI(rssi)) {
        throw new Error(`Invalid RSSI value: ${rssi}`);
      }

      // Update history
      this.rssiHistory.push(rssi);
      if (this.rssiHistory.length > this.config.movingAverageWindow) {
        this.rssiHistory.shift();
      }

      // Update statistics
      this.stats.totalReadings++;
      this.stats.sumRSSI += rssi;

      // Update category distribution
      const category = this.classifySignalStrength(rssi);
      this.stats.categoryDistribution[category]++;

      // Calculate moving average
      const movingAvg = this.getMovingAverage();

      logger.debug('RSSI recorded:', {
        rssi,
        category,
        movingAverage: movingAvg
      });

      return {
        category,
        movingAverage: movingAvg
      };
    } catch (error) {
      logger.error('Error recording RSSI:', error);
      throw error;
    }
  }

  getStatistics() {
    return {
      totalReadings: this.stats.totalReadings,
      averageRSSI: this.stats.totalReadings > 0 
        ? this.stats.sumRSSI / this.stats.totalReadings 
        : 0,
      categoryDistribution: { ...this.stats.categoryDistribution },
      currentMovingAverage: this.getMovingAverage(),
      standardDeviation: this.calculateStandardDeviation()
    };
  }

  adaptThresholds() {
    try {
      const stats = this.getStatistics();
      if (!stats || stats.totalReadings < 5) {
        return this.thresholds;
      }

      const movingAvg = stats.currentMovingAverage;
      const stdDev = this.calculateStandardDeviation();

      // More aggressive adaptation based on moving average and standard deviation
      const adaptedThresholds = {
        excellent: Math.max(this.thresholds.excellent, movingAvg + 1.5 * stdDev),
        good: Math.max(this.thresholds.good, movingAvg + 0.5 * stdDev),
        fair: Math.max(this.thresholds.fair, movingAvg - 0.5 * stdDev),
        poor: Math.max(this.thresholds.poor, movingAvg - 1.5 * stdDev)
      };

      // Maintain minimum gaps between thresholds
      const minGap = 10;
      adaptedThresholds.good = Math.min(adaptedThresholds.good, adaptedThresholds.excellent - minGap);
      adaptedThresholds.fair = Math.min(adaptedThresholds.fair, adaptedThresholds.good - minGap);
      adaptedThresholds.poor = Math.min(adaptedThresholds.poor, adaptedThresholds.fair - minGap);

      // Ensure thresholds stay within valid RSSI range
      Object.keys(adaptedThresholds).forEach(key => {
        adaptedThresholds[key] = Math.max(
          Math.min(adaptedThresholds[key], this.config.maxRSSI),
          this.config.minRSSI
        );
      });

      this.thresholds = adaptedThresholds;
      logger.debug('Thresholds adapted:', this.thresholds);
      return this.thresholds;
    } catch (error) {
      logger.error('Error adapting thresholds:', error);
      return this.thresholds;
    }
  }

  getMovingAverage(windowSize = this.config.movingAverageWindow) {
    if (this.rssiHistory.length === 0) return 0;
        
    const window = this.rssiHistory.slice(-windowSize);
    return window.reduce((sum, rssi) => sum + rssi, 0) / window.length;
  }

  calculateStandardDeviation() {
    if (this.rssiHistory.length === 0) return 0;
        
    const mean = this.getMovingAverage();
    const squaredDiffs = this.rssiHistory.map(rssi => Math.pow(rssi - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / this.rssiHistory.length;
        
    return Math.sqrt(avgSquaredDiff);
  }

  detectAnomaly(rssi) {
    try {
      if (!this._isValidRSSI(rssi)) {
        throw new Error(`Invalid RSSI value: ${rssi}`);
      }

      const stats = this.getStatistics();
      if (!stats || stats.totalReadings < 5) {
        return false;
      }

      const movingAvg = stats.currentMovingAverage;
      const stdDev = this.calculateStandardDeviation();

      // Consider it an anomaly if:
      // 1. The RSSI value is more than 1.5 standard deviations away from the moving average
      // 2. The RSSI value represents a sudden drop (more than 15 dBm)
      const isStatisticalAnomaly = Math.abs(rssi - movingAvg) > 1.5 * stdDev;
      const isSuddenDrop = rssi < movingAvg - 15;

      const isAnomaly = isStatisticalAnomaly || isSuddenDrop;

      if (isAnomaly) {
        logger.debug('Anomaly detected:', {
          rssi,
          movingAverage: movingAvg,
          standardDeviation: stdDev,
          isStatisticalAnomaly,
          isSuddenDrop
        });
      }

      return isAnomaly;
    } catch (error) {
      logger.error('Error detecting anomaly:', error);
      return false;
    }
  }
}

module.exports = {
  RSSIThresholds
}; 