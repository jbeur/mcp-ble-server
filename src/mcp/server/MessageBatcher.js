const { EventEmitter } = require('events');
const logger = require('../../utils/logger');

class MessageBatcher extends EventEmitter {
    constructor(config = {}) {
        super();
        this.batchSize = config.batchSize || 10;
        this.batchTimeout = config.batchTimeout || 100; // ms
        this.minBatchSize = config.minBatchSize || 5;
        this.maxBatchSize = config.maxBatchSize || 50;
        this.adaptiveInterval = config.adaptiveInterval || 60000; // 1 minute
        this.performanceThreshold = config.performanceThreshold || 0.8; // 80% target performance
        this.batches = new Map(); // clientId -> batch
        this.timers = new Map(); // clientId -> timer
        this.batchStartTimes = new Map(); // clientId -> startTime
        this.adaptiveTimer = null; // Store the interval timer
        this.metrics = {
            totalBatches: 0,
            totalMessages: 0,
            averageBatchSize: 0,
            maxBatchSize: 0,
            minBatchSize: Infinity,
            batchLatency: {
                total: 0,
                count: 0,
                max: 0,
                min: Infinity
            },
            activeClients: 0,
            activeBatches: 0,
            batchFlushReasons: {
                size: 0,
                timeout: 0,
                clientDisconnect: 0
            },
            errors: {
                addMessage: 0,
                flushBatch: 0,
                clientDisconnect: 0
            },
            performance: {
                lastAdjustment: Date.now(),
                currentLoad: 0,
                targetLoad: 0,
                adjustmentHistory: []
            }
        };

        // Start adaptive sizing
        this._startAdaptiveSizing();
    }

    _startAdaptiveSizing() {
        this.adaptiveTimer = setInterval(() => {
            this._adjustBatchSize();
        }, this.adaptiveInterval);
    }

    /**
     * Stop adaptive sizing and clean up resources
     */
    stop() {
        if (this.adaptiveTimer) {
            clearInterval(this.adaptiveTimer);
            this.adaptiveTimer = null;
        }

        // Clean up any remaining batch timers
        for (const [clientId, timer] of this.timers) {
            clearTimeout(timer);
            this.timers.delete(clientId);
        }

        // Flush any remaining batches
        for (const clientId of this.batches.keys()) {
            this._flushBatch(clientId, 'clientDisconnect');
        }

        this.batches.clear();
        this.batchStartTimes.clear();
    }

    _adjustBatchSize() {
        try {
            const currentLoad = this._calculateCurrentLoad();
            const targetLoad = this.performanceThreshold;
            const loadDiff = currentLoad - targetLoad;

            // Store current metrics
            this.metrics.performance.lastAdjustment = Date.now();
            this.metrics.performance.currentLoad = currentLoad;
            this.metrics.performance.targetLoad = targetLoad;

            // Adjust batch size based on load
            if (Math.abs(loadDiff) > 0.05) { // More sensitive to load changes
                const adjustmentFactor = Math.min(Math.abs(loadDiff), 0.5); // Cap adjustment factor
                const adjustment = Math.round(this.batchSize * adjustmentFactor * (loadDiff > 0 ? 1 : -1));
                const newSize = Math.max(
                    this.minBatchSize,
                    Math.min(this.maxBatchSize, this.batchSize + adjustment)
                );

                if (newSize !== this.batchSize) {
                    this.metrics.performance.adjustmentHistory.push({
                        timestamp: Date.now(),
                        oldSize: this.batchSize,
                        newSize: newSize,
                        loadDiff: loadDiff
                    });

                    // Keep only last 10 adjustments
                    if (this.metrics.performance.adjustmentHistory.length > 10) {
                        this.metrics.performance.adjustmentHistory.shift();
                    }

                    this.batchSize = newSize;
                    logger.info('Adjusted batch size:', {
                        oldSize: this.batchSize,
                        newSize: newSize,
                        currentLoad: currentLoad,
                        targetLoad: targetLoad,
                        adjustment: adjustment
                    });
                }
            }
        } catch (error) {
            logger.error('Error adjusting batch size:', { error });
        }
    }

    _calculateCurrentLoad() {
        const now = Date.now();
        const recentBatches = this.metrics.performance.adjustmentHistory.filter(
            adj => now - adj.timestamp < this.adaptiveInterval
        );

        if (recentBatches.length === 0) {
            // If no recent adjustments, calculate based on current batch sizes and total messages
            const totalBatches = this.batches.size;
            if (totalBatches === 0) return 0;

            let totalLoad = 0;
            let totalMessages = 0;
            for (const [_, batch] of this.batches) {
                totalMessages += batch.length;
                const batchSizeRatio = batch.length / this.maxBatchSize;
                const loadFactor = Math.min(1, batchSizeRatio);
                totalLoad += loadFactor;
            }

            // If we have a lot of messages in the current batches, increase the load factor
            if (totalMessages > this.maxBatchSize * totalBatches) {
                return Math.min(1, totalLoad / totalBatches + 0.5);
            }

            return totalLoad / totalBatches;
        }

        // Calculate average load based on adjustment history and current state
        const historyLoad = recentBatches.reduce((sum, adj) => {
            const batchSizeRatio = adj.newSize / this.maxBatchSize;
            const loadFactor = Math.min(1, batchSizeRatio);
            return sum + loadFactor;
        }, 0) / recentBatches.length;

        // Factor in current state
        const currentLoad = this.batches.size > 0 ? 
            Array.from(this.batches.values()).reduce((sum, batch) => sum + batch.length, 0) / 
            (this.maxBatchSize * this.batches.size) : 0;

        // Weighted average of history and current load
        return Math.min(1, (historyLoad * 0.7 + currentLoad * 0.3));
    }

