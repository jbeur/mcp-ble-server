const DataConsistency = require('../../../../src/mcp/server/DataConsistency');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('DataConsistency', () => {
  let dataConsistency;
  let mockConnectionPool;
  let mockStateManager;
  let mockTransactionLog;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock objects
    mockConnectionPool = {
      getStatus: jest.fn(),
      getPoolSize: jest.fn(),
      getActiveConnections: jest.fn(),
      beginTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn()
    };

    mockStateManager = {
      saveState: jest.fn(),
      loadState: jest.fn(),
      clearState: jest.fn()
    };

    mockTransactionLog = {
      append: jest.fn(),
      getUncommitted: jest.fn(),
      markCommitted: jest.fn(),
      markRolledBack: jest.fn()
    };

    // Initialize DataConsistency instance
    dataConsistency = new DataConsistency({
      connectionPool: mockConnectionPool,
      stateManager: mockStateManager,
      transactionLog: mockTransactionLog,
      config: {
        checkpointInterval: 5000,
        maxTransactionRetries: 3,
        transactionTimeout: 10000
      }
    });
  });

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(dataConsistency.connectionPool).toBe(mockConnectionPool);
      expect(dataConsistency.stateManager).toBe(mockStateManager);
      expect(dataConsistency.transactionLog).toBe(mockTransactionLog);
      expect(dataConsistency.config).toBeDefined();
    });

    it('should throw error if required dependencies are missing', () => {
      expect(() => new DataConsistency({})).toThrow('Connection pool is required');
      expect(() => new DataConsistency({ connectionPool: mockConnectionPool }))
        .toThrow('State manager is required');
      expect(() => new DataConsistency({ 
        connectionPool: mockConnectionPool,
        stateManager: mockStateManager 
      })).toThrow('Transaction log is required');
    });
  });

  describe('beginTransaction', () => {
    it('should start a new transaction', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.beginTransaction.mockResolvedValue(transactionId);

      const result = await dataConsistency.beginTransaction();

      expect(result).toBe(transactionId);
      expect(mockTransactionLog.append).toHaveBeenCalledWith(expect.objectContaining({
        id: transactionId,
        status: 'started'
      }));
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.active_transactions', expect.any(Number));
    });

    it('should handle transaction start errors', async () => {
      mockConnectionPool.beginTransaction.mockRejectedValue(new Error('Start failed'));
      await expect(dataConsistency.beginTransaction()).rejects.toThrow('Start failed');
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_errors', expect.any(Number));
    });
  });

  describe('commitTransaction', () => {
    it('should commit a transaction', async () => {
      const transactionId = 'tx-1';
      const startTime = Date.now();
      dataConsistency.activeTransactions.set(transactionId, {
        startTime,
        status: 'started'
      });
      mockConnectionPool.commitTransaction.mockResolvedValue(true);

      await dataConsistency.commitTransaction(transactionId);

      expect(mockTransactionLog.markCommitted).toHaveBeenCalledWith(transactionId);
      expect(metrics.histogram).toHaveBeenCalledWith('data_consistency.transaction_duration', expect.any(Number));
    });

    it('should handle commit errors', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.commitTransaction.mockRejectedValue(new Error('Commit failed'));
      await expect(dataConsistency.commitTransaction(transactionId)).rejects.toThrow('Commit failed');
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_errors', expect.any(Number));
    });

    it('should handle commit when transaction not in active transactions', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.commitTransaction.mockResolvedValue(true);

      await dataConsistency.commitTransaction(transactionId);

      expect(mockTransactionLog.markCommitted).toHaveBeenCalledWith(transactionId);
      expect(metrics.histogram).not.toHaveBeenCalled();
    });
  });

  describe('rollbackTransaction', () => {
    it('should rollback a transaction', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.rollbackTransaction.mockResolvedValue(true);

      await dataConsistency.rollbackTransaction(transactionId);

      expect(mockTransactionLog.markRolledBack).toHaveBeenCalledWith(transactionId);
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_rollbacks', expect.any(Number));
    });

    it('should handle rollback errors', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.rollbackTransaction.mockRejectedValue(new Error('Rollback failed'));
      await expect(dataConsistency.rollbackTransaction(transactionId)).rejects.toThrow('Rollback failed');
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_errors', expect.any(Number));
    });

    it('should handle rollback when transaction not in active transactions', async () => {
      const transactionId = 'tx-1';
      mockConnectionPool.rollbackTransaction.mockResolvedValue(true);

      await dataConsistency.rollbackTransaction(transactionId);

      expect(mockTransactionLog.markRolledBack).toHaveBeenCalledWith(transactionId);
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_rollbacks', expect.any(Number));
    });
  });

  describe('recoverTransactions', () => {
    it('should recover uncommitted transactions', async () => {
      const uncommittedTransactions = [
        { id: 'tx-1', status: 'started' },
        { id: 'tx-2', status: 'started' }
      ];

      mockTransactionLog.getUncommitted.mockResolvedValue(uncommittedTransactions);
      mockConnectionPool.rollbackTransaction.mockResolvedValue(true);

      await dataConsistency.recoverTransactions();

      expect(mockTransactionLog.getUncommitted).toHaveBeenCalled();
      expect(mockConnectionPool.rollbackTransaction).toHaveBeenCalledTimes(2);
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.recovery_success', 1);
    });

    it('should handle recovery errors', async () => {
      mockTransactionLog.getUncommitted.mockRejectedValue(new Error('Recovery failed'));
      await expect(dataConsistency.recoverTransactions()).rejects.toThrow('Recovery failed');
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.recovery_success', 0);
    });

    it('should handle individual transaction rollback failures during recovery', async () => {
      const uncommittedTransactions = [
        { id: 'tx-1', status: 'started' },
        { id: 'tx-2', status: 'started' }
      ];

      mockTransactionLog.getUncommitted.mockResolvedValue(uncommittedTransactions);
      mockConnectionPool.rollbackTransaction
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Rollback failed'));

      await dataConsistency.recoverTransactions();

      expect(mockTransactionLog.getUncommitted).toHaveBeenCalled();
      expect(mockConnectionPool.rollbackTransaction).toHaveBeenCalledTimes(2);
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.recovery_success', 1);
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.transaction_errors', 1);
    });

    it('should handle empty uncommitted transactions list', async () => {
      mockTransactionLog.getUncommitted.mockResolvedValue([]);

      await dataConsistency.recoverTransactions();

      expect(mockTransactionLog.getUncommitted).toHaveBeenCalled();
      expect(mockConnectionPool.rollbackTransaction).not.toHaveBeenCalled();
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.recovery_success', 1);
    });
  });

  describe('createCheckpoint', () => {
    it('should create a system checkpoint', async () => {
      const state = {
        poolSize: 10,
        activeConnections: 5,
        status: 'healthy'
      };

      mockConnectionPool.getStatus.mockResolvedValue('healthy');
      mockConnectionPool.getPoolSize.mockReturnValue(10);
      mockConnectionPool.getActiveConnections.mockReturnValue(5);

      await dataConsistency.createCheckpoint();

      expect(mockStateManager.saveState).toHaveBeenCalledWith(expect.objectContaining(state));
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.checkpoint_success', 1);
    });

    it('should handle checkpoint errors', async () => {
      mockStateManager.saveState.mockRejectedValue(new Error('Checkpoint failed'));
      await expect(dataConsistency.createCheckpoint()).rejects.toThrow('Checkpoint failed');
      expect(metrics.gauge).toHaveBeenCalledWith('data_consistency.checkpoint_success', 0);
    });
  });

  describe('checkpointing', () => {
    it('should start checkpointing', () => {
      const mockTimer = { id: 123 };
      global.setInterval = jest.fn().mockReturnValue(mockTimer);

      dataConsistency.startCheckpointing();

      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
      expect(dataConsistency.checkpointTimer).toBe(mockTimer);
    });

    it('should clear existing timer when starting checkpointing', () => {
      const mockTimer = { id: 123 };
      global.setInterval = jest.fn().mockReturnValue(mockTimer);
      global.clearInterval = jest.fn();

      dataConsistency.checkpointTimer = { id: 456 };
      dataConsistency.startCheckpointing();

      expect(global.clearInterval).toHaveBeenCalledWith({ id: 456 });
      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
      expect(dataConsistency.checkpointTimer).toBe(mockTimer);
    });

    it('should stop checkpointing', () => {
      const mockTimer = { id: 123 };
      global.clearInterval = jest.fn();

      dataConsistency.checkpointTimer = mockTimer;
      dataConsistency.stopCheckpointing();

      expect(global.clearInterval).toHaveBeenCalledWith(mockTimer);
      expect(dataConsistency.checkpointTimer).toBeNull();
    });

    it('should handle stopping checkpointing when no timer exists', () => {
      global.clearInterval = jest.fn();

      dataConsistency.checkpointTimer = null;
      dataConsistency.stopCheckpointing();

      expect(global.clearInterval).not.toHaveBeenCalled();
      expect(dataConsistency.checkpointTimer).toBeNull();
    });
  });
}); 