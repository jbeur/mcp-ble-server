const crypto = require('crypto');
const { logger } = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class MessageSecurity {
  constructor(config, metrics) {
    this.config = config || {};
    this.metrics = metrics;
    this.signingKey = this.config.security?.signingKey;
    this.algorithm = this.config.security?.algorithm || 'sha256';
    this.signatureExpiration = this.config.security?.signatureExpiration || 3600; // 1 hour
  }

  /**
     * Sign a message using HMAC-SHA256
     * @param {Object} message - The message to sign
     * @returns {Object} Signed message with signature and timestamp
     */
  signMessage(message) {
    try {
      if (!this.signingKey) {
        throw new Error('Signing key not configured');
      }

      // Use provided timestamp or current time
      const timestamp = message.timestamp || Date.now();
      const messageToSign = {
        ...message,
        timestamp
      };

      // Create HMAC
      const hmac = crypto.createHmac(this.algorithm, this.signingKey);
      hmac.update(JSON.stringify(messageToSign));
      const signature = hmac.digest('hex');

      const signedMessage = {
        ...messageToSign,
        signature
      };

      this.metrics?.messageSigningSuccess?.inc();
      return signedMessage;
    } catch (error) {
      logger.error('Failed to sign message:', error);
      this.metrics?.messageSigningError?.inc();
      throw error;
    }
  }

  /**
     * Verify a message signature
     * @param {Object} signedMessage - The signed message to verify
     * @returns {boolean} Whether the signature is valid
     */
  verifySignature(signedMessage) {
    try {
      if (!this.signingKey) {
        throw new Error('Signing key not configured');
      }

      if (!signedMessage || !signedMessage.signature || !signedMessage.timestamp) {
        logger.error('Invalid signed message format');
        this.metrics?.messageVerificationError?.inc();
        return false;
      }

      // Check if signature has expired
      const now = Date.now();
      const age = (now - signedMessage.timestamp) / 1000; // Convert to seconds
      if (age > this.signatureExpiration) {
        logger.error('Signature has expired');
        this.metrics?.messageVerificationError?.inc();
        return false;
      }

      // Extract signature and create message copy without it
      const { signature, ...messageWithoutSignature } = signedMessage;

      // Create HMAC
      const hmac = crypto.createHmac(this.algorithm, this.signingKey);
      hmac.update(JSON.stringify(messageWithoutSignature));
      const expectedSignature = hmac.digest('hex');

      // Use timing-safe comparison
      let isValid = false;
      try {
        isValid = crypto.timingSafeEqual(
          Buffer.from(signature, 'hex'),
          Buffer.from(expectedSignature, 'hex')
        );
      } catch (error) {
        logger.error('Failed to compare signatures:', error);
        this.metrics?.messageVerificationError?.inc();
        return false;
      }

      if (isValid) {
        this.metrics?.messageVerificationSuccess?.inc();
      } else {
        logger.error('Invalid signature');
        this.metrics?.messageVerificationError?.inc();
      }

      return isValid;
    } catch (error) {
      logger.error('Failed to verify signature:', error);
      this.metrics?.messageVerificationError?.inc();
      return false;
    }
  }

  /**
     * Signs a request object with additional security measures
     * @param {Object} request - The request object to sign
     * @returns {Object} Signed request object
     */
  signRequest(request) {
    try {
      if (!request || typeof request !== 'object') {
        this.metrics?.requestSigningError?.inc();
        throw new Error('Failed to sign request');
      }

      const nonce = crypto.randomBytes(16).toString(this.encoding);
      const timestamp = Date.now();
            
      const requestToSign = {
        ...request,
        nonce,
        timestamp
      };

      const signed = this.signMessage(requestToSign);
      return {
        ...requestToSign,
        signature: signed.signature
      };
    } catch (error) {
      logger.error('Request signing failed:', error.message);
      this.metrics?.requestSigningError?.inc();
      throw new Error('Failed to sign request');
    }
  }
}

module.exports = MessageSecurity; 