    /**
     * Add a message to the batch for a specific client
     * @param {string} clientId - The client identifier
     * @param {Object} message - The message to batch
     */
    addMessage(clientId, message) {
        try {
            if (!message) {
                throw new Error('Message cannot be null or undefined');
            }

            if (!message.type || !message.data) {
                this.metrics.errors.addMessage++;
                throw new Error('Invalid message format: must have type and data properties');
            }

            if (!this.batches.has(clientId)) {
                this.batches.set(clientId, []);
                this.batchStartTimes.set(clientId, Date.now());
                this._startBatchTimer(clientId);
                this.metrics.activeClients++;
                this.metrics.activeBatches++;
            }

            const batch = this.batches.get(clientId);
            batch.push(message);
            this.metrics.totalMessages++;

            if (batch.length >= this.batchSize) {
                this._flushBatch(clientId, 'size');
            }
        } catch (error) {
            logger.error('Error adding message to batch:', { error, clientId });
            this.metrics.errors.addMessage++;
            throw error;
        }
    }

    /**
     * Start a timer for a client's batch
     * @private
     * @param {string} clientId - The client identifier
     */
    _startBatchTimer(clientId) {
        const timer = setTimeout(() => {
            this._flushBatch(clientId, 'timeout');
        }, this.batchTimeout);

        this.timers.set(clientId, timer);
    }

    /**
     * Flush the batch for a specific client
     * @private
     * @param {string} clientId - The client identifier
     */
    _flushBatch(clientId, reason = 'size') {
        try {
            const batch = this.batches.get(clientId);
            if (!batch || batch.length === 0) return;

            const timer = this.timers.get(clientId);
            if (timer) {
                clearTimeout(timer);
                this.timers.delete(clientId);
            }

            // Update batch size metrics
            this.metrics.maxBatchSize = Math.max(this.metrics.maxBatchSize, batch.length);
            this.metrics.minBatchSize = Math.min(this.metrics.minBatchSize, batch.length);
            this.metrics.totalBatches++;
            this.metrics.averageBatchSize = 
                (this.metrics.averageBatchSize * (this.metrics.totalBatches - 1) + batch.length) / 
                this.metrics.totalBatches;

            // Update batch flush reason metrics
            this.metrics.batchFlushReasons[reason]++;

            // Update latency metrics
            const startTime = this.batchStartTimes.get(clientId);
            if (startTime) {
                const latency = Date.now() - startTime;
                this.metrics.batchLatency.total += latency;
                this.metrics.batchLatency.count++;
                this.metrics.batchLatency.max = Math.max(this.metrics.batchLatency.max, latency);
                this.metrics.batchLatency.min = Math.min(this.metrics.batchLatency.min, latency);
                this.batchStartTimes.delete(clientId);
            }

            this.batches.delete(clientId);
            this.metrics.activeBatches--;

            this.emit('batch', clientId, batch);
        } catch (error) {
            logger.error('Error flushing batch:', { error, clientId });
            this.metrics.errors.flushBatch++;
            throw error;
        }
    }

    /**
     * Remove a client's batch and timer
     * @param {string} clientId - The client identifier
     */
    removeClient(clientId) {
        try {
            const timer = this.timers.get(clientId);
            if (timer) {
                clearTimeout(timer);
                this.timers.delete(clientId);
            }

            if (this.batches.has(clientId)) {
                this._flushBatch(clientId, 'clientDisconnect');
                this.metrics.activeClients--;
            }

            this.batches.delete(clientId);
            this.batchStartTimes.delete(clientId);
        } catch (error) {
            logger.error('Error removing client:', { error, clientId });
            this.metrics.errors.clientDisconnect++;
            throw error;
        }
    }

    /**
     * Get current metrics
     * @returns {Object} Current metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            averageLatency: this.metrics.batchLatency.count > 0 ? 
                this.metrics.batchLatency.total / this.metrics.batchLatency.count : 0
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            totalBatches: 0,
            totalMessages: 0,
            averageBatchSize: 0,
            maxBatchSize: 0,
            minBatchSize: Infinity,
            batchLatency: {
                total: 0,
                count: 0,
                max: 0,
                min: Infinity
            },
            activeClients: 0,
            activeBatches: 0,
            batchFlushReasons: {
                size: 0,
                timeout: 0,
                clientDisconnect: 0
            },
            errors: {
                addMessage: 0,
                flushBatch: 0,
                clientDisconnect: 0
            },
            performance: {
                lastAdjustment: Date.now(),
                currentLoad: 0,
                targetLoad: 0,
                adjustmentHistory: []
            }
        };
    }
}

module.exports = MessageBatcher; 