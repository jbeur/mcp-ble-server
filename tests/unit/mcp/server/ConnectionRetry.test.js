const ConnectionRetry = require('../../../../src/mcp/server/ConnectionRetry');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionRetry', () => {
  let retry;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;
  let originalSetTimeout;
  let originalClearTimeout;
  let originalDate;

  beforeEach(() => {
    // Store original timer functions and Date
    originalSetTimeout = global.setTimeout;
    originalClearTimeout = global.clearTimeout;
    originalDate = global.Date;

    // Mock Date.now to return a fixed timestamp
    const now = 1647270000000; // March 14, 2022
    global.Date.now = jest.fn(() => now);

    // Reset mocks
    jest.clearAllMocks();

    // Create mock gauge and counter functions
    mockGaugeSet = jest.fn();
    mockCounterInc = jest.fn();

    // Create mock metrics
    mockMetrics = {
      gauge: jest.fn().mockReturnValue({
        set: mockGaugeSet
      }),
      counter: jest.fn().mockReturnValue({
        inc: mockCounterInc
      })
    };
    metrics.gauge = mockMetrics.gauge;
    metrics.counter = mockMetrics.counter;

    // Create mock connection
    mockConnection = {
      id: 'test-connection',
      status: 'active',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined)
    };

    // Mock setTimeout to execute callback immediately
    global.setTimeout = jest.fn((cb) => {
      if (typeof cb === 'function') {
        cb();
      }
      return 123;
    });
    global.clearTimeout = jest.fn();

    retry = new ConnectionRetry();
  });

  afterEach(() => {
    // Restore original timer functions and Date
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.Date = originalDate;
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(retry.options.maxRetries).toBe(3);
      expect(retry.options.initialDelay).toBe(1000); // 1 second
      expect(retry.options.maxDelay).toBe(30000); // 30 seconds
      expect(retry.options.backoffFactor).toBe(2);
    });

    it('should use custom retry options', () => {
      const customOptions = {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 60000,
        backoffFactor: 3
      };
      retry = new ConnectionRetry(customOptions);
      expect(retry.options.maxRetries).toBe(5);
      expect(retry.options.initialDelay).toBe(2000);
      expect(retry.options.maxDelay).toBe(60000);
      expect(retry.options.backoffFactor).toBe(3);
    });
  });

  describe('shouldRetry', () => {
    it('should retry on retryable errors', () => {
      const error = new Error('Connection failed');
      error.retryable = true;
      expect(retry.shouldRetry(error)).toBe(true);
    });

    it('should not retry on non-retryable errors', () => {
      const error = new Error('Invalid credentials');
      error.retryable = false;
      expect(retry.shouldRetry(error)).toBe(false);
    });

    it('should not retry when max retries reached', () => {
      mockConnection.retryCount = retry.options.maxRetries;
      const error = new Error('Connection failed');
      error.retryable = true;
      expect(retry.shouldRetry(error, mockConnection)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const delay = retry.calculateDelay(2); // Third retry
      expect(delay).toBe(4000); // 1000 * 2^2
    });

    it('should respect max delay limit', () => {
      const delay = retry.calculateDelay(5); // Sixth retry
      expect(delay).toBeLessThanOrEqual(retry.options.maxDelay);
    });

    it('should return initial delay for first retry', () => {
      const delay = retry.calculateDelay(0);
      expect(delay).toBe(retry.options.initialDelay);
    });
  });

  describe('retry', () => {
    it('should attempt connection retry', async () => {
      const error = new Error('Connection failed');
      error.retryable = true;
      mockConnection.retryCount = 0;

      await retry.retry(mockConnection, error);

      expect(mockConnection.connect).toHaveBeenCalled();
      expect(mockConnection.retryCount).toBe(0); // Should be reset after successful retry
      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: mockConnection.id });
    });

    it('should handle retry errors', async () => {
      const error = new Error('Connection failed');
      error.retryable = true;
      mockConnection.retryCount = 0;
      mockConnection.connect.mockRejectedValueOnce(new Error('Retry failed'));

      await expect(retry.retry(mockConnection, error)).rejects.toThrow('Retry failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Connection retry failed',
        expect.objectContaining({
          connectionId: mockConnection.id,
          retryCount: 1,
          error: 'Retry failed'
        })
      );
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('Invalid credentials');
      error.retryable = false;
      mockConnection.retryCount = 0;

      await retry.retry(mockConnection, error);

      expect(mockConnection.connect).not.toHaveBeenCalled();
      expect(mockConnection.retryCount).not.toBe(1);
    });

    it('should respect max retries', async () => {
      const error = new Error('Connection failed');
      error.retryable = true;
      mockConnection.retryCount = retry.options.maxRetries;

      await retry.retry(mockConnection, error);

      expect(mockConnection.connect).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Max retries reached',
        expect.objectContaining({
          connectionId: mockConnection.id,
          retryCount: retry.options.maxRetries
        })
      );
    });
  });

  describe('resetRetryCount', () => {
    it('should reset retry count for connection', () => {
      mockConnection.retryCount = 3;
      retry.resetRetryCount(mockConnection);
      expect(mockConnection.retryCount).toBe(0);
    });

    it('should handle connection without retry count', () => {
      retry.resetRetryCount(mockConnection);
      expect(mockConnection.retryCount).toBe(0);
    });
  });

  describe('classifyError', () => {
    it('should classify network errors as retryable', () => {
      const error = new Error('Network timeout');
      const classifiedError = retry.classifyError(error);
      expect(classifiedError.retryable).toBe(true);
      expect(classifiedError.category).toBe('network');
    });

    it('should classify authentication errors as non-retryable', () => {
      const error = new Error('Invalid credentials');
      const classifiedError = retry.classifyError(error);
      expect(classifiedError.retryable).toBe(false);
      expect(classifiedError.category).toBe('authentication');
    });

    it('should classify unknown errors as non-retryable', () => {
      const error = new Error('Unknown error');
      const classifiedError = retry.classifyError(error);
      expect(classifiedError.retryable).toBe(false);
      expect(classifiedError.category).toBe('unknown');
    });
  });
}); 