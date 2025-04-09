const RateLimiter = require('../../src/auth/RateLimiter');
const logger = require('../../src/utils/logger');
const metrics = require('../../src/utils/metrics');

jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/metrics');

describe('RateLimiter', () => {
  let rateLimiter;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mock config
    mockConfig = {
      windowMs: 1000, // 1 second window for faster testing
      maxRequests: 3 // 3 requests per window
    };

    // Setup logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();

    // Setup metrics mock
    metrics.increment = jest.fn();

    // Create rate limiter instance
    rateLimiter = new RateLimiter(mockConfig);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const limiter = new RateLimiter();
      expect(limiter.windowMs).toBe(60000);
      expect(limiter.maxRequests).toBe(100);
      expect(limiter.requests).toBeDefined();
      expect(limiter.cleanupInterval).toBeDefined();
    });

    it('should initialize with custom config', () => {
      const limiter = new RateLimiter(mockConfig);
      expect(limiter.windowMs).toBe(1000);
      expect(limiter.maxRequests).toBe(3);
      expect(limiter.requests).toBeDefined();
      expect(limiter.cleanupInterval).toBeDefined();
    });
  });

  describe('isRateLimited', () => {
    it('should allow requests within rate limit', () => {
      const key = 'test-client';
      
      // Make requests up to the limit
      for (let i = 0; i < mockConfig.maxRequests; i++) {
        expect(rateLimiter.isRateLimited(key)).toBe(false);
      }

      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.check.success');
    });

    it('should track requests for new keys', () => {
      const key = 'new-client';
      expect(rateLimiter.isRateLimited(key)).toBe(false);
      expect(rateLimiter.requests.has(key)).toBe(true);
      expect(rateLimiter.requests.get(key).length).toBe(1);
    });

    it('should throw error when rate limit is exceeded', () => {
      const key = 'test-client';

      // Make requests up to the limit
      for (let i = 0; i < mockConfig.maxRequests; i++) {
        rateLimiter.isRateLimited(key);
      }

      // Next request should throw
      expect(() => rateLimiter.isRateLimited(key)).toThrow('Rate limit exceeded');
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.exceeded');
    });

    it('should allow requests after window expires', () => {
      const key = 'test-client';

      // Make requests up to the limit
      for (let i = 0; i < mockConfig.maxRequests; i++) {
        rateLimiter.isRateLimited(key);
      }

      // Advance time past the window
      jest.advanceTimersByTime(mockConfig.windowMs);

      // Should allow new requests
      expect(rateLimiter.isRateLimited(key)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired request records', () => {
      const key = 'test-client';

      // Make some requests
      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);

      // Advance time past the window
      jest.advanceTimersByTime(mockConfig.windowMs);

      // Trigger cleanup
      rateLimiter.cleanup();

      expect(rateLimiter.requests.has(key)).toBe(false);
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.cleanup.success');
    });

    it('should keep valid request records', () => {
      const key = 'test-client';

      // Make some requests
      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);

      // Advance time halfway through the window
      jest.advanceTimersByTime(mockConfig.windowMs / 2);

      // Trigger cleanup
      rateLimiter.cleanup();

      expect(rateLimiter.requests.has(key)).toBe(true);
      expect(rateLimiter.requests.get(key).length).toBe(2);
    });

    it('should handle cleanup errors gracefully', () => {
      // Mock Map.entries to throw error
      rateLimiter.requests.entries = jest.fn().mockImplementation(() => {
        throw new Error('Entries failed');
      });

      rateLimiter.cleanup();

      expect(logger.error).toHaveBeenCalled();
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.cleanup.error');
    });

    it('should run cleanup automatically', () => {
      const key = 'test-client';
      rateLimiter.isRateLimited(key);

      // Spy on cleanup method
      const cleanupSpy = jest.spyOn(rateLimiter, 'cleanup');

      // Advance time past the window
      jest.advanceTimersByTime(mockConfig.windowMs);

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should clear interval and requests', () => {
      const key = 'test-client';
      rateLimiter.isRateLimited(key);

      rateLimiter.stop();

      expect(rateLimiter.cleanupInterval).toBeNull();
      expect(rateLimiter.requests.size).toBe(0);
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.stop.success');
    });

    it('should handle stop errors gracefully', () => {
      // Mock Map.clear to throw error
      rateLimiter.requests.clear = jest.fn().mockImplementation(() => {
        throw new Error('Clear failed');
      });

      rateLimiter.stop();

      expect(logger.error).toHaveBeenCalled();
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.stop.error');
    });
  });

  describe('reset', () => {
    it('should reset rate limit tracking for a key', () => {
      const key = 'test-client';
      rateLimiter.isRateLimited(key);

      rateLimiter.reset(key);

      expect(rateLimiter.requests.has(key)).toBe(false);
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.reset.success');
    });

    it('should handle reset errors gracefully', () => {
      // Mock Map.delete to throw error
      rateLimiter.requests.delete = jest.fn().mockImplementation(() => {
        throw new Error('Delete failed');
      });

      rateLimiter.reset('test-client');

      expect(logger.error).toHaveBeenCalled();
      expect(metrics.increment).toHaveBeenCalledWith('security.rate.limit.reset.error');
    });
  });
}); 