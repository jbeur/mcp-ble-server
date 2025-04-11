const EventEmitter = require('events');
const BatchCompressor = require('./BatchCompressor');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const zlib = require('zlib');
const { promisify } = require('util');
const BatchPredictor = require('./BatchPredictor');
const { PRIORITY_LEVELS } = require('../../utils/constants');
const { deepMerge } = require('../../utils/utils');
const {
  MESSAGE_TYPES,
  ERROR_CODES,
  COMPRESSION_TYPES
} = require('../../utils/constants');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_CONFIG = {
  batchSize: 5,
  minBatchSize: 1,
  maxBatchSize: 5,
  batchTimeout: 1000, // Add default batchTimeout for test compatibility
  timeouts: {
    high: 50,
    medium: 100,
    low: 200
  },
  compression: {
    enabled: true,
    minSize: 1024,
    threshold: 1000,  // Match test expectation
    type: 'gzip',
    maxRetries: 3,
    retryDelay: 100
  },
  analytics: {
    enabled: true,
    interval: 60000,
    metrics: {
      batchSizes: true,
      latencies: true,
      compression: true,
      priorities: true
    }
  },
  adaptiveSizing: {
    enabled: true,
    interval: 5000,
    minBatchSize: 1,
    maxBatchSize: 10,
    performanceThreshold: 0.8
  }
};

