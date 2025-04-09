const { CompressionUtils, ALGORITHMS } = require('../../../src/utils/CompressionUtils');
const assert = require('assert');

describe('Compression Versioning', () => {
  let compressionUtils;
  const testData = Buffer.from('a'.repeat(2048)); // Data larger than threshold

  beforeEach(() => {
    compressionUtils = new CompressionUtils();
  });

  describe('version negotiation', () => {
    it('should handle version 1 compression format', async () => {
      const compressed = await compressionUtils.compress(testData);
      const version = compressionUtils.getVersion(compressed);
      assert.strictEqual(version, 1);
    });

    it('should handle legacy format (no version)', async () => {
      // Create legacy format data (no version header)
      const legacyData = Buffer.from([0x1f, 0x8b]); // Gzip magic numbers
      const version = compressionUtils.getVersion(legacyData);
      assert.strictEqual(version, 0); // 0 indicates legacy format
    });

    it('should detect invalid version numbers', async () => {
      const invalidData = Buffer.from([0x4D, 0x43, 0x50, 0x99]); // MCP magic + invalid version
      const version = compressionUtils.getVersion(invalidData);
      assert.strictEqual(version, -1); // -1 indicates invalid version
    });
  });

  describe('backward compatibility', () => {
    it('should decompress legacy format data', async () => {
      // Create legacy format data (gzip)
      const legacyData = await compressionUtils.compressLegacy(testData);
      const decompressed = await compressionUtils.decompress(legacyData);
      assert.deepStrictEqual(decompressed, testData);
    });

    it('should decompress version 1 format data', async () => {
      const compressed = await compressionUtils.compress(testData);
      const decompressed = await compressionUtils.decompress(compressed);
      assert.deepStrictEqual(decompressed, testData);
    });

    it('should handle mixed format data in batch', async () => {
      const legacyData = await compressionUtils.compressLegacy(testData);
      const v1Data = await compressionUtils.compress(testData);
      const mixedBatch = [legacyData, v1Data];
            
      const decompressedBatch = await Promise.all(
        mixedBatch.map(data => compressionUtils.decompress(data))
      );
            
      assert.deepStrictEqual(decompressedBatch[0], testData);
      assert.deepStrictEqual(decompressedBatch[1], testData);
    });
  });

  describe('feature detection', () => {
    it('should detect supported features for version 1', async () => {
      const compressed = await compressionUtils.compress(testData);
      const features = compressionUtils.getSupportedFeatures(compressed);
      assert.deepStrictEqual(features, {
        version: 1,
        algorithms: ['gzip', 'deflate', 'brotli'],
        compressionLevels: true,
        metrics: true
      });
    });

    it('should detect supported features for legacy format', async () => {
      const legacyData = await compressionUtils.compressLegacy(testData);
      const features = compressionUtils.getSupportedFeatures(legacyData);
      assert.deepStrictEqual(features, {
        version: 0,
        algorithms: ['gzip'],
        compressionLevels: false,
        metrics: false
      });
    });
  });

  describe('version metrics', () => {
    it('should track version usage statistics', async () => {
      // Compress data in different formats
      await compressionUtils.compress(testData); // v1
      await compressionUtils.compressLegacy(testData); // legacy
            
      const stats = compressionUtils.getVersionStats();
      assert.strictEqual(stats.v1.count, 1);
      assert.strictEqual(stats.legacy.count, 1);
      assert(stats.v1.totalTime > 0);
      assert(stats.legacy.totalTime > 0);
    });

    it('should track version-specific compression ratios', async () => {
      await compressionUtils.compress(testData); // v1
      await compressionUtils.compressLegacy(testData); // legacy
            
      const stats = compressionUtils.getVersionStats();
      assert(stats.v1.avgRatio > 0);
      assert(stats.legacy.avgRatio > 0);
    });

    it('should track version-specific error rates', async () => {
      // Force some errors
      try {
        await compressionUtils.decompress(Buffer.from('invalid data'));
      } catch (e) {
        // Expected error
      }
            
      const stats = compressionUtils.getVersionStats();
      assert(stats.v1.errors >= 0);
      assert(stats.legacy.errors >= 0);
    });
  });
}); 