const assert = require('assert');
const { ConnectionPool } = require('../../../src/ble/ConnectionPool');
const logger = require('../../../src/utils/logger');

describe('Connection Pooling', () => {
    let connectionPool;

    beforeEach(() => {
        connectionPool = new ConnectionPool();
    });

    afterEach(() => {
        if (connectionPool._cleanerInterval) {
            clearInterval(connectionPool._cleanerInterval);
        }
    });

    it('should acquire and release connections', async () => {
        const connection = await connectionPool.acquireConnection();
        assert(connection, 'Should acquire a connection');
        assert(connectionPool._inUseConnections.has(connection.connectionId), 'Connection should be marked as in use');
        
        await connectionPool.releaseConnection(connection.connectionId);
        assert(!connectionPool._inUseConnections.has(connection.connectionId), 'Connection should be released');
        assert(connectionPool._availableConnections.has(connection.connectionId), 'Connection should be available');
    });

    it('should respect max connections limit', async () => {
        const connections = [];

        // Acquire max connections
        for (let i = 0; i < connectionPool._config.maxConnections; i++) {
            const connection = await connectionPool.acquireConnection();
            connections.push(connection);
        }

        // Attempt to acquire one more connection
        await assert.rejects(
            () => connectionPool.acquireConnection(),
            { message: /Maximum connections limit reached/ }
        );

        // Clean up
        for (const connection of connections) {
            await connectionPool.releaseConnection(connection.connectionId);
        }
    });

    it('should maintain minimum connections', async () => {
        const connections = [];

        // Acquire all connections
        for (let i = 0; i < connectionPool._config.maxConnections; i++) {
            const connection = await connectionPool.acquireConnection();
            connections.push(connection);
        }

        // Release all connections one by one
        for (const connection of connections) {
            await connectionPool.releaseConnection(connection.connectionId);
        }

        // Verify minimum connections are maintained
        assert.strictEqual(
            connectionPool._connections.size,
            connectionPool._config.minConnections,
            'Should maintain minimum connections'
        );
    });

    it('should handle connection failures gracefully', async () => {
        // Simulate a failed connection
        const connection = await connectionPool.acquireConnection();
        await connectionPool.releaseConnection(connection.connectionId);

        const metrics = connectionPool.getMetrics();
        assert(metrics.totalConnections > 0, 'Should track total connections');
        assert(metrics.totalReleases > 0, 'Should track total releases');
    });

    it('should track connection metrics', async () => {
        const connection = await connectionPool.acquireConnection();
        const metrics = connectionPool.getMetrics();
        
        assert(metrics.totalConnections > 0, 'Should track total connections');
        assert(metrics.activeConnections === 1, 'Should track active connections');
        assert(metrics.totalAcquisitions > 0, 'Should track total acquisitions');

        await connectionPool.releaseConnection(connection.connectionId);
    });

    it('should clean up idle connections', async () => {
        // Set a shorter idle timeout for testing
        connectionPool.updateConfig({ maxIdleTime: 100 });
        
        const connection = await connectionPool.acquireConnection();
        await connectionPool.releaseConnection(connection.connectionId);

        // Wait for idle timeout
        await new Promise(resolve => setTimeout(resolve, 150));

        // Force cleanup
        connectionPool.forceCleanup();

        // Verify connection was cleaned up while maintaining minimum connections
        assert(!connectionPool._availableConnections.has(connection.connectionId), 'Idle connection should be cleaned up');
        assert.strictEqual(
            connectionPool._connections.size,
            connectionPool._config.minConnections,
            'Should maintain minimum connections after cleanup'
        );
    }, 1000); // Set explicit timeout

    it('should handle concurrent connection requests', async () => {
        const requests = [];

        // Create concurrent requests
        for (let i = 0; i < connectionPool._config.maxConnections; i++) {
            requests.push(connectionPool.acquireConnection());
        }

        // Wait for all requests to complete
        const connections = await Promise.all(requests);
        
        // Verify all connections were acquired
        assert.strictEqual(connections.length, connectionPool._config.maxConnections, 'Should handle concurrent requests');
        assert.strictEqual(
            connectionPool._inUseConnections.size,
            connectionPool._config.maxConnections,
            'All connections should be marked as in use'
        );

        // Clean up one by one to avoid concurrent release issues
        for (const connection of connections) {
            await connectionPool.releaseConnection(connection.connectionId);
        }

        // Wait for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        // Force cleanup
        connectionPool.forceCleanup();

        // Verify cleanup
        assert.strictEqual(
            connectionPool._connections.size,
            connectionPool._config.minConnections,
            'Should maintain minimum connections after cleanup'
        );
    });
}); 