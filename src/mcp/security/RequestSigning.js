const crypto = require('crypto');

class RequestSigning {
  constructor(config, metrics) {
    this.algorithm = config?.security?.requestSigning?.algorithm || 'sha256';
    this.secret = config?.security?.requestSigning?.secret;
    this.timestampTolerance = config?.security?.requestSigning?.timestampTolerance || 300;
    this.requiredHeaders = config?.security?.requestSigning?.requiredHeaders || ['x-client-id', 'x-timestamp', 'x-signature'];
    this.metrics = metrics;
    this.logger = console;
  }

  _createSignaturePayload(request) {
    const timestamp = request.headers['x-timestamp'];
    const clientId = request.headers['x-client-id'];
    const body = request.body ? JSON.stringify(request.body) : '';
    return `${request.method}${request.path}${clientId}${timestamp}${body}`;
  }

  _validateTimestamp(timestamp) {
    const now = Date.now();
    const requestTime = parseInt(timestamp, 10);

    if (isNaN(requestTime)) {
      throw new Error('Invalid timestamp format');
    }

    if (requestTime > now) {
      throw new Error('Request timestamp is in the future');
    }

    if (now - requestTime > this.timestampTolerance * 1000) {
      throw new Error('Request timestamp expired');
    }

    return true;
  }

  signRequest(request) {
    try {
      if (!request.headers) {
        request.headers = {};
      }

      const payload = this._createSignaturePayload(request);
      const hmac = crypto.createHmac(this.algorithm, this.secret);
      const signature = hmac.update(payload).digest('hex');
      request.headers['x-signature'] = signature;

      if (this.metrics?.requestSigningSuccess?.inc) {
        this.metrics.requestSigningSuccess.inc();
      }

      return request;
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('Failed to sign request:', error);
      }
      if (this.metrics?.requestSigningError?.inc) {
        this.metrics.requestSigningError.inc();
      }
      throw new Error('Failed to sign request');
    }
  }

  verifyRequest(request) {
    try {
      // Check required headers
      for (const header of this.requiredHeaders) {
        if (!request.headers?.[header]) {
          if (this.metrics?.requestVerificationError?.inc) {
            this.metrics.requestVerificationError.inc();
          }
          throw new Error('Missing required headers');
        }
      }

      // Validate timestamp
      this._validateTimestamp(request.headers['x-timestamp']);

      // Verify signature
      const receivedSignature = request.headers['x-signature'];
      const payload = this._createSignaturePayload(request);
      const hmac = crypto.createHmac(this.algorithm, this.secret);
      const expectedSignature = hmac.update(payload).digest('hex');

      if (expectedSignature !== receivedSignature) {
        if (this.metrics?.requestVerificationError?.inc) {
          this.metrics.requestVerificationError.inc();
        }
        throw new Error('Invalid signature');
      }

      if (this.metrics?.requestVerificationSuccess?.inc) {
        this.metrics.requestVerificationSuccess.inc();
      }

      return true;
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('Request verification failed:', error);
      }
      if (this.metrics?.requestVerificationError?.inc) {
        this.metrics.requestVerificationError.inc();
      }

      // Preserve specific error messages
      if (error.message === 'Missing required headers' ||
                error.message === 'Invalid signature' ||
                error.message === 'Request timestamp expired' ||
                error.message === 'Request timestamp is in the future' ||
                error.message === 'Invalid timestamp format') {
        throw error;
      }

      // For crypto errors or other unexpected errors
      throw new Error('Failed to verify request');
    }
  }
}

module.exports = RequestSigning; 