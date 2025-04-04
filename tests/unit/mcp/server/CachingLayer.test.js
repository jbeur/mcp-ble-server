const CachingLayer = require('../../../../src/mcp/server/CachingLayer');
const MemoryManager = require('../../../../src/utils/MemoryManager');

// Mock dependencies
const metrics = {
    gauge: jest.fn().mockReturnValue({
        set: jest.fn()
    }),
    counter: jest.fn().mockReturnValue({
        inc: jest.fn()
    }),
    histogram: jest.fn().mockReturnValue({
        observe: jest.fn()
    }),
    incrementCounter: jest.fn(),
    recordMemoryUsage: jest.fn(),
    recordGauge: jest.fn()
};

jest.mock('../../../../src/utils/metrics', () => metrics);

const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

jest.mock('../../../../src/utils/logger', () => logger);

describe('CachingLayer', () => {
    let cachingLayer;
    let mockMemoryManager;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();

        mockMemoryManager = {
            getMemoryStats: jest.fn().mockReturnValue({
                heapSize: 1000,
                heapUsed: 500,
                heapLimit: 2000,
                poolSize: 100
            }),
            allocateFromPool: jest.fn().mockReturnValue(Buffer.alloc(100)),
            returnToPool: jest.fn(),
            startMonitoring: jest.fn(),
            stopMonitoring: jest.fn()
        };

        // Create a mock class for MemoryManager
        class MockMemoryManager {
            constructor() {
                Object.assign(this, mockMemoryManager);
            }
        }

        jest.mock('../../../../src/utils/MemoryManager', () => MockMemoryManager);

        const baseConfig = {
            memoryMonitoring: {
                enabled: true,
                interval: 1000,
                highWatermark: 0.8,
                criticalWatermark: 0.9
            },
            invalidationStrategy: {
                type: 'ttl',
                maxAge: 3600000
            },
            compression: {
                enabled: true,
                threshold: 1024,
                algorithm: 'gzip',
                level: 6
            }
        };

        cachingLayer = new CachingLayer(baseConfig);
    });

    afterEach(() => {
        if (cachingLayer) {
            if (cachingLayer.stopMemoryMonitoring) {
                cachingLayer.stopMemoryMonitoring();
            }
            if (cachingLayer.stopPreloading) {
                cachingLayer.stopPreloading();
            }
        }
        jest.clearAllTimers();
    });

    describe('constructor', () => {
        it('should initialize with provided configuration', () => {
            expect(cachingLayer.config).toEqual(baseConfig);
            expect(cachingLayer.cache).toBeDefined();
            expect(cachingLayer.invalidationStrategy).toBeDefined();
        });

        it('should throw error if config is missing', () => {
            expect(() => new CachingLayer()).toThrow('Configuration is required');
        });

        it('should throw error if invalidation strategy is missing', () => {
            const invalidConfig = { maxSize: 1000, ttl: 3600000 };
            expect(() => new CachingLayer(invalidConfig)).toThrow('Invalid configuration: invalidationStrategy is required');
        });
    });

    describe('invalidation strategy', () => {
        it('should invalidate entries based on max age', () => {
            const key = 'test-key';
            const value = 'test-value';
            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer.cache.set(key, {
                value,
                timestamp: now - 7200000, // 2 hours ago
                priority: 'high'
            });

            cachingLayer.invalidationStrategy.checkAndInvalidate(cachingLayer.cache);
            expect(cachingLayer.cache.has(key)).toBe(false);
        });

        it('should invalidate entries based on max size', async () => {
            const maxSize = 2;
            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority] || 0;
                    }
                }
            };

            const cachingLayer = new CachingLayer(config);
            await cachingLayer.set('key1', 'value1', 'low');
            await cachingLayer.set('key2', 'value2', 'medium');
            await cachingLayer.set('key3', 'value3', 'high');

            expect(cachingLayer.cache.size).toBe(maxSize);
            expect(cachingLayer.cache.has('key1')).toBe(false); // Oldest entry should be removed
        });

        it('should invalidate entries based on priority when size limit is reached', async () => {
            const maxSize = 2;
            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority] || 0;
                    }
                }
            };

            const cachingLayer = new CachingLayer(config);
            await cachingLayer.set('key1', 'value1', 'low');
            await cachingLayer.set('key2', 'value2', 'high');
            await cachingLayer.set('key3', 'value3', 'medium');

            expect(cachingLayer.cache.size).toBe(maxSize);
            expect(cachingLayer.cache.has('key1')).toBe(false); // Low priority entry should be removed
        });

        it('should log invalidation events', () => {
            const key = 'test-key';
            const value = 'test-value';
            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer.cache.set(key, {
                value,
                timestamp: now - 7200000,
                priority: 'high'
            });

            cachingLayer.invalidationStrategy.checkAndInvalidate(cachingLayer.cache);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Cache entry invalidated'),
                expect.objectContaining({
                    key,
                    reason: 'max_age'
                })
            );
        });

        it('should track invalidation metrics', () => {
            const key = 'test-key';
            const value = 'test-value';
            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer.cache.set(key, {
                value,
                timestamp: now - 7200000,
                priority: 'high'
            });

            cachingLayer.invalidationStrategy.checkAndInvalidate(cachingLayer.cache);
            expect(metrics.incrementCounter).toHaveBeenCalledWith(
                'cache_invalidations_total',
                expect.objectContaining({
                    reason: 'invalidation_strategy',
                    count: 1
                })
            );
        });

        it('should handle invalidation errors gracefully', async () => {
            const error = new Error('Test error');
            const mockCache = {
                entries: jest.fn().mockImplementation(() => {
                    throw error;
                })
            };

            const result = await cachingLayer.invalidationStrategy.checkAndInvalidate(mockCache);
            expect(result).toBe(0);
            expect(logger.error).toHaveBeenCalledWith(
                'Error during cache invalidation',
                { error }
            );
        });
    });

    describe('TTL configuration', () => {
        it('should respect TTL when getting entries', async () => {
            const key = 'test-key';
            const value = 'test-value';
            const config = {
                ...baseConfig,
                ttl: {
                    enabled: true,
                    defaultTTL: 1000 // 1 second
                }
            };

            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer = new CachingLayer(config);
            await cachingLayer.set(key, value);

            // Entry should be available immediately
            expect(await cachingLayer.get(key)).toBe(value);

            // Fast-forward time by 2 seconds
            jest.setSystemTime(now + 2000);

            // Entry should be expired
            expect(await cachingLayer.get(key)).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                'Cache entry invalidated',
                expect.objectContaining({
                    key,
                    reason: 'ttl'
                })
            );
        });

        it('should allow different TTLs for different priorities', async () => {
            const config = {
                ...baseConfig,
                ttl: {
                    enabled: true,
                    defaultTTL: 3600000, // 1 hour
                    priorityTTLs: {
                        high: 3600000, // 1 hour
                        medium: 1800000, // 30 minutes
                        low: 900000 // 15 minutes
                    }
                }
            };

            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer = new CachingLayer(config);

            // Set entries with different priorities
            await cachingLayer.set('high-key', 'high-value', 'high');
            await cachingLayer.set('medium-key', 'medium-value', 'medium');
            await cachingLayer.set('low-key', 'low-value', 'low');

            // Fast-forward time by 20 minutes
            jest.setSystemTime(now + 1200000);

            // Low priority entry should be expired
            expect(await cachingLayer.get('low-key')).toBeNull();

            // Medium and high priority entries should still be available
            expect(await cachingLayer.get('medium-key')).toBe('medium-value');
            expect(await cachingLayer.get('high-key')).toBe('high-value');

            // Fast-forward time by another 20 minutes
            jest.setSystemTime(now + 2400000);

            // Medium priority entry should now be expired
            expect(await cachingLayer.get('medium-key')).toBeNull();

            // High priority entry should still be available
            expect(await cachingLayer.get('high-key')).toBe('high-value');
        });

        it('should track TTL expiration metrics', async () => {
            const key = 'test-key';
            const value = 'test-value';
            const config = {
                ...baseConfig,
                ttl: {
                    enabled: true,
                    defaultTTL: 1000 // 1 second
                }
            };

            const now = Date.now();
            jest.setSystemTime(now);

            cachingLayer = new CachingLayer(config);
            await cachingLayer.set(key, value);

            // Fast-forward time by 2 seconds
            jest.setSystemTime(now + 2000);

            // Get the expired entry to trigger metrics
            await cachingLayer.get(key);

            expect(metrics.incrementCounter).toHaveBeenCalledWith(
                'cache_invalidations_total',
                expect.objectContaining({
                    reason: 'ttl',
                    key
                })
            );
        });

        it('should handle invalid TTL configuration gracefully', () => {
            const config = {
                ...baseConfig,
                ttl: 'invalid'
            };

            expect(() => new CachingLayer(config)).toThrow('Invalid TTL configuration');
        });
    });

    describe('memory monitoring', () => {
        let mockMemoryUsage;
        let cachingLayer;

        beforeEach(() => {
            mockMemoryUsage = {
                heapUsed: 50 * 1024 * 1024 // 50MB
            };
            jest.spyOn(process, 'memoryUsage').mockReturnValue(mockMemoryUsage);

            cachingLayer = new CachingLayer({
                memoryMonitoring: {
                    enabled: true,
                    maxMemoryMB: 100,
                    warningThresholdMB: 80,
                    checkIntervalMS: 1000
                },
                invalidationStrategy: {
                    maxAge: 3600000, // 1 hour
                    maxSize: 1000,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 1, medium: 2, high: 3 };
                        return values[priority] || 2;
                    }
                },
                ttl: {
                    enabled: true,
                    defaultTTL: 3600000, // 1 hour
                    priorityTTLs: {
                        low: 1800000, // 30 minutes
                        medium: 3600000, // 1 hour
                        high: 7200000 // 2 hours
                    }
                }
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
            if (cachingLayer) {
                cachingLayer.stopMemoryMonitoring();
            }
        });

        it('should track memory usage metrics', async () => {
            await cachingLayer.set('key1', 'value1');
            expect(metrics.recordMemoryUsage).toHaveBeenCalledWith('cache_memory_usage', 50);
        });

        it('should emit warning when memory usage exceeds threshold', async () => {
            mockMemoryUsage.heapUsed = 85 * 1024 * 1024; // 85MB
            await cachingLayer.set('key1', 'value1');

            expect(logger.warn).toHaveBeenCalledWith(
                'Cache memory usage exceeds warning threshold',
                expect.objectContaining({
                    currentUsageMB: 85,
                    warningThresholdMB: 80
                })
            );
        });

        it('should enforce memory limits and evict entries when exceeded', async () => {
            // Set up entries with different priorities
            await cachingLayer.set('key1', 'value1', 'low');
            await cachingLayer.set('key2', 'value2', 'high');

            // Simulate memory exceeding limit
            mockMemoryUsage.heapUsed = 110 * 1024 * 1024; // 110MB
            await cachingLayer.set('key3', 'value3');

            // High priority entry should be kept
            expect(cachingLayer.cache.has('key2')).toBe(true);
            expect(metrics.recordGauge).toHaveBeenCalledWith(
                'cache_memory_evictions',
                expect.any(Number)
            );
        });

        it('should track memory usage over time', async () => {
            jest.useFakeTimers();
            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize: 10,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority] || 0;
                    }
                },
                memoryMonitoring: {
                    enabled: true,
                    checkIntervalMS: 500,
                    warningThresholdMB: 100,
                    maxMemoryMB: 200
                }
            };

            const cachingLayer = new CachingLayer(config);
            await cachingLayer.set('key1', 'value1');
            await cachingLayer.set('key2', 'value2');
            jest.advanceTimersByTime(1000);

            expect(metrics.recordMemoryUsage).toHaveBeenCalledTimes(9); // Initial + 2 sets (2 each) + 2 interval checks + 2 cache operations
        });

        it('should handle memory monitoring errors gracefully', async () => {
            // Mock process.memoryUsage to throw an error
            const mockError = new Error('Memory usage error');
            process.memoryUsage.mockImplementation(() => {
                throw mockError;
            });

            await expect(cachingLayer.set('key1', 'value1')).rejects.toThrow('Memory usage error');
            expect(logger.error).toHaveBeenCalledWith('Error getting memory stats', mockError);
        });

        it('should disable memory monitoring when configured', async () => {
            // Clear any existing timers and mocks
            jest.clearAllTimers();
            jest.clearAllMocks();

            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize: 10,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority] || 0;
                    }
                },
                memoryMonitoring: {
                    enabled: false,
                    checkIntervalMS: 500,
                    warningThresholdMB: 100,
                    maxMemoryMB: 200
                }
            };

            const cachingLayer = new CachingLayer(config);
            
            // Ensure memory monitoring is stopped
            cachingLayer.stopMemoryMonitoring();
            
            await cachingLayer.set('key1', 'value1');

            expect(metrics.recordMemoryUsage).not.toHaveBeenCalled();
        });

        it('should update memory metrics on cache operations', async () => {
            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize: 10,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority] || 0;
                    }
                },
                memoryMonitoring: {
                    enabled: true,
                    checkIntervalMS: 500,
                    warningThresholdMB: 100,
                    maxMemoryMB: 200
                }
            };

            const cachingLayer = new CachingLayer(config);
            await cachingLayer.set('key1', 'value1');
            await cachingLayer.get('key1');
            await cachingLayer.delete('key1');
            await cachingLayer.clear();

            expect(metrics.recordMemoryUsage).toHaveBeenCalledTimes(8); // Initial + set (2) + get (2) + delete (2) + clear (1)
        });

        it('should provide memory usage statistics', () => {
            const stats = cachingLayer.getMemoryStats();
            expect(stats).toEqual({
                currentUsageMB: 50,
                maxMemoryMB: 100,
                warningThresholdMB: 80,
                percentageUsed: 50
            });
        });
    });

    describe('Cache Hit Ratio Tracking', () => {
        let cache;
        const config = {
            invalidationStrategy: {
                maxAge: 1000,
                maxSize: 100,
                priorityLevels: ['low', 'medium', 'high'],
                getPriorityValue: (priority) => {
                    const values = { low: 0, medium: 1, high: 2 };
                    return values[priority];
                }
            },
            hitRatioTracking: {
                enabled: true,
                windowSize: 10
            }
        };

        beforeEach(() => {
            cache = new CachingLayer(config);
        });

        test('should track hits and misses correctly', async () => {
            // Set some initial cache entries
            await cache.set('key1', 'value1');
            await cache.set('key2', 'value2');

            // Get existing entries (hits)
            await cache.get('key1');
            await cache.get('key2');

            // Get non-existent entries (misses)
            await cache.get('key3');
            await cache.get('key4');

            const stats = cache.getHitRatio();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(2);
            expect(stats.totalRequests).toBe(4);
            expect(stats.hitRatio).toBe(0.5);
            expect(stats.lastUpdate).toBeDefined();
        });

        test('should maintain correct window size', async () => {
            // Fill the window with hits
            for (let i = 0; i < 15; i++) {
                await cache.set(`key${i}`, `value${i}`);
                await cache.get(`key${i}`);
            }

            const stats = cache.getHitRatio();
            expect(stats.totalRequests).toBe(10); // windowSize
            expect(stats.hits).toBe(10);
            expect(stats.misses).toBe(0);
            expect(stats.hitRatio).toBe(1);
        });

        test('should handle TTL expiration correctly in hit ratio', async () => {
            // Mock Date.now() to control time
            const now = Date.now();
            const realDateNow = Date.now;
            Date.now = jest.fn(() => now);
            
            const config = {
                invalidationStrategy: {
                    maxAge: 1000,
                    maxSize: 100,
                    priorityLevels: ['low', 'medium', 'high'],
                    getPriorityValue: (priority) => {
                        const values = { low: 0, medium: 1, high: 2 };
                        return values[priority];
                    }
                },
                hitRatioTracking: {
                    enabled: true,
                    windowSize: 10
                },
                ttl: {
                    enabled: true,
                    defaultTTL: 100,
                    priorityTTLs: {
                        high: 50
                    }
                }
            };
            const cache = new CachingLayer(config);
            
            // Set entry
            await cache.set('key1', 'value1', 'high');
            
            // First access should be a hit
            await cache.get('key1');
            
            // Advance time past TTL
            Date.now = jest.fn(() => now + 75);
            
            // Access after expiration should be a miss
            await cache.get('key1');
            
            // Check hit ratio
            const ratio = cache.getHitRatio();
            expect(ratio.hitRatio).toBe(0.5); // 1 hit, 1 miss = 0.5 ratio
            
            // Restore Date.now
            Date.now = realDateNow;
        });

        test('should handle disabled hit ratio tracking', async () => {
            const disabledConfig = {
                ...config,
                hitRatioTracking: {
                    enabled: false
                }
            };
            const disabledCache = new CachingLayer(disabledConfig);

            // Perform some operations
            await disabledCache.set('key1', 'value1');
            await disabledCache.get('key1');
            await disabledCache.get('key2');

            const stats = disabledCache.getHitRatio();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.totalRequests).toBe(0);
            expect(stats.hitRatio).toBe(0);
            expect(stats.lastUpdate).toBeNull();
        });

        test('should record metrics for hit ratio', async () => {
            // Set up test entries
            await cache.set('key1', 'value1', 'high');
            await cache.set('key2', 'value2', 'high');
            
            // Generate hits and misses
            await cache.get('key1'); // hit
            await cache.get('key2'); // hit
            await cache.get('key3'); // miss
            await cache.get('key4'); // miss
            
            // Verify hit ratio
            const ratio = cache.getHitRatio();
            expect(ratio.hitRatio).toBe(0.5); // 2 hits, 2 misses = 0.5 ratio
            expect(ratio.hits).toBe(2);
            expect(ratio.misses).toBe(2);
            expect(ratio.totalRequests).toBe(4);
            expect(ratio.lastUpdate).toBeDefined();
        });
    });

    describe('Cache Preloading', () => {
        let cache;
        const config = {
            invalidationStrategy: {
                maxAge: 1000,
                maxSize: 100,
                priorityLevels: ['low', 'medium', 'high'],
                getPriorityValue: (priority) => {
                    const values = { low: 0, medium: 1, high: 2 };
                    return values[priority];
                }
            },
            preloading: {
                enabled: true,
                batchSize: 3,
                maxConcurrent: 2,
                priority: 'medium'
            }
        };

        beforeEach(() => {
            cache = new CachingLayer(config);
        });

        afterEach(() => {
            cache.stopPreloading();
        });

        test('should preload entries in batches', async () => {
            const entries = [
                { key: 'key1', value: 'value1' },
                { key: 'key2', value: 'value2' },
                { key: 'key3', value: 'value3' },
                { key: 'key4', value: 'value4' },
                { key: 'key5', value: 'value5' }
            ];

            await cache.preload(entries);
            await cache.processPreloadQueue();

            // Verify entries were preloaded
            expect(cache.size()).toBe(5);
            expect(await cache.get('key1')).toBe('value1');
            expect(await cache.get('key2')).toBe('value2');
            expect(await cache.get('key3')).toBe('value3');
            expect(await cache.get('key4')).toBe('value4');
            expect(await cache.get('key5')).toBe('value5');
        }, 5000);

        test('should respect priority settings', async () => {
            const entries = [
                { key: 'key1', value: 'value1', priority: 'high' },
                { key: 'key2', value: 'value2', priority: 'low' },
                { key: 'key3', value: 'value3' } // Should use default priority
            ];

            await cache.preload(entries);
            await cache.processPreloadQueue();

            // Verify entries were preloaded with correct priorities
            const entry1 = cache.cache.get('key1');
            const entry2 = cache.cache.get('key2');
            const entry3 = cache.cache.get('key3');

            expect(entry1.priority).toBe('high');
            expect(entry2.priority).toBe('low');
            expect(entry3.priority).toBe('medium'); // Default priority
        }, 5000);

        test('should handle preloading when disabled', async () => {
            const disabledConfig = {
                ...config,
                preloading: {
                    enabled: false
                }
            };
            const disabledCache = new CachingLayer(disabledConfig);

            const entries = [
                { key: 'key1', value: 'value1' },
                { key: 'key2', value: 'value2' }
            ];

            await disabledCache.preload(entries);

            // Verify entries were not preloaded
            expect(disabledCache.size()).toBe(0);
        });

        test('should respect concurrency limits', async () => {
            const entries = Array.from({ length: 5 }, (_, i) => ({
                key: `key${i}`,
                value: `value${i}`
            }));

            // Start preloading
            await cache.preload(entries);
            
            // Process first batch
            await cache.processPreloadQueue();

            // Check status
            const status = cache.getPreloadStatus();
            expect(status.inProgress).toBe(false);
            expect(status.queueSize).toBe(0);

            // Verify all entries were eventually processed
            expect(cache.size()).toBe(5);
        }, 5000);

        test('should handle preload errors gracefully', async () => {
            const entries = [
                { key: 'key1', value: 'value1', priority: 'high' },
                { key: 'key2', value: null, priority: 'high' }, // Invalid value
                { key: 'key3', value: 'value3', priority: 'high' }
            ];

            await cache.preload(entries);
            await cache.processPreloadQueue();

            // Verify valid entries were preloaded
            expect(await cache.get('key1')).toBe('value1');
            expect(await cache.get('key3')).toBe('value3');
            
            // Verify invalid entry was not stored
            expect(await cache.get('key2')).toBeNull();
            
            // Verify only valid entries are in the cache
            const status = cache.getPreloadStatus();
            expect(status.queueSize).toBe(0);
            expect(status.inProgress).toBe(false);
        }, 5000);

        test('should monitor memory usage during preloading', async () => {
            const memoryConfig = {
                ...config,
                memoryMonitoring: {
                    enabled: true,
                    checkIntervalMS: 100,
                    warningThresholdMB: 80,
                    maxMemoryMB: 100
                }
            };
            const memoryCache = new CachingLayer(memoryConfig);

            const entries = Array.from({ length: 10 }, (_, i) => ({
                key: `key${i}`,
                value: `value${i}`
            }));

            await memoryCache.preload(entries);
            await memoryCache.processPreloadQueue();

            // Verify memory monitoring was active
            const stats = memoryCache.getMemoryStats();
            expect(stats.currentUsageMB).toBeDefined();
            expect(stats.percentageUsed).toBeDefined();
        }, 5000);
    });

    describe('Cache Compression', () => {
        let cache;
        const config = {
            invalidationStrategy: {
                maxAge: 1000,
                maxSize: 100,
                priorityLevels: ['low', 'medium', 'high'],
                getPriorityValue: (priority) => {
                    const values = { low: 0, medium: 1, high: 2 };
                    return values[priority];
                }
            },
            compression: {
                enabled: true,
                minSize: 100, // Small size for testing
                level: 6,
                algorithm: 'gzip'
            }
        };

        beforeEach(() => {
            cache = new CachingLayer(config);
        });

        test('should compress large values', async () => {
            const largeValue = 'x'.repeat(1000); // 1000 bytes
            await cache.set('key1', largeValue);

            const entry = cache.cache.get('key1');
            expect(entry.value.compressed).toBe(true);
            expect(entry.value.algorithm).toBe('gzip');
            expect(entry.value.data.length).toBeLessThan(1000);

            const retrieved = await cache.get('key1');
            expect(retrieved).toBe(largeValue);
        });

        test('should not compress small values', async () => {
            const smallValue = 'x'.repeat(50); // 50 bytes
            await cache.set('key1', smallValue);

            const entry = cache.cache.get('key1');
            expect(entry.value).toBe(smallValue);

            const retrieved = await cache.get('key1');
            expect(retrieved).toBe(smallValue);
        });

        test('should handle compression errors gracefully', async () => {
            const invalidValue = { circular: {} };
            invalidValue.circular.self = invalidValue;

            await cache.set('key1', invalidValue);
            const entry = cache.cache.get('key1');
            expect(entry.value).toBe(invalidValue);
        });

        test('should track compression metrics', async () => {
            const largeValue = 'x'.repeat(1000);
            await cache.set('key1', largeValue);
            await cache.get('key1');

            const stats = cache.getCompressionStats();
            expect(stats.compressedBytes).toBeGreaterThan(0);
            expect(stats.uncompressedBytes).toBeGreaterThan(0);
            expect(stats.compressionRatio).toBeLessThan(1);
            expect(stats.compressionTime).toBeDefined();
            expect(stats.decompressionTime).toBeDefined();
        });

        test('should support different compression algorithms', async () => {
            const deflateConfig = {
                ...config,
                compression: {
                    ...config.compression,
                    algorithm: 'deflate'
                }
            };
            const deflateCache = new CachingLayer(deflateConfig);

            const largeValue = 'x'.repeat(1000);
            await deflateCache.set('key1', largeValue);

            const entry = deflateCache.cache.get('key1');
            expect(entry.value.compressed).toBe(true);
            expect(entry.value.algorithm).toBe('deflate');

            const retrieved = await deflateCache.get('key1');
            expect(retrieved).toBe(largeValue);
        });

        test('should handle different compression levels', async () => {
            const highLevelConfig = {
                ...config,
                compression: {
                    ...config.compression,
                    level: 9
                }
            };
            const highLevelCache = new CachingLayer(highLevelConfig);

            const largeValue = 'x'.repeat(1000);
            await highLevelCache.set('key1', largeValue);

            const entry = highLevelCache.cache.get('key1');
            expect(entry.value.compressed).toBe(true);
            expect(entry.value.data.length).toBeLessThan(1000);

            const retrieved = await highLevelCache.get('key1');
            expect(retrieved).toBe(largeValue);
        });

        test('should validate compression configuration', () => {
            const invalidConfigs = [
                {
                    ...config,
                    compression: { enabled: true, minSize: -1 }
                },
                {
                    ...config,
                    compression: { enabled: true, level: 0 }
                },
                {
                    ...config,
                    compression: { enabled: true, algorithm: 'invalid' }
                }
            ];

            invalidConfigs.forEach(invalidConfig => {
                expect(() => new CachingLayer(invalidConfig)).toThrow();
            });
        });

        test('should handle disabled compression', async () => {
            const disabledConfig = {
                ...config,
                compression: {
                    enabled: false
                }
            };
            const disabledCache = new CachingLayer(disabledConfig);

            const largeValue = 'x'.repeat(1000);
            await disabledCache.set('key1', largeValue);

            const entry = disabledCache.cache.get('key1');
            expect(entry.value).toBe(largeValue);

            const retrieved = await disabledCache.get('key1');
            expect(retrieved).toBe(largeValue);
        });
    });

    describe('memory management', () => {
        it('should initialize with memory monitoring enabled', () => {
            expect(cachingLayer.memoryMonitorInterval).toBeDefined();
            expect(cachingLayer.memoryManager).toBeDefined();
        });

        it('should monitor memory usage and update metrics', () => {
            cachingLayer.monitorMemoryUsage();
            expect(metrics.recordMemoryUsage).toHaveBeenCalledWith(50 * 1024 * 1024);
            expect(metrics.recordGauge).toHaveBeenCalledWith('cache_memory_usage_ratio', 0.25);
        });

        it('should handle high memory usage', () => {
            mockMemoryManager.getMemoryStats.mockReturnValueOnce({
                usedHeapSize: 90 * 1024 * 1024, // 90MB
                heapSizeLimit: 100 * 1024 * 1024, // 100MB
                poolSizes: { buffer: 10 }
            });

            cachingLayer.monitorMemoryUsage();
            expect(logger.warn).toHaveBeenCalledWith(
                'High memory usage detected',
                expect.objectContaining({
                    usedHeapSize: 90 * 1024 * 1024,
                    heapSizeLimit: 100 * 1024 * 1024,
                    usageRatio: 0.9
                })
            );
        });

        it('should handle critical memory usage', () => {
            mockMemoryManager.getMemoryStats.mockReturnValueOnce({
                usedHeapSize: 95 * 1024 * 1024, // 95MB
                heapSizeLimit: 100 * 1024 * 1024, // 100MB
                poolSizes: { buffer: 10 }
            });

            cachingLayer.monitorMemoryUsage();
            expect(logger.error).toHaveBeenCalledWith(
                'Critical memory usage detected',
                expect.objectContaining({
                    usedHeapSize: 95 * 1024 * 1024,
                    heapSizeLimit: 100 * 1024 * 1024,
                    usageRatio: 0.95
                })
            );
        });

        it('should use memory pool for buffer operations', async () => {
            const buffer = Buffer.from('test');
            await cachingLayer.set('test-key', buffer);
            expect(mockMemoryManager.allocateFromPool).toHaveBeenCalledWith('buffer', expect.any(Number));
        });

        it('should return buffers to pool on deletion', async () => {
            const buffer = Buffer.from('test');
            await cachingLayer.set('test-key', buffer);
            await cachingLayer.delete('test-key');
            expect(mockMemoryManager.returnToPool).toHaveBeenCalledWith('buffer', buffer);
        });

        it('should return all buffers to pool on clear', async () => {
            const buffer1 = Buffer.from('test1');
            const buffer2 = Buffer.from('test2');
            await cachingLayer.set('key1', buffer1);
            await cachingLayer.set('key2', buffer2);
            await cachingLayer.clear();
            expect(mockMemoryManager.returnToPool).toHaveBeenCalledTimes(2);
        });

        it('should provide detailed memory statistics', () => {
            const stats = cachingLayer.getMemoryStats();
            expect(stats).toEqual({
                usedHeapSize: 50 * 1024 * 1024,
                heapSizeLimit: 200 * 1024 * 1024,
                poolSizes: { buffer: 10 },
                poolHits: 5,
                poolMisses: 2,
                gcCount: 3,
                gcDuration: 150
            });
        });
    });
});

