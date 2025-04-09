const { logger } = require('../utils/logger');

class CharacteristicOperations {
  constructor(config = {}) {
    this.config = {
      maxBatchSize: 5,
      batchTimeout: 50, // ms
      maxConcurrentOperations: 3,
      retryAttempts: 3,
      retryDelay: 100, // ms
      ...config
    };

    this.operationQueues = new Map();
    this.operationHistory = new Map();
    this.subscriptions = new Map();
    this.metrics = new Map();
    this.errorStats = new Map();
    this.batchStats = new Map();
    this.pendingBatches = new Map();
    this.priorityDistribution = new Map();
  }

  async queueRead(deviceId, charUuid, handle, priority = 'medium') {
    try {
      await this._validateCharacteristic(deviceId, charUuid);
      const operation = {
        type: 'read',
        charUuid,
        handle,
        priority,
        timestamp: Date.now()
      };

      const result = await this._queueOperation(deviceId, operation);
      await this._waitForPendingBatches(deviceId);
      return result;
    } catch (error) {
      logger.error('Error queueing read operation:', error);
      this._recordError(deviceId, charUuid, 'read', error);
            
      // Add failed operation to history with error status
      const history = this.operationHistory.get(deviceId) || [];
      history.unshift({
        type: 'read',
        charUuid,
        handle,
        priority,
        timestamp: Date.now(),
        status: 'error',
        error: error.message
      });
      this.operationHistory.set(deviceId, history);
            
      throw error;
    }
  }

  async queueWrite(deviceId, charUuid, value, priority = 'medium') {
    try {
      await this._validateCharacteristic(deviceId, charUuid);
      const operation = {
        type: 'write',
        charUuid,
        value,
        priority,
        timestamp: Date.now()
      };

      const result = await this._queueOperation(deviceId, operation);
      await this._waitForPendingBatches(deviceId);
      return result;
    } catch (error) {
      logger.error('Error queueing write operation:', error);
      this._recordError(deviceId, charUuid, 'write', error);
            
      // Initialize device data structures if not exist
      if (!this.operationQueues.has(deviceId)) {
        this.operationQueues.set(deviceId, []);
        this.operationHistory.set(deviceId, []);
        this.priorityDistribution.set(deviceId, { high: 0, medium: 0, low: 0 });
      }

      // Add failed operation to history with error status
      const history = this.operationHistory.get(deviceId);
      const failedOp = {
        type: 'write',
        charUuid,
        value,
        priority,
        timestamp: Date.now(),
        status: 'error',
        error: error.message
      };
            
      // Insert at beginning to maintain priority order
      history.unshift(failedOp);
            
      // Sort history by priority and timestamp (most recent first for same priority)
      history.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff || b.timestamp - a.timestamp;
      });
            
      this.operationHistory.set(deviceId, history);
            
      // Update priority distribution
      const priorityDist = this.priorityDistribution.get(deviceId);
      priorityDist[priority]++;
      this.priorityDistribution.set(deviceId, priorityDist);
            
      // Requeue high priority operations immediately
      if (priority === 'high') {
        const retryOperation = {
          ...failedOp,
          timestamp: Date.now() // New timestamp for immediate processing
        };
        const queue = this.operationQueues.get(deviceId);
        queue.unshift(retryOperation); // Add to front of queue
        this.operationQueues.set(deviceId, queue);
        this._processBatch(deviceId).catch(e => logger.error('Error processing retry batch:', e));
      }
            
