const ConnectionHealth = require('../../../../src/mcp/server/ConnectionHealth');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionHealth', () => {
  let health;
  let mockConnection;
  let mockMetrics;
  let mockGaugeSet;
  let mockGaugeStatus;
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
    mockGaugeStatus = jest.fn();
    mockCounterInc = jest.fn();

    // Create mock metrics
    mockMetrics = {
      gauge: jest.fn().mockImplementation((name) => {
        if (name === 'connection_health_check_latency') {
          return { set: mockGaugeSet };
        }
        return { set: mockGaugeStatus };
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
      lastUsed: Date.now(),
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

    health = new ConnectionHealth();
  });

  afterEach(() => {
    // Restore original timer functions
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  describe('checkHealth', () => {
    it('should perform health check on connection', async () => {
      const result = await health.checkHealth(mockConnection);
      expect(result).toBe(true);
      expect(mockConnection.health.lastCheck).toBeDefined();
      expect(mockConnection.health.latency).toBeDefined();
    });

    it('should handle health check failures', async () => {
      // Simulate health check failure
      mockConnection.status = 'error';
      const result = await health.checkHealth(mockConnection);
      expect(result).toBe(false);
      expect(mockConnection.health.status).toBe('unhealthy');
    });

    it('should track health check metrics', async () => {
      await health.checkHealth(mockConnection);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        expect.any(Number)
      );
      expect(mockGaugeStatus).toHaveBeenCalledWith(
        { connection_id: mockConnection.id },
        1
      );
    });
  });

  describe('monitorConnection', () => {
    it('should start monitoring connection', () => {
      health.monitorConnection(mockConnection);
      expect(health.connections.has(mockConnection.id)).toBe(true);
      expect(global.setInterval).toHaveBeenCalledTimes(1);
    });

    it('should stop monitoring connection', () => {
      health.monitorConnection(mockConnection);
      health.stopMonitoring(mockConnection.id);
      expect(health.connections.has(mockConnection.id)).toBe(false);
      expect(global.clearInterval).toHaveBeenCalledTimes(1);
    });

    it('should handle monitoring errors', () => {
      // Simulate monitoring error
      const mockError = new Error('Monitoring error');
      global.setInterval.mockImplementationOnce(() => {
        throw mockError;
      });

      expect(() => health.monitorConnection(mockConnection)).toThrow('Monitoring error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error in health monitoring',
        expect.objectContaining({
          connectionId: mockConnection.id,
          error: mockError.message
        })
      );
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status for connection', () => {
      health.connections.set(mockConnection.id, mockConnection);
      const status = health.getHealthStatus(mockConnection.id);
      expect(status).toBeDefined();
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('lastCheck');
      expect(status).toHaveProperty('latency');
    });

    it('should return null for non-existent connection', () => {
      const status = health.getHealthStatus('non-existent');
      expect(status).toBeNull();
    });
  });

  describe('getUnhealthyConnections', () => {
    it('should return list of unhealthy connections', () => {
      const unhealthyConnection = {
        ...mockConnection,
        health: {
          ...mockConnection.health,
          status: 'unhealthy'
        }
      };

      health.connections.set(unhealthyConnection.id, unhealthyConnection);
      const unhealthy = health.getUnhealthyConnections();
      expect(unhealthy).toContain(unhealthyConnection);
    });
  });

  describe('cleanup', () => {
    it('should stop monitoring all connections', () => {
      health.connections.set(mockConnection.id, mockConnection);
      health.monitors.set(mockConnection.id, 123);
      health.cleanup();
      expect(health.connections.size).toBe(0);
      expect(health.monitors.size).toBe(0);
      expect(global.clearInterval).toHaveBeenCalledTimes(1);
    });
  });
}); 