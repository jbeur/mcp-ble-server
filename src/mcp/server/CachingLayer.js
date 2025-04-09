const defaultLogger = require('../../utils/logger').logger;
const defaultMetrics = require('../../utils/metrics').metrics;
const zlib = require('zlib');
const MemoryManager = require('../../utils/MemoryManager');

class InvalidationStrategy {
  constructor(config, logger, metrics) {
    this.maxAge = config.maxAge;
    this.maxSize = config.maxSize;
    this.priorityLevels = config.priorityLevels;
    this.getPriorityValue = config.getPriorityValue;
    this.logger = logger;
    this.metrics = metrics;
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
          this.metrics.incrementCounter('cache_invalidations_total', {
            reason: 'invalidation_strategy',
            count: 1
          });
          this.logger.info('Cache entry invalidated', {
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
            this.metrics.incrementCounter('cache_invalidations_total', {
              reason: 'invalidation_strategy',
              count: 1
            });
            this.logger.info('Cache entry invalidated', {
              key,
              reason: 'max_size'
            });
          }
        }
      }

      return invalidatedCount;
    } catch (error) {
      this.logger.error('Error during cache invalidation', { error });
      return 0;
    }
  }
}

class CachingLayer {
  constructor(config, logger = defaultLogger, metrics = defaultMetrics) {
    if (!config) {
      throw new Error('Configuration is required');
    }

    // Initialize dependencies
    this.logger = logger;
    this.metrics = metrics;

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
    this.invalidationStrategy = new InvalidationStrategy(config.invalidationStrategy, this.logger, this.metrics);

    // Initialize hit ratio tracking
    this.hitCount = 0;
    this.missCount = 0;
    this.requestWindow = [];
    this.lastHitRatio = 0;
    this.lastHitRatioUpdate = null;

    // Initialize preloading
    this.preloadQueue = [];
    this.preloadingInterval = null;

    // Initialize compression stats
    this.compressionStats = {
      compressedBytes: 0,
      uncompressedBytes: 0,
      compressionTime: 0,
      decompressionTime: 0,
      compressionRatio: 0
    };

    // Initialize cache operation flag
    this._isCacheOperation = false;

    // Initialize intervals
    this.memoryCheckInterval = null;
    this.preloadingInterval = null;
    this.invalidationCheckInterval = null;

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

    // Start invalidation if enabled
    if (this.config.invalidationStrategy?.maxAge) {
      this.startInvalidation();
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
    if (!this.config.memoryMonitoring.enabled) {
      this.logger.info('Memory monitoring is disabled');
      return;
    }

    this.logger.info('Starting memory monitoring', {
      checkIntervalMS: this.config.memoryMonitoring.checkIntervalMS,
      maxMemoryMB: this.config.memoryMonitoring.maxMemoryMB,
      warningThresholdMB: this.config.memoryMonitoring.warningThresholdMB
    });

    this.memoryCheckInterval = setInterval(() => {
      this.monitorMemoryUsage();
    }, this.config.memoryMonitoring.checkIntervalMS);
  }

  stopMemoryMonitoring() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
      this.logger.info('Memory monitoring stopped');
    }
  }

  async monitorMemoryUsage() {
    try {
      const stats = await this.memoryManager.getMemoryStats();
      const currentUsageMB = stats.heapUsed / (1024 * 1024);

      // Update metrics
      this.metrics.recordMemoryUsage('cache_memory_usage', currentUsageMB);

      // Check warning threshold
      if (currentUsageMB > this.config.memoryMonitoring.warningThresholdMB) {
        this.logger.warn('Cache memory usage exceeds warning threshold', {
          currentUsageMB,
          warningThresholdMB: this.config.memoryMonitoring.warningThresholdMB
        });
      }

      // Check max memory limit
      if (currentUsageMB > this.config.memoryMonitoring.maxMemoryMB) {
        this.logger.warn('Cache memory usage exceeds maximum limit', {
          currentUsageMB,
          maxMemoryMB: this.config.memoryMonitoring.maxMemoryMB
        });
        await this.evictEntries();
      }
    } catch (error) {
      this.logger.error('Error monitoring memory usage', { error });
    }
  }

  async evictEntries() {
    // Sort entries by priority and last access time
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a[1].priority] - priorityOrder[b[1].priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a[1].lastAccess - b[1].lastAccess;
      });

    // Remove entries until memory usage is below threshold
    while (entries.length > 0) {
      const [key] = entries.shift();
      await this.delete(key);
      
      const stats = await this.memoryManager.getMemoryStats();
      const currentUsageMB = stats.heapUsed / (1024 * 1024);
      if (currentUsageMB <= this.config.memoryMonitoring.maxMemoryMB * 0.9) {
        break;
      }
    }
  }

  async compress(value) {
    if (!this.config.compression.enabled) return value;

    try {
      const valueSize = Buffer.byteLength(value);
      if (valueSize < this.config.compression.minSizeBytes) {
        return value;
      }

      const compressed = await this.compression.compress(value);
      const compressedSize = Buffer.byteLength(compressed);

      // Only use compression if it actually reduces size
      if (compressedSize < valueSize) {
        this.metrics.recordMemoryUsage('compressed_size', compressedSize);
        this.metrics.recordMemoryUsage('original_size', valueSize);
        this.metrics.incrementCounter('compression_savings', valueSize - compressedSize);
        return compressed;
      }

      return value;
    } catch (error) {
      this.logger.error('Error compressing value', { error });
      return value;
    }
  }

  async decompress(value) {
    if (!this.config.compression.enabled) return value;

    try {
      return await this.compression.decompress(value);
    } catch (error) {
      this.logger.error('Error decompressing value', { error });
      return value;
    }
  }

  async set(key, value, ttl = null) {
    try {
      this._isCacheOperation = true;
      await this.monitorMemoryUsage();

      this.logger.debug('Setting cache entry', { key, value, ttl });

      if (!this.config.compression?.enabled) {
        this.logger.debug('Compression disabled, setting value directly');
        return this._set(key, value, ttl);
      }

      const valueSize = Buffer.byteLength(JSON.stringify(value));
      this.logger.debug('Value size', { valueSize, minSize: this.config.compression.minSize });

      if (valueSize > this.config.compression.minSize) {
        this.logger.debug('Compressing value before setting');
        const compressed = this._compress(value);
        return this._set(key, compressed, ttl, true);
      }

      this.logger.debug('Value size below threshold, setting without compression');
      return this._set(key, value, ttl);
    } catch (error) {
      this.logger.error('Error setting cache entry', { key, error });
      return false;
    }
  }

  _compress(value) {
    try {
      const jsonStr = JSON.stringify(value);
      const buffer = Buffer.from(jsonStr);
      return zlib.gzipSync(buffer);
    } catch (error) {
      this.logger.error('Error compressing value', { error });
      return value;
    }
  }

  _decompress(value) {
    try {
      const decompressed = zlib.gunzipSync(value);
      return JSON.parse(decompressed.toString());
    } catch (error) {
      this.logger.error('Error decompressing value', { error });
      return value;
    }
  }

  _set(key, value, ttl, isCompressed = false) {
    try {
      this.logger.debug('Creating cache entry', { key, isCompressed });
      const entry = {
        value,
        timestamp: Date.now(),
        expiresAt: ttl ? Date.now() + ttl : null,
        isCompressed
      };

      this.logger.debug('Cache entry created', { entry });
      this.cache.set(key, entry);
      this.metrics.incrementCounter('cache_set_operations');
      this.metrics.recordMemoryUsage('cache_size', this.cache.size);
      return true;
    } catch (error) {
      this.logger.error('Error setting cache entry', { key, error });
      return false;
    }
  }

  async get(key) {
    try {
      const value = await this._get(key);
      if (value !== undefined) {
        this.logger.debug('Cache hit', { key, value });
        this.metrics.recordCacheHit();
        this._updateHitRatio(true);
      } else {
        this.logger.debug('Cache miss', { key });
        this.metrics.recordCacheMiss();
        this._updateHitRatio(false);
      }
      return value;
    } catch (error) {
      this.logger.error('Error getting cache entry', { key, error });
      return undefined;
    }
  }

  _updateHitRatio(hit) {
    if (!this.config.hitRatioTracking.enabled) return;

    const window = this.config.hitRatioTracking.windowSize;
    this.hitCount = hit ? this.hitCount + 1 : this.hitCount;
    this.missCount = !hit ? this.missCount + 1 : this.missCount;
    
    this.lastHitRatio = this.hitCount / (this.hitCount + this.missCount);
    this.lastHitRatioUpdate = Date.now();

    this.metrics.recordGauge('cache_hit_ratio', this.lastHitRatio);
  }

  _get(key) {
    try {
      this.logger.debug('Getting cache entry', { key });
      const entry = this.cache.get(key);
      
      if (!entry) {
        this.logger.debug('Cache entry not found', { key });
        return undefined;
      }

      this.logger.debug('Cache entry found', { entry });

      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.logger.debug('Cache entry expired', { key, expiresAt: entry.expiresAt });
        this.delete(key);
        return undefined;
      }

      if (entry.isCompressed) {
        this.logger.debug('Decompressing cache entry', { key });
        return this._decompress(entry.value);
      }

      this.logger.debug('Returning uncompressed cache entry', { key, value: entry.value });
      return entry.value;
    } catch (error) {
      this.logger.error('Error getting cache entry', { key, error });
      return undefined;
    }
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
      this.logger.error('Error deleting cache entry', error);
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
      this.hitCount = 0;
      this.missCount = 0;
      this.lastHitRatio = 0;
      this.lastHitRatioUpdate = null;
      this.metrics.incrementCounter('cache_clear_operations');
      this.metrics.recordMemoryUsage('cache_size', 0);
      return true;
    } catch (error) {
      this.logger.error('Error clearing cache', error);
      throw error;
    }
  }

  size() {
    return this.cache.size;
  }

  async preload(key, value, priority = 'medium') {
    try {
      if (!this.config.preloading.enabled) {
        return false;
      }

      const entry = {
        key,
        value,
        priority,
        timestamp: Date.now()
      };

      this.preloadQueue.push(entry);
      this.metrics.incrementCounter('cache_preload_operations');
      return true;
    } catch (error) {
      this.logger.error('Error adding to preload queue', { key, error });
      return false;
    }
  }

  async processPreloadQueue() {
    try {
      if (!this.config.preloading.enabled || this.preloadQueue.length === 0) {
        return;
      }

      const batchSize = this.config.preloading.batchSize;
      const entries = this.preloadQueue.splice(0, batchSize);

      for (const entry of entries) {
        await this.set(entry.key, entry.value);
      }

      if (this.preloadQueue.length > 0) {
        setTimeout(() => this.processPreloadQueue(), this.config.preloading.batchInterval);
      }
    } catch (error) {
      this.logger.error('Error processing preload queue', { error });
    }
  }

  startPreloading() {
    if (this.config.preloading?.enabled && !this.preloadingInterval) {
      this.preloadingInterval = setInterval(() => {
        this.processPreloadQueue();
      }, this.config.preloading.batchInterval);
      this.logger.info('Cache preloading started');
    }
  }

  stopPreloading() {
    if (this.preloadingInterval) {
      clearInterval(this.preloadingInterval);
      this.preloadingInterval = null;
      this.logger.info('Cache preloading stopped');
    }
  }

  preloadEntries() {
    // Implementation of preloading logic
    // This is a placeholder - actual implementation would depend on your needs
    this.logger.debug('Cache preloading cycle started');
  }

  getPreloadStatus() {
    return {
      enabled: this.config.preloading?.enabled || false,
      queueSize: this.preloadQueue.length,
      inProgress: this.preloadingInterval !== null,
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

  async destroy() {
    try {
      // Stop all intervals
      this.stopMemoryMonitoring();
      this.stopPreloading();
      
      // Clear all caches
      await this.clear();
      
      // Stop memory manager monitoring
      if (this.memoryManager) {
        await this.memoryManager.stopMonitoring();
        await this.memoryManager.destroy();
      }
      
      // Clear all timers
      if (this.memoryCheckInterval) {
        clearInterval(this.memoryCheckInterval);
        this.memoryCheckInterval = null;
      }
      if (this.preloadingInterval) {
        clearInterval(this.preloadingInterval);
        this.preloadingInterval = null;
      }
      if (this.invalidationCheckInterval) {
        clearInterval(this.invalidationCheckInterval);
        this.invalidationCheckInterval = null;
      }
      
      // Clear all queues and lists
      this.preloadQueue = [];
      this.hitCount = 0;
      this.missCount = 0;
      this.lastHitRatio = 0;
      this.lastHitRatioUpdate = null;
      
      // Reset compression stats
      this.compressionStats = {
        compressedBytes: 0,
        uncompressedBytes: 0,
        compressionTime: 0,
        decompressionTime: 0,
        compressionRatio: 0
      };
      
      // Clear the cache
      this.cache.clear();
      
      return true;
    } catch (error) {
      this.logger.error('Error during cache destruction', { error });
      return false;
    }
  }

  startInvalidation() {
    if (this.invalidationCheckInterval) {
      clearInterval(this.invalidationCheckInterval);
    }

    this.invalidationCheckInterval = setInterval(
      () => this.checkInvalidation(),
      this.config.invalidationStrategy.maxAge / 2
    );
  }

  async checkInvalidation() {
    try {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.config.invalidationStrategy.maxAge) {
          this.cache.delete(key);
        }
      }
    } catch (error) {
      this.logger.error('Error checking cache invalidation', { error });
    }
  }
}

module.exports = CachingLayer; 