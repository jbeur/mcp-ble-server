const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const zlib = require('zlib');
const MemoryManager = require('../../utils/MemoryManager');

class InvalidationStrategy {
    constructor(config) {
        this.maxAge = config.maxAge;
        this.maxSize = config.maxSize;
        this.priorityLevels = config.priorityLevels;
        this.getPriorityValue = config.getPriorityValue;
    }

    async checkAndInvalidate(cache) {
        try {
            let invalidatedCount = 0;
            const now = Date.now();

            // Check max age
            for (const [key, entry] of cache.entries()) {
                const age = now - entry.timestamp;
                if (age > this.maxAge) {
                    cache.delete(key);
                    invalidatedCount++;
                    metrics.incrementCounter('cache_invalidations_total', {
                        reason: 'invalidation_strategy',
                        count: 1
                    });
                    logger.info('Cache entry invalidated', {
                        key,
                        reason: 'max_age'
                    });
                }
            }

            // Check max size
            if (cache.size > this.maxSize) {
                const entries = Array.from(cache.entries());
                entries.sort((a, b) => {
                    // Sort by priority (lowest first) and then by timestamp (oldest first)
                    const priorityDiff = this.getPriorityValue(a[1].priority) - 
                                       this.getPriorityValue(b[1].priority);
                    if (priorityDiff !== 0) return priorityDiff;
                    return a[1].timestamp - b[1].timestamp;
                });

                const numToRemove = cache.size - this.maxSize;
                const entriesToRemove = entries.slice(0, numToRemove);
                for (const [key] of entriesToRemove) {
                    if (key) {
                        cache.delete(key);
                        invalidatedCount++;
                        metrics.incrementCounter('cache_invalidations_total', {
                            reason: 'invalidation_strategy',
                            count: 1
                        });
                        logger.info('Cache entry invalidated', {
                            key,
                            reason: 'max_size'
                        });
                    }
                }
            }

            return invalidatedCount;
        } catch (error) {
            logger.error('Error during cache invalidation', { error });
            return 0;
        }
    }
}

class CachingLayer {
    constructor(config) {
        if (!config) {
            throw new Error('Configuration is required');
        }

        // Initialize invalidation strategy
        if (!config.invalidationStrategy) {
            throw new Error('Invalid configuration: invalidationStrategy is required');
        }

        // Initialize config with defaults
        this.config = {
            ...config,
            memoryMonitoring: {
                enabled: config?.memoryMonitoring?.enabled ?? true,
                checkIntervalMS: config?.memoryMonitoring?.checkIntervalMS || 60000,
                warningThresholdMB: config?.memoryMonitoring?.warningThresholdMB || 100,
                maxMemoryMB: config?.memoryMonitoring?.maxMemoryMB || 200,
                ...config.memoryMonitoring
            },
            hitRatioTracking: {
                enabled: true,
                windowSize: 1000, // Number of requests to track
                ...config.hitRatioTracking
            },
            preloading: {
                enabled: false,
                batchSize: 10,
                maxConcurrent: 5,
                priority: 'medium',
                ...config.preloading
            },
            compression: {
                enabled: false,
                minSize: 1024, // Minimum size in bytes to compress
                level: 6, // Compression level (1-9)
                algorithm: 'gzip', // 'gzip' or 'deflate'
                ...config.compression
            }
        };

        this.cache = new Map();
        this.memoryManager = new MemoryManager({
            maxHeapSize: this.config.memoryMonitoring.maxMemoryMB * 1024 * 1024,
            warningThreshold: this.config.memoryMonitoring.warningThresholdMB / this.config.memoryMonitoring.maxMemoryMB,
            criticalThreshold: 0.9,
            poolSize: this.config.invalidationStrategy.maxSize,
            gcInterval: this.config.memoryMonitoring.checkIntervalMS
        });
        this.invalidationStrategy = new InvalidationStrategy(config.invalidationStrategy);

        // Validate configurations
        this.validateTTLConfig(config.ttl);
        this.validateCompressionConfig(this.config.compression);

        // Initialize memory monitoring state
        this.stopMemoryMonitoring();

        // Start memory monitoring if enabled
        if (this.config.memoryMonitoring?.enabled) {
            this.startMemoryMonitoring();
        }

        // Start preloading if enabled
        if (this.config.preloading?.enabled) {
            this.startPreloading();
        }
    }

