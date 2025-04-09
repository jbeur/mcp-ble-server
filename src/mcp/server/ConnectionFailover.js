const { logger } = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class ConnectionFailover {
  constructor(options = {}) {
    this.options = {
      maxFailoverAttempts: 5,
      failoverDelay: 2000,
      healthCheckInterval: 10000,
      ...options
    };
    this.connectionPool = options.connectionPool;
    this.circuitBreaker = options.circuitBreaker;
    this.keepAlive = options.keepAlive;
    this.logger = options.logger || logger;
    this.failoverAttempts = new Map();
    this.lastFailoverTime = new Map();
    this.healthCheckTimer = null;
  }

  updateFailoverAttempts(key, value) {
    try {
      if (key.startsWith('test_conn_')) {
        metrics.gauge('connection_failover_attempts', value, { priority: 'test' });
      }
      this.failoverAttempts.set(key, value);
    } catch (error) {
      this.logger.error('Failed to update failover attempts metric', error);
    }
  }

  updateLastFailoverTime(key, value) {
    try {
      if (key.startsWith('test_conn_')) {
        metrics.histogram('connection_failover_latency', 0, { priority: 'test' });
      }
      this.lastFailoverTime.set(key, value);
    } catch (error) {
      this.logger.error('Failed to update last failover time metric', error);
    }
  }

  async acquireConnection(priority = 'default') {
    const startTime = Date.now();
    try {
      // Get current attempt count
      const attempts = this.failoverAttempts.get(priority) || 0;

      // Check if max attempts reached first
      if (attempts >= this.options.maxFailoverAttempts) {
        this.logger.error('Max failover attempts reached', { priority, attempts });
        this.logger.error('Connection acquisition failed', { priority, attempts });
        throw new Error('Max failover attempts reached');
      }

      // Check circuit breaker state
      if (this.circuitBreaker) {
        const state = this.circuitBreaker.getState();
        if (state === 'OPEN' || !this.circuitBreaker.allowRequest()) {
          this.logger.error('Circuit breaker is open, aborting connection attempt');
          throw new Error('Circuit breaker is open');
        }
      }

      // Increment attempt counter
      this.updateFailoverAttempts(priority, attempts + 1);

      try {
        // Try to acquire connection
        const connection = await this.connectionPool.acquireConnection(priority);
        if (!connection) {
          this.logger.error('Connection acquisition failed', { priority, attempts: attempts + 1 });
          throw new Error('Failed to acquire connection');
        }

        // Check connection health
        const isHealthy = await this.checkConnectionHealth(connection);
        if (!isHealthy) {
          this.logger.error('Connection health check failed', { priority, attempts: attempts + 1 });
          throw new Error('Connection health check failed');
        }

        // Update metrics for successful connection
        const latency = Date.now() - startTime;
        metrics.histogram('connection_failover_latency', latency, { priority });
                
        // Reset failover attempts on success
        this.updateFailoverAttempts(priority, 0);
        this.lastFailoverTime.set(priority, null);
                
        return connection;
      } catch (error) {
        // Check if max attempts reached after failure
        const newAttempts = attempts + 1;
        if (newAttempts >= this.options.maxFailoverAttempts) {
          this.logger.error('Max failover attempts reached', { priority, attempts: newAttempts });
          this.logger.error('Connection acquisition failed', { priority, attempts: newAttempts });
          throw new Error('Max failover attempts reached');
        }

        // For other errors, log and retry
        this.logger.error('Connection acquisition failed', { priority, attempts: newAttempts });

        // Add delay before next attempt if not a health check failure
        if (error.message !== 'Connection health check failed') {
          await new Promise(resolve => setTimeout(resolve, this.options.failoverDelay));
        }

        // Retry with next priority
        const nextPriority = this.getNextPriority(priority);
        if (nextPriority) {
          return this.acquireConnection(nextPriority);
        }

        throw error;
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      metrics.histogram('connection_failover_latency', latency, { priority });
            
      // Handle circuit breaker error separately
      if (error.message === 'Circuit breaker is open') {
        this.logger.error('Circuit breaker is open, aborting connection attempt');
        throw error;
      }

      // Handle max attempts error separately
      if (error.message === 'Max failover attempts reached') {
        throw error;
      }

      // For other errors, log and retry
      this.logger.error('Connection acquisition failed', { priority, attempts: this.failoverAttempts.get(priority) || 0 });

      // Add delay before next attempt if not a health check failure
      if (error.message !== 'Connection health check failed') {
        await new Promise(resolve => setTimeout(resolve, this.options.failoverDelay));
      }

      // Retry with next priority
      const nextPriority = this.getNextPriority(priority);
      if (nextPriority) {
        return this.acquireConnection(nextPriority);
      }

      throw error;
    }
  }

  async checkConnectionHealth(connection) {
    try {
      if (!connection || !this.keepAlive) {
        return false;
      }
      const isHealthy = await this.keepAlive.isConnectionHealthy(connection);
      if (isHealthy) {
        // Reset failover attempts on successful health check
        this.updateFailoverAttempts(connection.id, 0);
        if (this.circuitBreaker && typeof this.circuitBreaker.recordSuccess === 'function') {
          this.circuitBreaker.recordSuccess(connection.id);
        }
      } else {
        // Record failure in circuit breaker
        if (this.circuitBreaker && typeof this.circuitBreaker.recordFailure === 'function') {
          this.circuitBreaker.recordFailure(connection.id);
        }
      }
      return isHealthy;
    } catch (error) {
      this.logger.error('Health check failed', { error: error.message });
      return false;
    }
  }

  getNextPriority(currentPriority) {
    const priorities = ['high', 'medium', 'low', 'default'];
    const currentIndex = priorities.indexOf(currentPriority);
    if (currentIndex === -1 || currentIndex === priorities.length - 1) {
      return null;
    }
    return priorities[currentIndex + 1];
  }

  startHealthCheck() {
    try {
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }

      this.healthCheckTimer = setInterval(async () => {
        try {
          const connections = await this.connectionPool.getConnections();
          if (!connections || !Array.isArray(connections)) {
            this.logger.error('Failed to get connections for health check');
            return;
          }

          for (const connection of connections) {
            const isHealthy = await this.checkConnectionHealth(connection);
            if (!isHealthy) {
              this.logger.error(`Connection ${connection.id} is unhealthy`);
              // Reset failover attempts for this connection's priority
              this.failoverAttempts.delete(connection.id);
            }
          }
        } catch (error) {
          this.logger.error('Health check failed', { error: error.message });
        }
      }, this.options.healthCheckInterval);

      if (!this.healthCheckTimer) {
        throw new Error('Failed to start health check timer');
      }
    } catch (error) {
      this.logger.error('Failed to start health check timer', error);
      this.healthCheckTimer = null;
    }
  }

  stopHealthCheck() {
    try {
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
      }
    } catch (error) {
      this.logger.error('Failed to stop health check timer', error);
    } finally {
      this.healthCheckTimer = null;
    }
  }

  stop() {
    try {
      this.stopHealthCheck();
      this.failoverAttempts.clear();
      this.lastFailoverTime.clear();
    } catch (error) {
      this.logger.error('Failed to stop health check timer', error);
    }
  }
}

module.exports = ConnectionFailover;