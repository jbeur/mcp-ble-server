const { Transform } = require('stream');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

// Constants for base64 processing
const BASE64_CHUNK_SIZE = 1024 * 64; // 64KB chunks for optimal performance
const BASE64_LOOKUP = new Uint8Array(256);
const BASE64_ENCODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');

// Initialize base64 lookup table
for (let i = 0; i < BASE64_ENCODE.length; i++) {
    BASE64_LOOKUP[BASE64_ENCODE[i].charCodeAt(0)] = i;
}

class Base64Layer {
    constructor() {
        this.metrics = {
            encodeCount: 0,
            decodeCount: 0,
            encodeTime: 0,
            decodeTime: 0,
            streamEncodeCount: 0,
            streamDecodeCount: 0
        };

        // Bind methods
        this.encode = this.encode.bind(this);
        this.decode = this.decode.bind(this);
        this.createEncodeStream = this.createEncodeStream.bind(this);
        this.createDecodeStream = this.createDecodeStream.bind(this);
    }

    /**
     * Fast base64 encoding with buffered processing
     * @param {Buffer|string} data - Data to encode
     * @returns {string} Base64 encoded string
     */
    encode(data) {
        const startTime = process.hrtime();
        try {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            let result = '';
            
            // Process in chunks for better memory usage
            for (let i = 0; i < buffer.length; i += BASE64_CHUNK_SIZE) {
                const chunk = buffer.slice(i, i + BASE64_CHUNK_SIZE);
                result += chunk.toString('base64');
            }

            this.metrics.encodeCount++;
            const [s, ns] = process.hrtime(startTime);
            this.metrics.encodeTime += s * 1000 + ns / 1e6;
            metrics.histogram('base64.encode.time', this.metrics.encodeTime);

            return result;
        } catch (error) {
            logger.error('Base64 encoding error', { error });
            throw error;
        }
    }

    /**
     * Fast base64 decoding with buffered processing
     * @param {string} data - Base64 encoded string
     * @returns {Buffer} Decoded data
     */
    decode(data) {
        const startTime = process.hrtime();
        try {
            // Validate base64 format
            if (!this.isValidBase64(data)) {
                throw new Error('Invalid base64 string');
            }

            let result = Buffer.alloc(0);
            
            // Process in chunks for better memory usage
            for (let i = 0; i < data.length; i += BASE64_CHUNK_SIZE) {
                const chunk = data.slice(i, i + BASE64_CHUNK_SIZE);
                const decoded = Buffer.from(chunk, 'base64');
                result = Buffer.concat([result, decoded]);
            }

            this.metrics.decodeCount++;
            const [s, ns] = process.hrtime(startTime);
            this.metrics.decodeTime += s * 1000 + ns / 1e6;
            metrics.histogram('base64.decode.time', this.metrics.decodeTime);

            return result;
        } catch (error) {
            logger.error('Base64 decoding error', { error });
            throw error;
        }
    }

    /**
     * Create a transform stream for base64 encoding
     * @returns {Transform} Transform stream
     */
    createEncodeStream() {
        this.metrics.streamEncodeCount++;
        let remainder = Buffer.alloc(0);

        return new Transform({
            transform: (chunk, encoding, callback) => {
                try {
                    // Combine with any remainder from previous chunk
                    const buffer = Buffer.concat([remainder, chunk]);
                    
                    // Process complete blocks of 3 bytes (which encode to 4 base64 chars)
                    const blockSize = Math.floor(buffer.length / 3) * 3;
                    remainder = buffer.slice(blockSize);
                    
                    if (blockSize > 0) {
                        callback(null, buffer.slice(0, blockSize).toString('base64'));
                    } else {
                        callback();
                    }
                } catch (error) {
                    logger.error('Base64 encode stream error', { error });
                    callback(error);
                }
            },
            flush: (callback) => {
                try {
                    // Encode any remaining bytes
                    if (remainder.length > 0) {
                        callback(null, remainder.toString('base64'));
                    } else {
                        callback();
                    }
                } catch (error) {
                    logger.error('Base64 encode stream flush error', { error });
                    callback(error);
                }
            }
        });
    }

    /**
     * Create a transform stream for base64 decoding
     * @returns {Transform} Transform stream
     */
    createDecodeStream() {
        this.metrics.streamDecodeCount++;
        let remainder = '';

        return new Transform({
            transform: (chunk, encoding, callback) => {
                try {
                    // Combine with any remainder from previous chunk
                    const base64Str = remainder + chunk.toString();
                    
                    // Process complete blocks of 4 base64 chars (which decode to 3 bytes)
                    const blockSize = Math.floor(base64Str.length / 4) * 4;
                    remainder = base64Str.slice(blockSize);
                    
                    if (blockSize > 0) {
                        const blockStr = base64Str.slice(0, blockSize);
                        if (!this.isValidBase64(blockStr)) {
                            throw new Error('Invalid base64 string in stream');
                        }
                        callback(null, Buffer.from(blockStr, 'base64'));
                    } else {
                        callback();
                    }
                } catch (error) {
                    logger.error('Base64 decode stream error', { error });
                    callback(error);
                }
            },
            flush: (callback) => {
                try {
                    // Decode any remaining chars
                    if (remainder.length > 0) {
                        if (!this.isValidBase64(remainder)) {
                            throw new Error('Invalid base64 string in stream');
                        }
                        callback(null, Buffer.from(remainder, 'base64'));
                    } else {
                        callback();
                    }
                } catch (error) {
                    logger.error('Base64 decode stream flush error', { error });
                    callback(error);
                }
            }
        });
    }

    /**
     * Validate base64 string format
     * @param {string} str - String to validate
     * @returns {boolean} True if valid base64
     */
    isValidBase64(str) {
        return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
    }

    /**
     * Get current metrics
     * @returns {object} Metrics object
     */
    getMetrics() {
        return {
            ...this.metrics,
            averageEncodeTime: this.metrics.encodeCount > 0 ? 
                this.metrics.encodeTime / this.metrics.encodeCount : 0,
            averageDecodeTime: this.metrics.decodeCount > 0 ? 
                this.metrics.decodeTime / this.metrics.decodeCount : 0
        };
    }
}

module.exports = Base64Layer; 