const { logger } = require('../../utils/logger');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class BatchCompressor {
  constructor(config = {}) {
    this.config = {
      enabled: true,
      type: 'gzip',
      level: zlib.constants.Z_BEST_COMPRESSION,
      priorityThresholds: {
        high: 500,   // bytes
        medium: 1000, // bytes
        low: 2000    // bytes
      },
      ...config
    };

    this.metrics = {
      totalCompressed: 0,
      totalUncompressed: 0,
      totalBytesSaved: 0,
      compressionRatio: 0,
      errors: {
        compression: 0,
        decompression: 0
      },
      compressionTimes: {
        high: { total: 0, count: 0 },
        medium: { total: 0, count: 0 },
        low: { total: 0, count: 0 }
      }
    };
  }

  async compress(batch, priority = 'medium') {
    try {
      if (!this.config.enabled) {
        return batch;
      }

      const batchString = JSON.stringify(batch);
      const batchSize = Buffer.from(batchString).length;
      const threshold = this.config.priorityThresholds[priority];

      if (batchSize < threshold) {
        this.metrics.totalUncompressed++;
        return {
          compressed: false,
          data: batch,
          originalSize: batchSize,
          compressedSize: batchSize
        };
      }

      const startTime = process.hrtime();
      const compressed = await gzip(batchString, {
        level: this.config.level
      });
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const compressionTime = seconds * 1000 + nanoseconds / 1000000;

      // Update metrics
      this.metrics.totalCompressed++;
      this.metrics.totalBytesSaved += (batchSize - compressed.length);
      this.metrics.compressionRatio = 
        this.metrics.totalBytesSaved / 
        (this.metrics.totalCompressed + this.metrics.totalUncompressed);
            
      this.metrics.compressionTimes[priority].total += compressionTime;
      this.metrics.compressionTimes[priority].count++;

      return {
        compressed: true,
        algorithm: this.config.type,
        data: compressed,
        originalSize: batchSize,
        compressedSize: compressed.length,
        compressionRatio: (batchSize - compressed.length) / batchSize,
        compressionTime
      };
    } catch (error) {
      logger.error('Error compressing batch:', { error, priority });
      this.metrics.errors.compression++;
      return {
        compressed: false,
        data: batch,
        error: error.message
      };
    }
  }

  async decompress(data) {
    try {
      if (!data.compressed) {
        return data.data;
      }

      const decompressed = await gunzip(data.data);
      return JSON.parse(decompressed.toString());
    } catch (error) {
      logger.error('Error decompressing batch:', { error });
      this.metrics.errors.decompression++;
      throw error;
    }
  }

  isCompressionEnabled() {
    return this.config.enabled;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  resetMetrics() {
    this.metrics = {
      totalCompressed: 0,
      totalUncompressed: 0,
      totalBytesSaved: 0,
      compressionRatio: 0,
      errors: {
        compression: 0,
        decompression: 0
      },
      compressionTimes: {
        high: { total: 0, count: 0 },
        medium: { total: 0, count: 0 },
        low: { total: 0, count: 0 }
      }
    };
  }
}

module.exports = BatchCompressor; 