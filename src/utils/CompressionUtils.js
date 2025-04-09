const zlib = require('zlib');
const { promisify } = require('util');
const { logger } = require('./logger');

const ALGORITHMS = {
  GZIP: 'gzip',
  DEFLATE: 'deflate',
  BROTLI: 'brotli'
};

const ALGORITHM_INDICES = {
  [ALGORITHMS.GZIP]: 0,
  [ALGORITHMS.DEFLATE]: 1,
  [ALGORITHMS.BROTLI]: 2
};

const MAGIC_NUMBERS = {
  [ALGORITHMS.GZIP]: Buffer.from([0x1f, 0x8b]),
  [ALGORITHMS.DEFLATE]: Buffer.from([0x78, 0x9c]),
  [ALGORITHMS.BROTLI]: Buffer.from([0x0b, 0x07])
};

const HEADER_MAGIC = Buffer.from([0x4D, 0x43, 0x50]); // "MCP"
const HEADER_VERSION = 1;
const HEADER_SIZE = 8; // Magic (3) + Version (1) + Algorithm (1) + Level (1) + Length (2)

const DEFAULT_CONFIG = {
  defaultAlgorithm: ALGORITHMS.GZIP,
  compressionThreshold: 1024,
  maxCompressionLevel: 9,
  minCompressionLevel: 1,
  defaultCompressionLevel: 6,
  autoAlgorithmSelection: true,
  dynamicLevelAdjustment: true,
  metricsEnabled: true
};

