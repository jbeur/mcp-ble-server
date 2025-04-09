const CachingLayer = require('../../../../src/mcp/server/CachingLayer');
const zlib = require('zlib');

jest.mock('zlib', () => ({
  gzipSync: jest.fn((data) => {
    if (Buffer.isBuffer(data)) {
      return Buffer.from(`compressed_${data.toString()}`);
    }
    return Buffer.from(`compressed_${data}`);
  }),
  gunzipSync: jest.fn((data) => {
    if (Buffer.isBuffer(data)) {
      return Buffer.from(data.toString().replace('compressed_', ''));
    }
    return Buffer.from(data.replace('compressed_', ''));
  })
}));
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');
jest.mock('../../../../src/utils/MemoryManager', () => {
  return jest.fn().mockImplementation(() => ({
    getMemoryStats: jest.fn().mockResolvedValue({
      heapUsed: 1000000,
      heapTotal: 2000000
    }),
    allocateFromPool: jest.fn().mockResolvedValue(true),
    createNewObject: jest.fn().mockResolvedValue({}),
    releaseToPool: jest.fn().mockResolvedValue(true),
    returnToPool: jest.fn().mockResolvedValue(true)
  }));
});

describe('CachingLayer', () => {
  let cachingLayer;
  let logger;
  let metrics;
  let config;

  beforeEach(() => {
    // Mock logger with all required methods
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Mock metrics with required methods
    metrics = {
      recordMemoryUsage: jest.fn(),
      recordCacheHit: jest.fn(),
      recordCacheMiss: jest.fn(),
      recordCompressionRatio: jest.fn(),
      incrementCounter: jest.fn(),
      recordGauge: jest.fn()
    };

    // Mock zlib methods
    jest.clearAllMocks();

    // Setup configuration
    config = {
      ttl: {
        enabled: true,
        defaultTTL: 3600000, // 1 hour in milliseconds
        checkInterval: 60000 // 1 minute in milliseconds
      },
      compression: {
        enabled: true,
        minSize: 1000, // Compress values larger than 1KB
        level: 6,
        algorithm: 'gzip'
      },
      memoryMonitoring: {
        enabled: false, // Disable for tests to avoid timer issues
        maxMemoryMB: 200,
        warningThresholdMB: 100,
        checkIntervalMS: 60000
      },
      hitRatioTracking: {
        enabled: true,
        windowSize: 100
      },
      invalidationStrategy: {
        maxAge: 3600000, // 1 hour
        maxSize: 1000, // Maximum number of entries
        priorityLevels: ['high', 'medium', 'low'],
        getPriorityValue: (priority) => {
          const priorityMap = { high: 3, medium: 2, low: 1 };
          return priorityMap[priority] || 1;
        }
      }
    };

    // Initialize CachingLayer with mocks
    cachingLayer = new CachingLayer(config, logger, metrics);
  });

  afterEach(async () => {
    if (cachingLayer) {
      await cachingLayer.clear();
    }
    jest.clearAllMocks();
  });

  describe('Basic Cache Operations', () => {
    it('should set and get values correctly', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      await cachingLayer.set(key, value);
      const result = await cachingLayer.get(key);
      
      expect(result).toBe(value);
      expect(metrics.recordCacheHit).toHaveBeenCalled();
    });

    it('should delete values correctly', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      await cachingLayer.set(key, value);
      await cachingLayer.delete(key);
      const result = await cachingLayer.get(key);
      
      expect(result).toBeUndefined();
      expect(metrics.recordCacheMiss).toHaveBeenCalled();
    });

    it('should clear all values correctly', async () => {
      const entries = {
        'key1': 'value1',
        'key2': 'value2'
      };
      
      await Promise.all(
        Object.entries(entries).map(([key, value]) => cachingLayer.set(key, value))
      );
      
      await cachingLayer.clear();
      
      const results = await Promise.all(
        Object.keys(entries).map(key => cachingLayer.get(key))
      );
      
      results.forEach(result => expect(result).toBeUndefined());
    });
  });

  describe('Cache Hit Ratio', () => {
    it('should track cache hits and misses', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      // Miss - key doesn't exist
      await cachingLayer.get(key);
      expect(metrics.recordCacheMiss).toHaveBeenCalled();
      
      // Set the value
      await cachingLayer.set(key, value);
      
      // Hit - key exists
      const result = await cachingLayer.get(key);
      expect(result).toBe(value);
      expect(metrics.recordCacheHit).toHaveBeenCalled();
    });
  });

  describe('Cache Compression', () => {
    it('should compress large values', async () => {
      const key = 'large-value-key';
      const value = 'x'.repeat(2000); // Value larger than compression threshold
      
      await cachingLayer.set(key, value);
      const result = await cachingLayer.get(key);
      
      expect(result).toBe(value);
      expect(zlib.gzipSync).toHaveBeenCalled();
      expect(zlib.gunzipSync).toHaveBeenCalled();
    });

    it('should not compress small values', async () => {
      const key = 'small-value-key';
      const value = 'small value';
      
      await cachingLayer.set(key, value);
      const result = await cachingLayer.get(key);
      
      expect(result).toBe(value);
      expect(zlib.gzipSync).not.toHaveBeenCalled();
      expect(zlib.gunzipSync).not.toHaveBeenCalled();
    });
  });
}); 