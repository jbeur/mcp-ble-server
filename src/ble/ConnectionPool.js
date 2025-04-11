const { logger } = require('../utils/logger');

class ConnectionPool {
  constructor(config = {}) {
    this._config = {
      maxConnections: config.maxConnections || 10,
      minConnections: config.minConnections || 2,
      maxIdleTime: config.maxIdleTime || 30000,
      acquisitionTimeout: config.acquisitionTimeout || 5000,
      healthCheckInterval: config.healthCheckInterval || 60000
    };

    this._connections = new Map();
    this._availableConnections = new Map();
    this._inUseConnections = new Map();
    this._cleanerInterval = null;

    this._metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalAcquisitions: 0,
      totalReleases: 0,
      failedConnections: 0
    };

    this._initializeMinConnections();
    this._startIdleConnectionCleaner();
  }

  async acquireConnection() {
    try {
      this._metrics.totalAcquisitions++;

      // Check if we've reached the maximum connections limit
      if (this._connections.size >= this._config.maxConnections && this._availableConnections.size === 0) {
        throw new Error('Maximum connections limit reached');
      }

      // Try to get an available connection first
      if (this._availableConnections.size > 0) {
        const [connectionId, connection] = this._availableConnections.entries().next().value;
        this._availableConnections.delete(connectionId);
        this._inUseConnections.set(connectionId, connection);
        this._metrics.activeConnections = this._inUseConnections.size;
        this._metrics.idleConnections = this._availableConnections.size;
        logger.debug('Connection acquired', { connectionId });
        return connection;
      }

      // Create a new connection if we haven't reached the limit
      if (this._connections.size < this._config.maxConnections) {
        const connection = await this._createConnection();
        this._inUseConnections.set(connection.connectionId, connection);
        this._metrics.activeConnections = this._inUseConnections.size;
        logger.debug('Connection acquired', { connectionId: connection.connectionId });
        return connection;
      }

      throw new Error('Maximum connections limit reached');
    } catch (error) {
      logger.error('Error acquiring connection', { error: error.message });
      throw error;
    }
  }

  async releaseConnection(connectionId) {
    try {
      // Validate connection exists and is in use
      if (!this._connections.has(connectionId) || !this._inUseConnections.has(connectionId)) {
        throw new Error('Invalid connection ID or connection not in use');
      }

      // Move connection from in-use to available
      const connection = this._inUseConnections.get(connectionId);
      this._inUseConnections.delete(connectionId);
      this._availableConnections.set(connectionId, {
        ...connection,
        lastUsed: Date.now()
      });

      // Update metrics
      this._metrics.totalReleases++;
      this._metrics.activeConnections = this._inUseConnections.size;
      this._metrics.idleConnections = this._availableConnections.size;

      logger.debug('Connection released', { connectionId });

      // Clean up idle connections if we have more than minimum
      if (this._connections.size > this._config.minConnections) {
        await this._cleanupIdleConnections();
      }
    } catch (error) {
      logger.error('Error releasing connection', { error: error.message, connectionId });
      throw error;
    }
  }

  async _createConnection() {
    try {
      const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const connection = { connectionId, createdAt: Date.now() };
            
      this._connections.set(connectionId, connection);
      this._metrics.totalConnections = this._connections.size;
      logger.debug('Created new connection', { connectionId });
            
      return connection;
    } catch (error) {
      this._metrics.failedConnections++;
      logger.error('Failed to create connection', { error: error.message });
      throw error;
    }
  }

  async _initializeMinConnections() {
    // Calculate how many additional connections we need
    const additionalConnectionsNeeded = this._config.minConnections - this._connections.size;
        
    if (additionalConnectionsNeeded <= 0) return;

    // Create additional connections as needed
    const connectionPromises = Array(additionalConnectionsNeeded)
      .fill(null)
      .map(() => this._createConnection());
        
    try {
      const connections = await Promise.all(connectionPromises);
      connections.forEach(conn => {
        this._availableConnections.set(conn.connectionId, {
          ...conn,
          lastUsed: Date.now()
        });
      });
      this._metrics.idleConnections = this._availableConnections.size;
    } catch (error) {
      logger.error('Failed to initialize minimum connections', { error: error.message });
    }
  }

  _startIdleConnectionCleaner() {
    // Clear existing interval if it exists
    if (this._cleanerInterval) {
      clearInterval(this._cleanerInterval);
      this._cleanerInterval = null;
    }

    this._cleanerInterval = setInterval(async () => {
      await this._cleanupIdleConnections();
    }, this._config.healthCheckInterval);

    // Prevent the interval from keeping the process alive
    this._cleanerInterval.unref();
  }

  async _cleanupIdleConnections() {
    const now = Date.now();
    const availableConnections = Array.from(this._availableConnections.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        
    // First, clean up connections that are idle for longer than maxIdleTime
    for (const [connectionId, connection] of availableConnections) {
      const idleTime = now - connection.lastUsed;
      if (idleTime > this._config.maxIdleTime) {
        this._connections.delete(connectionId);
        this._availableConnections.delete(connectionId);
        this._metrics.totalConnections = this._connections.size;
        this._metrics.idleConnections = this._availableConnections.size;
        logger.debug('Cleaned up idle connection', { connectionId });
      }
    }

    // Then, ensure we have at least minConnections by creating new ones in batch
    const additionalConnectionsNeeded = this._config.minConnections - this._connections.size;
    if (additionalConnectionsNeeded > 0) {
      const connectionPromises = Array(additionalConnectionsNeeded)
        .fill(null)
        .map(() => this._createConnection());
            
      try {
        const newConnections = await Promise.all(connectionPromises);
        newConnections.forEach(conn => {
          this._availableConnections.set(conn.connectionId, {
            ...conn,
            lastUsed: Date.now()
          });
        });
        this._metrics.idleConnections = this._availableConnections.size;
      } catch (error) {
        logger.error('Failed to create additional connections', { error: error.message });
      }
    }

    // Finally, if we still have more than minimum connections, remove the oldest ones
    while (this._connections.size > this._config.minConnections) {
      const oldestConnection = Array.from(this._availableConnections.entries())
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
            
      if (oldestConnection) {
        const [connectionId] = oldestConnection;
        this._connections.delete(connectionId);
        this._availableConnections.delete(connectionId);
        this._metrics.totalConnections = this._connections.size;
        this._metrics.idleConnections = this._availableConnections.size;
        logger.debug('Cleaned up excess connection', { connectionId });
      } else {
        break;
      }
    }
  }

  getConfiguration() {
    return { ...this._config };
  }

  updateConfiguration(newConfig) {
    // Validate new configuration
    if (newConfig.maxConnections !== undefined) {
      if (newConfig.maxConnections < 1) {
        throw new Error('Invalid configuration: maxConnections must be greater than 0');
      }
    }
    if (newConfig.minConnections !== undefined) {
      if (newConfig.minConnections < 0) {
        throw new Error('Invalid configuration: minConnections must be non-negative');
      }
    }
    if (newConfig.maxIdleTime !== undefined) {
      if (newConfig.maxIdleTime < 1000) {
        throw new Error('Invalid configuration: maxIdleTime must be greater than 0');
      }
    }
    if (newConfig.acquisitionTimeout !== undefined) {
      if (newConfig.acquisitionTimeout < 1000) {
        throw new Error('Invalid configuration: acquisitionTimeout must be greater than 0');
      }
    }
    if (newConfig.healthCheckInterval !== undefined) {
      if (newConfig.healthCheckInterval < 1000) {
        throw new Error('Invalid configuration: healthCheckInterval must be greater than 0');
      }
    }

    // Validate minConnections <= maxConnections
    if (newConfig.minConnections !== undefined && newConfig.maxConnections !== undefined) {
      if (newConfig.minConnections > newConfig.maxConnections) {
        throw new Error('Invalid configuration: minConnections cannot be greater than maxConnections');
      }
    } else if (newConfig.minConnections !== undefined && newConfig.minConnections > this._config.maxConnections) {
      throw new Error('Invalid configuration: minConnections cannot be greater than maxConnections');
    } else if (newConfig.maxConnections !== undefined && this._config.minConnections > newConfig.maxConnections) {
      throw new Error('Invalid configuration: minConnections cannot be greater than maxConnections');
    }

    // Update configuration
    this._config = {
      ...this._config,
      ...newConfig
    };

    // Reinitialize if needed
    if (this._connections.size < this._config.minConnections) {
      this._initializeMinConnections();
    }

    // Update cleaner interval if healthCheckInterval changed
    if (newConfig.healthCheckInterval) {
      if (this._cleanerInterval) {
        clearInterval(this._cleanerInterval);
      }
      this._startIdleConnectionCleaner();
    }
  }

  getMetrics() {
    return { ...this._metrics };
  }

  // For testing purposes
  async forceCleanup() {
    await this._cleanupIdleConnections();
  }

  async stop() {
    try {
      // Clear the cleaner interval if it exists
      if (this._cleanerInterval) {
        clearInterval(this._cleanerInterval);
        this._cleanerInterval = null;
      }

      // Clear all connections
      for (const [deviceId, connection] of this._connections) {
        try {
          await connection.disconnect();
        } catch (error) {
          logger.error('Error disconnecting device during pool stop', {
            deviceId,
            error: error.message
          });
        }
      }
      this._connections.clear();

      // Reset state
      this._metrics = {
        totalConnections: 0,
        activeConnections: 0,
        failedConnections: 0,
        reconnections: 0
      };

      logger.info('Connection pool stopped');
    } catch (error) {
      logger.error('Error stopping connection pool', { error: error.message });
      throw error;
    }
  }

  _initializeMetrics() {
    this._metrics = {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
      reconnections: 0
    };
  }
}

module.exports = { ConnectionPool }; 