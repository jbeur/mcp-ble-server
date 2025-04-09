const { logger } = require('../utils/logger');
const { metrics } = require('./metrics');

class ResourceForecasting {
  constructor(config = {}) {
    this.config = {
      historyWindow: config.historyWindow || 3600, // 1 hour in seconds
      predictionInterval: config.predictionInterval || 300, // 5 minutes in seconds
      minDataPoints: config.minDataPoints || 12, // Minimum data points needed for prediction
      maxPredictionWindow: config.maxPredictionWindow || 3600, // Maximum prediction window (1 hour)
      ...config
    };
        
    this.metrics = {
      memoryHistory: [],
      cpuHistory: [],
      networkHistory: [],
      predictions: new Map()
    };
  }

  /**
     * Add new resource usage measurements
     * @param {number} timestamp - Unix timestamp
     * @param {Object} resources - Resource usage measurements
     * @param {number} resources.memory - Memory usage in MB
     * @param {number} resources.cpu - CPU usage percentage
     * @param {number} resources.network - Network usage in MB/s
     */
  addResourceMeasurement(timestamp, resources) {
    try {
      // Validate resource values
      if (typeof resources.memory !== 'number' || resources.memory < 0) {
        throw new Error('Invalid memory value');
      }
      if (typeof resources.cpu !== 'number' || resources.cpu < 0 || resources.cpu > 100) {
        throw new Error('Invalid CPU value');
      }
      if (typeof resources.network !== 'number' || resources.network < 0) {
        throw new Error('Invalid network value');
      }

      this.metrics.memoryHistory.push({ timestamp, value: resources.memory });
      this.metrics.cpuHistory.push({ timestamp, value: resources.cpu });
      this.metrics.networkHistory.push({ timestamp, value: resources.network });

      this._cleanupOldData();
      this._updatePredictions();
    } catch (error) {
      logger.error('Error adding resource measurement:', error);
      metrics.incrementCounter('resource_forecasting_errors');
    }
  }

  /**
     * Get predicted resource usage for a future timestamp
     * @param {number} futureTimestamp - Unix timestamp to predict for
     * @returns {Object|null} Predicted resource usage or null if insufficient data
     */
  getPredictedResources(futureTimestamp) {
    try {
      const currentTime = Date.now() / 1000;
      const predictionWindow = futureTimestamp - currentTime;

      // Return null if prediction is beyond max window
      if (predictionWindow > this.config.maxPredictionWindow) {
        return null;
      }

      if (this.metrics.predictions.has(futureTimestamp)) {
        return this.metrics.predictions.get(futureTimestamp);
      }
      return null;
    } catch (error) {
      logger.error('Error getting predicted resources:', error);
      metrics.incrementCounter('resource_forecasting_errors');
      return null;
    }
  }

  /**
     * Clean up old data points from history
     * @private
     */
  _cleanupOldData() {
    const cutoffTime = Date.now() / 1000 - this.config.historyWindow;
        
    this.metrics.memoryHistory = this.metrics.memoryHistory.filter(
      point => point.timestamp >= cutoffTime
    );
    this.metrics.cpuHistory = this.metrics.cpuHistory.filter(
      point => point.timestamp >= cutoffTime
    );
    this.metrics.networkHistory = this.metrics.networkHistory.filter(
      point => point.timestamp >= cutoffTime
    );
  }

  /**
     * Update predictions based on historical data
     * @private
     */
  _updatePredictions() {
    try {
      if (this.metrics.memoryHistory.length < this.config.minDataPoints ||
                this.metrics.cpuHistory.length < this.config.minDataPoints ||
                this.metrics.networkHistory.length < this.config.minDataPoints) {
        return;
      }

      // Generate predictions for each resource type
      const currentTime = Date.now() / 1000;
      for (let i = 1; i <= 12; i++) { // Predict next hour in 5-minute intervals
        const futureTime = currentTime + (i * this.config.predictionInterval);
                
        const memoryPrediction = this._predictResource(
          this.metrics.memoryHistory.slice(-this.config.minDataPoints),
          futureTime
        );
        const cpuPrediction = this._predictResource(
          this.metrics.cpuHistory.slice(-this.config.minDataPoints),
          futureTime
        );
        const networkPrediction = this._predictResource(
          this.metrics.networkHistory.slice(-this.config.minDataPoints),
          futureTime
        );

        this.metrics.predictions.set(futureTime, {
          memory: Math.max(0, memoryPrediction),
          cpu: Math.max(0, Math.min(100, cpuPrediction)),
          network: Math.max(0, networkPrediction)
        });
      }

      metrics.setGauge('resource_forecasting_predictions_count', this.metrics.predictions.size);
    } catch (error) {
      logger.error('Error updating predictions:', error);
      metrics.incrementCounter('resource_forecasting_errors');
    }
  }

  /**
     * Predict resource usage using linear regression
     * @private
     * @param {Array<{timestamp: number, value: number}>} data - Historical data points
     * @param {number} futureTime - Future timestamp to predict for
     * @returns {number} Predicted value
     */
  _predictResource(data, futureTime) {
    const n = data.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (const point of data) {
      sumX += point.timestamp;
      sumY += point.value;
      sumXY += point.timestamp * point.value;
      sumX2 += point.timestamp * point.timestamp;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return slope * futureTime + intercept;
  }
}

module.exports = ResourceForecasting; 