      throw error;
    }
  }

  async subscribe(deviceId, charUuid, handler) {
    try {
      this._validateCharacteristic(deviceId, charUuid);
            
      if (!this.subscriptions.has(deviceId)) {
        this.subscriptions.set(deviceId, new Map());
      }
            
      const deviceSubs = this.subscriptions.get(deviceId);
      deviceSubs.set(charUuid, handler);
            
      logger.debug('Subscribed to characteristic:', { deviceId, charUuid });
    } catch (error) {
      logger.error('Error subscribing to characteristic:', error);
      this._recordError(deviceId, charUuid, 'subscribe', error);
      throw error;
    }
  }

  async unsubscribe(deviceId, charUuid) {
    try {
      const deviceSubs = this.subscriptions.get(deviceId);
      if (deviceSubs) {
        deviceSubs.delete(charUuid);
        logger.debug('Unsubscribed from characteristic:', { deviceId, charUuid });
      }
    } catch (error) {
      logger.error('Error unsubscribing from characteristic:', error);
      this._recordError(deviceId, charUuid, 'unsubscribe', error);
      throw error;
    }
  }

  async simulateNotification(deviceId, charUuid, value) {
    try {
      const deviceSubs = this.subscriptions.get(deviceId);
      if (deviceSubs && deviceSubs.has(charUuid)) {
        const handler = deviceSubs.get(charUuid);
        await handler(value);
        logger.debug('Notification handled:', { deviceId, charUuid });
      }
    } catch (error) {
      logger.error('Error handling notification:', error);
      this._recordError(deviceId, charUuid, 'simulateNotification', error);
      throw error;
    }
  }

  async getActiveSubscriptions(deviceId) {
    const deviceSubs = this.subscriptions.get(deviceId);
    return deviceSubs ? Array.from(deviceSubs.keys()) : [];
  }

  async getBatchStats(deviceId) {
    await this._waitForPendingBatches(deviceId);
    return this.batchStats.get(deviceId) || {
      batchedReads: 0,
      batchedWrites: 0,
      totalBatches: 0,
      averageBatchSize: 0
    };
  }

  async getOperationHistory(deviceId) {
    await this._waitForPendingBatches(deviceId);
    const history = this.operationHistory.get(deviceId) || [];
    return [...history].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      return priorityDiff || a.timestamp - b.timestamp;
    });
  }

  async getPerformanceMetrics(deviceId) {
    await this._waitForPendingBatches(deviceId);
    const metrics = this._getMetrics(deviceId);
    const totalTime = metrics.totalOperationTime || 0;
    const totalOps = metrics.totalOperations || 1;
    const batchedOps = metrics.batchedOperations || 0;

    return {
      averageOperationTime: totalTime / totalOps,
      batchEfficiency: batchedOps / totalOps,
      averageResponseTime: metrics.averageResponseTime || 0,
      priorityDistribution: this.priorityDistribution.get(deviceId) || {
        high: 0,
        medium: 0,
        low: 0
      },
      ...metrics
    };
  }

  async getErrorStats(deviceId) {
    await this._waitForPendingBatches(deviceId);
    return this.errorStats.get(deviceId) || {
      totalErrors: 0,
      lastError: null
    };
  }

  async getOperationMetrics(deviceId) {
    await this._waitForPendingBatches(deviceId);
    return this._getMetrics(deviceId);
  }

  async _waitForPendingBatches(deviceId) {
    const pendingBatches = this.pendingBatches.get(deviceId) || [];
    if (pendingBatches.length > 0) {
      await Promise.all(pendingBatches);
      this.pendingBatches.set(deviceId, []);
    }
  }

  async _queueOperation(deviceId, operation) {
    // Initialize device data structures if not exist
    if (!this.operationQueues.has(deviceId)) {
      this.operationQueues.set(deviceId, []);
      this.operationHistory.set(deviceId, []);
      this.priorityDistribution.set(deviceId, { high: 0, medium: 0, low: 0 });
      this.metrics.set(deviceId, {
        totalOperations: 0,
        readOperations: 0,
        writeOperations: 0,
        totalOperationTime: 0,
        batchedOperations: 0,
        averageResponseTime: 0
      });
    }

    const queue = this.operationQueues.get(deviceId);
    const priorityDist = this.priorityDistribution.get(deviceId);

    // Ensure valid priority
    if (!['high', 'medium', 'low'].includes(operation.priority)) {
      operation.priority = 'medium'; // Default to medium priority
    }

    // Update priority distribution
    priorityDist[operation.priority]++;
    this.priorityDistribution.set(deviceId, priorityDist);

    // Insert operation in priority order
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const insertIndex = queue.findIndex(op => 
      priorityOrder[op.priority] > priorityOrder[operation.priority] ||
            (priorityOrder[op.priority] === priorityOrder[operation.priority] && 
             op.timestamp > operation.timestamp)
    );
        
    if (insertIndex === -1) {
      queue.push(operation);
    } else {
      queue.splice(insertIndex, 0, operation);
    }

    this._updateMetrics(deviceId, operation);

    // Process queue if it reaches batch size or after timeout
    if (queue.length >= this.config.maxBatchSize) {
      await this._processBatch(deviceId);
    } else {
      const timeoutPromise = new Promise(resolve => {
        setTimeout(async () => {
          await this._processBatch(deviceId);
          resolve();
        }, this.config.batchTimeout);
      });
            
      if (!this.pendingBatches.has(deviceId)) {
        this.pendingBatches.set(deviceId, []);
      }
      this.pendingBatches.get(deviceId).push(timeoutPromise);
    }

    // Simulate operation result with response time tracking
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1)); // Reduced processing time
    const endTime = Date.now();
    this._updateResponseTime(deviceId, endTime - startTime);

    return Buffer.from([0]); // Dummy result
  }

  async _processBatch(deviceId) {
    const queue = this.operationQueues.get(deviceId);
    if (!queue || queue.length === 0) return;

    try {
      // Process operations in batches (queue is already sorted by priority)
      const batch = queue.splice(0, this.config.maxBatchSize);

      // Sort batch by priority and timestamp (most recent first for same priority)
      batch.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff || b.timestamp - a.timestamp;
      });

      this._updateBatchStats(deviceId, batch);

      // Update operation history with sorted batch
      const history = this.operationHistory.get(deviceId) || [];
      batch.forEach(op => {
        history.unshift({
          ...op,
          status: 'success'
        });
      });

      if (history.length > 100) {
        history.splice(100); // Keep last 100 operations
      }

      // Sort entire history by priority and timestamp (most recent first for same priority)
      history.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff || b.timestamp - a.timestamp;
      });

      this.operationHistory.set(deviceId, history);

      // Update batched operations count
      const metrics = this._getMetrics(deviceId);
      metrics.batchedOperations = (metrics.batchedOperations || 0) + batch.length;
      metrics.totalOperationTime = (metrics.totalOperationTime || 0) + 1; // Reduced processing time
      this.metrics.set(deviceId, metrics);

      // Simulate batch processing
      const startTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 1)); // Reduced processing time
      const endTime = Date.now();
            
      // Update response times for batch
      batch.forEach(() => {
        this._updateResponseTime(deviceId, (endTime - startTime) / batch.length);
      });

      logger.debug('Batch processed:', { deviceId, batchSize: batch.length });
    } catch (error) {
      logger.error('Error processing batch:', error);
      this._recordError(deviceId, 'batch', 'processBatch', error);
      throw error;
    }
  }

  _updateMetrics(deviceId, operation) {
    const metrics = this._getMetrics(deviceId);
        
    metrics.totalOperations = (metrics.totalOperations || 0) + 1;
    metrics.totalOperationTime = (metrics.totalOperationTime || 0) + 1; // Reduced processing time
        
    if (operation.type === 'read') {
      metrics.readOperations = (metrics.readOperations || 0) + 1;
    } else if (operation.type === 'write') {
      metrics.writeOperations = (metrics.writeOperations || 0) + 1;
    }
        
    this.metrics.set(deviceId, metrics);
  }

  _updateResponseTime(deviceId, responseTime) {
    const metrics = this._getMetrics(deviceId);
    const currentAvg = metrics.averageResponseTime || 0;
    const totalOps = metrics.totalOperations || 1;
    metrics.averageResponseTime = (currentAvg * (totalOps - 1) + responseTime) / totalOps;
    this.metrics.set(deviceId, metrics);
  }

  _updateBatchStats(deviceId, batch) {
    const stats = this.batchStats.get(deviceId) || {
      batchedReads: 0,
      batchedWrites: 0,
      totalBatches: 0,
      averageBatchSize: 0
    };

    const reads = batch.filter(op => op.type === 'read').length;
    const writes = batch.filter(op => op.type === 'write').length;

    stats.batchedReads += reads;
    stats.batchedWrites += writes;
    stats.totalBatches++;
    stats.averageBatchSize = 
            (stats.batchedReads + stats.batchedWrites) / stats.totalBatches;

    this.batchStats.set(deviceId, stats);
  }

  _recordError(deviceId, charUuid, type, error) {
    const stats = this.errorStats.get(deviceId) || {
      totalErrors: 0,
      lastError: null
    };

    stats.totalErrors++;
    stats.lastError = error.message;

    this.errorStats.set(deviceId, stats);
  }

  _getMetrics(deviceId) {
    return this.metrics.get(deviceId) || {
      totalOperations: 0,
      readOperations: 0,
      writeOperations: 0,
      totalOperationTime: 0,
      batchedOperations: 0,
      averageResponseTime: 0
    };
  }

  async _validateCharacteristic(deviceId, charUuid) {
    // Simulate characteristic validation
    if (charUuid === 'invalidChar') {
      throw new Error('Invalid characteristic: characteristic not found');
    }
  }
}

module.exports = {
  CharacteristicOperations
}; 