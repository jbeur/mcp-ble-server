const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionTimeout {
  constructor(options = {}) {
    this.options = {
      timeoutDuration: options.timeoutDuration || 30000, // 30 seconds
      recoveryTimeout: options.recoveryTimeout || 5000, // 5 seconds
      ...options
    };

    // Initialize metrics
    this.timeoutDuration = metrics.gauge('connection_timeout_duration', 'Duration of connection timeout in milliseconds', ['connection_id']);
    this.recoveryDuration = metrics.gauge('connection_recovery_duration', 'Duration of connection recovery in milliseconds', ['connection_id']);
    this.timeoutCount = metrics.counter('connection_timeouts', 'Number of connection timeouts', ['connection_id']);
  }

  startTimeout(connection) {
    if (!connection || !connection.id) {
      logger.warn('Invalid connection provided for timeout monitoring');
      return;
    }

    // Clear any existing timeout
    this.clearTimeout(connection);

    const startTime = Date.now();
    logger.info('Starting connection timeout monitoring', {
      connectionId: connection.id,
      duration: this.options.timeoutDuration
    });

    // Start timeout monitoring
    connection.timeoutId = setTimeout(async () => {
      try {
        await this.handleTimeout(connection, startTime);
      } catch (error) {
        logger.error('Error in timeout handler', {
          connectionId: connection.id,
          error: error.message
        });
      }
    }, this.options.timeoutDuration);

    // Track timeout duration
    this.timeoutDuration.set({ connection_id: connection.id }, this.options.timeoutDuration);
  }

  clearTimeout(connection) {
    if (!connection) return;

    if (connection.timeoutId) {
      clearTimeout(connection.timeoutId);
      connection.timeoutId = undefined;
      logger.debug('Cleared connection timeout', { connectionId: connection.id });
    }
  }

  async handleTimeout(connection, startTime) {
    if (!connection) return;

    const duration = Date.now() - startTime;
    logger.error('Connection timeout', {
      connectionId: connection.id,
      duration: this.options.timeoutDuration
    });

    try {
      // Disconnect and cleanup the connection
      await connection.disconnect();
      await connection.cleanup();

      // Track timeout metrics
      this.timeoutCount.inc({ connection_id: connection.id });

      // Start recovery process
      this.startRecovery(connection);
    } catch (error) {
      logger.error('Error handling connection timeout', {
        connectionId: connection.id,
        error: error.message
      });
      throw error;
    }
  }

  startRecovery(connection) {
    if (!connection || !connection.id) {
      logger.warn('Invalid connection provided for recovery');
      return;
    }

    // Clear any existing recovery timeout
    this.clearRecovery(connection);

    const startTime = Date.now();
    logger.info('Starting connection recovery', {
      connectionId: connection.id,
      duration: this.options.recoveryTimeout
    });

    // Start recovery timeout
    connection.recoveryId = setTimeout(async () => {
      try {
        await this.handleRecovery(connection, startTime);
      } catch (error) {
        logger.error('Error in recovery handler', {
          connectionId: connection.id,
          error: error.message
        });
      }
    }, this.options.recoveryTimeout);

    // Track recovery duration
    this.recoveryDuration.set({ connection_id: connection.id }, this.options.recoveryTimeout);
  }

  clearRecovery(connection) {
    if (!connection) return;

    if (connection.recoveryId) {
      clearTimeout(connection.recoveryId);
      connection.recoveryId = undefined;
      logger.debug('Cleared connection recovery', { connectionId: connection.id });
    }
  }

  async handleRecovery(connection, startTime) {
    if (!connection) return;

    const duration = Date.now() - startTime;
    logger.info('Connection recovery completed', {
      connectionId: connection.id,
      duration: this.options.recoveryTimeout
    });

    try {
      // Perform recovery cleanup
      await connection.disconnect();
      await connection.cleanup();
    } catch (error) {
      logger.error('Error during connection recovery', {
        connectionId: connection.id,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = ConnectionTimeout; 