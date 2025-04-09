const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class RateLimiter {
  constructor(config = {}) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000; // 1 minute default
    this.maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100; // 100 requests per window default
    this.requests = new Map(); // clientId -> [{timestamp}]
  }

  isRateLimited(clientId) {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Get existing requests for this client
      let clientRequests = this.requests.get(clientId) || [];

      // Remove requests outside the current window
      clientRequests = clientRequests.filter(req => req.timestamp > windowStart);

      // Check if rate limit is exceeded
      if (clientRequests.length >= this.maxRequests) {
        this.metrics.increment('security.rate.limit.exceeded');
        return true;
      }

      // Add new request
      clientRequests.push({ timestamp: now });
      this.requests.set(clientId, clientRequests);

      this.metrics.increment('security.rate.limit.check.success');
      return false;
    } catch (error) {
      this.logger.error('Rate limit check error:', error.message || 'Unknown error');
      this.metrics.increment('security.rate.limit.check.error');
      return true; // Fail closed - rate limit on error
    }
  }

  getRemainingRequests(clientId) {
    try {
      if (!clientId) {
        return 0;
      }

      const now = Date.now();
      const windowStart = now - this.windowMs;
      const clientRequests = this.requests.get(clientId) || [];
      const validRequests = clientRequests.filter(req => req.timestamp > windowStart);

      return Math.max(0, this.maxRequests - validRequests.length);
    } catch (error) {
      this.logger.error('Error getting remaining requests:', error.message || 'Unknown error');
      return 0;
    }
  }

  async cleanup() {
    try {
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Clean up expired requests for all clients
      for (const [clientId, requests] of this.requests.entries()) {
        const validRequests = requests.filter(req => req.timestamp > windowStart);
        if (validRequests.length === 0) {
          this.requests.delete(clientId);
        } else {
          this.requests.set(clientId, validRequests);
        }
      }

      this.logger.info('RateLimiter cleanup completed');
    } catch (error) {
      this.logger.error('Error cleaning up RateLimiter:', error.message || 'Unknown error');
    }
  }

  async stop() {
    try {
      this.requests.clear();
      this.logger.info('RateLimiter stopped');
    } catch (error) {
      this.logger.error('Error stopping RateLimiter:', error.message || 'Unknown error');
    }
  }
}

module.exports = RateLimiter; 