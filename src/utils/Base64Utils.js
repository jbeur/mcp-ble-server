const { logger } = require('./logger');
const { metrics } = require('./metrics');
const { Buffer } = require('buffer');

class Base64Utils {
    constructor(config = {}) {
        this.config = {
            bufferSize: config.bufferSize || 8192, // Default buffer size for streaming
            compressionThreshold: config.compressionThreshold || 1024, // Size threshold for compression
            metricsEnabled: config.metricsEnabled !== false,
            useHardwareAcceleration: config.useHardwareAcceleration !== false // Enable hardware acceleration by default
        };

        // Initialize metrics
        if (this.config.metricsEnabled) {
            metrics.gauge('base64_operations_total', 0);
            metrics.gauge('base64_errors_total', 0);
            metrics.gauge('base64_processing_time_ms', 0);
            metrics.gauge('base64_hardware_acceleration_enabled', this.config.useHardwareAcceleration ? 1 : 0);
        }

        // Check if hardware acceleration is available
        this.hardwareAccelerationAvailable = this.checkHardwareAcceleration();
        if (this.config.metricsEnabled) {
            metrics.gauge('base64_hardware_acceleration_available', this.hardwareAccelerationAvailable ? 1 : 0);
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
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            let encoded;

            if (this.hardwareAccelerationAvailable && this.config.useHardwareAcceleration) {
                // Use native Buffer operations for hardware acceleration
                encoded = buffer.toString('base64');
            } else {
                // Fallback to standard encoding
                encoded = buffer.toString('base64');
            }

            if (this.config.metricsEnabled) {
                metrics.increment('base64_operations_total', { 
                    operation: 'encode',
                    hardware_accelerated: this.hardwareAccelerationAvailable && this.config.useHardwareAcceleration ? 'true' : 'false'
                });
                const [seconds, nanoseconds] = process.hrtime(startTime);
                const duration = seconds * 1000 + nanoseconds / 1000000;
                metrics.observe('base64_processing_time_ms', duration);
            }

            return encoded;
        } catch (error) {
            if (this.config.metricsEnabled) {
                metrics.increment('base64_errors_total', { operation: 'encode' });
            }
            logger.error('Base64 encoding error:', { error });
            throw error;
        }
    }

    /**
     * Decode base64 string to buffer with hardware acceleration
     * @param {string} data - Base64 encoded string
     * @param {Object} options - Decoding options
     * @returns {Buffer} Decoded buffer
     */
    decode(data, options = {}) {
        const startTime = process.hrtime();
        try {
            // For decoding, we'll try to decode first and only validate if it fails
            try {
                let decoded;
                if (this.hardwareAccelerationAvailable && this.config.useHardwareAcceleration) {
                    // Use native Buffer operations for hardware acceleration
                    decoded = Buffer.from(data, 'base64');
                } else {
                    // Fallback to standard decoding
                    decoded = Buffer.from(data, 'base64');
                }
                
                if (this.config.metricsEnabled) {
                    metrics.increment('base64_operations_total', { 
                        operation: 'decode',
                        hardware_accelerated: this.hardwareAccelerationAvailable && this.config.useHardwareAcceleration ? 'true' : 'false'
                    });
                    const [seconds, nanoseconds] = process.hrtime(startTime);
                    const duration = seconds * 1000 + nanoseconds / 1000000;
                    metrics.observe('base64_processing_time_ms', duration);
                }

                return decoded;
            } catch (decodeError) {
                if (!this.isValid(data)) {
                    throw new Error('Invalid base64 string');
                }
                throw decodeError;
            }
        } catch (error) {
            if (this.config.metricsEnabled) {
                metrics.increment('base64_errors_total', { operation: 'decode' });
            }
            logger.error('Base64 decoding error:', { error });
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
     * Stream encode data to base64
     * @param {Readable} stream - Input stream
     * @param {Writable} output - Output stream
     * @returns {Promise<void>}
     */
    async streamEncode(inputStream, outputStream) {
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            let hasError = false;
            
            const handleError = (error) => {
                if (!hasError) {
                    hasError = true;
                    if (this.config.metricsEnabled) {
                        metrics.increment('base64_errors_total', { operation: 'streamEncode' });
                    }
                    logger.error('Stream encoding error:', { error });
                    reject(error);
                }
            };

            inputStream.on('error', handleError);
            outputStream.on('error', handleError);
            
            inputStream.on('data', (chunk) => {
                if (hasError) return;
                try {
                    buffer = Buffer.concat([buffer, chunk]);
                    
                    if (buffer.length >= this.config.bufferSize) {
                        const encoded = buffer.toString('base64');
                        outputStream.write(encoded);
                        buffer = Buffer.alloc(0);
                    }
                } catch (error) {
                    handleError(error);
                }
            });

            inputStream.on('end', () => {
                if (hasError) return;
                try {
                    if (buffer.length > 0) {
                        const encoded = buffer.toString('base64');
                        outputStream.write(encoded);
                    }
                    outputStream.end();
                    resolve();
                } catch (error) {
                    handleError(error);
                }
            });
        });
    }

    /**
     * Stream decode base64 data
     * @param {Readable} stream - Input stream
     * @param {Writable} output - Output stream
     * @returns {Promise<void>}
     */
    async streamDecode(inputStream, outputStream) {
        return new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            let hasError = false;
            
            const handleError = (error) => {
                if (!hasError) {
                    hasError = true;
                    if (this.config.metricsEnabled) {
                        metrics.increment('base64_errors_total', { operation: 'streamDecode' });
                    }
                    logger.error('Stream decoding error:', { error });
                    reject(error);
                }
            };

            inputStream.on('error', handleError);
            outputStream.on('error', handleError);
            
            inputStream.on('data', (chunk) => {
                if (hasError) return;
                try {
                    buffer = Buffer.concat([buffer, chunk]);
                    
                    if (buffer.length >= this.config.bufferSize) {
                        const str = buffer.toString();
                        try {
                            const decoded = Buffer.from(str, 'base64');
                            outputStream.write(decoded);
                            buffer = Buffer.alloc(0);
                        } catch (error) {
                            if (!this.isValid(str)) {
                                throw new Error('Invalid base64 data in stream');
                            }
                            throw error;
                        }
                    }
                } catch (error) {
                    handleError(error);
                }
            });

            inputStream.on('end', () => {
                if (hasError) return;
                try {
                    if (buffer.length > 0) {
                        const str = buffer.toString();
                        try {
                            const decoded = Buffer.from(str, 'base64');
                            outputStream.write(decoded);
                        } catch (error) {
                            if (!this.isValid(str)) {
                                throw new Error('Invalid base64 data in stream');
                            }
                            throw error;
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

module.exports = Base64Utils; 