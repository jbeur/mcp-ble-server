const v8 = require('v8');
const metrics = require('../../../src/utils/metrics');
const logger = require('../../../src/utils/logger');
const MemoryManager = require('../../../src/utils/MemoryManager');

// Mock dependencies
jest.mock('../../../src/utils/metrics');
jest.mock('../../../src/utils/logger');

describe('MemoryManager', () => {
    let memoryManager;
    let v8Spy;
    let originalGc;
    
    beforeEach(() => {
        // Save original global.gc
        originalGc = global.gc;
        
        // Reset all mocks
        jest.clearAllMocks();
        
        // Setup v8 mock
        v8Spy = jest.spyOn(v8, 'getHeapStatistics').mockImplementation(() => ({
            total_available_size: 1024 * 1024 * 1024, // 1GB
            used_heap_size: 512 * 1024 * 1024, // 512MB
            heap_size_limit: 1024 * 1024 * 1024, // 1GB
            total_heap_size: 1024 * 1024 * 1024, // 1GB
            total_physical_size: 768 * 1024 * 1024 // 768MB
        }));

        // Setup logger mock
        Object.keys(logger).forEach(key => {
            logger[key] = jest.fn();
        });

        // Setup metrics mock
        Object.keys(metrics).forEach(key => {
            metrics[key] = jest.fn();
        });
    });

    afterEach(() => {
        if (memoryManager) {
            memoryManager.stopMonitoring();
        }
        v8Spy.mockRestore();
        
        // Restore original global.gc
        global.gc = originalGc;
    });

    describe('constructor', () => {
        it('should initialize with default options', () => {
            memoryManager = new MemoryManager();
            
            expect(memoryManager.maxHeapSize).toBe(1024 * 1024 * 1024);
            expect(memoryManager.minHeapSize).toBe(1024 * 1024 * 100);
            expect(memoryManager.gcInterval).toBe(300000);
            expect(memoryManager.warningThreshold).toBe(0.8);
            expect(memoryManager.criticalThreshold).toBe(0.9);
            expect(memoryManager.poolSize).toBe(1000);
        });

        it('should initialize with custom options', () => {
            const options = {
                maxHeapSize: 2 * 1024 * 1024 * 1024,
                minHeapSize: 512 * 1024 * 1024,
                gcInterval: 600000,
                warningThreshold: 0.7,
                criticalThreshold: 0.85,
                poolSize: 2000
            };
            
            memoryManager = new MemoryManager(options);
            
            expect(memoryManager.maxHeapSize).toBe(options.maxHeapSize);
            expect(memoryManager.minHeapSize).toBe(options.minHeapSize);
            expect(memoryManager.gcInterval).toBe(options.gcInterval);
            expect(memoryManager.warningThreshold).toBe(options.warningThreshold);
            expect(memoryManager.criticalThreshold).toBe(options.criticalThreshold);
            expect(memoryManager.poolSize).toBe(options.poolSize);
        });
    });

    describe('monitoring', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should start monitoring on initialization', () => {
            memoryManager = new MemoryManager();
            expect(memoryManager.monitoringInterval).toBeDefined();
            expect(memoryManager.gcTimer).toBeDefined();
            expect(logger.info).toHaveBeenCalledWith('MemoryManager monitoring started');
        });

        it('should stop monitoring when requested', () => {
            memoryManager = new MemoryManager();
            memoryManager.stopMonitoring();
            expect(memoryManager.monitoringInterval).toBeNull();
            expect(memoryManager.gcTimer).toBeNull();
            expect(logger.info).toHaveBeenCalledWith('MemoryManager monitoring stopped');
        });

        it('should handle errors during monitoring', () => {
            memoryManager = new MemoryManager();
            v8Spy.mockImplementation(() => {
                throw new Error('Monitoring Error');
            });

            memoryManager.monitorMemoryUsage();
            expect(logger.error).toHaveBeenCalledWith('Error monitoring memory usage:', expect.any(Error));
        });
    });

    describe('memory monitoring', () => {
        it('should monitor memory usage and update metrics', () => {
            memoryManager = new MemoryManager();
            memoryManager.monitorMemoryUsage();

            expect(v8Spy).toHaveBeenCalled();
            expect(metrics.gauge).toHaveBeenCalledWith('memory_heap_size', expect.any(Number));
            expect(metrics.gauge).toHaveBeenCalledWith('memory_heap_used', expect.any(Number));
            expect(metrics.gauge).toHaveBeenCalledWith('memory_heap_limit', expect.any(Number));
        });

        it('should handle high memory usage', () => {
            memoryManager = new MemoryManager();
            v8Spy.mockImplementation(() => ({
                total_available_size: 1024 * 1024 * 1024,
                used_heap_size: 900 * 1024 * 1024, // 90% usage
                heap_size_limit: 1024 * 1024 * 1024,
                total_heap_size: 1024 * 1024 * 1024
            }));

            memoryManager.monitorMemoryUsage();
            expect(logger.warn).toHaveBeenCalledWith('High memory usage detected', expect.any(Object));
        });

        it('should handle critical memory usage', () => {
            memoryManager = new MemoryManager();
            v8Spy.mockImplementation(() => ({
                total_available_size: 1024 * 1024 * 1024,
                used_heap_size: 950 * 1024 * 1024, // 95% usage
                heap_size_limit: 1024 * 1024 * 1024,
                total_heap_size: 1024 * 1024 * 1024
            }));

            memoryManager.monitorMemoryUsage();
            expect(logger.error).toHaveBeenCalledWith('Critical memory usage detected', expect.any(Object));
        });
    });

    describe('garbage collection', () => {
        it('should optimize garbage collection', async () => {
            memoryManager = new MemoryManager();
            await memoryManager.optimizeGarbageCollection();

            expect(v8Spy).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('Garbage collection completed', expect.any(Object));
        });

        it('should handle errors during garbage collection', async () => {
            memoryManager = new MemoryManager();
            
            v8Spy.mockImplementation(() => {
                throw new Error('GC Error');
            });

            await memoryManager.optimizeGarbageCollection();

            expect(logger.error).toHaveBeenCalledWith('Error during garbage collection:', expect.any(Error));
        });
    });

    describe('memory pooling', () => {
        it('should return items to pool', () => {
            memoryManager = new MemoryManager();
            const buffer = Buffer.alloc(1024);
            
            memoryManager.returnToPool('buffer', buffer);
            expect(memoryManager.pools.buffer.size).toBe(1);
        });

        it('should handle pool overflow', () => {
            memoryManager = new MemoryManager({ poolSize: 1 });
            const buffer1 = Buffer.alloc(1024);
            const buffer2 = Buffer.alloc(1024);
            
            memoryManager.returnToPool('buffer', buffer1);
            memoryManager.returnToPool('buffer', buffer2);
            expect(memoryManager.pools.buffer.size).toBe(1);
        });

        it('should handle invalid pool type', () => {
            memoryManager = new MemoryManager();
            const buffer = Buffer.alloc(1024);
            
            expect(() => {
                memoryManager.returnToPool('invalid', buffer);
            }).toThrow('Invalid pool type: invalid');
        });

        it('should allocate from pool', () => {
            memoryManager = new MemoryManager();
            const buffer = Buffer.alloc(1024);
            memoryManager.returnToPool('buffer', buffer);
            
            const allocated = memoryManager.allocateFromPool('buffer', 1024);
            expect(allocated).toBe(buffer);
            expect(memoryManager.pools.buffer.size).toBe(0);
        });

        it('should create new object when pool is empty', () => {
            memoryManager = new MemoryManager();
            const allocated = memoryManager.allocateFromPool('buffer', 1024);
            
            expect(allocated).toBeInstanceOf(Buffer);
            expect(allocated.length).toBe(1024);
        });

        it('should handle errors during pool operations', () => {
            memoryManager = new MemoryManager();
            const invalidBuffer = 'not a buffer';
            
            expect(() => {
                memoryManager.returnToPool('buffer', invalidBuffer);
            }).toThrow();
        });
    });

    describe('resource cleanup', () => {
        it('should clear all pools', () => {
            memoryManager = new MemoryManager();
            const buffer = Buffer.alloc(1024);
            memoryManager.returnToPool('buffer', buffer);
            
            memoryManager.clearAllPools();
            expect(memoryManager.pools.buffer.size).toBe(0);
            expect(logger.info).toHaveBeenCalledWith('All memory pools cleared');
        });

        it('should handle errors during pool clearing', () => {
            memoryManager = new MemoryManager();
            memoryManager.pools = null;
            
            expect(() => {
                memoryManager.clearAllPools();
            }).toThrow();
        });
    });

    describe('memory stats', () => {
        it('should get memory statistics', () => {
            memoryManager = new MemoryManager();
            const stats = memoryManager.getMemoryStats();
            
            expect(stats).toHaveProperty('totalHeapSize');
            expect(stats).toHaveProperty('usedHeapSize');
            expect(stats).toHaveProperty('heapSizeLimit');
            expect(stats).toHaveProperty('totalAvailableSize');
            expect(stats).toHaveProperty('totalPhysicalSize');
            expect(stats).toHaveProperty('poolSizes');
        });

        it('should handle errors when getting memory stats', () => {
            memoryManager = new MemoryManager();
            v8Spy.mockImplementation(() => {
                throw new Error('Stats Error');
            });
            
            expect(() => {
                memoryManager.getMemoryStats();
            }).toThrow();
        });
    });

    describe('monitoring intervals', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should trigger memory monitoring on interval', () => {
            memoryManager = new MemoryManager();
            const monitorSpy = jest.spyOn(memoryManager, 'monitorMemoryUsage');
            
            jest.advanceTimersByTime(60000);
            expect(monitorSpy).toHaveBeenCalled();
        });

        it('should trigger garbage collection on interval', () => {
            memoryManager = new MemoryManager();
            const gcSpy = jest.spyOn(memoryManager, 'optimizeGarbageCollection');
            
            jest.advanceTimersByTime(300000);
            expect(gcSpy).toHaveBeenCalled();
        });
    });

    describe('garbage collection with global.gc', () => {
        it('should use global.gc when available', async () => {
            const mockGc = jest.fn();
            global.gc = mockGc;
            
            memoryManager = new MemoryManager();
            await memoryManager.optimizeGarbageCollection();
            
            expect(mockGc).toHaveBeenCalled();
        });

        it('should handle missing global.gc', async () => {
            global.gc = undefined;
            
            memoryManager = new MemoryManager();
            await memoryManager.optimizeGarbageCollection();
            
            expect(logger.debug).toHaveBeenCalledWith('Garbage collection completed', expect.any(Object));
        });
    });

    describe('pool operations', () => {
        it('should validate string items', () => {
            memoryManager = new MemoryManager();
            expect(() => {
                memoryManager.returnToPool('string', 123);
            }).toThrow('Invalid item type: expected String');
        });

        it('should validate object items', () => {
            memoryManager = new MemoryManager();
            expect(() => {
                memoryManager.returnToPool('object', 'not an object');
            }).toThrow('Invalid item type: expected Object');
        });

        it('should check item suitability', () => {
            memoryManager = new MemoryManager();
            const buffer = Buffer.alloc(1024);
            const isSuitableSpy = jest.spyOn(memoryManager, 'isSuitableForReuse');
            
            memoryManager.returnToPool('buffer', buffer);
            memoryManager.allocateFromPool('buffer', 1024);
            
            expect(isSuitableSpy).toHaveBeenCalledWith(buffer, 1024);
        });

        it('should handle string allocation', () => {
            memoryManager = new MemoryManager();
            const str = 'test string';
            memoryManager.returnToPool('string', str);
            
            // Since strings are immutable, we should get a new empty string
            const retrieved = memoryManager.allocateFromPool('string', 0);
            expect(retrieved).toBe('');
        });

        it('should reset object state', () => {
            memoryManager = new MemoryManager();
            const obj = { test: 'value' };
            memoryManager.returnToPool('object', obj);
            
            const retrieved = memoryManager.allocateFromPool('object', 0);
            expect(Object.keys(retrieved).length).toBe(0);
        });

        it('should handle reset state errors', () => {
            memoryManager = new MemoryManager();
            const obj = Object.create(null);
            Object.defineProperty(obj, 'test', {
                configurable: false,
                value: 'test'
            });
            
            memoryManager.resetObjectState(obj);
            expect(logger.warn).toHaveBeenCalledWith(
                'Could not delete property:',
                expect.objectContaining({
                    key: 'test',
                    error: expect.any(String)
                })
            );
        });
    });

    describe('error handling', () => {
        it('should handle allocation errors', () => {
            memoryManager = new MemoryManager();
            memoryManager.createNewObject = jest.fn().mockImplementation(() => {
                throw new Error('Creation error');
            });
            
            expect(() => {
                memoryManager.allocateFromPool('buffer', 1024);
            }).toThrow('Creation error');
        });

        it('should handle memory stats errors', () => {
            memoryManager = new MemoryManager();
            memoryManager.pools = null;
            
            expect(() => {
                memoryManager.getMemoryStats();
            }).toThrow();
        });
    });
}); 