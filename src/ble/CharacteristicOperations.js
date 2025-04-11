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
        batchedOperations: 0,
        totalOperationTime: 0,
        averageResponseTime: 0,
        lastOperationTime: 0
      });
      this.batchStats.set(deviceId, {
        batchedReads: 0,
        batchedWrites: 0,
        totalBatches: 0,
        averageBatchSize: 0
      });
      this.errorStats.set(deviceId, {
        totalErrors: 0,
        lastError: null
      });
    }

    const queue = this.operationQueues.get(deviceId);
    queue.push(operation);
    this.operationQueues.set(deviceId, queue);

    // Update priority distribution
    const priorityDist = this.priorityDistribution.get(deviceId);
    priorityDist[operation.priority]++;
    this.priorityDistribution.set(deviceId, priorityDist);

    // Process batch if queue size reaches maxBatchSize
    if (queue.length >= this.config.maxBatchSize) {
      return this._processBatch(deviceId);
    }

    // Start batch timeout if not already running
    if (!this.pendingBatches.has(deviceId)) {
      this.pendingBatches.set(deviceId, []);
      setTimeout(() => this._processBatch(deviceId), this.config.batchTimeout);
    }

    return Promise.resolve();
  }

  async _processBatch(deviceId) {
    try {
      const queue = this.operationQueues.get(deviceId) || [];
      if (queue.length === 0) return;

      // Sort operations by priority and timestamp
      queue.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff || a.timestamp - b.timestamp;
      });

      // Process operations in batches
      const batchSize = Math.min(queue.length, this.config.maxBatchSize);
      const batch = queue.splice(0, batchSize);
      this.operationQueues.set(deviceId, queue);

      // Update batch stats
      const batchStats = this.batchStats.get(deviceId);
      batchStats.totalBatches++;
      batchStats.averageBatchSize = (batchStats.averageBatchSize * (batchStats.totalBatches - 1) + batch.length) / batchStats.totalBatches;
      
      // Count batched operations by type
      batch.forEach(op => {
        if (op.type === 'read') batchStats.batchedReads++;
        if (op.type === 'write') batchStats.batchedWrites++;
      });
      
      this.batchStats.set(deviceId, batchStats);

      // Process each operation in the batch
      const startTime = Date.now();
      const results = await Promise.allSettled(
        batch.map(async op => {
          try {
            const result = await this._executeOperation(deviceId, op);
            this._updateMetrics(deviceId, op);
            return result;
          } catch (error) {
            this._recordError(deviceId, op.charUuid, op.type, error);
            throw error;
          }
        })
      );

      // Update operation history
      const history = this.operationHistory.get(deviceId);
      batch.forEach((op, index) => {
        history.unshift({
          ...op,
          status: results[index].status,
          result: results[index].status === 'fulfilled' ? results[index].value : results[index].reason,
          timestamp: Date.now()
        });
      });
      this.operationHistory.set(deviceId, history);

      // Update performance metrics
      const totalTime = Date.now() - startTime;
      this._updateResponseTime(deviceId, totalTime / batch.length);

      return results;
    } catch (error) {
      logger.error('Error processing batch:', error);
      throw error;
    }
  }

  async _executeOperation(deviceId, _operation) {
    // Simulate operation execution
    await new Promise(resolve => setTimeout(resolve, 10));
    return { success: true, operation: _operation };
  }

  _updateMetrics(deviceId, operation) {
    const metrics = this.metrics.get(deviceId);
    metrics.totalOperations++;
    metrics.batchedOperations++;
    this.metrics.set(deviceId, metrics);
  }

  _updateResponseTime(deviceId, responseTime) {
    const metrics = this.metrics.get(deviceId);
    metrics.lastOperationTime = responseTime;
    metrics.averageResponseTime = (metrics.averageResponseTime * (metrics.totalOperations - 1) + responseTime) / metrics.totalOperations;
    this.metrics.set(deviceId, metrics);
  }

  _updateBatchStats(deviceId, batch) {
    const stats = this.batchStats.get(deviceId);
    stats.totalBatches++;
    stats.averageBatchSize = (stats.averageBatchSize * (stats.totalBatches - 1) + batch.length) / stats.totalBatches;
    this.batchStats.set(deviceId, stats);
  }

  _recordError(deviceId, charUuid, type, error) {
    const stats = this.errorStats.get(deviceId);
    stats.totalErrors++;
    stats.lastError = {
      charUuid,
      type,
      message: error.message,
      timestamp: Date.now()
    };
    this.errorStats.set(deviceId, stats);
    logger.error(`Error in ${type} operation:`, error);
  }

  _getMetrics(deviceId) {
    return this.metrics.get(deviceId) || {
      totalOperations: 0,
      batchedOperations: 0,
      totalOperationTime: 0,
      averageResponseTime: 0,
      lastOperationTime: 0
    };
  }

  async _validateCharacteristic(deviceId, charUuid) {
    if (!deviceId || !charUuid) {
      throw new Error('Invalid device ID or characteristic UUID');
    }
    return true;
  }
}

module.exports = {
  CharacteristicOperations
}; 