    validateTTLConfig(ttl) {
        // If TTL is not provided, it's valid (disabled)
        if (!ttl) return;

        // If TTL is a number, it's valid (simple TTL)
        if (typeof ttl === 'number' && ttl > 0) return;

        // If TTL is an object, validate its structure
        if (typeof ttl === 'object' && ttl !== null) {
            // If TTL is disabled, no further validation needed
            if (ttl.enabled === false) return;

            // If TTL is enabled, validate defaultTTL
            if (ttl.enabled === true) {
                if (typeof ttl.defaultTTL !== 'number' || ttl.defaultTTL <= 0) {
                    throw new Error('Invalid TTL configuration');
                }

                // Validate priorityTTLs if provided
                if (ttl.priorityTTLs) {
                    if (typeof ttl.priorityTTLs !== 'object' || ttl.priorityTTLs === null) {
                        throw new Error('Invalid TTL configuration');
                    }

                    for (const [priority, value] of Object.entries(ttl.priorityTTLs)) {
                        if (typeof value !== 'number' || value <= 0) {
                            throw new Error('Invalid TTL configuration');
                        }
                    }
                }
                return;
            }
        }

        throw new Error('Invalid TTL configuration');
    }

    validateMemoryConfig(config) {
        if (!config) return;

        if (typeof config !== 'object') {
            throw new Error('Invalid memory monitoring configuration');
        }

        if (config.enabled) {
            if (typeof config.maxMemoryMB !== 'number' || config.maxMemoryMB <= 0) {
                throw new Error('Invalid maxMemoryMB configuration');
            }

            if (typeof config.warningThresholdMB !== 'number' || config.warningThresholdMB <= 0) {
                throw new Error('Invalid warningThresholdMB configuration');
            }

            if (config.warningThresholdMB >= config.maxMemoryMB) {
                throw new Error('Warning threshold must be less than max memory');
            }
        }
    }

    validateCompressionConfig(config) {
        if (!config) return;

        if (typeof config !== 'object') {
            throw new Error('Invalid compression configuration');
        }

        if (config.enabled) {
            if (typeof config.minSize !== 'number' || config.minSize < 0) {
                throw new Error('Invalid minSize configuration');
            }

            if (typeof config.level !== 'number' || config.level < 1 || config.level > 9) {
                throw new Error('Invalid compression level configuration');
            }

            if (!['gzip', 'deflate'].includes(config.algorithm)) {
                throw new Error('Invalid compression algorithm configuration');
            }
        }
    }

    getTTLForPriority(priority) {
        const ttl = this.config.ttl;
        if (!ttl?.enabled) {
            return Infinity;
        }

        if (ttl.priorityTTLs?.[priority]) {
            return ttl.priorityTTLs[priority];
        }

        return ttl.defaultTTL;
    }

    startInvalidationCheck() {
        setInterval(() => {
            this.invalidationStrategy.checkAndInvalidate(this.cache);
        }, this.config.checkPeriod || 60000); // Default to 1 minute
    }

    startMemoryMonitoring() {
        if (this.config.memoryMonitoring?.enabled && !this.memoryMonitoringInterval) {
            this.memoryMonitoringInterval = setInterval(() => {
                this.monitorMemoryUsage();
            }, this.config.memoryMonitoring.checkIntervalMS);
            logger.info('Memory monitoring started');
        }
    }

    stopMemoryMonitoring() {
        if (this.memoryMonitoringInterval) {
            clearInterval(this.memoryMonitoringInterval);
            this.memoryMonitoringInterval = null;
            logger.info('Memory monitoring stopped');
        }
    }

