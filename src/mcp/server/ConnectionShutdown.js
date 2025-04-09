const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionShutdown {
  constructor(options = {}) {
    this.options = {
      quiescenceTimeout: options.quiescenceTimeout || 5000, // 5 seconds
      shutdownTimeout: options.shutdownTimeout || 10000, // 10 seconds
      ...options
    };

    // Initialize metrics
    this.shutdownDuration = metrics.gauge('connection_shutdown_duration', 'Duration of connection shutdown in milliseconds', ['connection_id']);
    this.shutdownErrors = metrics.counter('connection_shutdown_errors', 'Number of errors during connection shutdown', ['connection_id']);
    this.activeConnections = metrics.gauge('active_connections_during_shutdown', 'Number of active connections during shutdown');
  }

  async initiateShutdown(connection) {
    const startTime = Date.now();
    try {
      logger.info('Initiating connection shutdown', { connectionId: connection.id });

      // Disconnect the connection
      await connection.disconnect();

      // Cleanup resources
      await connection.cleanup();

      // Update connection status
      connection.status = 'closed';

      // Track shutdown duration
      const duration = Date.now() - startTime;
      this.shutdownDuration.set({ connection_id: connection.id }, duration);

      logger.info('Connection shutdown complete', { connectionId: connection.id, duration });
    } catch (error) {
      logger.error('Error during connection shutdown', { connectionId: connection.id, error: error.message });
      this.shutdownErrors.inc({ connection_id: connection.id });
      throw error;
    }
  }

  async shutdownAll(connections) {
    logger.info('Initiating shutdown of all connections', { count: connections.length });
    const startTime = Date.now();

    try {
      // Wait for connections to become idle
      await this.waitForQuiescence(connections);

      // Shutdown all connections
      const results = await Promise.allSettled(
        connections.map(async (connection) => {
          try {
            await this.initiateShutdown(connection);
          } catch (error) {
            logger.error('Error during connection shutdown', { connectionId: connection.id, error: error.message });
          }
        })
      );

      // Log results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const duration = Date.now() - startTime;

      logger.info('Shutdown complete', { successful, failed, duration });
    } catch (error) {
      logger.error('Error during shutdown process', { error: error.message });
      throw error;
    }
  }

  async waitForQuiescence(connections, timeout = this.options.quiescenceTimeout) {
    logger.info('Waiting for connections to become idle', { count: connections.length });
    const startTime = Date.now();
    const maxRetries = Math.floor(timeout / 100); // Maximum number of retries based on timeout and check interval
    let retryCount = 0;

    while (retryCount < maxRetries) {
      // Update active connections metric
      const activeCount = connections.filter(conn => conn.isActive?.()).length;
      this.activeConnections.set(activeCount);

      // Check if all connections are idle
      if (activeCount === 0) {
        const duration = Date.now() - startTime;
        logger.info('All connections are idle', { duration });
        return;
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for connections to become idle');
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 100));
      retryCount++;
    }

    throw new Error('Maximum retry count reached while waiting for connections to become idle');
  }

  async shutdown() {
    try {
      const activeConnections = this.getActiveConnections();
      
      if (activeConnections.length === 0) {
        logger.info('No active connections to shutdown');
        return;
      }

      logger.info(`Shutting down ${activeConnections.length} active connections`);
      
      for (const connection of activeConnections) {
        try {
          await this.closeConnection(connection);
        } catch (error) {
          logger.error('Error closing connection:', error);
          metrics.incrementCounter('connection_shutdown_errors');
        }
      }
      
      logger.info('All connections shutdown complete');
    } catch (error) {
      logger.error('Error during connection shutdown:', error);
      metrics.incrementCounter('shutdown_errors');
      throw error;
    }
  }
}

module.exports = ConnectionShutdown; 