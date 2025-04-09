const DisasterRecovery = require('../../../../src/mcp/server/DisasterRecovery');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('DisasterRecovery', () => {
  let disasterRecovery;
  let mockConnectionPool;
  let mockHighAvailability;
  let mockStateManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock objects
    mockConnectionPool = {
      getStatus: jest.fn(),
      getPoolSize: jest.fn(),
      getActiveConnections: jest.fn(),
      drain: jest.fn(),
      restore: jest.fn()
    };

    mockHighAvailability = {
      stop: jest.fn(),
      start: jest.fn(),
      getStatus: jest.fn()
    };

    mockStateManager = {
      saveState: jest.fn(),
      loadState: jest.fn(),
      clearState: jest.fn()
    };

    // Initialize DisasterRecovery instance
    disasterRecovery = new DisasterRecovery({
      connectionPool: mockConnectionPool,
      highAvailability: mockHighAvailability,
      stateManager: mockStateManager,
      config: {
        recoveryAttempts: 3,
        recoveryDelay: 1000,
        stateCheckInterval: 5000
      }
    });
  });

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(disasterRecovery.connectionPool).toBe(mockConnectionPool);
      expect(disasterRecovery.highAvailability).toBe(mockHighAvailability);
      expect(disasterRecovery.stateManager).toBe(mockStateManager);
      expect(disasterRecovery.config).toBeDefined();
    });

    it('should throw error if required dependencies are missing', () => {
      expect(() => new DisasterRecovery({})).toThrow('Connection pool is required');
      expect(() => new DisasterRecovery({ connectionPool: mockConnectionPool }))
        .toThrow('High availability is required');
      expect(() => new DisasterRecovery({ 
        connectionPool: mockConnectionPool,
        highAvailability: mockHighAvailability 
      })).toThrow('State manager is required');
    });
  });

  describe('saveSystemState', () => {
    it('should save current system state', async () => {
      const state = {
        poolSize: 10,
        activeConnections: 5,
        status: 'healthy'
      };

      mockConnectionPool.getStatus.mockResolvedValue('healthy');
      mockConnectionPool.getPoolSize.mockReturnValue(10);
      mockConnectionPool.getActiveConnections.mockReturnValue(5);

      await disasterRecovery.saveSystemState();

      expect(mockStateManager.saveState).toHaveBeenCalledWith(expect.objectContaining(state));
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.state_save', 1);
    });

    it('should handle save state errors', async () => {
      mockStateManager.saveState.mockRejectedValue(new Error('Save failed'));
      await expect(disasterRecovery.saveSystemState()).rejects.toThrow('Save failed');
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.state_save', 0);
    });
  });

  describe('restoreSystemState', () => {
    it('should restore system from saved state', async () => {
      const savedState = {
        poolSize: 10,
        activeConnections: 5,
        status: 'healthy'
      };

      mockStateManager.loadState.mockResolvedValue(savedState);
      mockConnectionPool.restore.mockResolvedValue(true);

      await disasterRecovery.restoreSystemState();

      expect(mockHighAvailability.stop).toHaveBeenCalled();
      expect(mockConnectionPool.restore).toHaveBeenCalled();
      expect(mockHighAvailability.start).toHaveBeenCalled();
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.state_restore', 1);
    });

    it('should handle restore state errors', async () => {
      mockStateManager.loadState.mockRejectedValue(new Error('Load failed'));
      await expect(disasterRecovery.restoreSystemState()).rejects.toThrow('Load failed');
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.state_restore', 0);
    });
  });

  describe('initiateRecovery', () => {
    it('should attempt recovery with retries', async () => {
      mockConnectionPool.restore.mockResolvedValue(true);
      mockStateManager.loadState.mockResolvedValue({
        poolSize: 10,
        activeConnections: 5,
        status: 'healthy'
      });

      await disasterRecovery.initiateRecovery();

      expect(mockHighAvailability.stop).toHaveBeenCalled();
      expect(mockConnectionPool.restore).toHaveBeenCalled();
      expect(mockHighAvailability.start).toHaveBeenCalled();
      expect(metrics.histogram).toHaveBeenCalledWith('disaster_recovery.recovery_time', expect.any(Number));
    });

    it('should handle recovery failure after max attempts', async () => {
      mockConnectionPool.restore.mockRejectedValue(new Error('Recovery failed'));

      await expect(disasterRecovery.initiateRecovery()).rejects.toThrow('Max recovery attempts reached');
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.recovery_success', 0);
    });
  });

  describe('drainConnections', () => {
    it('should drain all connections', async () => {
      await disasterRecovery.drainConnections();
      expect(mockConnectionPool.drain).toHaveBeenCalled();
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.drain_success', 1);
    });

    it('should handle drain errors', async () => {
      mockConnectionPool.drain.mockRejectedValue(new Error('Drain failed'));
      await expect(disasterRecovery.drainConnections()).rejects.toThrow('Drain failed');
      expect(metrics.gauge).toHaveBeenCalledWith('disaster_recovery.drain_success', 0);
    });
  });
}); 