    monitorMemoryUsage() {
        try {
            const stats = this.memoryManager.getMemoryStats();
            const usedMemoryMB = stats.usedHeapSize / (1024 * 1024);
            const maxMemoryMB = this.config.memoryMonitoring.maxMemoryMB;
            const warningThresholdMB = this.config.memoryMonitoring.warningThresholdMB;

            // Update metrics
            metrics.gauge('cache_memory_used_mb').set(usedMemoryMB);
            metrics.gauge('cache_memory_max_mb').set(maxMemoryMB);

            // Check thresholds
            if (usedMemoryMB >= maxMemoryMB) {
                this.handleCriticalMemoryUsage();
            } else if (usedMemoryMB >= warningThresholdMB) {
                this.handleHighMemoryUsage();
            }

            // Log memory usage
            logger.debug('Memory usage stats', {
                usedMemoryMB: Math.round(usedMemoryMB),
                maxMemoryMB,
                warningThresholdMB
            });
        } catch (error) {
            logger.error('Error monitoring memory usage', { error });
        }
    }

    handleHighMemoryUsage() {
        logger.warn('High memory usage detected', {
            usedMemoryMB: Math.round(this.memoryManager.getMemoryStats().usedHeapSize / (1024 * 1024)),
            maxMemoryMB: this.config.memoryMonitoring.maxMemoryMB
        });
        
        // Clear low priority cache entries
        for (const [key, entry] of this.cache.entries()) {
            if (entry.priority === 'low') {
                this.delete(key);
            }
        }
    }

    handleCriticalMemoryUsage() {
        logger.error('Critical memory usage detected', {
            usedMemoryMB: Math.round(this.memoryManager.getMemoryStats().usedHeapSize / (1024 * 1024)),
            maxMemoryMB: this.config.memoryMonitoring.maxMemoryMB
        });
        
        // Clear all non-critical cache entries
        for (const [key, entry] of this.cache.entries()) {
            if (entry.priority !== 'critical') {
                this.delete(key);
            }
        }
    }

