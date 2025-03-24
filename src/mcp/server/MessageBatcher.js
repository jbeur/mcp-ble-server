const EventEmitter = require('events');
const BatchCompressor = require('./BatchCompressor');
const logger = require('../../utils/logger');
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
        this.metrics = {
            totalBatches: 0,
            totalMessages: 0,
            activeBatches: 0,
            maxBatchSize: 0,
            minBatchSize: Infinity,
            averageBatchSize: 0,
            batchFlushReasons: {
                size: 0,
                timeout: 0,
                priority: 0,
                manual: 0
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
                averageCompressionTimes: 0
            },
            errors: {
                compression: 0,
                invalidMessage: 0,
                invalidClientId: 0,
                validation: 0,
                other: 0
            },
            performance: {
                currentLoad: 0,
                targetLoad: this.config.performanceThreshold,
                adjustmentHistory: []
            }
        };

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

        // Start analytics if enabled
        if (this.config.analytics.enabled) {
            this._startAnalytics();
        }

        // Start adaptive sizing if enabled
        this.adaptiveTimer = null;
        if (this.config.adaptiveInterval) {
            this._startAdaptiveSizing();
        }
    }

    _startAnalytics() {
        this.analyticsTimer = setInterval(() => {
            this._updateAnalytics();
        }, this.config.analytics.interval);
        this.analyticsTimer.unref();
    }

    _startAdaptiveSizing() {
        this.adaptiveTimer = setInterval(() => {
            this._adjustBatchSize();
        }, this.config.adaptiveInterval);
        this.adaptiveTimer.unref();
    }

    _updateAnalytics() {
        if (!this._shouldUpdateAnalytics()) return;

        const analytics = {
            batchSizeHistory: [{
                timestamp: Date.now(),
                average: this.metrics.averageBatchSize,
                max: this.metrics.maxBatchSize,
                min: this.metrics.minBatchSize
            }],
            latencyHistory: [{
                timestamp: Date.now(),
                average: this._calculateAverageLatency(),
                max: this._calculateMaxLatency(),
                min: this._calculateMinLatency()
            }],
            compressionHistory: [{
                timestamp: Date.now(),
                ratio: this.metrics.compression.averageCompressionRatio,
                bytesSaved: this.metrics.compression.totalBytesSaved,
                averageTimes: this.metrics.compression.averageCompressionTimes || 0
            }],
            priorityDistribution: this._calculatePriorityDistribution()
        };

        // Initialize history if not exists
        if (!this._analyticsHistory) {
            this._analyticsHistory = {
                batchSizeHistory: [],
                latencyHistory: [],
                compressionHistory: []
            };
        }

        // Add new data to history
        this._analyticsHistory.batchSizeHistory.push(analytics.batchSizeHistory[0]);
        this._analyticsHistory.latencyHistory.push(analytics.latencyHistory[0]);
        this._analyticsHistory.compressionHistory.push(analytics.compressionHistory[0]);

        // Keep only last 100 entries
        const maxHistorySize = 100;
        if (this._analyticsHistory.batchSizeHistory.length > maxHistorySize) {
            this._analyticsHistory.batchSizeHistory = this._analyticsHistory.batchSizeHistory.slice(-maxHistorySize);
            this._analyticsHistory.latencyHistory = this._analyticsHistory.latencyHistory.slice(-maxHistorySize);
            this._analyticsHistory.compressionHistory = this._analyticsHistory.compressionHistory.slice(-maxHistorySize);
        }

        // Include history in analytics event
        analytics.batchSizeHistory = [...this._analyticsHistory.batchSizeHistory];
        analytics.latencyHistory = [...this._analyticsHistory.latencyHistory];
        analytics.compressionHistory = [...this._analyticsHistory.compressionHistory];

        this.emit('analytics', analytics);
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
            priorities: {
                high: { ...this.metrics.priorities.high },
                medium: { ...this.metrics.priorities.medium },
                low: { ...this.metrics.priorities.low }
            },
            compression: { ...this.metrics.compression },
            errors: { ...this.metrics.errors },
            performance: { ...this.metrics.performance }
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
                throw new Error('Invalid client ID');
            }

            if (!message || !message.type) {
                this.metrics.errors.invalidMessage++;
                throw new Error('Invalid message');
            }

            // Set default priority if not provided
            message.priority = message.priority || 'medium';

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

            // Start or update timer
            this._startBatchTimer(clientId);

            // Check if batch should be flushed
            if (batch.length >= this.batchSize) {
                await this._flushBatch(clientId, 'size');
            }
        } catch (error) {
            logger.error('Error adding message', { error, clientId });
            throw error;
        }
    }

    _startBatchTimer(clientId) {
        const batch = this.batches.get(clientId);
        if (!batch || batch.length === 0) return;

        // Find highest priority message
        const priorities = { high: 0, medium: 1, low: 2 };
        const highestPriority = batch.reduce((a, b) => {
            return priorities[a.priority] < priorities[b.priority] ? a : b;
        }).priority;

        // Clear existing timer
        if (this.timers.has(clientId)) {
            clearTimeout(this.timers.get(clientId));
        }

        // Set new timer based on highest priority
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

            let isCompressed = false;
            let compressedData = null;

            if (this.compressionEnabled && batch.length >= this.config.compression.minSize) {
                try {
                    const compressed = await this.compressor.compress(batch);
                    if (compressed.compressed) {
                        compressedData = compressed.data;
                        isCompressed = true;
                        this.metrics.compression.totalCompressed++;
                        this.metrics.compression.totalBytesSaved += (compressed.originalSize - compressed.compressedSize);
                        this.metrics.compression.averageCompressionRatio = compressed.compressionRatio;
                        
                        // Update compression times
                        const compressorMetrics = this.compressor.getMetrics();
                        this.metrics.compression.averageCompressionTimes = compressorMetrics.averageCompressionTimes;
                    }
                } catch (error) {
                    this.metrics.errors.compression++;
                    logger.error('Compression error', { error, clientId });
                    // Continue without compression
                }
            }

            // Update metrics
            this.metrics.totalBatches++;
            this.metrics.totalMessages += batch.length;
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

            // Clean up
            this.batches.delete(clientId);
            this.batchStartTimes.delete(clientId);
            if (this.timers.has(clientId)) {
                clearTimeout(this.timers.get(clientId));
                this.timers.delete(clientId);
            }

            this.metrics.activeBatches--;

            // Emit batch with consistent format
            const batchData = {
                messages: batch,
                compressed: isCompressed,
                data: compressedData
            };
            this.emit('batch', clientId, batchData, isCompressed);

            // Update analytics if enabled and throttled
            if (this.config.analytics.enabled && this._shouldUpdateAnalytics()) {
                this._updateAnalytics();
            }
        } catch (error) {
            logger.error('Error flushing batch', { error, clientId });
            throw error;
        }
    }

    _shouldUpdateAnalytics() {
        const now = Date.now();
        if (!this._lastAnalyticsUpdate) {
            this._lastAnalyticsUpdate = now;
            return true;
        }

        const timeSinceLastUpdate = now - this._lastAnalyticsUpdate;
        if (timeSinceLastUpdate >= this.config.analytics.interval) {
            this._lastAnalyticsUpdate = now;
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
        const oldSize = this.batchSize;
        const currentLoad = this.metrics.averageBatchSize / this.batchSize;
        const targetLoad = this.performanceThreshold;
        const loadDiff = currentLoad - targetLoad;
        
        // Update metrics
        this.metrics.performance.currentLoad = currentLoad;

        // Adjust batch size based on load
        if (currentLoad > targetLoad) {
            this.batchSize = Math.max(this.batchSize * 0.8, this.minBatchSize);
        } else {
            this.batchSize = Math.min(this.batchSize * 1.2, this.maxBatchSize);
        }

        // Update adjustment history
        this.metrics.performance.adjustmentHistory.push({
            timestamp: Date.now(),
            oldSize,
            newSize: this.batchSize,
            loadDiff,
            currentLoad,
            targetLoad
        });

        // Keep only the last 10 adjustments
        if (this.metrics.performance.adjustmentHistory.length > 10) {
            this.metrics.performance.adjustmentHistory.shift();
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
        for (const [clientId, timer] of this.timers.entries()) {
            clearTimeout(timer);
            this.timers.delete(clientId);
        }

        // Flush all remaining batches
        for (const clientId of this.batches.keys()) {
            await this._flushBatch(clientId, 'manual');
        }

        // Stop predictor if exists
        if (this.predictor) {
            await this.predictor.stop();
        }
    }
}

module.exports = { MessageBatcher, PRIORITY_LEVELS }; 