const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class RequestSigning {
    constructor(config, metrics) {
        if (!config) {
            throw new Error('Configuration is required');
        }
        this.config = config;
        this.metrics = metrics;
        
        // Default configuration
        this.algorithm = this.config.security?.requestSigning?.algorithm || 'sha256';
        this.keyLength = this.config.security?.requestSigning?.keyLength || 32;
        this.timestampTolerance = this.config.security?.requestSigning?.timestampTolerance || 5 * 60; // 5 minutes in seconds
        this.requiredHeaders = this.config.security?.requestSigning?.requiredHeaders || ['content-type', 'x-request-id'];
        this.key = this.config.security?.requestSigning?.key || '';
    }

    /**
     * Sign a request with HMAC
     * @param {Object} request - The request to sign
     * @returns {Object} Signature object containing signature and timestamp
     */
    signRequest(request) {
        try {
            if (!request || typeof request !== 'object') {
                throw new Error('Invalid request format');
            }

            // Validate required components
            if (!request.method || !request.path || !request.headers) {
                throw new Error('Invalid request format');
            }

            // Check required headers
            for (const header of this.requiredHeaders) {
                if (!request.headers[header]) {
                    throw new Error(`Missing required header: ${header}`);
                }
            }

            // Create string to sign
            const timestamp = Date.now();
            const stringToSign = this._createStringToSign(request, timestamp);

            // Generate signature
            const signature = this._generateSignature(stringToSign);

            this.metrics?.requestSigningSuccess?.inc();
            return {
                signature,
                timestamp
            };
        } catch (error) {
            logger.error('Failed to sign request:', error);
            this.metrics?.requestSigningError?.inc();
            throw error;
        }
    }

    /**
     * Verify a signed request
     * @param {Object} request - The request to verify
     * @param {Object} signature - The signature object containing signature and timestamp
     * @returns {boolean} Whether the request is valid
     */
    verifyRequest(request, signature) {
        try {
            if (!request || !signature || !signature.signature || !signature.timestamp) {
                this.metrics?.requestVerificationError?.inc();
                return false;
            }

            // Check timestamp validity
            const now = Date.now();
            const timestamp = parseInt(signature.timestamp);
            if (isNaN(timestamp) || Math.abs(now - timestamp) > this.timestampTolerance * 1000) {
                this.metrics?.requestVerificationError?.inc();
                return false;
            }

            // Create string to verify
            const stringToVerify = this._createStringToSign(request, timestamp);

            // Verify signature
            let expectedSignature;
            try {
                expectedSignature = this._generateSignature(stringToVerify);
            } catch (error) {
                logger.error('Failed to generate verification signature:', error);
                this.metrics?.requestVerificationError?.inc();
                return false;
            }

            try {
                const isValid = crypto.timingSafeEqual(
                    Buffer.from(signature.signature, 'hex'),
                    Buffer.from(expectedSignature, 'hex')
                );

                if (isValid) {
                    this.metrics?.requestVerificationSuccess?.inc();
                } else {
                    this.metrics?.requestVerificationError?.inc();
                }

                return isValid;
            } catch (error) {
                logger.error('Failed to compare signatures:', error);
                this.metrics?.requestVerificationError?.inc();
                return false;
            }
        } catch (error) {
            logger.error('Failed to verify request:', error);
            this.metrics?.requestVerificationError?.inc();
            return false;
        }
    }

    /**
     * Create the string to sign from request components
     * @private
     */
    _createStringToSign(request, timestamp) {
        const components = [
            request.method.toUpperCase(),
            request.path,
            timestamp.toString()
        ];

        // Add required headers
        for (const header of this.requiredHeaders) {
            components.push(request.headers[header]);
        }

        // Add body if present
        if (request.body) {
            const bodyString = typeof request.body === 'string' 
                ? request.body 
                : JSON.stringify(request.body);
            components.push(bodyString);
        }

        return components.join('\n');
    }

    /**
     * Generate HMAC signature
     * @private
     */
    _generateSignature(stringToSign) {
        try {
            const hmac = crypto.createHmac(this.algorithm, this.key);
            hmac.update(stringToSign);
            return hmac.digest('hex');
        } catch (error) {
            logger.error('Failed to generate signature:', error);
            throw new Error('Invalid signature algorithm');
        }
    }
}

module.exports = RequestSigning; 