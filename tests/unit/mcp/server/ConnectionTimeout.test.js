const ConnectionTimeout = require('../../../../src/mcp/server/ConnectionTimeout');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionTimeout', () => {
  let timeout;
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
      disconnect: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined)
    };

    // Mock setTimeout to just return a number
    global.setTimeout = jest.fn().mockReturnValue(123);
    global.clearTimeout = jest.fn();

    timeout = new ConnectionTimeout();
  });

  afterEach(() => {
    // Restore original timer functions and Date
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.Date = originalDate;
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(timeout.options.timeoutDuration).toBe(30000); // 30 seconds
      expect(timeout.options.recoveryTimeout).toBe(5000); // 5 seconds
    });

    it('should use custom timeout options', () => {
      const customOptions = {
        timeoutDuration: 60000, // 1 minute
        recoveryTimeout: 10000 // 10 seconds
      };
      timeout = new ConnectionTimeout(customOptions);
      expect(timeout.options.timeoutDuration).toBe(60000);
      expect(timeout.options.recoveryTimeout).toBe(10000);
    });
  });

  describe('startTimeout', () => {
    it('should start timeout monitoring for a connection', () => {
      timeout.startTimeout(mockConnection);
      expect(global.setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        timeout.options.timeoutDuration
      );
      expect(mockConnection.timeoutId).toBe(123);
    });

    it('should clear existing timeout before starting new one', () => {
      mockConnection.timeoutId = 456;
      timeout.startTimeout(mockConnection);
      expect(global.clearTimeout).toHaveBeenCalledWith(456);
      expect(global.setTimeout).toHaveBeenCalled();
    });

    it('should track timeout metrics', () => {
      timeout.startTimeout(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('clearTimeout', () => {
    it('should clear timeout for a connection', () => {
      mockConnection.timeoutId = 123;
      timeout.clearTimeout(mockConnection);
      expect(global.clearTimeout).toHaveBeenCalledWith(123);
      expect(mockConnection.timeoutId).toBeUndefined();
    });

    it('should handle clearing non-existent timeout', () => {
      timeout.clearTimeout(mockConnection);
      expect(global.clearTimeout).not.toHaveBeenCalled();
    });
  });

  describe('handleTimeout', () => {
    it('should handle connection timeout', async () => {
      timeout.startTimeout(mockConnection);
      const timeoutCallback = global.setTimeout.mock.calls[0][0];
      await timeoutCallback();

      expect(mockConnection.disconnect).toHaveBeenCalled();
      expect(mockConnection.cleanup).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Connection timeout',
        expect.objectContaining({
          connectionId: mockConnection.id,
          duration: timeout.options.timeoutDuration
        })
      );
      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: mockConnection.id });
    });

    it('should handle timeout errors', async () => {
      const error = new Error('Disconnect failed');
      mockConnection.disconnect.mockRejectedValue(error);
      timeout.startTimeout(mockConnection);
      const timeoutCallback = global.setTimeout.mock.calls[0][0];
      await timeoutCallback();

      expect(logger.error).toHaveBeenCalledWith(
        'Error handling connection timeout',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: error.message
        })
      );
    });
  });

  describe('startRecovery', () => {
    it('should start recovery timeout', () => {
      timeout.startRecovery(mockConnection);
      expect(global.setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        timeout.options.recoveryTimeout
      );
      expect(mockConnection.recoveryId).toBe(123);
    });

    it('should clear existing recovery timeout', () => {
      mockConnection.recoveryId = 456;
      timeout.startRecovery(mockConnection);
      expect(global.clearTimeout).toHaveBeenCalledWith(456);
      expect(global.setTimeout).toHaveBeenCalled();
    });

    it('should track recovery metrics', () => {
      timeout.startRecovery(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('handleRecovery', () => {
    it('should handle connection recovery', async () => {
      timeout.startRecovery(mockConnection);
      const recoveryCallback = global.setTimeout.mock.calls[0][0];
      await recoveryCallback();

      expect(mockConnection.disconnect).toHaveBeenCalled();
      expect(mockConnection.cleanup).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Connection recovery completed',
        expect.objectContaining({
          connectionId: mockConnection.id,
          duration: timeout.options.recoveryTimeout
        })
      );
    });

    it('should handle recovery errors', async () => {
      const error = new Error('Recovery failed');
      mockConnection.disconnect.mockRejectedValue(error);
      timeout.startRecovery(mockConnection);
      const recoveryCallback = global.setTimeout.mock.calls[0][0];
      await recoveryCallback();

      expect(logger.error).toHaveBeenCalledWith(
        'Error during connection recovery',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: error.message
        })
      );
    });
  });
}); 