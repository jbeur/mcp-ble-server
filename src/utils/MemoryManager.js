const { logger } = require('./logger');
const metrics = require('./metrics');
const v8 = require('v8');

class MemoryManager {
  constructor(options = {}) {
    // Store options directly on the instance
    this.maxHeapSize = options.maxHeapSize || v8.getHeapStatistics().total_available_size;
    this.minHeapSize = options.minHeapSize || 1024 * 1024 * 100; // 100MB
    this.gcInterval = options.gcInterval || 300000; // 5 minutes
    this.warningThreshold = options.warningThreshold || 0.8; // 80% of max heap
    this.criticalThreshold = options.criticalThreshold || 0.9; // 90% of max heap
    this.poolSize = options.poolSize || 1000; // Number of objects to keep in pool

    // Initialize memory pools
    this.pools = {
      buffer: new Set(),
      string: new Set(),
      object: new Set()
    };

    // Initialize metrics
    metrics.gauge('memory_heap_size', 0);
    metrics.gauge('memory_heap_used', 0);
    metrics.gauge('memory_heap_limit', 0);
    metrics.gauge('memory_pool_size', 0);
    metrics.gauge('memory_warning_threshold', 0);
    metrics.gauge('memory_critical_threshold', 0);

    // Start monitoring
    this.startMonitoring();
  }

  startMonitoring() {
    // Set up periodic memory monitoring
    this.monitoringInterval = setInterval(() => {
      this.monitorMemoryUsage();
    }, 60000); // Check every minute

    // Set up periodic garbage collection
    this.gcTimer = setInterval(() => {
      this.optimizeGarbageCollection();
    }, this.gcInterval);

    logger.info('MemoryManager monitoring started');
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    logger.info('MemoryManager monitoring stopped');
  }

  monitorMemoryUsage() {
    try {
      const stats = v8.getHeapStatistics();
      const heapUsed = stats.used_heap_size;
      const heapLimit = stats.heap_size_limit;
      const heapUsageRatio = heapUsed / heapLimit;

      // Update metrics
      metrics.gauge('memory_heap_size', stats.total_heap_size);
      metrics.gauge('memory_heap_used', heapUsed);
      metrics.gauge('memory_heap_limit', heapLimit);
      metrics.gauge('memory_warning_threshold', this.warningThreshold * heapLimit);
      metrics.gauge('memory_critical_threshold', this.criticalThreshold * heapLimit);

      // Check thresholds
      if (heapUsageRatio > this.criticalThreshold) {
        logger.error('Critical memory usage detected', {
          heapUsed,
          heapLimit,
          usageRatio: heapUsageRatio
        });
        this.handleCriticalMemoryUsage();
      } else if (heapUsageRatio > this.warningThreshold) {
        logger.warn('High memory usage detected', {
          heapUsed,
          heapLimit,
          usageRatio: heapUsageRatio
        });
        this.handleHighMemoryUsage();
      }

      // Update pool metrics
      const totalPoolSize = Object.values(this.pools).reduce((sum, pool) => sum + pool.size, 0);
      metrics.gauge('memory_pool_size', totalPoolSize);
    } catch (error) {
      logger.error('Error monitoring memory usage:', error);
    }
  }

  handleHighMemoryUsage() {
    // Implement high memory usage handling
    // This could include:
    // 1. Clearing non-critical caches
    // 2. Reducing pool sizes
    // 3. Triggering garbage collection
    this.optimizeGarbageCollection();
  }

  handleCriticalMemoryUsage() {
    // Implement critical memory usage handling
    // This could include:
    // 1. Clearing all caches
    // 2. Emptying memory pools
    // 3. Forcing garbage collection
    // 4. Notifying system administrators
    this.clearAllPools();
    this.optimizeGarbageCollection();
  }

