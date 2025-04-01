const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

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

        this.invalidationStrategy = new InvalidationStrategy(config.invalidationStrategy);

        // Validate TTL configuration
        this.validateTTLConfig(config.ttl);

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

    async set(key, value, priority = 'medium') {
        try {
            if (!this.invalidationStrategy.priorityLevels.includes(priority)) {
                throw new Error(`Invalid priority level: ${priority}`);
            }

            const entry = {
                value,
                timestamp: Date.now(),
                priority
            };
            this.cache.set(key, entry);

            // Check if we need to invalidate entries
            await this.invalidationStrategy.checkAndInvalidate(this.cache);

            // Monitor memory usage after adding entry
            if (this.config.memoryMonitoring?.enabled) {
                this._isCacheOperation = true;
                await this.monitorMemoryUsage();
            }

            return entry;
        } catch (error) {
            logger.error('Error setting cache entry', { error, key });
            throw error;
        }
    }

    async get(key) {
        try {
            const entry = this.cache.get(key);
            if (!entry) {
                this.recordCacheMiss();
                return null;
            }

            // Check TTL expiration
            if (this.config.ttl?.enabled) {
                const ttl = this.getTTLForPriority(entry.priority);
                const age = Date.now() - entry.timestamp;
                if (age > ttl) {
                    this.cache.delete(key);
                    this.recordCacheMiss();
                    metrics.incrementCounter('cache_invalidations_total', {
                        key,
                        reason: 'ttl'
                    });
                    logger.info('Cache entry invalidated', {
                        key,
                        reason: 'ttl'
                    });
                    return null;
                }
            }

            // Record cache hit
            this.recordCacheHit();

            // Monitor memory usage after retrieving entry
            if (this.config.memoryMonitoring?.enabled) {
                this._isCacheOperation = true;
                await this.monitorMemoryUsage();
            }

            return entry.value;
        } catch (error) {
            logger.error('Error getting cache entry', { error, key });
            throw error;
        }
    }

    recordCacheHit() {
        if (!this.config.hitRatioTracking?.enabled) return;

        this.hitCount++;
        this.requestWindow.push('hit');
        this.updateHitRatio();
    }

    recordCacheMiss() {
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
        if (this._preloadInProgress || this._preloadQueue.length === 0) {
            return;
        }

        this._preloadInProgress = true;

        try {
            while (this._preloadQueue.length > 0) {
                const batch = this._preloadQueue.splice(0, this.config.preloading.batchSize);
                const promises = batch.map(entry => 
                    this.set(entry.key, entry.value, entry.priority || this.config.preloading.priority)
                );

                // Process batch with concurrency limit
                await Promise.all(promises.slice(0, this.config.preloading.maxConcurrent));

                // Monitor memory usage after each batch
                if (this.config.memoryMonitoring?.enabled) {
                    await this.monitorMemoryUsage();
                }
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
}

module.exports = CachingLayer; 