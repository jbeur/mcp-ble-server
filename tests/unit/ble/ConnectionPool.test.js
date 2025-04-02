const assert = require('assert');
const { ConnectionPool } = require('../../../src/ble/ConnectionPool');
const logger = require('../../../src/utils/logger');

describe('Connection Pool', () => {
    let connectionPool;

    beforeEach(() => {
        connectionPool = new ConnectionPool();
    });

    describe('Pool Configuration', () => {
        it('should initialize with default configuration', () => {
            const config = connectionPool.getConfiguration();
            assert(config.maxConnections > 0, 'Should have a positive max connections');
            assert(config.minConnections >= 0, 'Should have a non-negative min connections');
            assert(config.maxIdleTime > 0, 'Should have a positive max idle time');
            assert(config.acquisitionTimeout > 0, 'Should have a positive acquisition timeout');
            assert(config.healthCheckInterval > 0, 'Should have a positive health check interval');
        });

        it('should update configuration with valid values', () => {
            const newConfig = {
                maxConnections: 10,
                minConnections: 2,
                maxIdleTime: 30000,
                acquisitionTimeout: 5000,
                healthCheckInterval: 10000
            };

            connectionPool.updateConfiguration(newConfig);
            const config = connectionPool.getConfiguration();

            assert.strictEqual(config.maxConnections, newConfig.maxConnections);
            assert.strictEqual(config.minConnections, newConfig.minConnections);
            assert.strictEqual(config.maxIdleTime, newConfig.maxIdleTime);
            assert.strictEqual(config.acquisitionTimeout, newConfig.acquisitionTimeout);
            assert.strictEqual(config.healthCheckInterval, newConfig.healthCheckInterval);
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
                    () => connectionPool.updateConfiguration(config),
                    { message: /Invalid configuration/ },
                    `Should reject invalid config: ${JSON.stringify(config)}`
                );
            });
        });

        it('should maintain configuration constraints', () => {
            const config = connectionPool.getConfiguration();
            
            // Test max connections constraint
            assert.throws(
                () => connectionPool.updateConfiguration({ maxConnections: 0 }),
                { message: /maxConnections must be greater than 0/ }
            );

            // Test min connections constraint
            assert.throws(
                () => connectionPool.updateConfiguration({ minConnections: config.maxConnections + 1 }),
                { message: /minConnections cannot be greater than maxConnections/ }
            );

            // Test idle time constraint
            assert.throws(
                () => connectionPool.updateConfiguration({ maxIdleTime: 0 }),
                { message: /maxIdleTime must be greater than 0/ }
            );
        });

        it('should persist configuration changes', () => {
            const initialConfig = connectionPool.getConfiguration();
            const newConfig = {
                maxConnections: initialConfig.maxConnections + 5,
                minConnections: initialConfig.minConnections + 1
            };

            connectionPool.updateConfiguration(newConfig);
            const persistedConfig = connectionPool.getConfiguration();

            assert.strictEqual(persistedConfig.maxConnections, newConfig.maxConnections);
            assert.strictEqual(persistedConfig.minConnections, newConfig.minConnections);
        });

        it('should handle partial configuration updates', () => {
            const initialConfig = connectionPool.getConfiguration();
            const partialUpdate = {
                maxConnections: initialConfig.maxConnections + 2
            };

            connectionPool.updateConfiguration(partialUpdate);
            const updatedConfig = connectionPool.getConfiguration();

            assert.strictEqual(updatedConfig.maxConnections, partialUpdate.maxConnections);
            assert.strictEqual(updatedConfig.minConnections, initialConfig.minConnections);
            assert.strictEqual(updatedConfig.maxIdleTime, initialConfig.maxIdleTime);
        });
    });
}); 