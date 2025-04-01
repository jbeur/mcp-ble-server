// Mock metrics module
jest.mock('../../../../src/utils/metrics', () => ({
    gauge: jest.fn(),
    histogram: jest.fn()
}));

const mockMetrics = require('../../../../src/utils/metrics');
const { logger } = require('../../../../src/utils/logger');
const ConnectionFailover = require('../../../../src/mcp/server/ConnectionFailover');

describe('ConnectionFailover', () => {
    let failover;
    let mockConnectionPool;
    let mockCircuitBreaker;
    let mockKeepAlive;
    let mockLogger;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        mockConnectionPool = {
            acquireConnection: jest.fn(),
            getConnections: jest.fn()
        };
        mockCircuitBreaker = {
            getState: jest.fn(),
            allowRequest: jest.fn(),
            recordSuccess: jest.fn(),
            recordFailure: jest.fn()
        };
        mockKeepAlive = {
            isConnectionHealthy: jest.fn()
        };
        mockLogger = {
            error: jest.fn(),
            info: jest.fn(),
            debug: jest.fn()
        };

        failover = new ConnectionFailover({
            connectionPool: mockConnectionPool,
            circuitBreaker: mockCircuitBreaker,
            keepAlive: mockKeepAlive,
            logger: mockLogger,
            maxFailoverAttempts: 3,
            failoverDelay: 100,
            healthCheckInterval: 5000
        });
    });

    describe('constructor', () => {
        it('should initialize with default options when none provided', () => {
            const failover = new ConnectionFailover({
                connectionPool: mockConnectionPool,
                circuitBreaker: mockCircuitBreaker,
                keepAlive: mockKeepAlive
            });
            expect(failover.options.maxFailoverAttempts).toBe(5);
            expect(failover.options.failoverDelay).toBe(2000);
            expect(failover.options.healthCheckInterval).toBe(10000);
        });

        it('should initialize with provided options', () => {
            expect(failover.options.maxFailoverAttempts).toBe(3);
            expect(failover.options.failoverDelay).toBe(100);
            expect(failover.options.healthCheckInterval).toBe(5000);
        });

        it('should initialize empty state tracking', () => {
            expect(failover.failoverAttempts.size).toBe(0);
            expect(failover.lastFailoverTime.size).toBe(0);
            expect(failover.healthCheckTimer).toBeNull();
        });
    });

    describe('acquireConnection', () => {
        it('should acquire connection successfully on first attempt', async () => {
            const mockConnection = { id: 'test_conn_1' };
            mockConnectionPool.acquireConnection.mockResolvedValueOnce(mockConnection);
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);
            mockKeepAlive.isConnectionHealthy.mockResolvedValueOnce(true);

            const connection = await failover.acquireConnection();
            expect(connection).toBe(mockConnection);
            expect(mockConnectionPool.acquireConnection).toHaveBeenCalledTimes(1);
        });

        it('should attempt failover when connection fails', async () => {
            const mockConnection = { id: 'test_conn_1' };
            mockConnectionPool.acquireConnection
                .mockRejectedValueOnce(new Error('Connection failed'))
                .mockResolvedValueOnce(mockConnection);
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);
            mockKeepAlive.isConnectionHealthy.mockResolvedValueOnce(true);

            // Reset failover attempts
            failover.failoverAttempts.clear();

            // Mock delay to avoid actual delay
            const originalSetTimeout = global.setTimeout;
            global.setTimeout = jest.fn().mockImplementation(cb => cb());

            // Wrap in try-catch to handle the first failure
            try {
                await failover.acquireConnection();
            } catch (error) {
                // Ignore the first failure
            }

            const connection = await failover.acquireConnection();
            expect(connection).toBe(mockConnection);
            expect(mockConnectionPool.acquireConnection).toHaveBeenCalledTimes(2);

            // Restore original setTimeout
            global.setTimeout = originalSetTimeout;
        });

        it('should stop after max failover attempts', async () => {
            // Set initial attempts to max - 1
            failover.updateFailoverAttempts('default', failover.options.maxFailoverAttempts - 1);

            mockConnectionPool.acquireConnection.mockRejectedValue(new Error('Connection failed'));
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            await expect(failover.acquireConnection()).rejects.toThrow('Max failover attempts reached');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Max failover attempts'), expect.any(Object));
        });

        it('should respect circuit breaker state', async () => {
            mockCircuitBreaker.getState.mockReturnValue('OPEN');
            mockCircuitBreaker.allowRequest.mockReturnValue(false);

            await expect(failover.acquireConnection()).rejects.toThrow('Circuit breaker is open');
            expect(mockLogger.error).toHaveBeenCalledWith('Circuit breaker is open, aborting connection attempt');
        });

        it('should check connection health before returning', async () => {
            const mockConnection = { id: 'test_conn_1' };
            mockConnectionPool.acquireConnection.mockResolvedValueOnce(mockConnection);
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);
            mockKeepAlive.isConnectionHealthy.mockResolvedValueOnce(false);

            await expect(failover.acquireConnection()).rejects.toThrow('Connection health check failed');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Connection health check failed'), expect.any(Object));
        });
    });

    describe('health monitoring', () => {
        it('should start health check timer on initialization', () => {
            failover.startHealthCheck();
            expect(failover.healthCheckTimer).toBeDefined();
        });

        it('should stop health check timer on stop', () => {
            failover.startHealthCheck();
            failover.stopHealthCheck();
            expect(failover.healthCheckTimer).toBeNull();
        });

        it('should detect unhealthy connections', async () => {
            const mockConnection = { id: 'test_conn_1' };
            mockKeepAlive.isConnectionHealthy.mockResolvedValueOnce(false);

            await failover.checkConnectionHealth(mockConnection);
            expect(mockCircuitBreaker.recordFailure).toHaveBeenCalledWith(mockConnection.id);
        });

        it('should reset failover attempts on successful health check', async () => {
            const mockConnection = { id: 'test_conn_1' };
            mockKeepAlive.isConnectionHealthy.mockResolvedValueOnce(true);
            failover.failoverAttempts.set(mockConnection.id, 2);

            await failover.checkConnectionHealth(mockConnection);
            expect(failover.failoverAttempts.get(mockConnection.id)).toBe(0);
            expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalledWith(mockConnection.id);
        });
    });

    describe('metrics', () => {
        it('should track failover attempts', () => {
            failover.updateFailoverAttempts('test_conn_1', 1);
            expect(mockMetrics.gauge).toHaveBeenCalledWith('connection_failover_attempts', 1, { priority: 'test' });
        });

        it('should track failover latency', () => {
            failover.updateLastFailoverTime('test_conn_1', Date.now());
            expect(mockMetrics.histogram).toHaveBeenCalledWith('connection_failover_latency', 0, { priority: 'test' });
        });
    });

    describe('error handling', () => {
        it('should handle metrics reporting errors in updateFailoverAttempts', () => {
            // Mock metrics to throw error
            mockMetrics.gauge.mockImplementationOnce(() => {
                throw new Error('Metrics error');
            });

            // Should not throw error, just log it
            failover.updateFailoverAttempts('test_conn_1', 1);
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to update failover attempts metric', expect.any(Object));
        });

        it('should handle metrics reporting errors in updateLastFailoverTime', () => {
            // Mock metrics to throw error
            mockMetrics.histogram.mockImplementationOnce(() => {
                throw new Error('Metrics error');
            });

            // Should not throw error, just log it
            failover.updateLastFailoverTime('test_conn_1', Date.now());
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to update last failover time metric', expect.any(Object));
        });

        it('should handle connection pool errors in acquireConnection', async () => {
            mockConnectionPool.acquireConnection.mockRejectedValueOnce(new Error('Pool error'));
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            await expect(failover.acquireConnection()).rejects.toThrow('Pool error');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Connection acquisition failed'), expect.any(Object));
        });

        it('should handle health check errors', async () => {
            mockConnectionPool.acquireConnection.mockResolvedValueOnce({ id: 'test_conn_1' });
            mockKeepAlive.isConnectionHealthy.mockRejectedValueOnce(new Error('Health check error'));
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            await expect(failover.acquireConnection()).rejects.toThrow('Connection health check failed');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Health check failed'), expect.any(Object));
        });

        it('should handle timer errors in startHealthCheck', () => {
            // Mock setInterval to throw error
            const originalSetInterval = global.setInterval;
            global.setInterval = jest.fn().mockImplementationOnce(() => {
                throw new Error('Timer error');
            });

            // Should not throw error, just log it
            failover.startHealthCheck();
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to start health check timer', expect.any(Object));

            // Restore original setInterval
            global.setInterval = originalSetInterval;
        });

        it('should handle timer errors in stopHealthCheck', () => {
            // Mock clearInterval to throw error
            const originalClearInterval = global.clearInterval;
            global.clearInterval = jest.fn().mockImplementationOnce(() => {
                throw new Error('Timer error');
            });

            // Set a timer to clear
            failover.healthCheckTimer = 123;

            // Should not throw error, just log it
            failover.stopHealthCheck();
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to stop health check timer', expect.any(Object));

            // Restore original clearInterval
            global.clearInterval = originalClearInterval;
        });

        it('should handle errors in stop method', () => {
            // Mock clearInterval to throw error
            const originalClearInterval = global.clearInterval;
            global.clearInterval = jest.fn().mockImplementationOnce(() => {
                throw new Error('Timer error');
            });

            // Set a timer to clear
            failover.healthCheckTimer = 123;

            // Should not throw error, just log it
            failover.stop();
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to stop health check timer', expect.any(Object));

            // Restore original clearInterval
            global.clearInterval = originalClearInterval;
        });

        it('should handle multiple errors in stop method', () => {
            // Mock clearInterval to throw error
            const originalClearInterval = global.clearInterval;
            global.clearInterval = jest.fn().mockImplementationOnce(() => {
                throw new Error('Timer error');
            });

            // Set a timer to clear
            failover.healthCheckTimer = 123;

            // Should not throw error, just log both errors
            failover.stop();
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to stop health check timer', expect.any(Object));

            // Restore original clearInterval
            global.clearInterval = originalClearInterval;
        });
    });

    describe('edge cases', () => {
        it('should handle null connection from pool', async () => {
            mockConnectionPool.acquireConnection.mockResolvedValueOnce(null);
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            await expect(failover.acquireConnection()).rejects.toThrow('Failed to acquire connection');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Connection acquisition failed'), expect.any(Object));
        });

        it('should handle undefined connection from pool', async () => {
            mockConnectionPool.acquireConnection.mockResolvedValueOnce(undefined);
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            await expect(failover.acquireConnection()).rejects.toThrow('Failed to acquire connection');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Connection acquisition failed'), expect.any(Object));
        });

        it('should handle invalid priority in getNextPriority', () => {
            expect(failover.getNextPriority('invalid')).toBeNull();
        });

        it('should handle max attempts with multiple priorities', async () => {
            // Set initial attempts to max - 1
            failover.updateFailoverAttempts('high', failover.options.maxFailoverAttempts - 1);

            // Mock connection pool to fail
            mockConnectionPool.acquireConnection.mockRejectedValueOnce(new Error('Connection failed'));
            mockCircuitBreaker.getState.mockReturnValue('CLOSED');
            mockCircuitBreaker.allowRequest.mockReturnValue(true);

            // Should fail after max attempts
            await expect(failover.acquireConnection('high')).rejects.toThrow('Max failover attempts reached');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Max failover attempts'), expect.any(Object));
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Connection acquisition failed'), expect.any(Object));
        });
    });
}); 