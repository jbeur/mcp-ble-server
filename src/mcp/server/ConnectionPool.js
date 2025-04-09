const EventEmitter = require('events');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      minSize: options.minSize || 5,
      maxSize: options.maxSize || 20,
      idleTimeout: options.idleTimeout || 30000, // 30 seconds
      connectionTimeout: options.connectionTimeout || 5000, // 5 seconds
      validationInterval: options.validationInterval || 30000, // 30 seconds
      priorityLevels: options.priorityLevels || ['high', 'medium', 'low'],
      loadBalanceThreshold: options.loadBalanceThreshold || 0.8, // 80% utilization
      ...options
    };
        
    this.pool = new Map();
    this.availableConnections = new Set();
    this.inUseConnections = new Set();
    this.connectionCount = 0;
    this.validationTimer = null;
    this.performanceMetrics = {
      lastAcquisitionTime: 0,
      lastReleaseTime: 0,
      acquisitionTimes: [],
      releaseTimes: [],
      errors: 0,
      lastError: null
    };
        
    // Initialize metrics with unique pool-specific names
    this.metrics = {
      poolSize: metrics.gauge('ble_connection_pool_total_size', 'Current total size of the BLE connection pool'),
      availableConnections: metrics.gauge('ble_connection_pool_available', 'Number of available connections in the BLE pool'),
      inUseConnections: metrics.gauge('ble_connection_pool_in_use', 'Number of connections currently in use from the BLE pool'),
      connectionErrors: metrics.counter('ble_connection_pool_errors', 'Number of connection errors in the BLE pool'),
      connectionAcquisitions: metrics.counter('ble_connection_pool_acquisitions', 'Number of connection acquisitions'),
      connectionReleases: metrics.counter('ble_connection_pool_releases', 'Number of connection releases'),
      connectionValidations: metrics.counter('ble_connection_pool_validations', 'Number of connection validations'),
      invalidConnections: metrics.counter('ble_connection_pool_invalid', 'Number of invalid connections detected'),
      // New performance metrics
      acquisitionLatency: metrics.histogram('ble_connection_pool_acquisition_latency', 'Connection acquisition latency in milliseconds'),
      releaseLatency: metrics.histogram('ble_connection_pool_release_latency', 'Connection release latency in milliseconds'),
      priorityDistribution: metrics.gauge('ble_connection_pool_priority_distribution', 'Distribution of connections by priority level'),
      loadBalanceScore: metrics.gauge('ble_connection_pool_load_balance', 'Load balance score (0-1)'),
      errorRate: metrics.gauge('ble_connection_pool_error_rate', 'Error rate per second')
    };
        
    logger.info('ConnectionPool initialized with options:', this.options);
  }

  async initialize() {
    try {
      // Initialize minimum number of connections
      for (let i = 0; i < this.options.minSize; i++) {
        await this.createConnection();
      }
      this.updateMetrics();
      this.startValidationTimer();
      logger.info(`ConnectionPool initialized with ${this.options.minSize} connections`);
    } catch (error) {
      logger.error('Failed to initialize connection pool:', error);
      this.metrics.connectionErrors.inc();
      this.performanceMetrics.errors++;
      this.performanceMetrics.lastError = error;
      throw error;
    }
  }

  async createConnection(priority = 'medium') {
    try {
      if (this.pool.size >= this.options.maxSize) {
        throw new Error('Maximum connections reached');
      }

      const connection = {
        id: `conn_${this.connectionCount++}`,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        status: 'available',
        priority: priority
      };
            
      this.pool.set(connection.id, connection);
      this.availableConnections.add(connection.id);
      this.updateMetrics();
            
      logger.debug(`Created new connection: ${connection.id} with priority: ${priority}`);
      return connection;
    } catch (error) {
      this.metrics.connectionErrors.inc();
      this.performanceMetrics.errors++;
      this.performanceMetrics.lastError = error;
      logger.error('Failed to create connection:', error);
      throw error;
    }
  }

  async acquireConnection(priority = 'medium') {
    const startTime = Date.now();
    try {
      this.metrics.connectionAcquisitions.inc();
            
      // Validate priority
      if (!this.options.priorityLevels.includes(priority)) {
        throw new Error(`Invalid priority level: ${priority}`);
      }
            
      // Check load balance
      if (this.shouldLoadBalance()) {
        await this.performLoadBalancing();
      }
            
      // Try to get an available connection based on priority
      let connection = this.getAvailableConnection(priority);
            
      // If no available connection and pool isn't full, create a new one
      if (!connection && this.pool.size < this.options.maxSize) {
        connection = await this.createConnection(priority);
      }
            
      if (!connection) {
        throw new Error('Maximum connections reached');
      }
            
      // Mark connection as in use
      this.availableConnections.delete(connection.id);
      this.inUseConnections.add(connection.id);
      connection.status = 'in_use';
      connection.lastUsed = Date.now();
      connection.priority = priority;
            
      // Update performance metrics
      const acquisitionTime = Date.now() - startTime;
      this.performanceMetrics.lastAcquisitionTime = acquisitionTime;
      this.performanceMetrics.acquisitionTimes.push(acquisitionTime);
      this.metrics.acquisitionLatency.observe(acquisitionTime);
            
      this.updateMetrics();
      logger.debug(`Acquired connection: ${connection.id} with priority: ${priority}`);
      return connection;
    } catch (error) {
      this.metrics.connectionErrors.inc();
      this.performanceMetrics.errors++;
      this.performanceMetrics.lastError = error;
      logger.error('Failed to acquire connection:', error);
      throw error;
    }
  }

  async releaseConnection(connectionId) {
    const startTime = Date.now();
    try {
      this.metrics.connectionReleases.inc();
            
      const connection = this.pool.get(connectionId);
      if (!connection) {
        throw new Error(`Connection ${connectionId} not found in pool`);
      }
            
      // Remove from in-use and add to available
      this.inUseConnections.delete(connectionId);
      this.availableConnections.add(connectionId);
      connection.status = 'available';
      connection.lastUsed = Date.now();
            
      // Update performance metrics
      const releaseTime = Date.now() - startTime;
      this.performanceMetrics.lastReleaseTime = releaseTime;
      this.performanceMetrics.releaseTimes.push(releaseTime);
      this.metrics.releaseLatency.observe(releaseTime);
            
      this.updateMetrics();
      logger.debug(`Released connection: ${connectionId}`);
    } catch (error) {
      this.metrics.connectionErrors.inc();
      this.performanceMetrics.errors++;
      this.performanceMetrics.lastError = error;
      logger.error('Failed to release connection:', error);
      throw error;
    }
  }

  getAvailableConnection(priority = 'medium') {
    // First try to find a connection matching the requested priority
    for (const connectionId of this.availableConnections) {
      const connection = this.pool.get(connectionId);
      if (this.isConnectionValid(connection) && connection.priority === priority) {
        return connection;
      }
    }
        
    // If no matching priority found, try any available connection
    for (const connectionId of this.availableConnections) {
      const connection = this.pool.get(connectionId);
      if (this.isConnectionValid(connection)) {
        // Update the connection's priority to match the request
        connection.priority = priority;
        return connection;
      }
    }
        
    return null;
  }

  isConnectionValid(connection) {
    if (!connection) return false;
        
    // Check if connection is too old
    const age = Date.now() - connection.createdAt;
    if (age > this.options.idleTimeout) {
      this.metrics.invalidConnections.inc();
      return false;
    }
        
    return true;
  }

  async validateConnections() {
    try {
      this.metrics.connectionValidations.inc();
            
      // Validate all connections
      for (const [connectionId, connection] of this.pool.entries()) {
        if (!this.isConnectionValid(connection)) {
          // Remove invalid connection
          this.pool.delete(connectionId);
          this.availableConnections.delete(connectionId);
          this.inUseConnections.delete(connectionId);
          logger.debug(`Removed invalid connection: ${connectionId}`);
        }
      }
            
      // Ensure minimum pool size
      while (this.pool.size < this.options.minSize) {
        await this.createConnection();
      }
            
      this.updateMetrics();
    } catch (error) {
      this.metrics.connectionErrors.inc();
      logger.error('Failed to validate connections:', error);
    }
  }

  startValidationTimer() {
    this.validationTimer = setInterval(() => {
      this.validateConnections();
    }, this.options.validationInterval);
  }

  stopValidationTimer() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
  }

  shouldLoadBalance() {
    const utilization = this.getInUseConnections() / this.getPoolSize();
    return utilization > this.options.loadBalanceThreshold;
  }

  async performLoadBalancing() {
    const currentSize = this.getPoolSize();
    const targetSize = Math.min(
      Math.ceil(currentSize * 1.2), // Increase by 20%
      this.options.maxSize
    );
        
    while (this.getPoolSize() < targetSize) {
      await this.createConnection();
    }
        
    this.updateLoadBalanceMetrics();
  }

  updateLoadBalanceMetrics() {
    // Calculate priority distribution
    const priorityCounts = {};
    for (const priority of this.options.priorityLevels) {
      priorityCounts[priority] = 0;
    }
        
    for (const connection of this.pool.values()) {
      priorityCounts[connection.priority]++;
    }
        
    // Update priority distribution metrics
    for (const [priority, count] of Object.entries(priorityCounts)) {
      this.metrics.priorityDistribution.set({ priority }, count);
    }
        
    // Calculate load balance score
    const utilization = this.getInUseConnections() / this.getPoolSize();
    const loadBalanceScore = 1 - Math.abs(0.5 - utilization) * 2; // 0-1 score, higher is better
    this.metrics.loadBalanceScore.set(loadBalanceScore);
        
    // Calculate error rate
    const errorRate = this.performanceMetrics.errors / this.getPoolSize();
    this.metrics.errorRate.set(errorRate);
  }

  updateMetrics() {
    this.metrics.poolSize.set(this.pool.size);
    this.metrics.availableConnections.set(this.availableConnections.size);
    this.metrics.inUseConnections.set(this.inUseConnections.size);
    this.updateLoadBalanceMetrics();
  }

  getPoolSize() {
    return this.pool.size;
  }

  getAvailableConnections() {
    return this.availableConnections.size;
  }

  getInUseConnections() {
    return this.inUseConnections.size;
  }

  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      averageAcquisitionTime: this.performanceMetrics.acquisitionTimes.length > 0
        ? this.performanceMetrics.acquisitionTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.acquisitionTimes.length
        : 0,
      averageReleaseTime: this.performanceMetrics.releaseTimes.length > 0
        ? this.performanceMetrics.releaseTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.releaseTimes.length
        : 0,
      errorRate: this.performanceMetrics.errors / this.getPoolSize()
    };
  }
}

module.exports = ConnectionPool; 