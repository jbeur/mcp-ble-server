const assert = require('assert');
const { ConnectionPool } = require('../../../src/ble/ConnectionPool');
const logger = require('../../../src/utils/logger');

describe('Connection Pool', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool({
      maxConnections: 5,
      healthCheckInterval: 1000
    });
  });

  afterEach(async () => {
    // Ensure pool is stopped and cleaned up
    if (pool) {
      await pool.stop();
      pool = null;
    }
  });

  describe('Pool Configuration', () => {
    it('should initialize with default configuration', () => {
      const config = pool.getConfiguration();
      assert(config.maxConnections > 0, 'Should have a positive max connections');
      assert(config.minConnections >= 0, 'Should have a non-negative min connections');
      assert(config.maxIdleTime > 0, 'Should have a positive max idle time');
      assert(config.acquisitionTimeout > 0, 'Should have a positive acquisition timeout');
      assert(config.healthCheckInterval > 0, 'Should have a positive health check interval');
      expect(config.maxConnections).toBe(5);
      expect(config.healthCheckInterval).toBe(1000);
    });

    it('should update configuration with valid values', async () => {
      await pool.updateConfiguration({
        maxConnections: 10,
        healthCheckInterval: 2000
      });
      const config = pool.getConfiguration();
      assert.strictEqual(config.maxConnections, 10);
      assert.strictEqual(config.healthCheckInterval, 2000);
    });

    it('should validate configuration values', () => {
      const invalidConfigs = [
        { maxConnections: -1 },
        { minConnections: -1 },
        { maxIdleTime: -1 },
        { acquisitionTimeout: -1 },
        { healthCheckInterval: -1 },
        { minConnections: 5, maxConnections: 3 } // min > max
      ];

      invalidConfigs.forEach(config => {
        assert.throws(
          () => pool.updateConfiguration(config),
          { message: /Invalid configuration/ },
          `Should reject invalid config: ${JSON.stringify(config)}`
        );
      });
    });

    it('should maintain configuration constraints', () => {
      const config = pool.getConfiguration();
            
      // Test max connections constraint
      assert.throws(
        () => pool.updateConfiguration({ maxConnections: 0 }),
        { message: /maxConnections must be greater than 0/ }
      );

      // Test min connections constraint
      assert.throws(
        () => pool.updateConfiguration({ minConnections: config.maxConnections + 1 }),
        { message: /minConnections cannot be greater than maxConnections/ }
      );

      // Test idle time constraint
      assert.throws(
        () => pool.updateConfiguration({ maxIdleTime: 0 }),
        { message: /maxIdleTime must be greater than 0/ }
      );
    });

    it('should persist configuration changes', () => {
      const initialConfig = pool.getConfiguration();
      const newConfig = {
        maxConnections: initialConfig.maxConnections + 5,
        minConnections: initialConfig.minConnections + 1
      };

      pool.updateConfiguration(newConfig);
      const persistedConfig = pool.getConfiguration();

      assert.strictEqual(persistedConfig.maxConnections, newConfig.maxConnections);
      assert.strictEqual(persistedConfig.minConnections, newConfig.minConnections);
    });

    it('should handle partial configuration updates', () => {
      const initialConfig = pool.getConfiguration();
      const partialUpdate = {
        maxConnections: initialConfig.maxConnections + 2
      };

      pool.updateConfiguration(partialUpdate);
      const updatedConfig = pool.getConfiguration();

      assert.strictEqual(updatedConfig.maxConnections, partialUpdate.maxConnections);
      assert.strictEqual(updatedConfig.minConnections, initialConfig.minConnections);
      assert.strictEqual(updatedConfig.maxIdleTime, initialConfig.maxIdleTime);
    });
  });
}); 