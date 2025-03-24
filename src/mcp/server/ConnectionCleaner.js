const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionCleaner {
  constructor(options = {}) {
    this.options = {
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      staleTimeout: options.staleTimeout || 300000, // 5 minutes
      ...options
    };

    this.cleanerInterval = null;

    // Initialize metrics
    this.cleanupDuration = metrics.gauge('connection_cleanup_duration', 'Duration of connection cleanup in milliseconds', ['connection_id']);
    this.staleConnections = metrics.counter('stale_connections_cleaned', 'Number of stale connections cleaned', ['connection_id']);
  }

  startCleaner() {
    if (this.cleanerInterval) {
      logger.warn('Cleaner already running');
      return;
    }

    logger.info('Starting connection cleaner', { interval: this.options.cleanupInterval });
    this.cleanerInterval = setInterval(() => {
      this.cleanStaleConnections();
    }, this.options.cleanupInterval);
  }

  stopCleaner() {
    if (!this.cleanerInterval) {
      return;
    }

    logger.info('Stopping connection cleaner');
    clearInterval(this.cleanerInterval);
    this.cleanerInterval = null;
  }

  async cleanStaleConnections(connections) {
    if (!connections || connections.size === 0) {
      logger.warn('No connections provided for cleanup');
      return;
    }

    const startTime = Date.now();
    logger.info('Starting stale connection cleanup', { connectionCount: connections.size });

    try {
      const staleConnections = Array.from(connections.values())
        .filter(conn => this.isStale(conn));

      logger.info('Found stale connections', { count: staleConnections.length });

      for (const connection of staleConnections) {
        const cleanupStart = Date.now();
        
        try {
          // Disconnect and cleanup the connection
          await connection.disconnect();
          await connection.cleanup();

          // Track cleanup metrics
          const duration = Date.now() - cleanupStart;
          this.cleanupDuration.set({ connection_id: connection.id }, duration);
          this.staleConnections.inc({ connection_id: connection.id });

          logger.info('Cleaned stale connection', {
            connectionId: connection.id,
            duration
          });
        } catch (error) {
          logger.error('Error cleaning stale connection', {
            connectionId: connection.id,
            error: error.message
          });
          throw error; // Re-throw to ensure test catches it
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Completed stale connection cleanup', {
        duration,
        cleanedCount: staleConnections.length
      });
    } catch (error) {
      logger.error('Error during stale connection cleanup', { error: error.message });
      throw error; // Re-throw to allow error handling by caller
    }
  }

  isStale(connection) {
    if (!connection || !connection.lastActivity) {
      return true;
    }

    const timeSinceLastActivity = Date.now() - connection.lastActivity;
    return timeSinceLastActivity > this.options.staleTimeout;
  }
}

module.exports = ConnectionCleaner; 