  optimizeGarbageCollection() {
    try {
      const startTime = Date.now();
            
      // Get current heap statistics
      const beforeStats = v8.getHeapStatistics();
            
      // Force garbage collection
      if (global.gc) {
        global.gc();
      }
            
      // Get updated statistics
      const afterStats = v8.getHeapStatistics();
      const duration = Date.now() - startTime;
            
      // Update metrics
      metrics.gauge('memory_heap_size', afterStats.total_heap_size);
      metrics.gauge('memory_heap_used', afterStats.used_heap_size);
      metrics.gauge('memory_heap_limit', afterStats.heap_size_limit);
      metrics.gauge('memory_warning_threshold', this.warningThreshold * afterStats.heap_size_limit);
      metrics.gauge('memory_critical_threshold', this.criticalThreshold * afterStats.heap_size_limit);
            
      // Log GC results
      logger.debug('Garbage collection completed', {
        duration,
        beforeHeapUsed: beforeStats.used_heap_size,
        afterHeapUsed: afterStats.used_heap_size,
        freed: beforeStats.used_heap_size - afterStats.used_heap_size
      });
    } catch (error) {
      logger.error('Error during garbage collection:', error);
    }
  }

  allocateFromPool(type, size) {
    try {
      const pool = this.pools[type];
      if (!pool) {
        throw new Error(`Invalid pool type: ${type}`);
      }

      // Try to find a suitable object in the pool
      for (const item of pool) {
        if (this.isSuitableForReuse(item, size)) {
          pool.delete(item);
          // For strings, always return a new empty string
          if (type === 'string') {
            return '';
          }
          return item;
        }
      }

      // If no suitable object found, create a new one
      return this.createNewObject(type, size);
    } catch (error) {
      logger.error('Error allocating from pool:', error);
      throw error;
    }
  }

  returnToPool(type, item) {
    try {
      const pool = this.pools[type];
      if (!pool) {
        throw new Error(`Invalid pool type: ${type}`);
      }

      // Validate item type
      if (type === 'buffer' && !Buffer.isBuffer(item)) {
        throw new Error('Invalid item type: expected Buffer');
      } else if (type === 'string' && typeof item !== 'string') {
        throw new Error('Invalid item type: expected String');
      } else if (type === 'object' && typeof item !== 'object') {
        throw new Error('Invalid item type: expected Object');
      }

      // Check if pool is full
      if (pool.size >= this.poolSize) {
        // Remove oldest item if pool is full
        const oldestItem = Array.from(pool)[0];
        pool.delete(oldestItem);
      }

      // Reset item state before adding to pool
      this.resetObjectState(item);
      pool.add(item);
    } catch (error) {
      logger.error('Error returning item to pool:', error);
      throw error; // Re-throw the error
    }
  }

  clearAllPools() {
    for (const pool of Object.values(this.pools)) {
      pool.clear();
    }
    logger.info('All memory pools cleared');
  }

  isSuitableForReuse(item, size) {
    // Implement logic to check if an item is suitable for reuse
    // This will depend on the type of object and its current state
    return true; // Placeholder
  }

  createNewObject(type, size) {
    switch (type) {
    case 'buffer':
      return Buffer.alloc(size);
    case 'string':
      return ''; // Return empty string for string pool
    case 'object':
      return {};
    default:
      throw new Error(`Unsupported object type: ${type}`);
    }
  }

  resetObjectState(item) {
    try {
      if (Buffer.isBuffer(item)) {
        item.fill(0);
      } else if (typeof item === 'object' && item !== null) {
        // Get all enumerable own properties
        const properties = Object.getOwnPropertyNames(item);
                
        // Try to delete each property
        for (const key of properties) {
          try {
            delete item[key];
          } catch (e) {
            // Log but continue if we can't delete a property
            logger.warn('Could not delete property:', { key, error: e.message });
          }
        }
      }
      // Note: Strings are immutable, so we don't need to reset them
      // They will be replaced with a new string when allocated
    } catch (error) {
      logger.error('Error resetting object state:', error);
      throw error;
    }
  }

  getMemoryStats() {
    const stats = v8.getHeapStatistics();
    return {
      totalHeapSize: stats.total_heap_size,
      usedHeapSize: stats.used_heap_size,
      heapSizeLimit: stats.heap_size_limit,
      totalAvailableSize: stats.total_available_size,
      totalPhysicalSize: stats.total_physical_size,
      poolSizes: Object.fromEntries(
        Object.entries(this.pools).map(([type, pool]) => [type, pool.size])
      )
    };
  }
}

module.exports = MemoryManager; 