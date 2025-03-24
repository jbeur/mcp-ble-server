const ConnectionKeepAlive = require('../../../../src/mcp/server/ConnectionKeepAlive');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionKeepAlive', () => {
  let keepAlive;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    // Store original timer functions
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;

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
      ping: jest.fn().mockResolvedValue(undefined),
      lastPing: Date.now(),
      health: {
        status: 'healthy',
        lastCheck: Date.now(),
        latency: 100,
        errors: 0
      }
    };

    // Mock setInterval to just return a number
    global.setInterval = jest.fn().mockReturnValue(123);
    global.clearInterval = jest.fn();

    keepAlive = new ConnectionKeepAlive();
  });

  afterEach(() => {
    // Restore original timer functions
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  describe('startKeepAlive', () => {
    it('should start keep-alive monitoring for a connection', () => {
      keepAlive.startKeepAlive(mockConnection);
      expect(keepAlive.connections.has(mockConnection.id)).toBe(true);
      expect(global.setInterval).toHaveBeenCalledTimes(1);
    });

    it('should not start monitoring if connection is already monitored', () => {
      keepAlive.startKeepAlive(mockConnection);
      keepAlive.startKeepAlive(mockConnection);
      expect(global.setInterval).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Connection already being monitored',
        expect.objectContaining({ connectionId: mockConnection.id })
      );
    });

    it('should track keep-alive metrics', async () => {
      keepAlive.startKeepAlive(mockConnection);
      // Simulate interval callback
      await keepAlive.sendKeepAlive(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('stopKeepAlive', () => {
    it('should stop keep-alive monitoring for a connection', () => {
      keepAlive.startKeepAlive(mockConnection);
      keepAlive.stopKeepAlive(mockConnection.id);
      expect(keepAlive.connections.has(mockConnection.id)).toBe(false);
      expect(global.clearInterval).toHaveBeenCalledTimes(1);
    });

    it('should handle stopping non-existent monitoring', () => {
      keepAlive.stopKeepAlive('non-existent');
      expect(logger.warn).toHaveBeenCalledWith(
        'No keep-alive monitoring found for connection',
        expect.objectContaining({ connectionId: 'non-existent' })
      );
    });
  });

  describe('sendKeepAlive', () => {
    it('should send keep-alive ping to connection', async () => {
      await keepAlive.sendKeepAlive(mockConnection);
      expect(mockConnection.ping).toHaveBeenCalled();
      expect(mockConnection.lastPing).toBeDefined();
    });

    it('should handle ping failures', async () => {
      const error = new Error('Ping failed');
      mockConnection.ping.mockRejectedValue(error);

      await keepAlive.sendKeepAlive(mockConnection);
      expect(logger.error).toHaveBeenCalledWith(
        'Keep-alive ping failed',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: error.message
        })
      );
      expect(mockCounterInc).toHaveBeenCalledWith({ connection_id: mockConnection.id });
    });

    it('should track ping latency', async () => {
      await keepAlive.sendKeepAlive(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('cleanup', () => {
    it('should stop all keep-alive monitoring', () => {
      keepAlive.startKeepAlive(mockConnection);
      keepAlive.startKeepAlive({ ...mockConnection, id: 'test-connection-2' });

      keepAlive.cleanup();
      expect(keepAlive.connections.size).toBe(0);
      expect(global.clearInterval).toHaveBeenCalledTimes(2);
    });
  });
}); 