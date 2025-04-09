const EventEmitter = require('events');
const BatchCompressor = require('./BatchCompressor');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const zlib = require('zlib');
const { promisify } = require('util');
const BatchPredictor = require('./BatchPredictor');
const { PRIORITY_LEVELS } = require('../../utils/constants');
const { deepMerge } = require('../../utils/utils');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_CONFIG = {
  batchSize: 10,
  minBatchSize: 1,
  maxBatchSize: 100,
  timeouts: {
    high: 1000,
    medium: 5000,
    low: 10000
  },
  compression: {
    enabled: true,
    minSize: 5
  },
  analytics: {
    enabled: true,
    interval: 60000
  },
  adaptiveInterval: 5000,
  performanceThreshold: 0.8
};

class MessageBatcher extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = deepMerge(DEFAULT_CONFIG, config);
    this.batches = new Map();
    this.timers = new Map();
    this.batchStartTimes = new Map();
    
    // Initialize metrics
    this.metrics = {
      histogram: metrics.histogram('batch_size'),
      errorCounter: metrics.counter('error_count'),
      compressionCounter: metrics.counter('compression_count'),
      totalMessages: 0,
      activeClients: 0,
      activeBatches: 0,
      maxBatchSize: 0,
      minBatchSize: Infinity,
      averageBatchSize: 0,
      totalBatches: 0,
      batchFlushReasons: {
        size: 0,
        timeout: 0,
        clientDisconnect: 0
      },
      priorities: {
        high: { count: 0, latency: 0 },
        medium: { count: 0, latency: 0 },
        low: { count: 0, latency: 0 }
      },
      compression: {
        totalCompressed: 0,
        totalBytesSaved: 0,
        averageCompressionRatio: 0,
        averageCompressionTimes: {
          high: 0,
          medium: 0,
          low: 0
        }
      },
      errors: {
        addMessage: 0,
        compression: 0,
        invalidMessage: 0,
        invalidClientId: 0
      },
      performance: {
        adjustmentHistory: [],
        currentLoad: 0,
        targetLoad: this.config.performanceThreshold
      }
    };

    this.analyticsLastSent = Date.now();
    this.compressionEnabled = this.config.compression.enabled;
    if (this.compressionEnabled) {
      this.compressor = new BatchCompressor(this.config.compression);
    }

    if (this.config.analytics.enabled) {
      this._lastAnalyticsUpdate = 0;
      this._analyticsHistory = {
        batchSizeHistory: [],
        latencyHistory: [],
        compressionHistory: []
      };
      this._startAnalytics();
    }

    this.batchSize = this.config.batchSize;
    this.predictor = new BatchPredictor(this.config);
    this.adaptiveInterval = this.config.adaptiveInterval;
    this.performanceThreshold = this.config.performanceThreshold;

    // Listen for batch size predictions
    this.predictor.on('prediction', (data) => {
      if (data.confidence > 0.7) { // Only adjust if confidence is high enough
        const oldSize = this.batchSize;
        this.batchSize = data.recommendedBatchSize;
        logger.info('Adjusted batch size based on ML prediction', {
          oldSize,
          newSize: this.batchSize,
          confidence: data.confidence,
          features: data.features
        });
      }
    });

    // Start adaptive sizing if enabled
    this.adaptiveTimer = null;
    if (this.config.adaptiveInterval) {
      this._startAdaptiveSizing();
    }
  }

  _startAnalytics() {
    this._analyticsInterval = setInterval(() => {
      try {
        this._updateAnalytics();
      } catch (error) {
        logger.error('Error updating analytics', { error });
      }
    }, this.config.analytics.interval);
  }

  _startAdaptiveSizing() {
    this.adaptiveTimer = setInterval(() => {
      try {
        this._adjustBatchSize();
      } catch (error) {
        logger.error('Error in adaptive sizing', { error });
      }
    }, this.adaptiveInterval);
  }

  _updateAnalytics() {
    try {
      // Update batch size history
      this._analyticsHistory.batchSizeHistory.push({
        timestamp: Date.now(),
        average: this.metrics.averageBatchSize,
        max: this.metrics.maxBatchSize,
        min: this.metrics.minBatchSize
      });

      // Update latency history
      const latencyMetrics = Object.entries(this.metrics.priorities).map(([priority, data]) => ({
        priority,
        averageLatency: data.count > 0 ? data.latency / data.count : 0
      }));
      this._analyticsHistory.latencyHistory.push({
        timestamp: Date.now(),
        metrics: latencyMetrics
      });

      // Update compression history
      if (this.compressionEnabled) {
        this._analyticsHistory.compressionHistory.push({
          timestamp: Date.now(),
          ratio: this.metrics.compression.averageCompressionRatio,
          bytesSaved: this.metrics.compression.totalBytesSaved
        });
      }

      // Emit analytics update
      this.emit('analytics', {
        timestamp: Date.now(),
        metrics: this.metrics,
        history: this._analyticsHistory
      });

      // Track metrics
      metrics.gauge('active_batches').set(this.metrics.activeBatches);
      metrics.gauge('average_batch_size').set(this.metrics.averageBatchSize);
      metrics.gauge('compression_ratio').set(this.metrics.compression.averageCompressionRatio);

      logger.debug('Analytics updated', {
        activeBatches: this.metrics.activeBatches,
        averageBatchSize: this.metrics.averageBatchSize,
        totalMessages: this.metrics.totalMessages
      });
    } catch (error) {
      logger.error('Error in analytics update', { error });
    }
  }

  _calculatePriorityDistribution() {
    const totalMessages = Object.values(this.metrics.priorities).reduce((sum, p) => sum + p.count, 0);
    if (totalMessages === 0) return { high: 0, medium: 0, low: 0 };

    const distribution = {};
    Object.entries(this.metrics.priorities).forEach(([priority, data]) => {
      // Calculate exact ratio first
      const ratio = data.count / totalMessages;
      // Round to 1 decimal place
      distribution[priority] = Math.round(ratio * 10) / 10;
    });

    return distribution;
  }

  _calculateAverageLatency() {
    const totalLatency = Object.values(this.metrics.priorities).reduce((sum, p) => sum + p.latency, 0);
    const totalMessages = Object.values(this.metrics.priorities).reduce((sum, p) => sum + p.count, 0);
    return totalMessages > 0 ? totalLatency / totalMessages : 0;
  }

  _calculateMaxLatency() {
    return Math.max(...Object.values(this.metrics.priorities).map(p => p.latency));
  }

  _calculateMinLatency() {
    return Math.min(...Object.values(this.metrics.priorities).map(p => p.latency));
  }

  getMetrics() {
    return {
      ...this.metrics,
      currentBatchSize: this.batchSize,
      analyticsHistory: this._analyticsHistory
    };
  }

  resetMetrics() {
    this.metrics = {
      totalMessages: 0,
      activeClients: 0,
      activeBatches: 0,
      maxBatchSize: 0,
      minBatchSize: Infinity,
      averageBatchSize: 0,
      totalBatches: 0,
      batchFlushReasons: {
        size: 0,
        timeout: 0,
        clientDisconnect: 0
      },
      priorities: {
        high: { count: 0, latency: 0 },
        medium: { count: 0, latency: 0 },
        low: { count: 0, latency: 0 }
      },
      compression: {
        totalCompressed: 0,
        totalBytesSaved: 0,
        averageCompressionRatio: 0,
        averageCompressionTimes: {
          high: 0,
          medium: 0,
          low: 0
        }
      },
      errors: {
        addMessage: 0,
        compression: 0,
        invalidMessage: 0,
        invalidClientId: 0
      },
      performance: {
        adjustmentHistory: [],
        currentLoad: 0,
        targetLoad: this.performanceThreshold
      }
    };
  }

  async addMessage(clientId, message) {
    try {
      if (!clientId) {
        this.metrics.errors.invalidClientId++;
        logger.error('Invalid client ID');
        throw new Error('Invalid client ID');
      }

      if (!message || !message.type) {
        this.metrics.errors.invalidMessage++;
        logger.error('Invalid message');
        throw new Error('Invalid message');
      }

      // Set default priority if not provided
      message.priority = message.priority || PRIORITY_LEVELS.MEDIUM;

      // Create new batch if none exists
      if (!this.batches.has(clientId)) {
        this.batches.set(clientId, []);
        this.batchStartTimes.set(clientId, Date.now());
        this.metrics.activeBatches++;
      }

      const batch = this.batches.get(clientId);
      batch.push(message);
      this.metrics.totalMessages++;
      this.metrics.priorities[message.priority].count++;

      // Track metrics
      this.metrics.histogram.observe(batch.length);
      logger.debug('Added message to batch', { clientId, messageType: message.type });

      // Start or update timer
      this._startBatchTimer(clientId);

      // Check if batch should be flushed
      if (batch.length >= this.batchSize) {
        await this._flushBatch(clientId, 'size');
      }
    } catch (error) {
      this.metrics.errorCounter.inc();
      logger.error(`Error adding message: ${error.message}`);
      throw error;
    }
  }

  _startBatchTimer(clientId) {
    if (this.timers.has(clientId)) {
      clearTimeout(this.timers.get(clientId));
    }

    const batch = this.batches.get(clientId);
    if (!batch) return;

    // Get highest priority in batch
    const highestPriority = batch.reduce((highest, msg) => {
      const priorities = { high: 0, medium: 1, low: 2 };
      return priorities[msg.priority] < priorities[highest] ? msg.priority : highest;
    }, 'low');

    // Set timeout based on priority
    const timeout = this.config.timeouts[highestPriority];
    const timer = setTimeout(async () => {
      try {
        await this._flushBatch(clientId, 'timeout');
      } catch (error) {
        logger.error('Error in batch timer', { error, clientId });
      }
    }, timeout);

    this.timers.set(clientId, timer);
  }

  async _flushBatch(clientId, reason) {
    try {
      const batch = this.batches.get(clientId);
      if (!batch || batch.length === 0) return;

      // Sort by priority
      batch.sort((a, b) => {
        const priorities = { high: 0, medium: 1, low: 2 };
        return priorities[a.priority] - priorities[b.priority];
      });

      let compressed = false;
      let compressedData = null;

      if (this.compressionEnabled && batch.length >= this.config.compression.minSize) {
        try {
          logger.debug('Compressing batch', { clientId, batchSize: batch.length });
          const result = await this.compressor.compress(batch);
          if (result.compressed) {
            compressedData = result.data;
            compressed = true;
            this.metrics.compressionCounter.inc();
            this.metrics.compression.totalCompressed++;
            this.metrics.compression.totalBytesSaved += (result.originalSize - result.compressedSize);
            this.metrics.compression.averageCompressionRatio = result.compressionRatio;
          }
        } catch (error) {
          this.metrics.errors.compression++;
          logger.error('Compression error', { error, clientId });
          // Continue without compression
        }
      }

      // Update metrics
      this.metrics.totalBatches++;
      this.metrics.batchFlushReasons[reason] = (this.metrics.batchFlushReasons[reason] || 0) + 1;
      this.metrics.maxBatchSize = Math.max(this.metrics.maxBatchSize, batch.length);
      this.metrics.minBatchSize = Math.min(this.metrics.minBatchSize, batch.length);
      
      // Calculate average batch size
      const currentBatchSize = batch.length;
      this.metrics.averageBatchSize = (this.metrics.averageBatchSize * (this.metrics.totalBatches - 1) + currentBatchSize) / this.metrics.totalBatches;

      // Calculate latency
      const latency = Date.now() - this.batchStartTimes.get(clientId);
      batch.forEach(msg => {
        this.metrics.priorities[msg.priority].latency += latency;
      });

      // Track metrics
      this.metrics.histogram.observe(batch.length);

      // Clean up
      this.batches.delete(clientId);
      this.batchStartTimes.delete(clientId);
      if (this.timers.has(clientId)) {
        clearTimeout(this.timers.get(clientId));
        this.timers.delete(clientId);
      }

      this.metrics.activeBatches--;

      // Emit batch
      const batchData = {
        messages: batch,
        compressed,
        data: compressedData
      };
      this.emit('batch', clientId, batchData);

      // Update analytics if enabled and throttled
      if (this.config.analytics.enabled && this._shouldUpdateAnalytics()) {
        this._updateAnalytics();
      }
    } catch (error) {
      this.metrics.errorCounter.inc();
      logger.error(`Error flushing batch: ${error.message}`);
      throw error;
    }
  }

  _shouldUpdateAnalytics() {
    const now = Date.now();
    if (now - this.analyticsLastSent >= this.config.analytics.interval) {
      this.analyticsLastSent = now;
      if (this.config.analytics && typeof this.config.analyticsHandler === 'function') {
        this.config.analyticsHandler({
          batchSizes: this.batchSizes,
          compressionMetrics: this.compressionMetrics,
          priorityDistribution: this.priorityDistribution
        });
      }
      return true;
    }
    return false;
  }

  async removeClient(clientId) {
    try {
      await this._flushBatch(clientId, 'clientDisconnect');
      this.metrics.activeClients--;
    } catch (error) {
      logger.error('Error removing client', { error, clientId });
      throw error;
    }
  }

  _adjustBatchSize() {
    const currentLoad = this.metrics.activeBatches / this.config.maxBatchSize;
    this.metrics.performance.currentLoad = currentLoad;

    const adjustment = this.predictor.predictAdjustment(
      currentLoad,
      this.performanceThreshold,
      this.metrics
    );

    if (adjustment !== 0) {
      const oldSize = this.batchSize;
      this.batchSize = Math.max(
        this.config.minBatchSize,
        Math.min(this.config.maxBatchSize, this.batchSize + adjustment)
      );

      this.metrics.performance.adjustmentHistory.push({
        timestamp: Date.now(),
        oldSize,
        newSize: this.batchSize,
        load: currentLoad
      });

      logger.info('Batch size adjusted', {
        oldSize,
        newSize: this.batchSize,
        load: currentLoad,
        threshold: this.performanceThreshold
      });
    }
  }

  enableCompression() {
    this.compressionEnabled = true;
  }

  disableCompression() {
    this.compressionEnabled = false;
  }

  async stop() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Clear analytics interval
    if (this._analyticsInterval) {
      clearInterval(this._analyticsInterval);
      this._analyticsInterval = null;
    }

    // Clear adaptive sizing interval
    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
      this.adaptiveTimer = null;
    }

    // Flush all remaining batches
    const clientIds = Array.from(this.batches.keys());
    return Promise.all(clientIds.map(clientId => this._flushBatch(clientId, 'stop')));
  }

  async flush(clientId) {
    return this._flushBatch(clientId, 'manual');
  }
}

module.exports = MessageBatcher; 