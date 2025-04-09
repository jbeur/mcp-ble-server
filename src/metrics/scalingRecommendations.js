const { logger } = require('../utils/logger');
const { metrics } = require('./metrics');

class ScalingRecommendations {
  constructor(config = {}) {
    this.config = {
      memoryThreshold: config.memoryThreshold || 80, // Memory usage threshold in percentage
      cpuThreshold: config.cpuThreshold || 80, // CPU usage threshold in percentage
      networkThreshold: config.networkThreshold || 80, // Network usage threshold in percentage
      minScalingInterval: config.minScalingInterval || 300, // Minimum time between scaling recommendations in seconds
      ...config
    };

    this.metrics = {
      lastScalingRecommendation: null,
      recommendations: []
    };
  }

  /**
     * Generate scaling recommendations based on predicted resource usage
     * @param {Object} predictions - Predicted resource usage
     * @param {number} predictions.memory - Predicted memory usage in MB
     * @param {number} predictions.cpu - Predicted CPU usage percentage
     * @param {number} predictions.network - Predicted network usage in MB/s
     * @returns {Object|null} Scaling recommendation or null if no scaling needed
     */
  generateRecommendations(predictions) {
    try {
      if (!predictions || typeof predictions !== 'object') {
        throw new Error('Invalid predictions object');
      }

      const currentTime = Date.now() / 1000;
      const timeSinceLastRecommendation = this.metrics.lastScalingRecommendation
        ? currentTime - this.metrics.lastScalingRecommendation
        : Infinity;

      // Check if enough time has passed since last recommendation
      if (timeSinceLastRecommendation < this.config.minScalingInterval) {
        return null;
      }

      const recommendation = {
        timestamp: currentTime,
        actions: [],
        reason: []
      };

      // Check memory usage
      if (predictions.memory > this.config.memoryThreshold) {
        recommendation.actions.push({
          type: 'memory',
          action: 'scale_up',
          current: predictions.memory,
          threshold: this.config.memoryThreshold
        });
        recommendation.reason.push('High memory usage predicted');
      }

      // Check CPU usage
      if (predictions.cpu > this.config.cpuThreshold) {
        recommendation.actions.push({
          type: 'cpu',
          action: 'scale_up',
          current: predictions.cpu,
          threshold: this.config.cpuThreshold
        });
        recommendation.reason.push('High CPU usage predicted');
      }

      // Check network usage
      if (predictions.network > this.config.networkThreshold) {
        recommendation.actions.push({
          type: 'network',
          action: 'scale_up',
          current: predictions.network,
          threshold: this.config.networkThreshold
        });
        recommendation.reason.push('High network usage predicted');
      }

      // Only return recommendation if there are actions to take
      if (recommendation.actions.length > 0) {
        this.metrics.lastScalingRecommendation = currentTime;
        this.metrics.recommendations.push(recommendation);
        metrics.incrementCounter('scaling_recommendations_generated');
        return recommendation;
      }

      return null;
    } catch (error) {
      logger.error('Error generating scaling recommendations:', error);
      metrics.incrementCounter('scaling_recommendations_errors');
      return null;
    }
  }

  /**
     * Get recent scaling recommendations
     * @param {number} [limit=10] - Maximum number of recommendations to return
     * @returns {Array} Array of recent scaling recommendations
     */
  getRecentRecommendations(limit = 10) {
    return this.metrics.recommendations.slice(-limit);
  }

  /**
     * Clear all recommendations
     */
  clearRecommendations() {
    this.metrics.recommendations = [];
    this.metrics.lastScalingRecommendation = null;
  }

  /**
     * Update configuration
     * @param {Object} newConfig - New configuration values
     */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }
}

module.exports = ScalingRecommendations; 