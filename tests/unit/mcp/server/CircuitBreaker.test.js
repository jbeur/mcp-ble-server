const CircuitBreaker = require('../../../../src/mcp/server/CircuitBreaker');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('CircuitBreaker', () => {
  let breaker;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;
  let originalDate;

  beforeEach(() => {
    // Store original Date
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

    breaker = new CircuitBreaker();
  });

  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(breaker.options.failureThreshold).toBe(5);
      expect(breaker.options.resetTimeout).toBe(60000); // 60 seconds
      expect(breaker.options.halfOpenLimit).toBe(1);
    });

    it('should use custom circuit breaker options', () => {
      const customOptions = {
        failureThreshold: 3,
        resetTimeout: 30000,
        halfOpenLimit: 2
      };
      breaker = new CircuitBreaker(customOptions);
      expect(breaker.options.failureThreshold).toBe(3);
      expect(breaker.options.resetTimeout).toBe(30000);
      expect(breaker.options.halfOpenLimit).toBe(2);
    });
  });

  describe('state management', () => {
    it('should start in closed state', () => {
      expect(breaker.getState(mockConnection.id)).toBe('CLOSED');
    });

    it('should transition to open state after failure threshold', () => {
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }
      expect(breaker.getState(mockConnection.id)).toBe('OPEN');
    });

    it('should transition to half-open state after reset timeout', () => {
      // Record enough failures to open circuit
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }
      expect(breaker.getState(mockConnection.id)).toBe('OPEN');

      // Move time forward past reset timeout
      const futureTime = Date.now() + breaker.options.resetTimeout + 1000;
      jest.spyOn(global.Date, 'now').mockReturnValue(futureTime);

      expect(breaker.getState(mockConnection.id)).toBe('HALF_OPEN');
    });

    it('should transition back to closed state after success in half-open', () => {
      // Set up half-open state
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }
      const futureTime = Date.now() + breaker.options.resetTimeout + 1000;
      jest.spyOn(global.Date, 'now').mockReturnValue(futureTime);
      expect(breaker.getState(mockConnection.id)).toBe('HALF_OPEN');

      // Record success
      breaker.recordSuccess(mockConnection.id);
      expect(breaker.getState(mockConnection.id)).toBe('CLOSED');
    });
  });

  describe('allowRequest', () => {
    it('should allow requests in closed state', () => {
      expect(breaker.allowRequest(mockConnection.id)).toBe(true);
    });

    it('should not allow requests in open state', () => {
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }
      expect(breaker.allowRequest(mockConnection.id)).toBe(false);
    });

    it('should allow limited requests in half-open state', () => {
      // Set up half-open state
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }
      const futureTime = Date.now() + breaker.options.resetTimeout + 1000;
      jest.spyOn(global.Date, 'now').mockReturnValue(futureTime);

      // Should allow halfOpenLimit requests
      for (let i = 0; i < breaker.options.halfOpenLimit; i++) {
        expect(breaker.allowRequest(mockConnection.id)).toBe(true);
      }
      // Should deny additional requests
      expect(breaker.allowRequest(mockConnection.id)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute operation in closed state', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await breaker.execute(mockConnection.id, operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalled();
    });

    it('should throw CircuitBreakerError in open state', async () => {
      // Open the circuit
      for (let i = 0; i < breaker.options.failureThreshold; i++) {
        breaker.recordFailure(mockConnection.id);
      }

      const operation = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(mockConnection.id, operation))
        .rejects
        .toThrow('Circuit breaker is open');
      expect(operation).not.toHaveBeenCalled();
    });

    it('should handle operation failure and update metrics', async () => {
      const error = new Error('Operation failed');
      const operation = jest.fn().mockRejectedValue(error);

      await expect(breaker.execute(mockConnection.id, operation))
        .rejects
        .toThrow('Operation failed');

      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: mockConnection.id });
      expect(logger.error).toHaveBeenCalledWith(
        'Circuit breaker operation failed',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: 'Operation failed'
        })
      );
    });

    it('should reset failure count after successful operation', async () => {
      // Record some failures but not enough to open
      for (let i = 0; i < breaker.options.failureThreshold - 1; i++) {
        breaker.recordFailure(mockConnection.id);
      }

      const operation = jest.fn().mockResolvedValue('success');
      await breaker.execute(mockConnection.id, operation);

      // Record another failure - should not open circuit because count was reset
      breaker.recordFailure(mockConnection.id);
      expect(breaker.getState(mockConnection.id)).toBe('CLOSED');
    });
  });

  describe('metrics', () => {
    it('should track state transitions', () => {
      breaker.recordFailure(mockConnection.id);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });

    it('should track failure counts', () => {
      breaker.recordFailure(mockConnection.id);
      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: mockConnection.id });
    });

    it('should track successful operations', () => {
      breaker.recordSuccess(mockConnection.id);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });
}); 