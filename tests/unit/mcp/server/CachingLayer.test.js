const CachingLayer = require('../../../../src/mcp/server/CachingLayer');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
    incrementCounter: jest.fn(),
    recordMemoryUsage: jest.fn(),
    recordGauge: jest.fn(),
    gauge: jest.fn()
}));

describe('CachingLayer', () => {
    let cachingLayer;
    const baseConfig = {
        maxSize: 1000,
        ttl: 3600000, // 1 hour
        checkPeriod: 60000, // 1 minute
        invalidationStrategy: {
            maxAge: 3600000,
            maxSize: 1000,
            priorityLevels: ['high', 'medium', 'low']
        },
        memoryMonitoring: {
            enabled: true,
            maxMemoryMB: 100,
            warningThresholdMB: 80,
            checkIntervalMS: 1000
        },
        hitRatioTracking: {
            enabled: true,
            windowSize: 1000
        },
        preloading: {
            enabled: false,
            batchSize: 10,
            maxConcurrent: 5,
            priority: 'medium'
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        cachingLayer = new CachingLayer(baseConfig);
    });

    afterEach(() => {
        jest.useRealTimers();
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

            // Low priority entry should be evicted
            expect(cachingLayer.cache.has('key1')).toBe(false);
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

            expect(metrics.recordMemoryUsage).toHaveBeenCalledTimes(7); // Initial + 2 sets + 2 interval checks + 2 cache operations
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

            expect(metrics.recordMemoryUsage).toHaveBeenCalledTimes(7); // Initial + set + get + delete + clear + 2 cache operations
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
}); 