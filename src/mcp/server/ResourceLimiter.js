const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ResourceLimiter {
  constructor(options = {}) {
    this.options = {
      maxConnections: options.maxConnections || 100,
      maxMemoryUsage: options.maxMemoryUsage || 0.8, // 80% of total memory
      maxCpuUsage: options.maxCpuUsage || 0.8, // 80% of CPU
      maxNetworkUsage: options.maxNetworkUsage || 1024 * 1024 * 1024, // 1GB
      ...options
    };

    // Current resource usage tracking
    this.currentConnections = 0;
    this.currentNetworkUsage = 0;
    this.lastCpuUsage = process.cpuUsage();

    // Initialize metrics
    this.memoryGauge = metrics.gauge('resource_memory_usage', 'Current memory usage', ['connection_id', 'resource_type']);
    this.cpuGauge = metrics.gauge('resource_cpu_usage', 'Current CPU usage', ['connection_id', 'resource_type']);
    this.networkGauge = metrics.gauge('resource_network_usage', 'Current network usage', ['connection_id', 'resource_type']);
    this.connectionGauge = metrics.gauge('resource_connection_count', 'Current number of connections', ['connection_id']);
    this.limitViolationCounter = metrics.counter('resource_limit_violations', 'Number of resource limit violations', ['connection_id', 'resource_type']);
  }

  canAcceptConnection() {
    return this.currentConnections < this.options.maxConnections;
  }

  incrementConnections() {
    this.currentConnections++;
    this.connectionGauge.set({ connection_id: 'total' }, this.currentConnections);
  }

  decrementConnections() {
    this.currentConnections = Math.max(0, this.currentConnections - 1);
    this.connectionGauge.set({ connection_id: 'total' }, this.currentConnections);
  }

  checkMemoryUsage(connectionId) {
    const { heapUsed, heapTotal } = process.memoryUsage();
    const memoryUsageRatio = heapUsed / heapTotal;

    // Track memory usage metric
    this.memoryGauge.set(
      { connection_id: connectionId, resource_type: 'memory' },
      memoryUsageRatio
    );

    if (memoryUsageRatio > this.options.maxMemoryUsage) {
      this.limitViolationCounter.inc({
        connection_id: connectionId,
        resource_type: 'memory'
      });
      return false;
    }

    return true;
  }

  checkCpuUsage(connectionId) {
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const totalCpuUsage = currentCpuUsage.user + currentCpuUsage.system;
    const cpuUsageRatio = totalCpuUsage / (1000 * 1000); // Convert to percentage

    // Track CPU usage metric
    this.cpuGauge.set(
      { connection_id: connectionId, resource_type: 'cpu' },
      cpuUsageRatio
    );

    if (cpuUsageRatio > this.options.maxCpuUsage) {
      this.limitViolationCounter.inc({
        connection_id: connectionId,
        resource_type: 'cpu'
      });
      return false;
    }

    this.lastCpuUsage = process.cpuUsage();
    return true;
  }

  checkNetworkUsage(connectionId, bytes) {
    const newNetworkUsage = this.currentNetworkUsage + bytes;

    // Track network usage metric
    this.networkGauge.set(
      { connection_id: connectionId, resource_type: 'network' },
      newNetworkUsage
    );

    if (newNetworkUsage > this.options.maxNetworkUsage) {
      this.limitViolationCounter.inc({
        connection_id: connectionId,
        resource_type: 'network'
      });
      return false;
    }

    this.currentNetworkUsage = newNetworkUsage;
    return true;
  }

  enforceLimits({ connectionId, networkBytes = 0 }) {
    const violations = [];

    // Check connection limit
    if (!this.canAcceptConnection()) {
      violations.push('connections');
    }

    // Check memory usage
    if (!this.checkMemoryUsage(connectionId)) {
      violations.push('memory');
    }

    // Check CPU usage
    if (!this.checkCpuUsage(connectionId)) {
      violations.push('cpu');
    }

    // Check network usage
    if (!this.checkNetworkUsage(connectionId, networkBytes)) {
      violations.push('network');
    }

    const result = {
      allowed: violations.length === 0,
      reason: violations.length > 0 ? 'Resource limits exceeded' : 'All resource limits satisfied',
      details: violations
    };

    if (violations.length > 0) {
      logger.warn('Resource limits exceeded', {
        connectionId,
        violations,
        details: result
      });
    }

    return result;
  }

  reset() {
    this.currentConnections = 0;
    this.currentNetworkUsage = 0;
    this.lastCpuUsage = process.cpuUsage();
    this.connectionGauge.set({ connection_id: 'total' }, 0);
    this.networkGauge.set({ connection_id: 'total', resource_type: 'network' }, 0);
  }
}

module.exports = ResourceLimiter; 