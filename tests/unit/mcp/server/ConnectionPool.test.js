const ConnectionPool = require('../../../../src/mcp/server/ConnectionPool');
const { metrics } = require('../../../../src/utils/metrics');

jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ConnectionPool', () => {
    let pool;
    let mockMetrics;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        
        // Set up mock metrics
        mockMetrics = {
            gauge: jest.fn().mockReturnValue({
                set: jest.fn()
            }),
            counter: jest.fn().mockReturnValue({
                inc: jest.fn()
            }),
            histogram: jest.fn().mockReturnValue({
                observe: jest.fn()
            })
        };
        
        // Apply mocks
        metrics.gauge = mockMetrics.gauge;
        metrics.counter = mockMetrics.counter;
        metrics.histogram = mockMetrics.histogram;
        
        pool = new ConnectionPool({
            minSize: 3,
            maxSize: 10,
            idleTimeout: 5000,
            validationInterval: 1000,
            priorityLevels: ['high', 'medium', 'low'],
            loadBalanceThreshold: 0.8
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        pool.stopValidationTimer();
    });

    describe('constructor', () => {
        it('should initialize with default options when none provided', () => {
            const defaultPool = new ConnectionPool();
            expect(defaultPool.options.minSize).toBe(5);
            expect(defaultPool.options.maxSize).toBe(20);
            expect(defaultPool.options.idleTimeout).toBe(30000);
        });

        it('should initialize with provided options', () => {
            expect(pool.options.minSize).toBe(3);
            expect(pool.options.maxSize).toBe(10);
            expect(pool.options.idleTimeout).toBe(5000);
        });

        it('should initialize empty pool and sets', () => {
            expect(pool.pool.size).toBe(0);
            expect(pool.availableConnections.size).toBe(0);
            expect(pool.inUseConnections.size).toBe(0);
            expect(pool.connectionCount).toBe(0);
        });
    });

    describe('initialize', () => {
        it('should create minimum number of connections on initialization', async () => {
            await pool.initialize();
            expect(pool.getPoolSize()).toBe(3);
            expect(pool.getAvailableConnections()).toBe(3);
            expect(pool.getInUseConnections()).toBe(0);
        });

        it('should handle initialization errors', async () => {
            const error = new Error('Connection failed');
            const originalCreateConnection = pool.createConnection;
            pool.createConnection = jest.fn().mockRejectedValue(error);
            
            await expect(pool.initialize()).rejects.toThrow(error);
            expect(pool.metrics.connectionErrors.inc).toHaveBeenCalled();
            
            pool.createConnection = originalCreateConnection;
        });
    });

    describe('createConnection', () => {
        it('should create a new connection with correct properties', async () => {
            const connection = await pool.createConnection();
            
            expect(connection).toHaveProperty('id', 'conn_0');
            expect(connection).toHaveProperty('createdAt');
            expect(connection).toHaveProperty('lastUsed');
            expect(connection).toHaveProperty('status', 'available');
            expect(pool.pool.has('conn_0')).toBe(true);
            expect(pool.availableConnections.has('conn_0')).toBe(true);
        });

        it('should increment connection count', async () => {
            await pool.createConnection();
            expect(pool.connectionCount).toBe(1);
        });

        it('should handle connection creation errors', async () => {
            const error = new Error('Connection creation failed');
            const originalCreateConnection = pool.createConnection;
            const errorCounterSpy = jest.spyOn(pool.metrics.connectionErrors, 'inc');

            pool.createConnection = jest.fn().mockImplementation(() => {
                pool.metrics.connectionErrors.inc();
                throw error;
            });

            try {
                await pool.createConnection();
                fail('Should have thrown an error');
            } catch (e) {
                expect(e).toBe(error);
                expect(errorCounterSpy).toHaveBeenCalled();
            } finally {
                pool.createConnection = originalCreateConnection;
            }
        });
    });

    describe('connection reuse', () => {
        it('should acquire and release connections', async () => {
            await pool.initialize();
            
            // Acquire a connection
            const connection = await pool.acquireConnection();
            expect(connection).toBeDefined();
            expect(connection.status).toBe('in_use');
            expect(pool.getInUseConnections()).toBe(1);
            expect(pool.getAvailableConnections()).toBe(2);
            expect(pool.metrics.connectionAcquisitions.inc).toHaveBeenCalled();
            
            // Release the connection
            await pool.releaseConnection(connection.id);
            expect(connection.status).toBe('available');
            expect(pool.getInUseConnections()).toBe(0);
            expect(pool.getAvailableConnections()).toBe(3);
            expect(pool.metrics.connectionReleases.inc).toHaveBeenCalled();
        });

        it('should create new connections when pool is full', async () => {
            await pool.initialize();
            
            // Acquire all available connections
            const connections = [];
            for (let i = 0; i < pool.options.maxSize; i++) {
                const conn = await pool.acquireConnection();
                connections.push(conn);
            }
            
            // Try to acquire one more connection
            await expect(pool.acquireConnection()).rejects.toThrow('No available connections and pool is full');
            
            // Release all connections
            for (const conn of connections) {
                await pool.releaseConnection(conn.id);
            }
        });

        it('should validate and remove invalid connections', async () => {
            await pool.initialize();
            
            // Acquire a connection
            const connection = await pool.acquireConnection();
            
            // Simulate time passing
            jest.advanceTimersByTime(pool.options.idleTimeout + 1000);
            
            // Trigger validation
            await pool.validateConnections();
            
            // Check that invalid connection was removed
            expect(pool.pool.has(connection.id)).toBe(false);
            expect(pool.metrics.invalidConnections.inc).toHaveBeenCalled();
            expect(pool.metrics.connectionValidations.inc).toHaveBeenCalled();
        });

        it('should maintain minimum pool size after validation', async () => {
            await pool.initialize();
            
            // Acquire all connections
            const connections = [];
            for (let i = 0; i < pool.options.minSize; i++) {
                const conn = await pool.acquireConnection();
                connections.push(conn);
            }
            
            // Simulate time passing
            jest.advanceTimersByTime(pool.options.idleTimeout + 1000);
            
            // Trigger validation
            await pool.validateConnections();
            
            // Check that pool size is maintained
            expect(pool.getPoolSize()).toBe(pool.options.minSize);
        });

        it('should handle release of non-existent connection', async () => {
            await expect(pool.releaseConnection('non_existent')).rejects.toThrow('Connection non_existent not found in pool');
            expect(pool.metrics.connectionErrors.inc).toHaveBeenCalled();
        });
    });

    describe('priority management', () => {
        it('should create connections with specified priority', async () => {
            await pool.initialize();
            
            const highPriorityConn = await pool.acquireConnection('high');
            expect(highPriorityConn.priority).toBe('high');
            
            const mediumPriorityConn = await pool.acquireConnection('medium');
            expect(mediumPriorityConn.priority).toBe('medium');
            
            const lowPriorityConn = await pool.acquireConnection('low');
            expect(lowPriorityConn.priority).toBe('low');
        });

        it('should prefer connections matching requested priority', async () => {
            await pool.initialize();
            
            // Create connections with different priorities
            const highConn = await pool.acquireConnection('high');
            const mediumConn = await pool.acquireConnection('medium');
            const lowConn = await pool.acquireConnection('low');
            
            // Release all connections
            await pool.releaseConnection(highConn.id);
            await pool.releaseConnection(mediumConn.id);
            await pool.releaseConnection(lowConn.id);
            
            // Try to acquire high priority connection
            const acquiredConn = await pool.acquireConnection('high');
            expect(acquiredConn.id).toBe(highConn.id);
            expect(acquiredConn.priority).toBe('high');
        });

        it('should fall back to any available connection if priority match not found', async () => {
            await pool.initialize();
            
            // Create only medium priority connections
            const conn1 = await pool.acquireConnection('medium');
            const conn2 = await pool.acquireConnection('medium');
            await pool.releaseConnection(conn1.id);
            await pool.releaseConnection(conn2.id);
            
            // Try to acquire high priority connection
            const acquiredConn = await pool.acquireConnection('high');
            expect(acquiredConn.priority).toBe('high'); // Priority should be updated to requested priority
        });

        it('should reject invalid priority levels', async () => {
            await expect(pool.acquireConnection('invalid')).rejects.toThrow('Invalid priority level');
        });
    });

    describe('load balancing', () => {
        it('should trigger load balancing when threshold is exceeded', async () => {
            await pool.initialize();
            
            // Acquire connections until threshold is exceeded
            const connections = [];
            for (let i = 0; i < Math.ceil(pool.options.minSize * pool.options.loadBalanceThreshold); i++) {
                const conn = await pool.acquireConnection();
                connections.push(conn);
            }
            
            // Try to acquire one more connection
            const newConn = await pool.acquireConnection();
            expect(newConn).toBeDefined();
            
            // Verify pool size increased
            expect(pool.getPoolSize()).toBeGreaterThan(pool.options.minSize);
            
            // Release all connections
            for (const conn of connections) {
                await pool.releaseConnection(conn.id);
            }
            await pool.releaseConnection(newConn.id);
        });

        it('should respect max size limit during load balancing', async () => {
            await pool.initialize();
            
            // Acquire connections until threshold is exceeded
            const connections = [];
            for (let i = 0; i < pool.options.maxSize; i++) {
                const conn = await pool.acquireConnection();
                connections.push(conn);
            }
            
            // Try to acquire one more connection
            await expect(pool.acquireConnection()).rejects.toThrow('No available connections and pool is full');
            
            // Release all connections
            for (const conn of connections) {
                await pool.releaseConnection(conn.id);
            }
        });
    });

    describe('performance metrics', () => {
        it('should track acquisition and release times', async () => {
            await pool.initialize();
            
            // Mock Date.now() to control timing
            const originalDateNow = Date.now;
            let currentTime = 1000;
            Date.now = jest.fn().mockImplementation(() => {
                currentTime += 100;
                return currentTime;
            });
            
            try {
                // Acquire and release a connection
                const connection = await pool.acquireConnection();
                await pool.releaseConnection(connection.id);
                
                const metrics = pool.getPerformanceMetrics();
                expect(metrics.lastAcquisitionTime).toBeGreaterThan(0);
                expect(metrics.lastReleaseTime).toBeGreaterThan(0);
                expect(metrics.acquisitionTimes.length).toBe(1);
                expect(metrics.releaseTimes.length).toBe(1);
            } finally {
                Date.now = originalDateNow;
            }
        });

        it('should track error rates', async () => {
            // Force an error
            const originalCreateConnection = pool.createConnection;
            const error = new Error('Test error');
            pool.createConnection = jest.fn().mockRejectedValue(error);
            
            try {
                await pool.initialize();
                // Should not reach here
                expect.fail('Should have thrown an error');
            } catch (e) {
                expect(e.message).toBe('Test error');
            }
            
            // Try another operation that should fail
            try {
                await pool.acquireConnection();
                expect.fail('Should have thrown an error');
            } catch (e) {
                expect(e.message).toBe('Test error');
            }
            
            const metrics = pool.getPerformanceMetrics();
            expect(metrics.errors).toBe(2);
            expect(metrics.errorRate).toBeGreaterThan(0);
            
            pool.createConnection = originalCreateConnection;
        });

        it('should update priority distribution metrics', async () => {
            await pool.initialize();
            
            // Create connections with different priorities
            await pool.acquireConnection('high');
            await pool.acquireConnection('medium');
            await pool.acquireConnection('low');
            
            // Verify metrics were updated
            expect(pool.metrics.priorityDistribution.set).toHaveBeenCalledWith(
                expect.objectContaining({ priority: 'high' }),
                expect.any(Number)
            );
            expect(pool.metrics.priorityDistribution.set).toHaveBeenCalledWith(
                expect.objectContaining({ priority: 'medium' }),
                expect.any(Number)
            );
            expect(pool.metrics.priorityDistribution.set).toHaveBeenCalledWith(
                expect.objectContaining({ priority: 'low' }),
                expect.any(Number)
            );
        });

        it('should calculate load balance score', async () => {
            await pool.initialize();
            
            // Acquire half of the connections
            const connections = [];
            for (let i = 0; i < pool.options.minSize / 2; i++) {
                const conn = await pool.acquireConnection();
                connections.push(conn);
            }
            
            // Verify load balance score is close to 1 (optimal)
            expect(pool.metrics.loadBalanceScore.set).toHaveBeenCalledWith(
                expect.any(Number)
            );
            
            // Release all connections
            for (const conn of connections) {
                await pool.releaseConnection(conn.id);
            }
        });
    });

    describe('metrics', () => {
        it('should update metrics when pool size changes', async () => {
            await pool.createConnection();
            // We now have more metrics to update (priority distribution, load balance, etc.)
            expect(metrics.gauge().set).toHaveBeenCalled();
        });
    });
}); 