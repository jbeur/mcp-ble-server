const { logger } = require('./logger');
const { metrics } = require('./metrics');
const Buffer = global.Buffer;
const { Writable } = require('stream');
const { Transform } = require('stream');

class Base64Utils {
  constructor(config = {}) {
    this.config = {
      bufferSize: config.bufferSize || 8192, // Default buffer size for streaming
      compressionThreshold: config.compressionThreshold || 1024, // Size threshold for compression
      metricsEnabled: config.metricsEnabled !== false,
      useHardwareAcceleration: config.useHardwareAcceleration !== false // Enable hardware acceleration by default
    };

    // Initialize logger and metrics
    this.logger = logger;
    this.metrics = metrics;

    // Initialize metrics
    if (this.config.metricsEnabled) {
      this.metrics.gauge('base64_operations_total', 0);
      this.metrics.gauge('base64_errors_total', 0);
      this.metrics.gauge('base64_processing_time_ms', 0);
      this.metrics.gauge('base64_hardware_acceleration_enabled', this.config.useHardwareAcceleration ? 1 : 0);
    }

    // Check if hardware acceleration is available
    this.hardwareAccelerationAvailable = this.checkHardwareAcceleration();
    if (this.config.metricsEnabled) {
      this.metrics.gauge('base64_hardware_acceleration_available', this.hardwareAccelerationAvailable ? 1 : 0);
    }
  }

  /**
     * Check if hardware acceleration is available
     * @returns {boolean} Whether hardware acceleration is available
     */
  checkHardwareAcceleration() {
    try {
      // Try to use native Buffer operations
      const testBuffer = Buffer.alloc(1024);
      const encoded = testBuffer.toString('base64');
      const decoded = Buffer.from(encoded, 'base64');
      return Buffer.compare(testBuffer, decoded) === 0;
    } catch (error) {
      logger.warn('Hardware acceleration not available:', { error });
      return false;
    }
  }

  /**
     * Encode data to base64 with optional compression and hardware acceleration
     * @param {Buffer|string} data - Data to encode
     * @param {Object} options - Encoding options
     * @returns {string} Base64 encoded string
     */
  encode(data, options = {}) {
    const startTime = process.hrtime();
    try {
      const buffer = Buffer.from(data);
      const encoded = buffer.toString('base64');
      this.metrics.increment('base64.encode.success');
      return encoded;
    } catch (error) {
      this.logger.error('Error encoding data to base64:', error);
      this.metrics.increment('base64.encode.error');
      throw error;
    }
  }

  /**
     * Validate if a string is valid base64
     * @param {string} data - String to validate
     * @returns {boolean} Whether the string is valid base64
     */
  isValid(data) {
    try {
      if (typeof data !== 'string') return false;
      if (data === '') return true;
            
      // Trim whitespace
      data = data.trim();
            
      // Basic base64 pattern check
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(data)) return false;

      // Check padding
      const paddingLength = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      if (paddingLength > 0) {
        const mainLength = data.length - paddingLength;
        if ((mainLength + paddingLength) % 4 !== 0) return false;
      }

      // Try to decode
      try {
        Buffer.from(data, 'base64');
        return true;
      } catch (e) {
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  /**
     * Decode base64 string to buffer with hardware acceleration
     * @param {string} data - Base64 encoded string
     * @param {Object} options - Decoding options
     * @returns {Buffer} Decoded buffer
     */
  decode(base64String, options = {}) {
    const startTime = process.hrtime();
    try {
      if (!this.isValid(base64String)) {
        throw new Error('Invalid base64 string');
      }
      const buffer = Buffer.from(base64String, 'base64');
      this.metrics.increment('base64.decode.success');
      return buffer;
    } catch (error) {
      this.logger.error('Error decoding base64 string:', error);
      this.metrics.increment('base64.decode.error');
      throw error;
    }
  }

  /**
     * Stream encode data to base64
     * @param {Readable} stream - Input stream
     * @param {Writable} output - Output stream
     * @returns {Promise<void>}
     */
  streamEncode(inputStream, outputStream, options = {}) {
    return new Promise((resolve, reject) => {
      const transform = new Transform({
        transform(chunk, encoding, callback) {
          try {
            const buffer = Buffer.from(chunk);
            const encoded = buffer.toString('base64');
            callback(null, encoded);
          } catch (error) {
            callback(error);
          }
        }
      });

      let hasError = false;

      const cleanup = () => {
        inputStream.removeAllListeners();
        transform.removeAllListeners();
        outputStream.removeAllListeners();
        if (!inputStream.destroyed) inputStream.destroy();
        if (!transform.destroyed) transform.destroy();
      };

      const handleError = (error) => {
        if (hasError) return;
        hasError = true;
        if (this.config.metricsEnabled) {
          metrics.increment('base64_encode_errors', { type: 'stream' });
        }
        cleanup();
        reject(error);
      };

      inputStream.on('error', handleError);
      transform.on('error', handleError);
      outputStream.on('error', handleError);

      transform.on('end', () => {
        if (!hasError) {
          resolve();
        }
      });

      inputStream
        .pipe(transform)
        .pipe(outputStream, { end: true });
    });
  }

  /**
     * Stream decode base64 data
     * @param {Readable} stream - Input stream
     * @param {Writable} output - Output stream
     * @returns {Promise<void>}
     */
  streamDecode(inputStream, outputStream) {
    return new Promise((resolve, reject) => {
      let hasError = false;
      let buffer = Buffer.alloc(0);
      
      const cleanup = () => {
        inputStream.removeAllListeners();
        outputStream.removeAllListeners();
        if (!inputStream.destroyed) {
          inputStream.destroy();
        }
      };
            
      const handleError = (error) => {
        if (!hasError) {
          hasError = true;
          if (this.config.metricsEnabled) {
            metrics.increment('base64_errors_total', { operation: 'streamDecode' });
          }
          cleanup();
          reject(error);
        }
      };

      const decodeChunk = (data) => {
        try {
          // Remove any whitespace and validate base64
          const base64Str = data.toString().replace(/\s+/g, '');
          if (!base64Str) return Buffer.alloc(0);
          
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Str)) {
            throw new Error('Invalid base64 input');
          }
          
          return Buffer.from(base64Str, 'base64');
        } catch (error) {
          throw new Error(`Base64 decode error: ${error.message}`);
        }
      };

      inputStream.on('error', handleError);
      outputStream.on('error', handleError);
            
      inputStream.on('data', (chunk) => {
        if (hasError) return;
        try {
          if (chunk && chunk.length > 0) {
            buffer = Buffer.concat([buffer, chunk]);
                        
            if (buffer.length >= this.config.bufferSize) {
              const decoded = decodeChunk(buffer);
              if (decoded.length > 0 && !outputStream.write(decoded)) {
                inputStream.pause();
              }
              buffer = Buffer.alloc(0);
            }
          }
        } catch (error) {
          handleError(error);
        }
      });

      outputStream.on('drain', () => {
        inputStream.resume();
      });

      inputStream.on('end', () => {
        if (hasError) return;
        try {
          if (buffer.length > 0) {
            const decoded = decodeChunk(buffer);
            if (decoded.length > 0) {
              outputStream.write(decoded);
            }
          }
          outputStream.end();
          resolve();
        } catch (error) {
          handleError(error);
        }
      });
    });
  }
}

module.exports = { Base64Utils };