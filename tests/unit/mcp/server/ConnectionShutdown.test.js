const ConnectionShutdown = require('../../../../src/mcp/server/ConnectionShutdown');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionShutdown', () => {
  let shutdown;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;

  beforeEach(() => {
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
      cleanup: jest.fn().mockResolvedValue(undefined),
      isActive: jest.fn().mockReturnValue(false),
      lastUsed: Date.now(),
      health: {
        status: 'healthy',
        lastCheck: Date.now(),
        latency: 100,
        errors: 0
      }
    };

    shutdown = new ConnectionShutdown();
  });

  describe('initiateShutdown', () => {
    it('should gracefully shutdown a connection', async () => {
      await shutdown.initiateShutdown(mockConnection);
      expect(mockConnection.disconnect).toHaveBeenCalled();
      expect(mockConnection.cleanup).toHaveBeenCalled();
      expect(mockConnection.status).toBe('closed');
    });

    it('should handle shutdown errors', async () => {
      const error = new Error('Shutdown error');
      mockConnection.disconnect.mockRejectedValue(error);

      await expect(shutdown.initiateShutdown(mockConnection)).rejects.toThrow('Shutdown error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error during connection shutdown',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: error.message
        })
      );
    });

    it('should track shutdown metrics', async () => {
      await shutdown.initiateShutdown(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
    });
  });

  describe('shutdownAll', () => {
    it('should shutdown all connections', async () => {
      const connections = [
        mockConnection,
        { ...mockConnection, id: 'test-connection-2' }
      ];

      await shutdown.shutdownAll(connections);
      expect(mockConnection.disconnect).toHaveBeenCalled();
      expect(mockConnection.cleanup).toHaveBeenCalled();
    });

    it('should continue shutdown process even if some connections fail', async () => {
      const error = new Error('Shutdown error');
      const connections = [
        { ...mockConnection, disconnect: jest.fn().mockRejectedValue(error) },
        mockConnection
      ];

      await shutdown.shutdownAll(connections);
      expect(mockConnection.disconnect).toHaveBeenCalled();
      expect(mockConnection.cleanup).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Error during connection shutdown',
        expect.objectContaining({
          connectionId: connections[0].id,
          error: error.message
        })
      );
    });

    it('should track shutdown progress', async () => {
      const connections = [
        mockConnection,
        { ...mockConnection, id: 'test-connection-2' }
      ];

      await shutdown.shutdownAll(connections);
      // One call for each connection's shutdown duration
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: 'test-connection-2' },
        expect.any(Number)
      );
    });
  });

  describe('waitForQuiescence', () => {
    it('should wait for connections to become idle', async () => {
      const connections = [
        mockConnection,
        { ...mockConnection, id: 'test-connection-2' }
      ];

      await shutdown.waitForQuiescence(connections);
      // Should update active connections count
      expect(mockGaugeSet).toHaveBeenCalledWith(0);
    });

    it('should timeout if connections do not become idle', async () => {
      const connections = [
        { ...mockConnection, isActive: jest.fn().mockReturnValue(true) }
      ];

      await expect(shutdown.waitForQuiescence(connections, 100)).rejects.toThrow('Timeout waiting for connections to become idle');
    });
  });
}); 