class MessageBatcher extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Validate and merge configuration
    this._validateConfig(config);
    this.config = this._mergeConfig(DEFAULT_CONFIG, config);

    // Initialize core data structures
    this.batches = new Map();
    this.timers = new Map();
    this.batchStartTimes = new Map();
    this.operationQueues = new Map(); // Queue for operations per client
    this.sequenceNumbers = new Map();

    // Initialize metrics with proper structure
    this.resetMetrics();

    // Initialize compression settings
    this.compressionEnabled = this.config.compression?.enabled ?? true;
    this.compressionThreshold = this.config.compression?.threshold ?? 1000;
    this.compressionType = this.config.compression?.type ?? 'gzip';
    this.compressor = config.compressor || new BatchCompressor();

    // Initialize batch size and timeout
    this.batchSize = this.config.batchSize;
    this.batchTimeout = this.config.batchTimeout || 1000;

    // Initialize analytics history with proper structure
    this.analyticsHistory = {
      batchSizes: [],
      latencies: [],
      errorRates: [],
      compressionRatios: [],
      lastUpdate: Date.now()
    };

    // Initialize adaptive sizing with validated values
    this.currentBatchSize = this.config.batchSize;
    this.lastAdjustmentTime = Date.now();

    // Initialize event emitter
    this.eventEmitter = new EventEmitter();

    // Bind methods
    this._processBatch = this._processBatch.bind(this);
    this._flushBatch = this._flushBatch.bind(this);
    this._startBatchTimer = this._startBatchTimer.bind(this);
    this._adjustBatchSize = this._adjustBatchSize.bind(this);
    this._startAnalytics = this._startAnalytics.bind(this);
    this.addMessage = this.addMessage.bind(this);
    this.removeClient = this.removeClient.bind(this);
    this.stop = this.stop.bind(this);
    this.start = this.start.bind(this);

    // Start analytics if enabled
    if (this.config.analytics.enabled) {
      this._startAnalytics();
    }

    logger.info('MessageBatcher initialized', {
      batchSize: this.config.batchSize,
      compression: {
        enabled: this.compressionEnabled,
        threshold: this.compressionThreshold,
        type: this.compressionType
      },
      analytics: {
        enabled: this.config.analytics.enabled,
        interval: this.config.analytics.interval
      }
    });
  }

  _validateConfig(config) {
    // Validate batch sizes
    if (config.batchSize !== undefined) {
      if (typeof config.batchSize !== 'number' || config.batchSize < 1) {
        throw new Error('Invalid batchSize: must be a positive number');
      }
    }
    if (config.maxBatchSize !== undefined) {
      if (typeof config.maxBatchSize !== 'number' || config.maxBatchSize < 1) {
        throw new Error('Invalid maxBatchSize: must be a positive number');
      }
    }
    if (config.minBatchSize !== undefined) {
      if (typeof config.minBatchSize !== 'number' || config.minBatchSize < 1) {
        throw new Error('Invalid minBatchSize: must be a positive number');
      }
    }
    if (config.batchTimeout !== undefined) {
      if (typeof config.batchTimeout !== 'number' || config.batchTimeout < 0) {
        throw new Error('Invalid batchTimeout: must be a non-negative number');
      }
    }

    // Validate timeouts
    if (config.timeouts) {
      const validPriorities = ['high', 'medium', 'low'];
      for (const [priority, timeout] of Object.entries(config.timeouts)) {
        if (!validPriorities.includes(priority)) {
          throw new Error(`Invalid priority level: ${priority}`);
        }
        if (typeof timeout !== 'number' || timeout < 0) {
          throw new Error(`Invalid timeout for ${priority}: must be a non-negative number`);
        }
      }
    }

    // Validate compression settings
    if (config.compression) {
      if (config.compression.enabled !== undefined && typeof config.compression.enabled !== 'boolean') {
        throw new Error('Invalid compression.enabled: must be a boolean');
      }
      if (config.compression.minSize !== undefined) {
        if (typeof config.compression.minSize !== 'number' || config.compression.minSize < 0) {
          throw new Error('Invalid compression.minSize: must be a non-negative number');
        }
      }
    }

    // Validate analytics settings
    if (config.analytics) {
      if (config.analytics.enabled !== undefined && typeof config.analytics.enabled !== 'boolean') {
        throw new Error('Invalid analytics.enabled: must be a boolean');
      }
      if (config.analytics.interval !== undefined) {
        if (typeof config.analytics.interval !== 'number' || config.analytics.interval < 1000) {
          throw new Error('Invalid analytics.interval: must be at least 1000ms');
        }
      }
    }
  }

  _mergeConfig(defaultConfig, userConfig) {
    const merged = { ...defaultConfig };
    
    // Helper function for deep merge
    const deepMerge = (target, source) => {
      for (const key in source) {
        if (source[key] instanceof Object && !Array.isArray(source[key])) {
          target[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    };

    return deepMerge(merged, userConfig);
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
    }, this.config.adaptiveSizing.interval);
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
      totalErrors: 0,
      processedBatches: 0,
      activeClients: 0,
      batchFlushReasons: {
        size: 0,
        timeout: 0,
        manual: 0
      },
      priorities: {
        high: { count: 0, latency: 0, totalLatency: 0 },
        medium: { count: 0, latency: 0, totalLatency: 0 },
        low: { count: 0, latency: 0, totalLatency: 0 }
      },
      compression: {
        totalAttempted: 0,
        totalCompressed: 0,
        totalSize: 0,
        compressedSize: 0,
        errors: 0,
        averageProcessingTime: 0,
        averageCompressionRatio: 0
      },
      increment: function(metric) {
        if (typeof this[metric] === 'number') {
          this[metric]++;
        } else if (metric.includes('batch_flush_')) {
          const reason = metric.replace('batch_flush_', '');
          if (this.batchFlushReasons[reason] !== undefined) {
            this.batchFlushReasons[reason]++;
          }
        }
      }
    };

    // Reset analytics history
    this._analyticsHistory = {
      batchSizes: [],
      latencies: [],
      errorRates: [],
      compressionRatios: [],
      lastUpdate: Date.now()
    };
  }

  async _enqueueOperation(clientId, operation) {
    if (!this.operationQueues.has(clientId)) {
      this.operationQueues.set(clientId, Promise.resolve());
    }

    const queue = this.operationQueues.get(clientId);
    const result = queue.then(async () => {
      try {
        return await operation();
      } catch (error) {
        logger.error('Operation failed', { 
          clientId, 
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
    
    this.operationQueues.set(clientId, result);
    return result;
  }

  async addMessage(clientId, message) {
    return this._enqueueOperation(clientId, async () => {
      try {
        // Validate inputs
        if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
          this.metrics.totalErrors++;
          throw new Error('Invalid client ID');
        }
        if (!message || typeof message !== 'object') {
          this.metrics.totalErrors++;
          throw new Error('Invalid message data: message must be an object');
        }
        if (!message.id || typeof message.id !== 'number' && typeof message.id !== 'string') {
          this.metrics.totalErrors++;
          throw new Error('Invalid message data: message must have a valid id');
        }
        if (!message.data) {
          this.metrics.totalErrors++;
          throw new Error('Invalid message data: message must have data');
        }

        // Set default priority if not provided
        message.priority = message.priority || 'medium';

        // Get or create batch for client
        let batch = this.batches.get(clientId);
        if (!batch) {
          batch = {
            messages: [],
            isReady: false,
            priority: message.priority,
            processing: false,
            sequence: 0
          };
          this.batches.set(clientId, batch);
          this.batchStartTimes.set(clientId, Date.now());
          this.metrics.activeClients++;
        }

        // Add message to batch with sequence number
        const sequence = this.sequenceNumbers.get(clientId) || 0;
        this.sequenceNumbers.set(clientId, sequence + 1);
        message.sequence = sequence;
        message.timestamp = Date.now();
        batch.messages.push(message);

        // Sort messages by priority and sequence
        const priorityLevels = { high: 3, medium: 2, low: 1 };
        batch.messages.sort((a, b) => {
          const priorityA = priorityLevels[a.priority || 'medium'];
          const priorityB = priorityLevels[b.priority || 'medium'];
          if (priorityA !== priorityB) {
            return priorityB - priorityA; // Higher priority first
          }
          // If priorities are equal, sort by sequence number
          return a.sequence - b.sequence;
        });

        // Update batch priority to highest priority message
        const highestPriorityMessage = batch.messages[0];
        batch.priority = highestPriorityMessage.priority || 'medium';

        // Start or restart batch timer
        this._startBatchTimer(clientId);

        // Check if batch should be flushed
        if (batch.messages.length >= this.config.batchSize) {
          this.metrics.batchFlushReasons.size++;
          await this._flushBatch(clientId);
        }

        return { success: true };
      } catch (error) {
        this.metrics.totalErrors++;
        logger.error('Error adding message to batch', {
          clientId,
          error: error.message
        });
        throw error;
      }
    });
  }

  async _startBatchTimer(clientId) {
    try {
      if (!this.batches.has(clientId) || this.batches.get(clientId).processing) {
        return;
      }

      // Clear existing timer if any
      if (this.timers.has(clientId)) {
        clearTimeout(this.timers.get(clientId));
        this.timers.delete(clientId);
      }

      const timer = setTimeout(() => {
        // Remove the async IIFE and handle promise rejection
        if (!this.batches.has(clientId) || this.batches.get(clientId).processing) {
          return;
        }

        logger.debug(`Batch timeout for client ${clientId}`);
        
        // Increment metrics before flushing
        this.metrics.increment('batch_timeouts');
        
        // Call _flushBatch and handle any errors
        this._flushBatch(clientId, 'timeout').catch(error => {
          logger.error(`Error in batch timeout handler: ${error.message}`);
          this.metrics.increment('batch_timeout_errors');
        });
      }, this.config.batchTimeout);

      this.timers.set(clientId, timer);
      logger.debug(`Started batch timer for client ${clientId}`);
    } catch (error) {
      logger.error(`Error starting batch timer: ${error.message}`);
      this.metrics.increment('timer_start_errors');
    }
  }

  async _processBatch(clientId, batch) {
    try {
      const startTime = Date.now();
      
      // Process the batch
      const processedMessages = await this._processMessages(batch.messages);
      
      // Record processing time
      const processingTime = Date.now() - startTime;
      this.metrics.record('batch_processing_time', processingTime);
      
      // Clear the batch and related data
      this.batches.delete(clientId);
      this.batchStartTimes.delete(clientId);
      if (this.timers.has(clientId)) {
        clearTimeout(this.timers.get(clientId));
        this.timers.delete(clientId);
      }
      
      return processedMessages;
    } catch (error) {
      this.metrics.increment('batch_processing_errors');
      throw error;
    }
  }

  async _flushBatch(clientId, reason = 'size') {
    try {
      const batch = this.batches.get(clientId);
      if (!batch || batch.processing) {
        return;
      }

      logger.debug(`Flushing batch for client ${clientId} (reason: ${reason})`);
      
      // Mark batch as processing and get messages
      batch.processing = true;
      const messages = [...batch.messages]; // Make a copy
      
      // Clear batch data before processing to prevent duplicate processing
      this.batches.delete(clientId);
      this.batchStartTimes.delete(clientId);
      if (this.timers.has(clientId)) {
        clearTimeout(this.timers.get(clientId));
        this.timers.delete(clientId);
      }
      
      // Process the batch
      await this._processBatch(clientId, { messages });

      this.metrics.increment(`batch_flush_${reason}`);
      logger.debug(`Successfully flushed batch for client ${clientId}`);
    } catch (error) {
      logger.error(`Error flushing batch: ${error.message}`);
      this.metrics.increment('batch_flush_errors');
    }
  }

  async removeClient(clientId) {
    try {
      logger.debug(`Removing client ${clientId}`);
      
      // Clear timer if exists
      if (this.timers.has(clientId)) {
        clearTimeout(this.timers.get(clientId));
        this.timers.delete(clientId);
      }
      
      if (this.batches.has(clientId)) {
        // Process any pending messages
        await this._flushBatch(clientId, 'client_removal');
      }
      
      this.batches.delete(clientId);
      this.batchStartTimes.delete(clientId);
      this.operationQueues.delete(clientId);
      this.sequenceNumbers.delete(clientId);
      this.metrics.activeClients = Math.max(0, this.metrics.activeClients - 1);
      
      logger.debug(`Successfully removed client ${clientId}`);
    } catch (error) {
      logger.error(`Error removing client: ${error.message}`);
      this.metrics.increment('client_removal_errors');
    }
  }

  _adjustBatchSize() {
    try {
      if (!this.config.adaptiveSizing.enabled) {
        return;
      }

      const now = Date.now();
      const timeSinceLastAdjustment = now - this.lastAdjustmentTime;
      
      // Only adjust if enough time has passed
      if (timeSinceLastAdjustment < this.config.adaptiveSizing.interval) {
        return;
      }

      // Calculate performance metrics
      const stats = this.getStats();
      const currentLoad = stats.activeClients / this.config.maxBatchSize;
      const errorRate = stats.errorRate;
      const avgLatency = stats.priorities.high.averageLatency;
      const compressionEfficiency = stats.compressionStats.averageProcessingTime;

      // Calculate performance score (0-1)
      const performanceScore = this._calculatePerformanceScore({
        currentLoad,
        errorRate,
        avgLatency,
        compressionEfficiency
      });

      // Determine adjustment direction and magnitude
      let adjustment = 0;
      if (performanceScore < this.config.adaptiveSizing.performanceThreshold) {
        // Performance is below threshold, reduce batch size
        adjustment = -Math.ceil(this.currentBatchSize * 0.1); // Reduce by 10%
      } else if (currentLoad > 0.8) {
        // High load, increase batch size
        adjustment = Math.ceil(this.currentBatchSize * 0.1); // Increase by 10%
      }

      // Apply adjustment within bounds
      const newBatchSize = Math.max(
        this.config.adaptiveSizing.minBatchSize,
        Math.min(
          this.config.adaptiveSizing.maxBatchSize,
          this.currentBatchSize + adjustment
        )
      );

      // Only update if there's a change
      if (newBatchSize !== this.currentBatchSize) {
        this.currentBatchSize = newBatchSize;
        this.lastAdjustmentTime = now;

        // Log adjustment
        logger.info('Adjusted batch size', {
          oldSize: this.currentBatchSize - adjustment,
          newSize: this.currentBatchSize,
          performanceScore,
          currentLoad,
          errorRate
        });

        // Update metrics
        this.metrics.performance.adjustmentHistory.push({
          timestamp: now,
          oldSize: this.currentBatchSize - adjustment,
          newSize: this.currentBatchSize,
          reason: performanceScore < this.config.adaptiveSizing.performanceThreshold ? 'performance' : 'load'
        });
      }
    } catch (error) {
      logger.error('Error in adaptive batch size adjustment', { error });
      // Don't throw - we want to continue processing even if adjustment fails
    }
  }

  _calculatePerformanceScore({ currentLoad, errorRate, avgLatency, compressionEfficiency }) {
    // Normalize metrics to 0-1 range
    const normalizedLoad = Math.min(currentLoad, 1);
    const normalizedError = Math.min(errorRate, 1);
    const normalizedLatency = Math.min(avgLatency / 1000, 1); // Normalize to seconds
    const normalizedCompression = Math.min(compressionEfficiency / 100, 1);

    // Weight factors (should sum to 1)
    const weights = {
      load: 0.3,
      error: 0.3,
      latency: 0.25,
      compression: 0.15
    };

    // Calculate weighted score (higher is better)
    return (
      weights.load * (1 - normalizedLoad) +
      weights.error * (1 - normalizedError) +
      weights.latency * (1 - normalizedLatency) +
      weights.compression * (1 - normalizedCompression)
    );
  }

  enableCompression() {
    this.compressionEnabled = true;
  }

  disableCompression() {
    this.compressionEnabled = false;
  }

  async stop() {
    try {
      // Clear all timers with proper cleanup
      for (const [clientId, batch] of this.batches.entries()) {
        if (batch.timer) {
          clearTimeout(batch.timer);
        }
      }
      this.batches.clear();
      
      // Flush remaining batches with proper error handling
      const flushPromises = Array.from(this.batches.entries()).map(async ([clientId, batch]) => {
        try {
          if (batch.messages.length > 0) {
            await this._flushBatch(clientId);
          }
        } catch (error) {
          logger.error('Error flushing batch during shutdown', { 
            error,
            clientId,
            batchSize: batch.messages.length 
          });
        }
      });
      
      await Promise.all(flushPromises);
      
      // Clear analytics intervals
      if (this._analyticsInterval) {
        clearInterval(this._analyticsInterval);
        this._analyticsInterval = null;
      }
      
      if (this.adaptiveTimer) {
        clearInterval(this.adaptiveTimer);
        this.adaptiveTimer = null;
      }
      
      // Reset data structures
      this.batches.clear();
      this.batchStartTimes = new Map();
      
      // Reset metrics with proper structure
      this.resetMetrics();
      
      logger.info('MessageBatcher stopped successfully', {
        totalProcessed: this.metrics.totalMessages,
        activeClients: this.metrics.activeClients
      });
      
      return { success: true };
    } catch (error) {
      logger.error('Error stopping MessageBatcher', { error });
      throw error;
    }
  }

  async flush(clientId) {
    const result = await this._flushBatch(clientId, 'manual');
    this.batches.delete(clientId);
    return result;
  }

  getBatch(clientId) {
    if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
      this.metrics.totalErrors++;
      throw new Error('Invalid client ID');
    }
    return this.batches.get(clientId);
  }

  getStats() {
    const totalMessages = this.metrics.totalMessages;
    const processedBatches = this.metrics.processedBatches;
    const averageBatchSize = processedBatches > 0 
      ? totalMessages / processedBatches 
      : 0;

    // Calculate compression metrics
    const compressionStats = {
      totalCompressed: this.metrics.compression.totalCompressed,
      totalSize: this.metrics.compression.totalSize,
      compressedSize: this.metrics.compression.compressedSize,
      errors: this.metrics.compression.errors,
      totalAttempted: this.metrics.compression.totalAttempted,
      averageCompressionRatio: this.metrics.compression.averageCompressionRatio
    };

    // Calculate overall compression ratio
    const compressionRatio = compressionStats.totalSize > 0
      ? (compressionStats.totalSize - compressionStats.compressedSize) / compressionStats.totalSize
      : 0;

    // Calculate error rate excluding compression errors
    const errorRate = totalMessages > 0 
      ? (this.metrics.totalErrors - this.metrics.compression.errors) / totalMessages 
      : 0;

    // Calculate priority-specific metrics
    const priorities = {};
    Object.entries(this.metrics.priorities).forEach(([priority, data]) => {
      priorities[priority] = {
        count: data.count,
        latency: data.count > 0 ? data.latency / data.count : 0,
        averageLatency: data.count > 0 ? data.totalLatency / data.count : 0
      };
    });

    return {
      totalMessages,
      processedBatches,
      averageBatchSize,
      totalErrors: this.metrics.totalErrors,
      compressionRatio,
      compressionSuccesses: this.metrics.compression.totalCompressed,
      compressionStats,
      errorRate,
      activeClients: this.metrics.activeClients,
      priorities,
      batchFlushReasons: this.metrics.batchFlushReasons
    };
  }

  async processBatch(messages, clientId) {
    try {
      // If clientId is provided, get messages from batch
      if (clientId) {
        const batch = this.batches.get(clientId);
        if (!batch || !batch.messages.length) {
          return { success: true, messages: [] };
        }
        messages = batch.messages;
      }

      // Sort messages by priority and timestamp
      const priorityLevels = { high: 3, medium: 2, low: 1 };
      const sortedMessages = [...messages].sort((a, b) => {
        const priorityA = priorityLevels[a.priority || 'medium'];
        const priorityB = priorityLevels[b.priority || 'medium'];
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }
        // If priorities are equal, sort by timestamp, then by id for stable sorting
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return (a.id || 0) - (b.id || 0);
      });

      // Process the batch
      const result = await this._processBatch(clientId, { messages });
      
      // Update metrics
      if (result.success) {
        this.metrics.processedBatches++;
        this.metrics.totalMessages += messages.length;

        // Update priority-specific metrics
        sortedMessages.forEach(msg => {
          const priority = msg.priority || 'medium';
          if (this.metrics.priorities[priority]) {
            this.metrics.priorities[priority].count++;
            const latency = Date.now() - (msg.timestamp || Date.now());
            this.metrics.priorities[priority].latency += latency;
            this.metrics.priorities[priority].totalLatency += latency;
          }
        });
      }

      return {
        ...result,
        messages: sortedMessages // Return sorted messages
      };
    } catch (error) {
      logger.error('Error processing batch', { 
        error: error.message,
        messageCount: messages?.length || 0
      });
      this.metrics.totalErrors++;
      throw error;
    }
  }

  start() {
    try {
      // Start analytics collection if not already started
      if (!this.analyticsStarted) {
        this._startAnalytics();
      }
      
      // Set up periodic batch size adjustment
      this.adjustmentInterval = setInterval(() => {
        this._adjustBatchSize();
      }, this.config.adaptiveSizing.interval);

      // Log startup
      console.log('MessageBatcher started with config:', {
        batchSize: this.currentBatchSize,
        compressionEnabled: this.compressionEnabled,
        compressionThreshold: this.compressionThreshold
      });
    } catch (error) {
      console.error('Error starting MessageBatcher:', error);
      throw error;
    }
  }

  shouldCompressBatch(messages) {
    if (!this.config.compression?.enabled) {
      return false;
    }
    
    // Calculate total size of messages
    const batchSize = Buffer.from(JSON.stringify(messages)).length;
    
    // Check against configured threshold
    const threshold = this.config.compression?.threshold || 1000;
    return batchSize >= threshold;
  }

  async compressBatch(messages) {
    if (!this.compressionEnabled || !messages || messages.length === 0) {
      return messages;
    }

    try {
      // Calculate total size
      const totalSize = messages.reduce((size, msg) => {
        return size + (msg.data ? Buffer.from(msg.data).length : 0);
      }, 0);

      // Only compress if above threshold
      if (totalSize < this.compressionThreshold) {
        return messages;
      }

      // Compress the messages
      const compressedData = await this.compressor.compress(messages);
      if (!compressedData) {
        throw new Error('Compression failed');
      }

      this.metrics.compression.totalCompressed++;
      this.metrics.compression.totalSize += totalSize;
      this.metrics.compression.compressedSize += compressedData.length;

      return compressedData;
    } catch (error) {
      logger.error('Error compressing batch', { error });
      this.metrics.compression.errors++;
      throw error;
    }
  }

  async _compressData(messages) {
    try {
      if (!this.compressionEnabled || !messages || messages.length === 0) {
        return null;
      }

      const data = Buffer.from(JSON.stringify(messages));
      if (data.length < this.compressionThreshold) {
        return null;
      }

      return await gzip(data);
    } catch (error) {
      logger.error('Error in compression', { 
        error: error.message,
        stack: error.stack 
      });
      throw error; // Let the parent handle the error
    }
  }

  async _processMessages(messages) {
    try {
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return [];
      }

      // Track processed message IDs to prevent duplicates
      const processedIds = new Set();
      
      // Process each message
      const processedMessages = await Promise.all(messages.map(async (message) => {
        try {
          // Skip if already processed
          if (processedIds.has(message.id)) {
            return null;
          }
          processedIds.add(message.id);
          
          // Emit the message for processing
          this.emit('message', message);
          return { success: true, message };
        } catch (error) {
          logger.error('Error processing message', { error });
          return { success: false, error: error.message };
        }
      }));

      // Filter out null values (duplicates)
      return processedMessages.filter(msg => msg !== null);
    } catch (error) {
      logger.error('Error in batch message processing', { error });
      throw error;
    }
  }
}

module.exports = MessageBatcher; 