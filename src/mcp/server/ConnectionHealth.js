const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionHealth {
  constructor(options = {}) {
    this.options = {
      checkInterval: options.checkInterval || 30000, // 30 seconds
      timeout: options.timeout || 5000, // 5 seconds
      maxErrors: options.maxErrors || 3,
      ...options
    };

    this.connections = new Map();
    this.monitors = new Map();

    // Initialize metrics
    this.healthCheckLatency = metrics.gauge('connection_health_check_latency', 'Latency of health checks in milliseconds', ['connection_id']);
    this.healthCheckErrors = metrics.counter('connection_health_check_errors', 'Number of health check errors', ['connection_id']);
    this.connectionHealthStatus = metrics.gauge('connection_health_status', 'Current health status of connection (1=healthy, 0=unhealthy)', ['connection_id']);
  }

  async checkHealth(connection) {
    try {
      const startTime = Date.now();
      
      // Perform health check
      const isHealthy = await this._performHealthCheck(connection);
      
      // Update metrics
      const latency = Date.now() - startTime;
      this.healthCheckLatency.set({ connection_id: connection.id }, latency);
      this.connectionHealthStatus.set({ connection_id: connection.id }, isHealthy ? 1 : 0);

      // Update connection health status
      connection.health = {
        ...connection.health,
        status: isHealthy ? 'healthy' : 'unhealthy',
        lastCheck: Date.now(),
        latency,
        errors: isHealthy ? 0 : (connection.health?.errors || 0) + 1
      };

      return isHealthy;
    } catch (error) {
      logger.error('Health check failed', { connectionId: connection.id, error: error.message });
      this.healthCheckErrors.inc({ connection_id: connection.id });
      
      connection.health = {
        ...connection.health,
        status: 'unhealthy',
        lastCheck: Date.now(),
        errors: (connection.health?.errors || 0) + 1
      };

      return false;
    }
  }

  async _performHealthCheck(connection) {
    // Implement actual health check logic here
    // This could include:
    // - Checking connection state
    // - Verifying device is still in range
    // - Testing basic communication
    // - Checking signal strength
    return connection.status === 'active';
  }

  monitorConnection(connection) {
    try {
      if (this.connections.has(connection.id)) {
        logger.warn('Connection already being monitored', { connectionId: connection.id });
        return;
      }

      this.connections.set(connection.id, connection);

      // Start monitoring interval
      const monitor = setInterval(async () => {
        try {
          await this.checkHealth(connection);
          if (connection.health?.errors >= this.options.maxErrors) {
            logger.error('Connection exceeded max errors', { connectionId: connection.id });
            this.stopMonitoring(connection.id);
          }
        } catch (error) {
          logger.error('Error in health monitoring', { connectionId: connection.id, error: error.message });
        }
      }, this.options.checkInterval);

      this.monitors.set(connection.id, monitor);
    } catch (error) {
      logger.error('Error in health monitoring', { connectionId: connection.id, error: error.message });
      throw error;
    }
  }

  stopMonitoring(connectionId) {
    const monitor = this.monitors.get(connectionId);
    if (monitor) {
      clearInterval(monitor);
      this.monitors.delete(connectionId);
    }
    this.connections.delete(connectionId);
  }

  getHealthStatus(connectionId) {
    const connection = this.connections.get(connectionId);
    return connection?.health || null;
  }

  getUnhealthyConnections() {
    return Array.from(this.connections.values())
      .filter(conn => conn.health?.status === 'unhealthy');
  }

  cleanup() {
    // Stop all monitoring intervals
    for (const [connectionId, monitor] of this.monitors.entries()) {
      clearInterval(monitor);
      this.monitors.delete(connectionId);
    }
    this.connections.clear();
  }
}

module.exports = ConnectionHealth; 