class CompressionUtils {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.algorithmStats = {};
    this.versionStats = {
      v1: { count: 0, totalTime: 0, totalBytes: 0, avgRatio: 0, errors: 0 },
      legacy: { count: 0, totalTime: 0, totalBytes: 0, avgRatio: 0, errors: 0 }
    };
    this.validateConfig();
  }

  validateConfig() {
    if (!Object.values(ALGORITHMS).includes(this.config.defaultAlgorithm)) {
      throw new Error('Invalid default algorithm');
    }
    if (this.config.compressionThreshold < 0) {
      throw new Error('Compression threshold must be non-negative');
    }
    if (this.config.maxCompressionLevel < this.config.minCompressionLevel) {
      throw new Error('Max compression level must be greater than or equal to min compression level');
    }
    if (this.config.defaultCompressionLevel < this.config.minCompressionLevel || 
            this.config.defaultCompressionLevel > this.config.maxCompressionLevel) {
      throw new Error('Default compression level must be between min and max levels');
    }
  }

  initializeAlgorithmStats() {
    Object.values(ALGORITHMS).forEach(algorithm => {
      this.algorithmStats[algorithm] = {
        count: 0,
        totalTime: 0,
        totalBytes: 0,
        avgRatio: 0
      };
    });
  }

  detectAlgorithm(data) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }
    if (data.length === 0) {
      return this.config.defaultAlgorithm;
    }

    // Check for custom header first
    if (data.length >= HEADER_SIZE) {
      const header = data.slice(0, HEADER_SIZE);
      if (header[0] === HEADER_MAGIC[0] && header[1] === HEADER_MAGIC[1] && header[2] === HEADER_MAGIC[2]) {
        const algorithmIndex = header[3];
        if (algorithmIndex < Object.values(ALGORITHMS).length) {
          return Object.values(ALGORITHMS)[algorithmIndex];
        }
      }
    }

    // Check magic numbers for each algorithm
    for (const [algorithm, magic] of Object.entries(MAGIC_NUMBERS)) {
      if (data.length >= magic.length && data.slice(0, magic.length).equals(magic)) {
        return algorithm;
      }
    }

    return this.config.defaultAlgorithm;
  }

  getVersion(data) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    // Check for custom header
    if (data.length >= HEADER_SIZE) {
      const header = data.slice(0, HEADER_SIZE);
      if (header[0] === HEADER_MAGIC[0] && header[1] === HEADER_MAGIC[1] && header[2] === HEADER_MAGIC[2]) {
        const version = header[3];
        if (version === HEADER_VERSION) {
          return 1;
        }
        return -1; // Invalid version
      }
    }

    // Check for legacy format (gzip magic numbers)
    if (data.length >= MAGIC_NUMBERS[ALGORITHMS.GZIP].length) {
      const magic = data.slice(0, MAGIC_NUMBERS[ALGORITHMS.GZIP].length);
      if (magic.equals(MAGIC_NUMBERS[ALGORITHMS.GZIP])) {
        return 0; // Legacy format
      }
    }

    return -1; // Unknown format
  }

  getSupportedFeatures(data) {
    const version = this.getVersion(data);
    if (version === -1) {
      throw new Error('Unsupported compression format');
    }

    if (version === 0) {
      return {
        version: 0,
        algorithms: ['gzip'],
        compressionLevels: false,
        metrics: false
      };
    }

    return {
      version: 1,
      algorithms: ['gzip', 'deflate', 'brotli'],
      compressionLevels: true,
      metrics: true
    };
  }

  getVersionStats() {
    return this.versionStats;
  }

  async compressLegacy(data) {
    if (!data) {
      throw new Error('Compression error: null or undefined input');
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length < this.config.compressionThreshold) {
      logger.debug('Data size below threshold, skipping compression');
      return buffer;
    }

    const startTime = process.hrtime.bigint();
    try {
      const compressed = await promisify(zlib.gzip)(buffer, { level: this.config.defaultCompressionLevel });
      const endTime = process.hrtime.bigint();
      const elapsedTime = Number(endTime - startTime) / 1_000_000;

      this.versionStats.legacy.count++;
      this.versionStats.legacy.totalTime += elapsedTime;
      this.versionStats.legacy.totalBytes += buffer.length;
      const ratio = compressed.length / buffer.length;
      this.versionStats.legacy.avgRatio = 
                ((this.versionStats.legacy.avgRatio * (this.versionStats.legacy.count - 1)) + ratio) / 
                this.versionStats.legacy.count;

      return compressed;
    } catch (error) {
      this.versionStats.legacy.errors++;
      throw error;
    }
  }

  async compress(data, options = {}) {
    if (!data) {
      throw new Error('Compression error: null or undefined input');
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length < this.config.compressionThreshold) {
      logger.debug('Data size below threshold, skipping compression');
      return buffer;
    }

    const algorithm = options.algorithm || this.selectAlgorithm(buffer);
    const level = options.level || this.selectLevel(buffer);
    const startTime = process.hrtime.bigint();

    try {
      let compressed;
      switch (algorithm) {
      case ALGORITHMS.GZIP:
        compressed = await promisify(zlib.gzip)(buffer, { level });
        break;
      case ALGORITHMS.DEFLATE:
        compressed = await promisify(zlib.deflate)(buffer, { level });
        break;
      case ALGORITHMS.BROTLI:
        compressed = await promisify(zlib.brotliCompress)(buffer, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level }
        });
        break;
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }

      const endTime = process.hrtime.bigint();
      const elapsedTime = Number(endTime - startTime) / 1_000_000;

      // Add custom header
      const header = Buffer.alloc(HEADER_SIZE);
      HEADER_MAGIC.copy(header, 0);
      header[3] = HEADER_VERSION;
      header[4] = ALGORITHM_INDICES[algorithm];
      header[5] = level;
      header.writeUInt16BE(compressed.length, 6);

      const result = Buffer.concat([header, compressed]);
            
      // Update version stats
      this.versionStats.v1.count++;
      this.versionStats.v1.totalTime += elapsedTime;
      this.versionStats.v1.totalBytes += buffer.length;
      const ratio = result.length / buffer.length;
      this.versionStats.v1.avgRatio = 
                ((this.versionStats.v1.avgRatio * (this.versionStats.v1.count - 1)) + ratio) / 
                this.versionStats.v1.count;

      // Update algorithm stats
      this.updateMetrics(algorithm, buffer.length, compressed.length, elapsedTime);
            
      return result;
    } catch (error) {
      this.versionStats.v1.errors++;
      throw error;
    }
  }

  async decompress(data) {
    if (!data) {
      throw new Error('Decompression error: null or undefined input');
    }

    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    if (data.length === 0) {
      return data;
    }

    const version = this.getVersion(data);
    if (version === -1) {
      throw new Error('Unsupported compression format');
    }

    try {
      if (version === 0) {
        // Legacy format (gzip)
        return await promisify(zlib.gunzip)(data);
      }

      // Version 1 format
      const header = data.slice(0, HEADER_SIZE);
      const algorithmIndex = header[4];
      const level = header[5];
      const compressedLength = header.readUInt16BE(6);

      if (data.length < HEADER_SIZE + compressedLength) {
        throw new Error('Invalid compressed data length');
      }

      const compressedData = data.slice(HEADER_SIZE, HEADER_SIZE + compressedLength);
      const algorithm = Object.values(ALGORITHMS)[algorithmIndex];

      if (!algorithm) {
        throw new Error('Invalid algorithm index in header');
      }

      switch (algorithm) {
      case ALGORITHMS.GZIP:
        return await promisify(zlib.gunzip)(compressedData);
      case ALGORITHMS.DEFLATE:
        return await promisify(zlib.inflate)(compressedData);
      case ALGORITHMS.BROTLI:
        return await promisify(zlib.brotliDecompress)(compressedData);
      default:
        throw new Error('Unsupported algorithm in header');
      }
    } catch (error) {
      if (version === 0) {
        this.versionStats.legacy.errors++;
      } else {
        this.versionStats.v1.errors++;
      }
      throw new Error('Decompression error: ' + error.message);
    }
  }

  selectAlgorithm(data) {
    if (!this.config.autoAlgorithmSelection) {
      return this.config.defaultAlgorithm;
    }

    // For now, just use the default algorithm
    // In the future, we could implement more sophisticated selection based on data characteristics
    return this.config.defaultAlgorithm;
  }

  selectLevel(data) {
    if (!this.config.dynamicLevelAdjustment) {
      return this.config.defaultCompressionLevel;
    }

    // Adjust level based on data size
    if (data.length < 1024) {
      return this.config.minCompressionLevel;
    } else if (data.length > 1024 * 1024) {
      return this.config.maxCompressionLevel;
    }

    // For medium-sized data, use default level
    return this.config.defaultCompressionLevel;
  }

  updateMetrics(algorithm, inputSize, outputSize, elapsedTime) {
    if (!this.config.metricsEnabled) {
      return;
    }

    if (!this.algorithmStats[algorithm]) {
      this.algorithmStats[algorithm] = {
        count: 0,
        totalTime: 0,
        totalBytes: 0,
        avgRatio: 0
      };
    }

    const stats = this.algorithmStats[algorithm];
    stats.count++;
    stats.totalTime += elapsedTime;
    stats.totalBytes += inputSize;
    const ratio = outputSize / inputSize;
    stats.avgRatio = ((stats.avgRatio * (stats.count - 1)) + ratio) / stats.count;

    logger.debug('Compression metrics:', {
      algorithm,
      inputSize,
      outputSize,
      ratio,
      elapsedMillis: elapsedTime,
      stats
    });
  }
}

module.exports = {
  CompressionUtils,
  ALGORITHMS
};