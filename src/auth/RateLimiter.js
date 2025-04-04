const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class RateLimiter {
    constructor(config = {}) {
        this.windowMs = config.windowMs || 60000; // Default: 1 minute
        this.maxRequests = config.maxRequests || 100; // Default: 100 requests per window
        this.requests = new Map(); // Map<string, Array<number>> - key -> timestamps
        this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
        this.logger = logger;
        this.metrics = metrics;
    }

    /**
     * Check if a key has exceeded its rate limit
     * @param {string} key - The key to check (e.g., IP address, client ID)
     * @returns {boolean} - True if rate limit is exceeded, false otherwise
     */
    isRateLimited(key) {
        try {
            const now = Date.now();
            const windowStart = now - this.windowMs;

            // Get or initialize request timestamps for this key
            if (!this.requests.has(key)) {
                this.requests.set(key, []);
                this.logger.debug(`New rate limit tracking for key: ${key}`);
            }

            // Get request timestamps and filter out old ones
            const timestamps = this.requests.get(key);
            const filteredTimestamps = timestamps.filter(ts => ts > windowStart);

            // Check if rate limit would be exceeded with this request
            if (filteredTimestamps.length >= this.maxRequests) {
                this.logger.info(`Rate limit exceeded for key: ${key}, requests in window: ${filteredTimestamps.length}`);
                this.metrics.increment('security.rate.limit.exceeded');
                return true;
            }

            // Add current timestamp only if not rate limited
            filteredTimestamps.push(now);
            this.requests.set(key, filteredTimestamps);
            this.logger.debug(`Updated requests for key: ${key}, count: ${filteredTimestamps.length}`);

            this.metrics.increment('security.rate.limit.check.success');
            return false;
        } catch (error) {
            this.logger.error('Rate limit check failed:', error);
            this.metrics.increment('security.rate.limit.check.error');
            return false; // Fail open to prevent blocking legitimate traffic
        }
    }

    /**
     * Clean up old request records
     */
    cleanup() {
        try {
            const now = Date.now();
            const windowStart = now - this.windowMs;

            for (const [key, timestamps] of this.requests.entries()) {
                const filteredTimestamps = timestamps.filter(ts => ts > windowStart);
                if (filteredTimestamps.length === 0) {
                    this.requests.delete(key);
                    this.logger.debug(`Cleaned up rate limit tracking for key: ${key}`);
                } else {
                    this.requests.set(key, filteredTimestamps);
                    this.logger.debug(`Updated rate limit tracking for key: ${key}, remaining requests: ${filteredTimestamps.length}`);
                }
            }

            this.metrics.increment('security.rate.limit.cleanup.success');
        } catch (error) {
            this.logger.error('Rate limit cleanup failed:', error);
            this.metrics.increment('security.rate.limit.cleanup.error');
        }
    }

    /**
     * Stop the rate limiter and clean up resources
     */
    stop() {
        try {
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            this.requests.clear();
            this.metrics.increment('security.rate.limit.stop.success');
        } catch (error) {
            this.logger.error('Rate limiter stop failed:', error);
            this.metrics.increment('security.rate.limit.stop.error');
        }
    }

    /**
     * Reset rate limit tracking for a key
     * @param {string} key - The key to reset
     */
    reset(key) {
        try {
            this.requests.delete(key);
            this.logger.debug(`Reset rate limit tracking for key: ${key}`);
            this.metrics.increment('security.rate.limit.reset.success');
        } catch (error) {
            this.logger.error('Rate limit reset failed:', error);
            this.metrics.increment('security.rate.limit.reset.error');
        }
    }
}

module.exports = RateLimiter; 