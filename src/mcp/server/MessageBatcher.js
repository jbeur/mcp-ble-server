const { EventEmitter } = require('events');
const logger = require('../../utils/logger');

// Priority levels
const PRIORITY_LEVELS = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2
};

class MessageBatcher extends EventEmitter {
    constructor(config = {}) {
        super();
        this.batchSize = config.batchSize || 10;
        this.batchTimeout = config.batchTimeout || 100; // ms
        this.minBatchSize = config.minBatchSize || 5;
        this.maxBatchSize = config.maxBatchSize || 50;
        this.adaptiveInterval = config.adaptiveInterval || 60000; // 1 minute
        this.performanceThreshold = config.performanceThreshold || 0.8; // 80% target performance
        this.enableAdaptiveSizing = config.enableAdaptiveSizing !== false; // Enable by default
        this.batches = new Map(); // clientId -> { high: [], medium: [], low: [] }
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
            },
            priorities: {
                high: { count: 0, averageLatency: 0 },
                medium: { count: 0, averageLatency: 0 },
                low: { count: 0, averageLatency: 0 }
            }
        };

        // Start adaptive sizing only if enabled
        if (this.enableAdaptiveSizing) {
            this._startAdaptiveSizing();
        }
    }

    _startAdaptiveSizing() {
        // Clear any existing timer
        if (this.adaptiveTimer) {
            clearInterval(this.adaptiveTimer);
            this.adaptiveTimer = null;
        }

        // Start new timer
        this.adaptiveTimer = setInterval(() => {
            this._adjustBatchSize();
        }, this.adaptiveInterval);
    }

    /**
     * Stop adaptive sizing and clean up resources
     */
    stop() {
        // Clear adaptive timer first
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

        // Clear all data structures
        this.batches.clear();
        this.batchStartTimes.clear();
        this.timers.clear();

        // Remove all listeners
        this.removeAllListeners();
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
                const adjustment = Math.round(this.batchSize * adjustmentFactor * (loadDiff > 0 ? -1 : 1));
                const newSize = Math.max(
                    this.minBatchSize,
                    Math.min(this.maxBatchSize, this.batchSize + adjustment)
                );

                if (newSize !== this.batchSize) {
                    // Record adjustment before changing batch size
                    this.metrics.performance.adjustmentHistory.push({
                        timestamp: Date.now(),
                        oldSize: this.batchSize,
                        newSize: newSize,
                        loadDiff: loadDiff,
                        currentLoad: currentLoad,
                        targetLoad: targetLoad
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
                // Calculate total messages across all priority levels
                const batchSize = Object.values(batch).reduce((sum, priorityBatch) => sum + priorityBatch.length, 0);
                totalMessages += batchSize;
                const batchSizeRatio = batchSize / this.maxBatchSize;
                const loadFactor = Math.min(1, batchSizeRatio);
                totalLoad += loadFactor;
            }

            // If we have a lot of messages in the current batches, increase the load factor
            if (totalMessages > this.maxBatchSize * totalBatches) {
                return Math.min(1, totalLoad / totalBatches + 0.2); // Less aggressive increase
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
            Array.from(this.batches.values()).reduce((sum, batch) => {
                const batchSize = Object.values(batch).reduce((total, priorityBatch) => total + priorityBatch.length, 0);
                return sum + (batchSize / this.maxBatchSize);
            }, 0) / this.batches.size : 0;

        // Weighted average of history and current load
        return Math.min(1, (historyLoad * 0.6 + currentLoad * 0.4));
    }

    /**
     * Add a message to the batch for a specific client
     * @param {string} clientId - The client identifier
     * @param {Object} message - The message to batch
     * @param {number} priority - Message priority (0: high, 1: medium, 2: low)
     */
    addMessage(clientId, message, priority = PRIORITY_LEVELS.MEDIUM) {
        try {
            if (!message) {
                throw new Error('Message cannot be null or undefined');
            }

            if (!message.type || !message.data) {
                this.metrics.errors.addMessage++;
                throw new Error('Invalid message format: must have type and data properties');
            }

            if (!this.batches.has(clientId)) {
                this.batches.set(clientId, {
                    high: [],
                    medium: [],
                    low: []
                });
                this.batchStartTimes.set(clientId, Date.now());
                this._startBatchTimer(clientId);
                this.metrics.activeClients++;
                this.metrics.activeBatches++;
            }

            const clientBatches = this.batches.get(clientId);
            const priorityKey = this._getPriorityKey(priority);
            clientBatches[priorityKey].push(message);
            this.metrics.totalMessages++;
            this.metrics.priorities[priorityKey].count++;

            // Check if we should flush based on total messages across all priorities
            const totalMessages = Object.values(clientBatches).reduce((sum, batch) => sum + batch.length, 0);
            if (totalMessages >= this.batchSize) {
                this._flushBatch(clientId, 'size');
            }
        } catch (error) {
            logger.error('Error adding message to batch:', { error, clientId });
            this.metrics.errors.addMessage++;
            throw error;
        }
    }

    /**
     * Get priority key from level
     * @private
     * @param {number} priority - Priority level
     * @returns {string} Priority key
     */
    _getPriorityKey(priority) {
        switch (priority) {
            case PRIORITY_LEVELS.HIGH: return 'high';
            case PRIORITY_LEVELS.MEDIUM: return 'medium';
            case PRIORITY_LEVELS.LOW: return 'low';
            default: return 'medium';
        }
    }

    /**
     * Start a timer for a client's batch
     * @private
     * @param {string} clientId - The client identifier
     */
    _startBatchTimer(clientId) {
        // Clear any existing timer
        const existingTimer = this.timers.get(clientId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.timers.delete(clientId);
        }

        const timer = setTimeout(() => {
            this._flushBatch(clientId, 'timeout');
        }, this.batchTimeout);

        this.timers.set(clientId, timer);
    }

    /**
     * Flush the batch for a specific client
     * @private
     * @param {string} clientId - The client identifier
     * @param {string} reason - The reason for flushing
     */
    _flushBatch(clientId, reason = 'size') {
        try {
            const clientBatches = this.batches.get(clientId);
            if (!clientBatches) return;

            // Clear the timer first
            const timer = this.timers.get(clientId);
            if (timer) {
                clearTimeout(timer);
                this.timers.delete(clientId);
            }

            // Combine batches in priority order
            const batch = [
                ...clientBatches.high,
                ...clientBatches.medium,
                ...clientBatches.low
            ];

            if (batch.length === 0) {
                // Clean up even if batch is empty
                this.batches.delete(clientId);
                this.batchStartTimes.delete(clientId);
                this.metrics.activeBatches--;
                return;
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

            // Clean up client data
            this.batches.delete(clientId);
            this.metrics.activeBatches--;

            // Emit the batch event
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
            activeClients: this.batches.size, // Keep current active clients
            activeBatches: this.batches.size, // Keep current active batches
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
            },
            priorities: {
                high: { count: 0, averageLatency: 0 },
                medium: { count: 0, averageLatency: 0 },
                low: { count: 0, averageLatency: 0 }
            }
        };
    }
}

module.exports = { MessageBatcher, PRIORITY_LEVELS }; 