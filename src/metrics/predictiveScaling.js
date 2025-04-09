const { logger } = require('../utils/logger');
const { metrics } = require('./metrics');

class PredictiveScaling {
  constructor(config = {}) {
    this.config = {
      historyWindow: config.historyWindow || 3600, // 1 hour in seconds
      predictionInterval: config.predictionInterval || 300, // 5 minutes in seconds
      minDataPoints: config.minDataPoints || 12, // Minimum data points needed for prediction
      maxPredictionWindow: config.maxPredictionWindow || 3600, // Maximum prediction window (1 hour)
      ...config
    };
        
    this.metrics = {
      loadHistory: [],
      resourceUsageHistory: [],
      predictions: new Map()
    };
  }

  /**
     * Add a new load measurement to the history
     * @param {number} timestamp - Unix timestamp
     * @param {number} load - Current load value
     */
  addLoadMeasurement(timestamp, load) {
    try {
      // Validate load value
      if (typeof load !== 'number' || isNaN(load) || load < 0) {
        throw new Error('Invalid load value');
      }

      this.metrics.loadHistory.push({ timestamp, load });
      this._cleanupOldData();
      this._updatePredictions();
    } catch (error) {
      logger.error('Error adding load measurement:', error);
      metrics.incrementCounter('predictive_scaling_errors');
    }
  }

  /**
     * Get predicted load for a future timestamp
     * @param {number} futureTimestamp - Unix timestamp to predict for
     * @returns {number|null} Predicted load or null if insufficient data
     */
  getPredictedLoad(futureTimestamp) {
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
      logger.error('Error getting predicted load:', error);
      metrics.incrementCounter('predictive_scaling_errors');
      return null;
    }
  }

  /**
     * Clean up old data points from history
     * @private
     */
  _cleanupOldData() {
    const cutoffTime = Date.now() / 1000 - this.config.historyWindow;
    this.metrics.loadHistory = this.metrics.loadHistory.filter(
      point => point.timestamp >= cutoffTime
    );
  }

  /**
     * Update predictions based on historical data
     * @private
     */
  _updatePredictions() {
    try {
      if (this.metrics.loadHistory.length < this.config.minDataPoints) {
        return;
      }

      // Simple linear regression for prediction
      const recentData = this.metrics.loadHistory.slice(-this.config.minDataPoints);
      const { slope, intercept } = this._calculateLinearRegression(recentData);

      // Generate predictions for next intervals
      const currentTime = Date.now() / 1000;
      for (let i = 1; i <= 12; i++) { // Predict next hour in 5-minute intervals
        const futureTime = currentTime + (i * this.config.predictionInterval);
        const prediction = slope * futureTime + intercept;
        this.metrics.predictions.set(futureTime, Math.max(0, prediction));
      }

      metrics.setGauge('predictive_scaling_predictions_count', this.metrics.predictions.size);
    } catch (error) {
      logger.error('Error updating predictions:', error);
      metrics.incrementCounter('predictive_scaling_errors');
    }
  }

  /**
     * Calculate linear regression parameters
     * @private
     * @param {Array<{timestamp: number, load: number}>} data - Historical data points
     * @returns {{slope: number, intercept: number}} Regression parameters
     */
  _calculateLinearRegression(data) {
    const n = data.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (const point of data) {
      sumX += point.timestamp;
      sumY += point.load;
      sumXY += point.timestamp * point.load;
      sumX2 += point.timestamp * point.timestamp;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }
}

module.exports = PredictiveScaling; 