describe('CachingLayer Memory Management', () => {
    let cachingLayer;
    let mockMemoryManager;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Mock MemoryManager
        mockMemoryManager = {
            getMemoryStats: jest.fn(),
            allocateFromPool: jest.fn(),
            returnToPool: jest.fn(),
            metrics: {
                poolHits: { _value: 0 },
                poolMisses: { _value: 0 },
                gcCount: { _value: 0 },
                gcDuration: { _sum: 0 }
            }
        };
        MemoryManager.mockImplementation(() => mockMemoryManager);

        // Mock metrics
        metrics.gauge = jest.fn().mockReturnValue({ set: jest.fn() });
        metrics.counter = jest.fn().mockReturnValue({ inc: jest.fn() });
        metrics.histogram = jest.fn().mockReturnValue({ observe: jest.fn() });
        metrics.recordMemoryUsage = jest.fn();
        metrics.recordGauge = jest.fn();

        // Create CachingLayer instance with memory monitoring enabled
        cachingLayer = new CachingLayer({
            memoryMonitoring: {
                enabled: true,
                checkIntervalMS: 1000,
                warningThresholdMB: 100,
                maxMemoryMB: 200
            },
            invalidationStrategy: {
                maxAge: 3600000,
                maxSize: 1000,
                priorityLevels: ['low', 'medium', 'high'],
                getPriorityValue: (priority) => {
                    const values = { low: 0, medium: 1, high: 2 };
                    return values[priority] || 0;
                }
            }
        });
    });

    afterEach(() => {
        cachingLayer.stopMemoryMonitoring();
        jest.clearAllTimers();
    });

    describe('Memory Monitoring', () => {
        it('should start memory monitoring on initialization', () => {
            expect(cachingLayer.memoryCheckInterval).toBeDefined();
        });

        it('should stop memory monitoring when requested', () => {
            cachingLayer.stopMemoryMonitoring();
            expect(cachingLayer.memoryCheckInterval).toBeNull();
        });

        it('should monitor memory usage during cache operations', async () => {
            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 50 * 1024 * 1024, // 50MB
                heapSizeLimit: 200 * 1024 * 1024 // 200MB
            });

            await cachingLayer.monitorMemoryUsage();
            expect(metrics.recordMemoryUsage).toHaveBeenCalledWith('cache_memory_usage', 50);
        });

        it('should handle high memory usage warnings', async () => {
            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 150 * 1024 * 1024, // 150MB
                heapSizeLimit: 200 * 1024 * 1024 // 200MB
            });

            await cachingLayer.monitorMemoryUsage();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should enforce memory limits when exceeded', async () => {
            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 250 * 1024 * 1024, // 250MB
                heapSizeLimit: 200 * 1024 * 1024 // 200MB
            });

            // Add some test entries to the cache
            await cachingLayer.set('key1', Buffer.from('test1'), { priority: 'low' });
            await cachingLayer.set('key2', Buffer.from('test2'), { priority: 'medium' });
            await cachingLayer.set('key3', Buffer.from('test3'), { priority: 'high' });

            await cachingLayer.monitorMemoryUsage();
            expect(logger.error).toHaveBeenCalled();
            expect(metrics.recordGauge).toHaveBeenCalledWith('cache_memory_evictions', expect.any(Number));
        });
    });

    describe('Memory Pooling', () => {
        it('should use memory pool for buffer operations', async () => {
            const testBuffer = Buffer.from('test');
            mockMemoryManager.allocateFromPool.mockReturnValue(Buffer.alloc(testBuffer.length));

            await cachingLayer.set('key', testBuffer);
            expect(mockMemoryManager.allocateFromPool).toHaveBeenCalledWith('buffer', testBuffer.length);
        });

        it('should return buffers to pool on deletion', async () => {
            const testBuffer = Buffer.from('test');
            await cachingLayer.set('key', testBuffer);
            await cachingLayer.delete('key');
            expect(mockMemoryManager.returnToPool).toHaveBeenCalledWith('buffer', expect.any(Buffer));
        });

        it('should return buffers to pool on clear', async () => {
            const testBuffer = Buffer.from('test');
            await cachingLayer.set('key', testBuffer);
            await cachingLayer.clear();
            expect(mockMemoryManager.returnToPool).toHaveBeenCalledWith('buffer', expect.any(Buffer));
        });
    });

    describe('Memory Statistics', () => {
        it('should provide accurate memory statistics', () => {
            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 75 * 1024 * 1024, // 75MB
                heapSizeLimit: 200 * 1024 * 1024, // 200MB
                poolSizes: { buffer: 10, string: 5, object: 3 }
            });

            const stats = cachingLayer.getMemoryStats();
            expect(stats).toEqual({
                currentUsageMB: 75,
                maxMemoryMB: 200,
                warningThresholdMB: 100,
                percentageUsed: 37.5,
                poolStats: { buffer: 10, string: 5, object: 3 },
                gcStats: {
                    count: 0,
                    duration: 0
                }
            });
        });

        it('should track pool hits and misses', async () => {
            const testBuffer = Buffer.from('test');
            mockMemoryManager.allocateFromPool.mockReturnValue(Buffer.alloc(testBuffer.length));
            mockMemoryManager.metrics.poolHits._value = 5;
            mockMemoryManager.metrics.poolMisses._value = 2;

            await cachingLayer.monitorMemoryUsage();
            expect(metrics.gauge).toHaveBeenCalledWith('cache_memory_pool_hits', 5);
            expect(metrics.gauge).toHaveBeenCalledWith('cache_memory_pool_misses', 2);
        });
    });

    describe('Memory Limit Enforcement', () => {
        it('should evict low priority entries first', async () => {
            // Add entries with different priorities
            await cachingLayer.set('low1', Buffer.from('low1'), { priority: 'low' });
            await cachingLayer.set('low2', Buffer.from('low2'), { priority: 'low' });
            await cachingLayer.set('medium1', Buffer.from('medium1'), { priority: 'medium' });
            await cachingLayer.set('high1', Buffer.from('high1'), { priority: 'high' });

            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 250 * 1024 * 1024, // 250MB
                heapSizeLimit: 200 * 1024 * 1024 // 200MB
            });

            await cachingLayer.monitorMemoryUsage();
            expect(cachingLayer.cache.has('high1')).toBe(true);
            expect(cachingLayer.cache.has('medium1')).toBe(true);
            expect(cachingLayer.cache.has('low1')).toBe(false);
            expect(cachingLayer.cache.has('low2')).toBe(false);
        });

        it('should respect memory limits during preloading', async () => {
            cachingLayer.config.preloading.enabled = true;
            const entries = Array(20).fill(null).map((_, i) => ({
                key: `key${i}`,
                value: Buffer.from(`value${i}`),
                priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low'
            }));

            mockMemoryManager.getMemoryStats.mockReturnValue({
                usedHeapSize: 250 * 1024 * 1024, // 250MB
                heapSizeLimit: 200 * 1024 * 1024 // 200MB
            });

            await cachingLayer.preload(entries);
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for preload to process

            // Verify that high priority entries were preserved
            expect(cachingLayer.cache.has('key0')).toBe(true);
            expect(cachingLayer.cache.has('key3')).toBe(true);
            expect(cachingLayer.cache.has('key6')).toBe(true);
        });
    });
}); 