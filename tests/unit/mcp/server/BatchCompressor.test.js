// Mock logger first
const mockLogger = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
};

jest.mock('../../../../src/utils/logger', () => mockLogger);

const BatchCompressor = require('../../../../src/mcp/server/BatchCompressor');

describe('BatchCompressor', () => {
  let compressor;
  let mockMetrics;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockMetrics = {
      errors: {
        compression: 0,
        decompression: 0
      }
    };

    compressor = new BatchCompressor({ metrics: mockMetrics });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config when no config provided', () => {
      const defaultCompressor = new BatchCompressor();
      expect(defaultCompressor.config.enabled).toBe(true);
      expect(defaultCompressor.config.minSize).toBe(1024);
      expect(defaultCompressor.config.level).toBe(6);
      expect(defaultCompressor.config.priorityThresholds).toEqual({
        high: 512,
        medium: 1024,
        low: 2048
      });
      expect(defaultCompressor.config.algorithms).toEqual({
        high: 'gzip',
        medium: 'gzip',
        low: 'gzip'
      });
    });

    it('should initialize with provided config', () => {
      const config = {
        enabled: false,
        minSize: 500,
        level: 9,
        priorityThresholds: {
          high: 100,
          medium: 200,
          low: 300
        },
        algorithms: {
          high: 'gzip',
          medium: 'gzip',
          low: 'gzip'
        }
      };
      const customCompressor = new BatchCompressor(config);
      expect(customCompressor.config).toEqual(config);
    });
  });

  describe('compress', () => {
    it('should not compress when compression is disabled', async () => {
      compressor.config.enabled = false;
      const batch = Array(10).fill({ type: 'test', data: 'data' });
      const result = await compressor.compress(batch);
      expect(result).toBe(batch);
    });

    it('should not compress when batch size is below threshold', async () => {
      const smallBatch = [{ type: 'test', data: 'small' }];
      const result = await compressor.compress(smallBatch, 'high');
      expect(result).toBe(smallBatch);
      expect(compressor.metrics.totalUncompressed).toBe(1);
    });

    it('should compress batch when size exceeds threshold', async () => {
      const largeBatch = Array(20).fill({ type: 'test', data: 'large data' });
      const result = await compressor.compress(largeBatch, 'high');
      expect(result.compressed).toBe(true);
      expect(result.algorithm).toBe('gzip');
      expect(result.originalSize).toBeGreaterThan(result.compressedSize);
      expect(compressor.metrics.totalCompressed).toBe(1);
    });

    it('should handle compression errors gracefully', () => {
      const batch = {
        messages: ['test'],
        priority: 'high'
      };

      // Force compression to fail
      jest.spyOn(Buffer, 'from').mockImplementation(() => {
        throw new Error('Compression failed');
      });

      const result = compressor.compress(batch);

      expect(result).toBe(batch);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        'Error compressing batch:',
        expect.objectContaining({
          error: expect.any(Error),
          priority: 'high'
        })
      );
      expect(mockMetrics.errors.compression).toBe(1);
    });

    it('should track compression times', async () => {
      const batch = Array(20).fill({ type: 'test', data: 'data' });
      const result = await compressor.compress(batch, 'high');
      expect(result.compressionTime).toBeGreaterThan(0);
      expect(compressor.metrics.compressionTimes.high.count).toBe(1);
      expect(compressor.metrics.compressionTimes.high.total).toBeGreaterThan(0);
    });
  });

  describe('decompress', () => {
    it('should return original data when not compressed', async () => {
      const batch = [{ type: 'test', data: 'data' }];
      const result = await compressor.decompress(batch);
      expect(result).toBe(batch);
    });

    it('should decompress compressed data', async () => {
      const batch = Array(20).fill({ type: 'test', data: 'data' });
      const compressed = await compressor.compress(batch);
      const decompressed = await compressor.decompress(compressed);
      expect(decompressed.data).toEqual(batch);
      expect(decompressed.decompressionTime).toBeGreaterThan(0);
    });

    it('should handle decompression errors gracefully', () => {
      const batch = {
        messages: ['test'],
        compressed: true
      };

      // Force decompression to fail
      jest.spyOn(Buffer, 'from').mockImplementation(() => {
        throw new Error('Decompression failed');
      });

      const result = compressor.decompress(batch);

      expect(result).toBe(batch);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        'Error decompressing batch:',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
      expect(mockMetrics.errors.decompression).toBe(1);
    });
  });

  describe('metrics', () => {
    it('should calculate compression ratio correctly', async () => {
      const batch = Array(20).fill({ type: 'test', data: 'data' });
      await compressor.compress(batch);
      const metrics = compressor.getMetrics();
      expect(metrics.compressionRatio).toBeGreaterThan(0);
    });

    it('should track compression times per priority', async () => {
      const batch = Array(20).fill({ type: 'test', data: 'data' });
      await compressor.compress(batch, 'high');
      await compressor.compress(batch, 'medium');
      const metrics = compressor.getMetrics();
      expect(metrics.averageCompressionTimes.high).toBeGreaterThan(0);
      expect(metrics.averageCompressionTimes.medium).toBeGreaterThan(0);
    });

    it('should reset metrics correctly', () => {
      compressor.metrics.totalCompressed = 10;
      compressor.metrics.totalUncompressed = 5;
      compressor.resetMetrics();
      expect(compressor.metrics.totalCompressed).toBe(0);
      expect(compressor.metrics.totalUncompressed).toBe(0);
      expect(compressor.metrics.compressionRatio).toBe(0);
    });
  });
}); 