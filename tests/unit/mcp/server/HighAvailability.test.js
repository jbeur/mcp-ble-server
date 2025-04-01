const HighAvailability = require('../../../../src/mcp/server/HighAvailability');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('HighAvailability', () => {
    let highAvailability;
    let mockConnectionPool;
    let mockCircuitBreaker;
    let mockKeepAlive;
    let mockTimer;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock timer
        mockTimer = {
            id: 123
        };
        global.setInterval = jest.fn().mockReturnValue(mockTimer);
        global.clearInterval = jest.fn();

        // Setup mock objects
        mockConnectionPool = {
            acquire: jest.fn(),
            release: jest.fn(),
            getStatus: jest.fn(),
            getPoolSize: jest.fn(),
            getActiveConnections: jest.fn()
        };

        mockCircuitBreaker = {
            getState: jest.fn(),
            recordSuccess: jest.fn(),
            recordFailure: jest.fn(),
            isOpen: jest.fn()
        };

        mockKeepAlive = {
            start: jest.fn(),
            stop: jest.fn(),
            isActive: jest.fn()
        };

        // Initialize HighAvailability instance
        highAvailability = new HighAvailability({
            connectionPool: mockConnectionPool,
            circuitBreaker: mockCircuitBreaker,
            keepAlive: mockKeepAlive,
            config: {
                maxRetries: 3,
                retryDelay: 1000,
                healthCheckInterval: 5000,
                failoverTimeout: 10000
            }
        });
    });

    afterEach(() => {
        // Restore timer functions
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with provided dependencies', () => {
            expect(highAvailability.connectionPool).toBe(mockConnectionPool);
            expect(highAvailability.circuitBreaker).toBe(mockCircuitBreaker);
            expect(highAvailability.keepAlive).toBe(mockKeepAlive);
            expect(highAvailability.config).toBeDefined();
        });

        it('should throw error if required dependencies are missing', () => {
            expect(() => new HighAvailability({})).toThrow('Connection pool is required');
            expect(() => new HighAvailability({ connectionPool: mockConnectionPool })).toThrow('Circuit breaker is required');
            expect(() => new HighAvailability({ 
                connectionPool: mockConnectionPool,
                circuitBreaker: mockCircuitBreaker 
            })).toThrow('Keep-alive is required');
        });
    });

    describe('start', () => {
        it('should start health monitoring and keep-alive', async () => {
            await highAvailability.start();
            expect(mockKeepAlive.start).toHaveBeenCalled();
            expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
            expect(highAvailability.healthCheckTimer).toBe(mockTimer);
        });

        it('should handle errors during startup', async () => {
            mockKeepAlive.start.mockRejectedValue(new Error('Start failed'));
            await expect(highAvailability.start()).rejects.toThrow('Start failed');
        });
    });

    describe('stop', () => {
        it('should stop health monitoring and keep-alive', async () => {
            await highAvailability.start();
            await highAvailability.stop();
            expect(mockKeepAlive.stop).toHaveBeenCalled();
            expect(global.clearInterval).toHaveBeenCalledWith(mockTimer);
            expect(highAvailability.healthCheckTimer).toBeNull();
        });

        it('should handle errors during shutdown', async () => {
            mockKeepAlive.stop.mockRejectedValue(new Error('Stop failed'));
            await expect(highAvailability.stop()).rejects.toThrow('Stop failed');
        });
    });

    describe('health check', () => {
        it('should perform health check and record metrics', async () => {
            mockConnectionPool.getStatus.mockResolvedValue('healthy');
            mockConnectionPool.getPoolSize.mockReturnValue(10);
            mockConnectionPool.getActiveConnections.mockReturnValue(5);

            await highAvailability.start();
            // Trigger health check
            await highAvailability._performHealthCheck();

            expect(metrics.gauge).toHaveBeenCalledWith('connection_pool.size', 10);
            expect(metrics.gauge).toHaveBeenCalledWith('connection_pool.active', 5);
            expect(metrics.gauge).toHaveBeenCalledWith('connection_pool.health', 1);
        });

        it('should handle unhealthy pool status', async () => {
            mockConnectionPool.getStatus.mockResolvedValue('unhealthy');
            mockCircuitBreaker.isOpen.mockReturnValue(false);

            await highAvailability.start();
            await highAvailability._performHealthCheck();

            expect(metrics.gauge).toHaveBeenCalledWith('connection_pool.health', 0);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('failover handling', () => {
        it('should attempt failover when primary connection fails', async () => {
            const error = new Error('Primary failed');
            mockConnectionPool.acquire
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce({ id: 'backup-1' });
            mockCircuitBreaker.isOpen.mockReturnValue(false);

            await expect(highAvailability.acquireConnection()).rejects.toThrow('Primary failed');
            expect(metrics.histogram).toHaveBeenCalledWith('connection.failover.latency', expect.any(Number));
        });

        it('should respect circuit breaker state during failover', async () => {
            mockCircuitBreaker.isOpen.mockReturnValue(true);
            await expect(highAvailability.acquireConnection()).rejects.toThrow('Circuit breaker is open');
        });
    });

    describe('connection management', () => {
        it('should release connection and update metrics', async () => {
            const connection = { id: 'test-1' };
            highAvailability.connectionStartTimes.set(connection.id, Date.now() - 1000); // Set start time 1 second ago
            await highAvailability.releaseConnection(connection);
            expect(mockConnectionPool.release).toHaveBeenCalledWith(connection);
            expect(metrics.histogram).toHaveBeenCalledWith('connection.lifetime', expect.any(Number));
        });

        it('should handle connection release errors', async () => {
            const connection = { id: 'test-1' };
            mockConnectionPool.release.mockRejectedValue(new Error('Release failed'));
            await expect(highAvailability.releaseConnection(connection)).rejects.toThrow('Release failed');
        });
    });
}); 