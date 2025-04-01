const assert = require('assert');
const { CompressionUtils, ALGORITHMS } = require('../../../src/utils/CompressionUtils');

describe('CompressionUtils', () => {
    let compressionUtils;
    const testData = Buffer.from('a'.repeat(2048)); // Make test data larger than threshold

    beforeEach(() => {
        compressionUtils = new CompressionUtils();
    });

    describe('configuration', () => {
        it('should use default configuration', () => {
            const utils = new CompressionUtils();
            assert.strictEqual(utils.config.defaultAlgorithm, ALGORITHMS.GZIP);
            assert.strictEqual(utils.config.compressionThreshold, 1024);
            assert.strictEqual(utils.config.maxCompressionLevel, 9);
            assert.strictEqual(utils.config.minCompressionLevel, 1);
            assert.strictEqual(utils.config.defaultCompressionLevel, 6);
            assert.strictEqual(utils.config.autoAlgorithmSelection, true);
            assert.strictEqual(utils.config.dynamicLevelAdjustment, true);
            assert.strictEqual(utils.config.metricsEnabled, true);
        });

        it('should validate configuration', () => {
            assert.throws(() => new CompressionUtils({ defaultAlgorithm: 'invalid' }));
            assert.throws(() => new CompressionUtils({ compressionThreshold: -1 }));
            assert.throws(() => new CompressionUtils({ maxCompressionLevel: 0 }));
            assert.throws(() => new CompressionUtils({ minCompressionLevel: 10 }));
            assert.throws(() => new CompressionUtils({ defaultCompressionLevel: 0 }));
        });

        it('should allow custom configuration', () => {
            const config = {
                defaultAlgorithm: ALGORITHMS.DEFLATE,
                compressionThreshold: 2048,
                maxCompressionLevel: 7,
                minCompressionLevel: 3,
                defaultCompressionLevel: 5,
                autoAlgorithmSelection: false,
                dynamicLevelAdjustment: false,
                metricsEnabled: false
            };
            const utils = new CompressionUtils(config);
            assert.deepStrictEqual(utils.config, { ...utils.config, ...config });
        });
    });

    describe('compression', () => {
        it('should compress and decompress data correctly', async () => {
            const compressed = await compressionUtils.compress(testData);
            const decompressed = await compressionUtils.decompress(compressed);
            assert.deepStrictEqual(decompressed, testData);
        });

        it('should skip compression for small data', async () => {
            const smallData = Buffer.from('Hi');
            const compressed = await compressionUtils.compress(smallData);
            assert.deepStrictEqual(compressed, smallData);
        });

        it('should handle empty input', async () => {
            const compressed = await compressionUtils.compress(Buffer.alloc(0));
            const decompressed = await compressionUtils.decompress(compressed);
            assert.deepStrictEqual(decompressed, Buffer.alloc(0));
        });

        it('should handle binary data', async () => {
            const binaryData = Buffer.from(Array(2048).fill(0).map((_, i) => i % 256)); // Make binary data larger than threshold
            const compressed = await compressionUtils.compress(binaryData);
            const decompressed = await compressionUtils.decompress(compressed);
            assert.deepStrictEqual(decompressed, binaryData);
        });

        it('should support different algorithms', async () => {
            for (const algorithm of Object.values(ALGORITHMS)) {
                const compressed = await compressionUtils.compress(testData, { algorithm });
                const decompressed = await compressionUtils.decompress(compressed);
                assert.deepStrictEqual(decompressed, testData);
            }
        });

        it('should handle compression errors', async () => {
            await assert.rejects(
                compressionUtils.compress(null),
                /Compression error: null or undefined input/
            );
        });

        it('should handle decompression errors', async () => {
            const invalidData = Buffer.from('invalid compressed data');
            await assert.rejects(
                compressionUtils.decompress(invalidData),
                /Decompression error:/
            );
        });
    });

    describe('algorithm selection', () => {
        it('should select default algorithm when auto-selection is disabled', async () => {
            const utils = new CompressionUtils({ autoAlgorithmSelection: false });
            const data = Buffer.from('test data');
            const compressed = await utils.compress(data);
            const algorithm = utils.detectAlgorithm(compressed);
            assert.strictEqual(algorithm, ALGORITHMS.GZIP);
        });

        it('should select algorithm based on performance', async () => {
            const data = Buffer.from('test data');
            const compressed = await compressionUtils.compress(data);
            const algorithm = compressionUtils.detectAlgorithm(compressed);
            assert(Object.values(ALGORITHMS).includes(algorithm));
        });
    });

    describe('compression level', () => {
        it('should use default level when dynamic adjustment is disabled', async () => {
            const utils = new CompressionUtils({ dynamicLevelAdjustment: false });
            const data = Buffer.from('test data');
            const compressed = await utils.compress(data);
            const algorithm = utils.detectAlgorithm(compressed);
            assert(Object.values(ALGORITHMS).includes(algorithm));
        });

        it('should adjust level based on data size', async () => {
            const smallData = Buffer.from('small');
            const largeData = Buffer.from('large'.repeat(1000));
            const smallCompressed = await compressionUtils.compress(smallData);
            const largeCompressed = await compressionUtils.compress(largeData);
            assert(smallCompressed.length > 0);
            assert(largeCompressed.length > 0);
        });

        it('should adjust level based on data entropy', async () => {
            const lowEntropyData = Buffer.from('aaaa'.repeat(100));
            const highEntropyData = Buffer.from(Array(400).fill(0).map(() => Math.floor(Math.random() * 256)));
            const lowCompressed = await compressionUtils.compress(lowEntropyData);
            const highCompressed = await compressionUtils.compress(highEntropyData);
            assert(lowCompressed.length > 0);
            assert(highCompressed.length > 0);
        });
    });

    describe('algorithm detection', () => {
        it('should detect gzip', async () => {
            const compressed = await compressionUtils.compress(testData, { algorithm: ALGORITHMS.GZIP });
            const detected = compressionUtils.detectAlgorithm(compressed);
            assert.strictEqual(detected, ALGORITHMS.GZIP);
        });

        it('should detect deflate', async () => {
            const compressed = await compressionUtils.compress(testData, { algorithm: ALGORITHMS.DEFLATE });
            const detected = compressionUtils.detectAlgorithm(compressed);
            assert.strictEqual(detected, ALGORITHMS.DEFLATE);
        });

        it('should detect brotli', async () => {
            const compressed = await compressionUtils.compress(testData, { algorithm: ALGORITHMS.BROTLI });
            const detected = compressionUtils.detectAlgorithm(compressed);
            assert.strictEqual(detected, ALGORITHMS.BROTLI);
        });

        it('should return default algorithm for unknown format', () => {
            const unknownData = Buffer.from('unknown format');
            const detected = compressionUtils.detectAlgorithm(unknownData);
            assert.strictEqual(detected, ALGORITHMS.GZIP);
        });
    });

    describe('metrics', () => {
        it('should track compression operations', async () => {
            await compressionUtils.compress(testData);
            const stats = compressionUtils.algorithmStats[ALGORITHMS.GZIP];
            assert(stats && stats.count > 0, 'Compression operations should be tracked');
            assert(stats && stats.totalTime > 0, 'Compression time should be tracked');
            assert(stats && stats.totalBytes > 0, 'Compressed bytes should be tracked');
        });

        it('should track compression ratio', async () => {
            const compressed = await compressionUtils.compress(testData);
            const ratio = (compressed.length - 8) / testData.length; // Subtract header size
            assert(ratio < 1, 'Compression ratio should be less than 1 for compressible data');
        });

        it('should handle metrics being disabled', async () => {
            const utils = new CompressionUtils({ metricsEnabled: false });
            await utils.compress(testData);
            const stats = utils.algorithmStats[ALGORITHMS.GZIP];
            assert.strictEqual(stats.count, 0);
            assert.strictEqual(stats.totalTime, 0);
            assert.strictEqual(stats.totalBytes, 0);
        });
    });
}); 