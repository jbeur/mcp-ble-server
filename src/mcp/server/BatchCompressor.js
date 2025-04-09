const { promisify } = require('util');
const zlib = require('zlib');
const { logger } = require('../../utils/logger');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class BatchCompressor {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      minSize: config.minSize || 1024, // 1KB
      level: config.level || 6,
      priorityThresholds: config.priorityThresholds || {
        high: 512,    // 512B
        medium: 1024, // 1KB
        low: 2048     // 2KB
      },
      algorithms: config.algorithms || {
        high: 'gzip',
        medium: 'gzip',
        low: 'gzip'
      }
    };

    this.metrics = {
      totalCompressed: 0,
      totalUncompressed: 0,
      totalBytesSaved: 0,
      compressionRatio: 0,
      compressionTimes: {
        high: { total: 0, count: 0 },
        medium: { total: 0, count: 0 },
        low: { total: 0, count: 0 }
      },
      errors: {
        compression: 0,
        decompression: 0
      }
    };
  }

  async compress(batch, priority = 'medium') {
    try {
      if (!this.config.enabled) {
        return batch;
      }

      const batchSize = JSON.stringify(batch).length;
      const threshold = this.config.priorityThresholds[priority];

      if (batchSize < threshold) {
        this.metrics.totalUncompressed++;
        return batch;
      }

      const startTime = process.hrtime();
      const compressed = await gzip(JSON.stringify(batch), {
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
        algorithm: this.config.algorithms[priority],
        data: compressed,
        originalSize: batchSize,
        compressedSize: compressed.length,
        compressionRatio: this.metrics.compressionRatio,
        compressionTime
      };
    } catch (error) {
      logger.error('Error compressing batch:', { error, priority });
      this.metrics.errors.compression++;
      return batch;
    }
  }

  async decompress(batch) {
    try {
      if (!batch.compressed) return batch;

      const startTime = process.hrtime();
      const decompressed = await gunzip(batch.data);
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const decompressionTime = seconds * 1000 + nanoseconds / 1000000;

      return {
        data: JSON.parse(decompressed.toString()),
        decompressionTime,
        originalSize: batch.originalSize,
        compressedSize: batch.compressedSize
      };
    } catch (error) {
      logger.error('Error decompressing batch:', { error });
      this.metrics.errors.decompression++;
      return batch;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      averageCompressionTimes: Object.entries(this.metrics.compressionTimes).reduce((acc, [priority, data]) => {
        acc[priority] = data.count > 0 ? data.total / data.count : 0;
        return acc;
      }, {})
    };
  }

  resetMetrics() {
    this.metrics = {
      totalCompressed: 0,
      totalUncompressed: 0,
      totalBytesSaved: 0,
      compressionRatio: 0,
      compressionTimes: {
        high: { total: 0, count: 0 },
        medium: { total: 0, count: 0 },
        low: { total: 0, count: 0 }
      },
      errors: {
        compression: 0,
        decompression: 0
      }
    };
  }
}

module.exports = BatchCompressor; 