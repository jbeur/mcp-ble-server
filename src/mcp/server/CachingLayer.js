const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');
const zlib = require('zlib');

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
                enabled: false,
                checkIntervalMS: 1000,
                warningThresholdMB: 80,
                maxMemoryMB: 100,
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
        this.memoryMonitoringInterval = null;
        this.lastRecordedMemoryUsage = null;
        this._isScheduledCheck = false;
        this._isCacheOperation = false;
        this._preloadQueue = [];
        this._preloadInProgress = false;

        // Initialize hit ratio tracking
        this.hitCount = 0;
        this.missCount = 0;
        this.requestWindow = [];
        this.lastHitRatio = 0;
        this.lastHitRatioUpdate = Date.now();

        // Initialize compression metrics
        this.compressionStats = {
            compressedBytes: 0,
            uncompressedBytes: 0,
            compressionRatio: 0,
            compressionTime: 0,
            decompressionTime: 0
        };

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
        // Early return if monitoring is disabled
        if (!this.config.memoryMonitoring.enabled) {
            this.stopMemoryMonitoring();
            return;
        }

        // Stop any existing monitoring
        this.stopMemoryMonitoring();

        // Start new interval
        this.memoryMonitoringInterval = setInterval(() => {
            if (this.config.memoryMonitoring.enabled) {
                this._isScheduledCheck = true;
                this.monitorMemoryUsage().catch(error => {
                    logger.error('Error in memory monitoring interval', error);
                });
            }
        }, this.config.memoryMonitoring.checkIntervalMS);

        // Initial memory usage check
        this._isScheduledCheck = true;
        this.monitorMemoryUsage().catch(error => {
            logger.error('Error in initial memory monitoring', error);
        });
    }

    getMemoryStats() {
        if (!this.config.memoryMonitoring?.enabled) {
            return {
                currentUsageMB: 0,
                maxMemoryMB: 0,
                warningThresholdMB: 0,
                percentageUsed: 0
            };
        }

        try {
            const heapUsed = process.memoryUsage().heapUsed;
            const currentUsageMB = Math.floor(heapUsed / (1024 * 1024));
            const maxMemoryMB = this.config.memoryMonitoring.maxMemoryMB;
            const warningThresholdMB = this.config.memoryMonitoring.warningThresholdMB;
            const percentageUsed = Math.floor((currentUsageMB / maxMemoryMB) * 100);

            return {
                currentUsageMB,
                maxMemoryMB,
                warningThresholdMB,
                percentageUsed
            };
        } catch (error) {
            logger.error('Error getting memory stats', error);
            throw error;
        }
    }

    async monitorMemoryUsage() {
        // Early return if monitoring is disabled
        if (!this.config.memoryMonitoring?.enabled) {
            return;
        }

        try {
            const stats = this.getMemoryStats();
            const currentUsageMB = Math.floor(stats.currentUsageMB);

            // Record memory usage for:
            // 1. Scheduled checks
            // 2. Cache operations
            if (this._isScheduledCheck || this._isCacheOperation) {
                metrics.recordMemoryUsage('cache_memory_usage', currentUsageMB);
                this.lastRecordedMemoryUsage = currentUsageMB;
            }

            // Check warning threshold
            if (currentUsageMB > this.config.memoryMonitoring.warningThresholdMB) {
                logger.warn('Cache memory usage exceeds warning threshold', {
                    currentUsageMB,
                    warningThresholdMB: this.config.memoryMonitoring.warningThresholdMB
                });
            }

            // Check memory limit
            if (currentUsageMB > this.config.memoryMonitoring.maxMemoryMB) {
                await this.enforceMemoryLimit(currentUsageMB);
            }
        } catch (error) {
            logger.error('Error monitoring cache memory usage', error);
            throw error;
        } finally {
            this._isScheduledCheck = false;
            this._isCacheOperation = false;
        }
    }

    async enforceMemoryLimit(currentUsageMB) {
        if (!this.config.memoryMonitoring.enabled || currentUsageMB <= this.config.memoryMonitoring.maxMemoryMB) {
            return false;
        }

        try {
            const entries = Array.from(this.cache.entries());
            const sortedEntries = entries.sort((a, b) => {
                const priorityA = this.invalidationStrategy.getPriorityValue(a[1].priority);
                const priorityB = this.invalidationStrategy.getPriorityValue(b[1].priority);
                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                return a[1].timestamp - b[1].timestamp;
            });

            let evictedCount = 0;
            for (const [key, entry] of sortedEntries) {
                // Skip high priority entries
                if (entry.priority === 'high') {
                    continue;
                }

                this.cache.delete(key);
                evictedCount++;

                const newStats = this.getMemoryStats();
                if (newStats.currentUsageMB <= this.config.memoryMonitoring.maxMemoryMB) {
                    break;
                }
            }

            if (evictedCount > 0) {
                metrics.recordGauge('cache_memory_evictions', evictedCount);
                logger.info('Cache entries evicted due to memory limit', {
                    evictedCount,
                    currentUsageMB
                });
            }

            return evictedCount > 0;
        } catch (error) {
            logger.error('Error enforcing memory limit', error);
            throw error;
        }
    }

    stopMemoryMonitoring() {
        if (this.memoryMonitoringInterval) {
            clearInterval(this.memoryMonitoringInterval);
            this.memoryMonitoringInterval = null;
        }
        this.lastRecordedMemoryUsage = null;
        this._isScheduledCheck = false;
        this._isCacheOperation = false;
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

    async set(key, value, priority = 'medium') {
        try {
            if (!key) {
                throw new Error('Key is required');
            }

            // Check memory usage before setting
            if (this.config.memoryMonitoring?.enabled) {
                await this.checkMemoryUsage();
            }

            // Compress value if enabled
            const compressedValue = await this.compress(value);

            const entry = {
                value: compressedValue,
                timestamp: Date.now(),
                priority
            };

            this.cache.set(key, entry);
            metrics.incrementCounter('cache_entries_total');
            logger.debug('Cache entry set', { key, priority });

            // Check if we need to invalidate entries
            await this.invalidationStrategy.checkAndInvalidate(this.cache);

            // Monitor memory usage after adding entry
            if (this.config.memoryMonitoring?.enabled) {
                await this.checkMemoryUsage();
            }
        } catch (error) {
            logger.error('Error setting cache entry', { error, key });
            throw error;
        }
    }

    async get(key) {
        try {
            if (!key) {
                throw new Error('Key is required');
            }

            const entry = this.cache.get(key);
            if (!entry) {
                this.recordMiss();
                return null;
            }

            // Check TTL if enabled
            if (this.config.ttl?.enabled) {
                const ttl = this.getTTLForPriority(entry.priority);
                if (Date.now() - entry.timestamp > ttl) {
                    this.cache.delete(key);
                    this.recordMiss();
                    metrics.incrementCounter('cache_invalidations_total', {
                        reason: 'ttl',
                        key
                    });
                    logger.info('Cache entry invalidated', {
                        key,
                        reason: 'ttl'
                    });
                    return null;
                }
            }

            this.recordHit();
            
            // Decompress value if compressed
            const value = await this.decompress(entry.value);

            // Monitor memory usage after retrieving entry
            if (this.config.memoryMonitoring?.enabled) {
                await this.checkMemoryUsage();
            }

            return value;
        } catch (error) {
            logger.error('Error getting cache entry', { error, key });
            this.recordMiss();
            return null;
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
            const result = this.cache.delete(key);

            // Monitor memory usage after deleting entry
            if (this.config.memoryMonitoring?.enabled) {
                this._isCacheOperation = true;
                await this.monitorMemoryUsage();
            }

            return result;
        } catch (error) {
            logger.error('Error deleting cache entry', { error, key });
            throw error;
        }
    }

    async clear() {
        try {
            this.cache.clear();

            // Monitor memory usage after clearing cache
            if (this.config.memoryMonitoring?.enabled) {
                this._isCacheOperation = true;
                await this.monitorMemoryUsage();
            }
        } catch (error) {
            logger.error('Error clearing cache', { error });
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
        if (!this.config.preloading?.enabled) {
            return;
        }

        // Start periodic preload queue processing
        setInterval(() => {
            if (!this._preloadInProgress && this._preloadQueue.length > 0) {
                this.processPreloadQueue().catch(error => {
                    logger.error('Error in preload interval', { error });
                });
            }
        }, 1000); // Check every second
    }

    stopPreloading() {
        this._preloadQueue = [];
        this._preloadInProgress = false;
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

    async checkMemoryUsage() {
        try {
            const memoryUsage = process.memoryUsage();
            const currentUsageMB = memoryUsage.heapUsed / (1024 * 1024);
            this.lastRecordedMemoryUsage = currentUsageMB;

            metrics.recordMemoryUsage('cache_memory_usage', currentUsageMB);

            if (currentUsageMB > this.config.memoryMonitoring.warningThresholdMB) {
                logger.warn('Cache memory usage exceeds warning threshold', {
                    currentUsageMB,
                    warningThresholdMB: this.config.memoryMonitoring.warningThresholdMB
                });
            }

            if (currentUsageMB > this.config.memoryMonitoring.maxMemoryMB) {
                // Get entries sorted by priority (lowest first) and timestamp (oldest first)
                const entries = Array.from(this.cache.entries())
                    .map(([key, entry]) => ({
                        key,
                        entry,
                        priorityValue: this.invalidationStrategy.getPriorityValue(entry.priority)
                    }))
                    .sort((a, b) => {
                        if (a.priorityValue !== b.priorityValue) {
                            return a.priorityValue - b.priorityValue;
                        }
                        return a.entry.timestamp - b.entry.timestamp;
                    });

                // Find the highest priority value
                const highestPriorityValue = Math.max(...entries.map(e => e.priorityValue));

                // Remove entries starting with lowest priority until memory usage is below limit
                // But preserve entries with the highest priority
                for (const {key, priorityValue} of entries) {
                    if (priorityValue < highestPriorityValue) {
                        this.cache.delete(key);
                        metrics.recordGauge('cache_memory_evictions', 1);
                        logger.info('Cache entry evicted due to memory limit', { key, priorityValue });

                        // Check if memory usage is now below limit
                        const newMemoryUsage = process.memoryUsage().heapUsed / (1024 * 1024);
                        if (newMemoryUsage <= this.config.memoryMonitoring.maxMemoryMB) {
                            return currentUsageMB;
                        }
                    }
                }
            }

            return currentUsageMB;
        } catch (error) {
            logger.error('Error getting memory stats', error);
            throw new Error('Memory usage error');
        }
    }
}

module.exports = CachingLayer; 