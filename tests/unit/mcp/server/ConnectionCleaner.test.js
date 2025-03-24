const ConnectionCleaner = require('../../../../src/mcp/server/ConnectionCleaner');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionCleaner', () => {
  let cleaner;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;
  let originalSetInterval;
  let originalClearInterval;
  let originalDate;

  beforeEach(() => {
    // Store original timer functions and Date
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;
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
      lastActivity: Date.now() - 1000, // 1 second ago
      disconnect: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined)
    };

    // Mock setInterval to just return a number
    global.setInterval = jest.fn().mockReturnValue(123);
    global.clearInterval = jest.fn();

    cleaner = new ConnectionCleaner();
  });

  afterEach(() => {
    // Restore original timer functions and Date
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    global.Date = originalDate;
  });

  describe('startCleaner', () => {
    it('should start the cleaner with default options', () => {
      cleaner.startCleaner();
      expect(global.setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Number)
      );
    });

    it('should use custom cleanup interval', () => {
      const customInterval = 60000;
      cleaner = new ConnectionCleaner({ cleanupInterval: customInterval });
      cleaner.startCleaner();
      expect(global.setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        customInterval
      );
    });
  });

  describe('stopCleaner', () => {
    it('should stop the cleaner', () => {
      cleaner.startCleaner();
      cleaner.stopCleaner();
      expect(global.clearInterval).toHaveBeenCalledWith(123);
      expect(cleaner.cleanerInterval).toBeNull();
    });

    it('should handle stopping when not running', () => {
      cleaner.stopCleaner();
      expect(global.clearInterval).not.toHaveBeenCalled();
    });
  });

  describe('cleanStaleConnections', () => {
    it('should clean stale connections', async () => {
      const staleConnection = {
        id: 'stale-connection',
        lastActivity: Date.now() - 600000, // 10 minutes ago
        disconnect: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };
      const activeConnection = {
        id: 'active-connection',
        lastActivity: Date.now() - 1000, // 1 second ago
        disconnect: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      const connections = new Map([
        [staleConnection.id, staleConnection],
        [activeConnection.id, activeConnection]
      ]);

      await cleaner.cleanStaleConnections(connections);

      expect(staleConnection.disconnect).toHaveBeenCalled();
      expect(staleConnection.cleanup).toHaveBeenCalled();
      expect(activeConnection.disconnect).not.toHaveBeenCalled();
      expect(activeConnection.cleanup).not.toHaveBeenCalled();
      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: staleConnection.id });
    });

    it('should handle cleanup errors', async () => {
      const mockConnection = {
        id: 'test-connection',
        lastActivity: Date.now() - 600000, // 10 minutes ago
        disconnect: jest.fn().mockRejectedValue(new Error('Cleanup failed')),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };
      const connections = new Map([[mockConnection.id, mockConnection]]);

      await expect(cleaner.cleanStaleConnections(connections)).rejects.toThrow('Cleanup failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Error cleaning stale connection',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: 'Cleanup failed'
        })
      );
    });

    it('should track cleanup metrics', async () => {
      const staleConnection = {
        ...mockConnection,
        lastActivity: Date.now() - 600000 // 10 minutes ago
      };
      const connections = new Map([[staleConnection.id, staleConnection]]);

      await cleaner.cleanStaleConnections(connections);

      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: staleConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('isStale', () => {
    it('should identify stale connections', () => {
      const staleConnection = {
        ...mockConnection,
        lastActivity: Date.now() - 600000 // 10 minutes ago
      };
      expect(cleaner.isStale(staleConnection)).toBe(true);
    });

    it('should identify active connections', () => {
      const activeConnection = {
        ...mockConnection,
        lastActivity: Date.now() - 1000 // 1 second ago
      };
      expect(cleaner.isStale(activeConnection)).toBe(false);
    });

    it('should handle missing lastActivity', () => {
      const noActivityConnection = {
        ...mockConnection,
        lastActivity: undefined
      };
      expect(cleaner.isStale(noActivityConnection)).toBe(true);
    });
  });
}); 