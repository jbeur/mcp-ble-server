const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class HighAvailability {
    constructor({ connectionPool, circuitBreaker, keepAlive, config }) {
        if (!connectionPool) {
            throw new Error('Connection pool is required');
        }
        if (!circuitBreaker) {
            throw new Error('Circuit breaker is required');
        }
        if (!keepAlive) {
            throw new Error('Keep-alive is required');
        }

        this.connectionPool = connectionPool;
        this.circuitBreaker = circuitBreaker;
        this.keepAlive = keepAlive;
        this.config = {
            maxRetries: 3,
            retryDelay: 1000,
            healthCheckInterval: 5000,
            failoverTimeout: 10000,
            ...config
        };

        this.healthCheckTimer = null;
        this.connectionStartTimes = new Map();
    }

    async start() {
        try {
            await this.keepAlive.start();
            this.startHealthCheck();
            logger.info('High availability system started');
        } catch (error) {
            logger.error('Failed to start high availability system', { error: error.message });
            this.stopHealthCheck();
            throw error;
        }
    }

    async stop() {
        try {
            this.stopHealthCheck();
            await this.keepAlive.stop();
            logger.info('High availability system stopped');
        } catch (error) {
            logger.error('Failed to stop high availability system', { error: error.message });
            throw error;
        }
    }

    startHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        const healthCheckFunction = async () => {
            try {
                await this._performHealthCheck();
            } catch (error) {
                logger.error('Health check failed', { error: error.message });
            }
        };

        this.healthCheckTimer = setInterval(healthCheckFunction, this.config.healthCheckInterval);
        return this.healthCheckTimer;
    }

    stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    async _performHealthCheck() {
        try {
            const status = await this.connectionPool.getStatus();
            const poolSize = this.connectionPool.getPoolSize();
            const activeConnections = this.connectionPool.getActiveConnections();

            metrics.gauge('connection_pool.size', poolSize);
            metrics.gauge('connection_pool.active', activeConnections);
            metrics.gauge('connection_pool.health', status === 'healthy' ? 1 : 0);

            if (status !== 'healthy') {
                logger.error('Connection pool health check failed', {
                    status,
                    poolSize,
                    activeConnections
                });
            }
        } catch (error) {
            logger.error('Health check failed', { error: error.message });
            throw error;
        }
    }

    async acquireConnection() {
        if (this.circuitBreaker.isOpen()) {
            throw new Error('Circuit breaker is open');
        }

        const startTime = Date.now();
        try {
            const connection = await this.connectionPool.acquire();
            this.connectionStartTimes.set(connection.id, startTime);
            this.circuitBreaker.recordSuccess();
            return connection;
        } catch (error) {
            this.circuitBreaker.recordFailure();
            logger.error('Failed to acquire connection', { error: error.message });
            const latency = Date.now() - startTime;
            metrics.histogram('connection.failover.latency', latency);
            throw error;
        }
    }

    async releaseConnection(connection) {
        try {
            const startTime = this.connectionStartTimes.get(connection.id);
            if (startTime) {
                const lifetime = Date.now() - startTime;
                metrics.histogram('connection.lifetime', lifetime);
                this.connectionStartTimes.delete(connection.id);
            }

            await this.connectionPool.release(connection);
        } catch (error) {
            logger.error('Failed to release connection', { error: error.message });
            throw error;
        }
    }
}

module.exports = HighAvailability; 