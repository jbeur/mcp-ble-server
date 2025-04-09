const ConnectionPool = require('../../../../src/mcp/server/ConnectionPool');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

jest.mock('../../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../../src/utils/metrics', () => ({
  metrics: {
    gauge: jest.fn().mockReturnValue({
      set: jest.fn()
    }),
    counter: jest.fn().mockReturnValue({
      inc: jest.fn()
    }),
    histogram: jest.fn().mockReturnValue({
      observe: jest.fn()
    })
  }
}));

describe('ConnectionPool', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(pool.options.minSize).toBe(5);
      expect(pool.options.maxSize).toBe(20);
      expect(pool.options.idleTimeout).toBe(30000);
      expect(pool.options.connectionTimeout).toBe(5000);
      expect(pool.options.validationInterval).toBe(30000);
      expect(pool.options.priorityLevels).toEqual(['high', 'medium', 'low']);
      expect(pool.options.loadBalanceThreshold).toBe(0.8);
      expect(pool.performanceMetrics).toBeDefined();
    });

    it('should initialize with custom options', () => {
      const customPool = new ConnectionPool({
        minSize: 3,
        maxSize: 10,
        idleTimeout: 15000,
        connectionTimeout: 3000,
        validationInterval: 20000,
        priorityLevels: ['critical', 'normal'],
        loadBalanceThreshold: 0.7
      });

      expect(customPool.options.minSize).toBe(3);
      expect(customPool.options.maxSize).toBe(10);
      expect(customPool.options.idleTimeout).toBe(15000);
      expect(customPool.options.connectionTimeout).toBe(3000);
      expect(customPool.options.validationInterval).toBe(20000);
      expect(customPool.options.priorityLevels).toEqual(['critical', 'normal']);
      expect(customPool.options.loadBalanceThreshold).toBe(0.7);
    });
  });

  describe('addConnection', () => {
    it('should add a new connection', async () => {
      const connection = await pool.createConnection();
      expect(pool.pool.size).toBe(1);
      expect(pool.availableConnections.has(connection.id)).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Created new connection:'));
    });

    it('should not exceed maxSize', async () => {
      pool.options.maxSize = 2;
      
      await pool.createConnection();
      await pool.createConnection();
      
      await expect(pool.createConnection()).rejects.toThrow('Maximum connections reached');
      expect(pool.pool.size).toBe(2);
    });
  });

  describe('acquireConnection', () => {
    it('should acquire an available connection', async () => {
      const connection = await pool.createConnection();
      const acquired = await pool.acquireConnection();
      
      expect(acquired).toBe(connection);
      expect(pool.inUseConnections.has(connection.id)).toBe(true);
      expect(pool.availableConnections.has(connection.id)).toBe(false);
    });

    it('should handle invalid priority', async () => {
      await expect(pool.acquireConnection('invalid')).rejects.toThrow('Invalid priority level');
    });
  });

  describe('releaseConnection', () => {
    it('should release a connection', async () => {
      const connection = await pool.createConnection();
      await pool.acquireConnection();
      await pool.releaseConnection(connection.id);
      
      expect(pool.availableConnections.has(connection.id)).toBe(true);
      expect(pool.inUseConnections.has(connection.id)).toBe(false);
    });

    it('should handle non-existent connection', async () => {
      await expect(pool.releaseConnection('non-existent')).rejects.toThrow('Connection non-existent not found in pool');
    });
  });

  describe('validateConnections', () => {
    it('should remove invalid connections', async () => {
      const connection = await pool.createConnection();
      connection.createdAt = Date.now() - (pool.options.idleTimeout + 1000); // Make it invalid
      
      await pool.validateConnections();
      
      expect(pool.pool.has(connection.id)).toBe(false);
      expect(pool.availableConnections.has(connection.id)).toBe(false);
    });

    it('should maintain minimum pool size', async () => {
      await pool.initialize();
      const initialSize = pool.pool.size;
      
      // Make all connections invalid
      for (const [, connection] of pool.pool) {
        connection.createdAt = Date.now() - (pool.options.idleTimeout + 1000);
      }
      
      await pool.validateConnections();
      
      expect(pool.pool.size).toBe(initialSize);
    });
  });
}); 