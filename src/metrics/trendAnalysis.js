const { logger } = require('../utils/logger');
const { metrics } = require('./metrics');

class TrendAnalysis {
  constructor(config = {}) {
    this.config = {
      historyWindow: config.historyWindow || 3600, // 1 hour in seconds
      minDataPoints: config.minDataPoints || 10,
      trendThreshold: config.trendThreshold || 0.1, // 10% change threshold
      ...config
    };

    this.metrics = {
      memory: [],
      cpu: [],
      network: []
    };
  }

  /**
     * Add a new resource measurement for trend analysis
     * @param {Object} measurement - Resource measurement data
     * @param {number} measurement.memory - Memory usage in MB
     * @param {number} measurement.cpu - CPU usage percentage
     * @param {number} measurement.network - Network usage in MB/s
     */
  addMeasurement(measurement) {
    try {
      if (!measurement || typeof measurement !== 'object') {
        throw new Error('Invalid measurement object');
      }

      const timestamp = Date.now() / 1000;
      const dataPoint = {
        timestamp,
        ...measurement
      };

      // Add data point to each resource metric
      ['memory', 'cpu', 'network'].forEach(resource => {
        if (typeof measurement[resource] === 'number') {
          this.metrics[resource].push(dataPoint);
        }
      });

      this._cleanupOldData();
      metrics.incrementCounter('trend_analysis_measurements_added');
    } catch (error) {
      logger.error('Error adding measurement:', error);
      metrics.incrementCounter('trend_analysis_errors');
    }
  }

  /**
     * Analyze trends for all resources
     * @returns {Object} Trend analysis results
     */
  analyzeTrends() {
    try {
      const results = {
        memory: this._analyzeTrendForResource('memory'),
        cpu: this._analyzeTrendForResource('cpu'),
        network: this._analyzeTrendForResource('network')
      };

      metrics.incrementCounter('trend_analysis_performed');
      return results;
    } catch (error) {
      logger.error('Error analyzing trends:', error);
      metrics.incrementCounter('trend_analysis_errors');
      return null;
    }
  }

  /**
     * Analyze trend for a specific resource
     * @private
     * @param {string} resource - Resource type (memory, cpu, network)
     * @returns {Object} Trend analysis result for the resource
     */
  _analyzeTrendForResource(resource) {
    const data = this.metrics[resource];
    if (data.length < this.config.minDataPoints) {
      return {
        trend: 'insufficient_data',
        change: 0,
        confidence: 0
      };
    }

    // Calculate moving averages
    const windowSize = Math.min(5, Math.floor(data.length / 2));
    const recentData = data.slice(-windowSize);
    const previousData = data.slice(-2 * windowSize, -windowSize);
        
    const recentAvg = this._calculateMovingAverage(recentData, resource);
    const previousAvg = this._calculateMovingAverage(previousData, resource);

    // Calculate percentage change
    const change = previousAvg === 0 ? 0 : ((recentAvg - previousAvg) / previousAvg) * 100;

    // Determine trend direction and confidence
    let trend = 'stable';
    if (Math.abs(change) >= this.config.trendThreshold * 100) {
      trend = change > 0 ? 'increasing' : 'decreasing';
    }

    // Calculate confidence based on data consistency
    const confidence = this._calculateConfidence(data.slice(-2 * windowSize), resource);

    return {
      trend,
      change,
      confidence
    };
  }

  /**
     * Calculate moving average for a dataset
     * @private
     * @param {Array} data - Array of data points
     * @param {string} resource - Resource type (memory, cpu, network)
     * @returns {number} Moving average
     */
  _calculateMovingAverage(data, resource) {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, point) => acc + point[resource], 0);
    return sum / data.length;
  }

  /**
     * Calculate confidence level based on data consistency
     * @private
     * @param {Array} data - Array of data points
     * @param {string} resource - Resource type (memory, cpu, network)
     * @returns {number} Confidence level between 0 and 1
     */
  _calculateConfidence(data, resource) {
    if (data.length < 2) return 0;

    // Calculate standard deviation
    const mean = this._calculateMovingAverage(data, resource);
    const squaredDiffs = data.map(point => Math.pow(point[resource] - mean, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / data.length;
    const stdDev = Math.sqrt(variance);

    // Calculate coefficient of variation (CV)
    const cv = mean === 0 ? 1 : stdDev / mean;

    // Convert CV to confidence score (lower CV means higher confidence)
    return Math.max(0, Math.min(1, 1 - cv));
  }

  /**
     * Clean up old data points
     * @private
     */
  _cleanupOldData() {
    const cutoffTime = (Date.now() / 1000) - this.config.historyWindow;
    ['memory', 'cpu', 'network'].forEach(resource => {
      this.metrics[resource] = this.metrics[resource].filter(
        point => point.timestamp >= cutoffTime
      );
    });
  }

  /**
     * Get current metrics data
     * @returns {Object} Current metrics data
     */
  getMetrics() {
    return {
      memory: [...this.metrics.memory],
      cpu: [...this.metrics.cpu],
      network: [...this.metrics.network]
    };
  }

  /**
     * Clear all metrics data
     */
  clearMetrics() {
    this.metrics = {
      memory: [],
      cpu: [],
      network: []
    };
  }
}

module.exports = TrendAnalysis; 