const { EventEmitter } = require('events');
const logger = require('../../utils/logger');

class MessageBatcher extends EventEmitter {
    constructor(config = {}) {
        super();
        this.batchSize = config.batchSize || 10;
        this.batchTimeout = config.batchTimeout || 100; // ms
        this.batches = new Map(); // clientId -> batch
        this.timers = new Map(); // clientId -> timer
        this.batchStartTimes = new Map(); // clientId -> startTime
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
            }
        };
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
            }
        };
    }
}

module.exports = MessageBatcher; 