    async compress(value) {
        if (!this.config.compression.enabled) return value;

        try {
            // Handle circular references
            const seen = new WeakSet();
            const stringified = JSON.stringify(value, (key, val) => {
                if (typeof val === 'object' && val !== null) {
                    if (seen.has(val)) {
                        return '[Circular]';
                    }
                    seen.add(val);
                }
                return val;
            });

            const buffer = Buffer.from(stringified);
            if (buffer.length < this.config.compression.minSize) {
                this.compressionStats.uncompressedBytes += buffer.length;
                return value;
            }

            const startTime = process.hrtime();
            let compressed;

            try {
                if (this.config.compression.algorithm === 'gzip') {
                    compressed = await new Promise((resolve, reject) => {
                        zlib.gzip(buffer, { level: this.config.compression.level }, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });
                } else {
                    compressed = await new Promise((resolve, reject) => {
                        zlib.deflate(buffer, { level: this.config.compression.level }, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });
                }

                const endTime = process.hrtime(startTime);
                const compressionTime = endTime[0] * 1000 + endTime[1] / 1000000;
                
                this.compressionStats.compressionTime += compressionTime;
                this.compressionStats.compressedBytes += compressed.length;
                this.compressionStats.uncompressedBytes += buffer.length;
                this.compressionStats.compressionRatio = 
                    this.compressionStats.compressedBytes / this.compressionStats.uncompressedBytes;

                metrics.gauge('cache_compression_ratio', this.compressionStats.compressionRatio);
                metrics.gauge('cache_compression_time_ms', this.compressionStats.compressionTime);

                return {
                    compressed: true,
                    data: compressed,
                    algorithm: this.config.compression.algorithm
                };
            } catch (error) {
                logger.error('Compression failed', { error });
                return value;
            }
        } catch (error) {
            logger.error('Error preparing value for compression', { error });
            return value;
        }
    }

    async decompress(value) {
        if (!value || !value.compressed) return value;

        const startTime = process.hrtime();
        try {
            const buffer = await new Promise((resolve, reject) => {
                if (value.algorithm === 'gzip') {
                    zlib.gunzip(value.data, (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                } else {
                    zlib.inflate(value.data, (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                }
            });

            const endTime = process.hrtime(startTime);
            this.compressionStats.decompressionTime += endTime[0] * 1000 + endTime[1] / 1000000;
            metrics.gauge('cache_decompression_time_ms', this.compressionStats.decompressionTime);

            return JSON.parse(buffer.toString());
        } catch (error) {
            logger.error('Decompression failed', { error });
            return null;
        }
    }

    async set(key, value, options = {}) {
        try {
            this._isCacheOperation = true;
            await this.monitorMemoryUsage();

            // If value is a buffer, try to get it from the memory pool
            if (Buffer.isBuffer(value)) {
                const pooledBuffer = this.memoryManager.allocateFromPool('buffer', value.length);
                value.copy(pooledBuffer);
                value = pooledBuffer;
            }

            const entry = {
                value,
                timestamp: Date.now(),
                priority: options.priority || 'medium',
                ttl: options.ttl || this.config.invalidationStrategy.maxAge
            };

            this.cache.set(key, entry);
            return true;
        } catch (error) {
            logger.error('Error setting cache entry', error);
            throw error;
        }
    }

    async get(key) {
        try {
            this._isCacheOperation = true;
            await this.monitorMemoryUsage();

            const entry = this.cache.get(key);
            if (!entry) {
                return null;
            }

            // Check if entry has expired
            if (Date.now() - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                return null;
            }

            return entry.value;
        } catch (error) {
            logger.error('Error getting cache entry', error);
            throw error;
        }
    }

    recordHit() {
        if (!this.config.hitRatioTracking?.enabled) return;

        this.hitCount++;
        this.requestWindow.push('hit');
        this.updateHitRatio();
    }

    recordMiss() {
        if (!this.config.hitRatioTracking?.enabled) return;

        this.missCount++;
        this.requestWindow.push('miss');
        this.updateHitRatio();
    }

    updateHitRatio() {
        if (!this.config.hitRatioTracking?.enabled) return;

        // Maintain window size
        while (this.requestWindow.length > this.config.hitRatioTracking.windowSize) {
            const removed = this.requestWindow.shift();
            if (removed === 'hit') this.hitCount--;
            if (removed === 'miss') this.missCount--;
        }

        // Calculate hit ratio
        const total = this.hitCount + this.missCount;
        if (total > 0) {
            this.lastHitRatio = this.hitCount / total;
            this.lastHitRatioUpdate = Date.now();

            // Record metrics
            metrics.gauge('cache_hit_ratio', this.lastHitRatio);
            metrics.gauge('cache_hits_total', this.hitCount);
            metrics.gauge('cache_misses_total', this.missCount);
        }
    }

    getHitRatio() {
        if (!this.config.hitRatioTracking?.enabled) {
            return {
                hitRatio: 0,
                hits: 0,
                misses: 0,
                totalRequests: 0,
                lastUpdate: null
            };
        }

        return {
            hitRatio: this.lastHitRatio,
            hits: this.hitCount,
            misses: this.missCount,
            totalRequests: this.hitCount + this.missCount,
            lastUpdate: this.lastHitRatioUpdate
        };
    }

    async delete(key) {
        try {
            this._isCacheOperation = true;
            await this.monitorMemoryUsage();

            const entry = this.cache.get(key);
            if (entry && Buffer.isBuffer(entry.value)) {
                this.memoryManager.returnToPool('buffer', entry.value);
            }

            return this.cache.delete(key);
        } catch (error) {
            logger.error('Error deleting cache entry', error);
            throw error;
        }
    }

    async clear() {
        try {
            this._isCacheOperation = true;
            await this.monitorMemoryUsage();

            // Return all buffer values to the memory pool
            for (const entry of this.cache.values()) {
                if (Buffer.isBuffer(entry.value)) {
                    this.memoryManager.returnToPool('buffer', entry.value);
                }
            }

            this.cache.clear();
            return true;
        } catch (error) {
            logger.error('Error clearing cache', error);
            throw error;
        }
    }

    size() {
        return this.cache.size;
    }

    async preload(entries) {
        if (!this.config.preloading?.enabled) {
            logger.warn('Cache preloading is disabled');
            return;
        }

        try {
            // Add entries to preload queue
            this._preloadQueue.push(...entries);

            // Start preloading if not already in progress
            if (!this._preloadInProgress) {
                await this.processPreloadQueue();
            }
        } catch (error) {
            logger.error('Error queueing preload entries', { error });
            throw error;
        }
    }

    async processPreloadQueue() {
        if (this._preloadInProgress || !this.config.preloading.enabled) return;

        this._preloadInProgress = true;
        const batchSize = this.config.preloading.batchSize;
        const maxConcurrent = this.config.preloading.maxConcurrent;

        try {
            while (this._preloadQueue.length > 0) {
                const batch = this._preloadQueue.splice(0, batchSize);
                const promises = batch.map(async (entry) => {
                    try {
                        await this.set(entry.key, entry.value, entry.priority || this.config.preloading.priority);
                    } catch (error) {
                        logger.error('Error preloading cache entry', { error, key: entry.key });
                        return entry;
                    }
                });

                await Promise.all(promises.slice(0, maxConcurrent));
            }
        } catch (error) {
            logger.error('Error processing preload queue', { error });
            // Put failed entries back in queue
            this._preloadQueue.unshift(...batch);
        } finally {
            this._preloadInProgress = false;
        }
    }

    startPreloading() {
        if (this.config.preloading?.enabled && !this.preloadingInterval) {
            this.preloadingInterval = setInterval(() => {
                this.preloadEntries();
            }, this.config.preloading.checkIntervalMS || 60000);
            logger.info('Cache preloading started');
        }
    }

    stopPreloading() {
        if (this.preloadingInterval) {
            clearInterval(this.preloadingInterval);
            this.preloadingInterval = null;
            logger.info('Cache preloading stopped');
        }
    }

    preloadEntries() {
        // Implementation of preloading logic
        // This is a placeholder - actual implementation would depend on your needs
        logger.debug('Cache preloading cycle started');
    }

    getPreloadStatus() {
        return {
            enabled: this.config.preloading?.enabled || false,
            queueSize: this._preloadQueue.length,
            inProgress: this._preloadInProgress,
            config: {
                batchSize: this.config.preloading?.batchSize,
                maxConcurrent: this.config.preloading?.maxConcurrent,
                priority: this.config.preloading?.priority
            }
        };
    }

    getCompressionStats() {
        return {
            ...this.compressionStats,
            enabled: this.config.compression.enabled,
            algorithm: this.config.compression.algorithm,
            minSize: this.config.compression.minSize,
            level: this.config.compression.level
        };
    }

    getMemoryStats() {
        const stats = this.memoryManager.getMemoryStats();
        return {
            currentUsageMB: stats.usedHeapSize / (1024 * 1024),
            maxMemoryMB: this.config.memoryMonitoring.maxMemoryMB,
            warningThresholdMB: this.config.memoryMonitoring.warningThresholdMB,
            percentageUsed: (stats.usedHeapSize / stats.heapSizeLimit) * 100,
            poolStats: stats.poolSizes,
            gcStats: {
                count: this.memoryManager.metrics.gcCount._value,
                duration: this.memoryManager.metrics.gcDuration._sum / this.memoryManager.metrics.gcCount._value
            }
        };
    }
}

module.exports = CachingLayer; 