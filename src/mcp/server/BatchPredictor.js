const EventEmitter = require('events');
const { logger } = require('../../utils/logger');

class BatchPredictor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      minBatchSize: config.minBatchSize || 1,
      maxBatchSize: config.maxBatchSize || 100,
      learningRate: config.learningRate || 0.01,
      historySize: config.historySize || 1000,
      predictionInterval: config.predictionInterval || 60000, // 1 minute
      featureWindow: config.featureWindow || 10, // Number of historical points to use
      ...config
    };

    this.trainingData = [];
    this.model = {
      weights: {
        messageRate: 0.5,
        latency: -0.3,
        errorRate: -0.2,
        compressionRatio: 0.4,
        resourceUsage: -0.3
      },
      bias: 1.0
    };

    this.metrics = {
      predictions: 0,
      accuracy: 0,
      totalError: 0,
      lastPrediction: null,
      featureImportance: {}
    };

    this._startPredictionLoop();
  }

  _calculateFeatures(history) {
    const recent = history.slice(-this.config.featureWindow);
    if (recent.length === 0) return null;

    return {
      messageRate: this._calculateMessageRate(recent),
      latency: this._calculateAverageLatency(recent),
      errorRate: this._calculateErrorRate(recent),
      compressionRatio: this._calculateCompressionRatio(recent),
      resourceUsage: this._calculateResourceUsage(recent)
    };
  }

  _calculateMessageRate(history) {
    const messages = history.reduce((sum, point) => sum + point.messageCount, 0);
    const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
    return messages / (timeSpan / 1000); // messages per second
  }

  _calculateAverageLatency(history) {
    const latencies = history.map(point => point.latency);
    return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  }

  _calculateErrorRate(history) {
    const errors = history.reduce((sum, point) => sum + point.errors, 0);
    const total = history.reduce((sum, point) => sum + point.messageCount, 0);
    return total > 0 ? errors / total : 0;
  }

  _calculateCompressionRatio(history) {
    const ratios = history.map(point => point.compressionRatio).filter(r => r !== undefined);
    return ratios.length > 0 ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : 1;
  }

  _calculateResourceUsage(history) {
    const usage = history.map(point => point.resourceUsage);
    return usage.reduce((sum, u) => sum + u, 0) / usage.length;
  }

  _predict(features) {
    if (!features) return this.config.minBatchSize;

    let prediction = this.model.bias;
    for (const [feature, value] of Object.entries(features)) {
      prediction += this.model.weights[feature] * value;
    }

    // Clamp prediction to valid batch size range
    prediction = Math.max(this.config.minBatchSize, 
      Math.min(this.config.maxBatchSize, 
        Math.round(prediction)));

    return prediction;
  }

  _updateModel(features, actualBatchSize) {
    if (!features) return;

    const prediction = this._predict(features);
    const error = actualBatchSize - prediction;

    // Update weights using gradient descent
    for (const [feature, value] of Object.entries(features)) {
      this.model.weights[feature] += this.config.learningRate * error * value;
            
      // Update feature importance
      const importance = Math.abs(this.model.weights[feature]);
      this.metrics.featureImportance[feature] = importance;
    }

    // Update bias
    this.model.bias += this.config.learningRate * error;

    // Update metrics
    this.metrics.predictions++;
    this.metrics.totalError += Math.abs(error);
    this.metrics.accuracy = 1 - (this.metrics.totalError / this.metrics.predictions);
    this.metrics.lastPrediction = {
      predicted: prediction,
      actual: actualBatchSize,
      error: error,
      features: { ...features }
    };
  }

  _startPredictionLoop() {
    this.predictionTimer = setInterval(() => {
      try {
        const features = this._calculateFeatures(this.trainingData);
        const prediction = this._predict(features);
        this.emit('prediction', {
          recommendedBatchSize: prediction.batchSize,
          confidence: prediction.confidence,
          features
        });
      } catch (error) {
        logger.error('Error in prediction loop:', error);
      }
    }, this.config.predictionInterval);
    this.predictionTimer.unref();
  }

  stop() {
    if (this.predictionTimer) {
      clearInterval(this.predictionTimer);
      this.predictionTimer = null;
    }
  }

  addDataPoint(dataPoint) {
    try {
      const point = {
        timestamp: Date.now(),
        messageCount: dataPoint.messageCount || 0,
        batchSize: dataPoint.batchSize || 0,
        latency: dataPoint.latency || 0,
        errors: dataPoint.errors || 0,
        compressionRatio: dataPoint.compressionRatio,
        resourceUsage: dataPoint.resourceUsage || 0
      };

      this.trainingData.push(point);

      // Keep history size within limit
      if (this.trainingData.length > this.config.historySize) {
        this.trainingData = this.trainingData.slice(-this.config.historySize);
      }

      // Update model with new data point
      const features = this._calculateFeatures([point]);
      if (features) {
        this._updateModel(features, point.batchSize);
      }
    } catch (error) {
      logger.error('Error adding data point to predictor', { error, dataPoint });
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      modelState: {
        weights: { ...this.model.weights },
        bias: this.model.bias
      },
      dataPoints: this.trainingData.length
    };
  }

  reset() {
    this.trainingData = [];
    this.model.weights = {
      messageRate: 0.5,
      latency: -0.3,
      errorRate: -0.2,
      compressionRatio: 0.4,
      resourceUsage: -0.3
    };
    this.model.bias = 1.0;
    this.metrics = {
      predictions: 0,
      accuracy: 0,
      totalError: 0,
      lastPrediction: null,
      featureImportance: {}
    };
  }
}

module.exports = BatchPredictor; 