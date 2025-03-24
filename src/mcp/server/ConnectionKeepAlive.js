const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionKeepAlive {
  constructor(options = {}) {
    this.options = {
      keepAliveInterval: options.keepAliveInterval || 30000, // 30 seconds
      pingTimeout: options.pingTimeout || 5000, // 5 seconds
      maxPingFailures: options.maxPingFailures || 3,
      ...options
    };

    this.connections = new Map();
    this.monitors = new Map();

    // Initialize metrics
    this.pingLatency = metrics.gauge('connection_ping_latency', 'Latency of keep-alive pings in milliseconds', ['connection_id']);
    this.pingFailures = metrics.counter('connection_ping_failures', 'Number of ping failures', ['connection_id']);
  }

  startKeepAlive(connection) {
    if (this.connections.has(connection.id)) {
      logger.warn('Connection already being monitored', { connectionId: connection.id });
      return;
    }

    logger.info('Starting keep-alive monitoring', { connectionId: connection.id });
    this.connections.set(connection.id, connection);

    // Start keep-alive interval
    const monitor = setInterval(async () => {
      try {
        await this.sendKeepAlive(connection);
      } catch (error) {
        logger.error('Error in keep-alive monitoring', { connectionId: connection.id, error: error.message });
      }
    }, this.options.keepAliveInterval);

    this.monitors.set(connection.id, monitor);
  }

  stopKeepAlive(connectionId) {
    const monitor = this.monitors.get(connectionId);
    if (!monitor) {
      logger.warn('No keep-alive monitoring found for connection', { connectionId });
      return;
    }

    logger.info('Stopping keep-alive monitoring', { connectionId });
    clearInterval(monitor);
    this.monitors.delete(connectionId);
    this.connections.delete(connectionId);
  }

  async sendKeepAlive(connection) {
    const startTime = Date.now();
    try {
      logger.debug('Sending keep-alive ping', { connectionId: connection.id });
      await connection.ping();

      // Update last ping time and latency
      connection.lastPing = Date.now();
      const latency = connection.lastPing - startTime;
      this.pingLatency.set({ connection_id: connection.id }, latency);

      logger.debug('Keep-alive ping successful', { connectionId: connection.id, latency });
    } catch (error) {
      logger.error('Keep-alive ping failed', { connectionId: connection.id, error: error.message });
      this.pingFailures.inc({ connection_id: connection.id });

      // Check if max failures exceeded
      const failures = (connection.pingFailures || 0) + 1;
      connection.pingFailures = failures;

      if (failures >= this.options.maxPingFailures) {
        logger.error('Max ping failures exceeded', { connectionId: connection.id, failures });
        this.stopKeepAlive(connection.id);
      }
    }
  }

  cleanup() {
    logger.info('Cleaning up keep-alive monitoring', { connectionCount: this.monitors.size });
    for (const [connectionId, monitor] of this.monitors.entries()) {
      clearInterval(monitor);
      this.monitors.delete(connectionId);
    }
    this.connections.clear();
  }
}

module.exports = ConnectionKeepAlive; 