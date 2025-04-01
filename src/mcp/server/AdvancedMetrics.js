const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

/**
 * AdvancedMetrics class for tracking detailed metrics and analytics
 * Implements connection lifecycle tracking, resource utilization metrics,
 * performance anomaly detection, and SLA compliance monitoring
 */
class AdvancedMetrics {
  constructor() {
    // Initialize connection lifecycle tracking
    this.connectionStates = new Map();
    this.connectionTimestamps = new Map();

    // Initialize resource tracking
    this.resourceThresholds = {
      memory: 0.8, // 80% of total memory
      cpu: 0.8,    // 80% CPU utilization
      network: 0.8  // 80% of network capacity
    };

    // Initialize performance tracking
    this.performanceBaselines = new Map();
    this.performanceThresholds = {
      latency: 2.0,      // 2 standard deviations
      throughput: -2.0,  // -2 standard deviations (lower is worse)
      errorRate: 2.0,    // 2 standard deviations
      resourceUsage: 2.0 // 2 standard deviations
    };
  }

  /**
   * Track connection initialization
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the initialization
   */
  trackConnectionInit(connectionId, deviceId, timestamp) {
    try {
      // Record initialization timestamp
      metrics.gauge('connection_init_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Increment initialization counter
      metrics.counter('connection_init_count', 1, {
        connectionId,
        deviceId
      });

      // Store connection state
      this.connectionStates.set(connectionId, 'initializing');
      this.connectionTimestamps.set(connectionId, {
        init: timestamp
      });

      logger.debug('Connection initialization tracked', {
        connectionId,
        deviceId,
        timestamp
      });
    } catch (error) {
      logger.error('Error tracking connection initialization', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track connection establishment
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the establishment
   * @param {number} latency - Connection establishment latency
   */
  trackConnectionEstablished(connectionId, deviceId, timestamp, latency) {
    try {
      // Record establishment timestamp
      metrics.gauge('connection_established_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Record establishment latency
      metrics.histogram('connection_establishment_latency', latency, {
        connectionId,
        deviceId
      });

      // Increment establishment counter
      metrics.counter('connection_established_count', 1, {
        connectionId,
        deviceId
      });

      // Update connection state
      this.connectionStates.set(connectionId, 'connected');
      const timestamps = this.connectionTimestamps.get(connectionId) || {};
      timestamps.established = timestamp;
      this.connectionTimestamps.set(connectionId, timestamps);

      logger.debug('Connection establishment tracked', {
        connectionId,
        deviceId,
        timestamp,
        latency
      });
    } catch (error) {
      logger.error('Error tracking connection establishment', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track connection termination
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the termination
   * @param {number} duration - Connection duration in milliseconds
   * @param {string} reason - Reason for termination
   */
  trackConnectionTerminated(connectionId, deviceId, timestamp, duration, reason) {
    try {
      // Record termination timestamp
      metrics.gauge('connection_terminated_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Record connection duration
      metrics.histogram('connection_duration', duration, {
        connectionId,
        deviceId
      });

      // Increment termination counter with reason
      metrics.counter('connection_terminated_count', 1, {
        connectionId,
        deviceId,
        reason
      });

      // Update connection state
      this.connectionStates.set(connectionId, 'terminated');
      const timestamps = this.connectionTimestamps.get(connectionId) || {};
      timestamps.terminated = timestamp;
      this.connectionTimestamps.set(connectionId, timestamps);

      logger.debug('Connection termination tracked', {
        connectionId,
        deviceId,
        timestamp,
        duration,
        reason
      });
    } catch (error) {
      logger.error('Error tracking connection termination', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track connection state changes
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the state change
   * @param {string} oldState - Previous connection state
   * @param {string} newState - New connection state
   */
  trackConnectionStateChange(connectionId, deviceId, timestamp, oldState, newState) {
    try {
      // Record state change timestamp
      metrics.gauge('connection_state_change_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Increment state change counter
      metrics.counter('connection_state_changes', 1, {
        connectionId,
        deviceId,
        oldState,
        newState
      });

      // Update connection state
      this.connectionStates.set(connectionId, newState);

      logger.debug('Connection state change tracked', {
        connectionId,
        deviceId,
        timestamp,
        oldState,
        newState
      });
    } catch (error) {
      logger.error('Error tracking connection state change', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track connection errors
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the error
   * @param {string} errorType - Type of error that occurred
   * @param {string} errorMessage - Detailed error message
   */
  trackConnectionError(connectionId, deviceId, timestamp, errorType, errorMessage) {
    try {
      // Record error timestamp
      metrics.gauge('connection_error_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Increment error counter with type
      metrics.counter('connection_errors', 1, {
        connectionId,
        deviceId,
        errorType
      });

      logger.error('Connection error tracked', {
        connectionId,
        deviceId,
        timestamp,
        errorType,
        errorMessage
      });
    } catch (error) {
      logger.error('Error tracking connection error', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track connection health status
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the health check
   * @param {string} healthStatus - Current health status
   * @param {number} latency - Health check latency
   */
  trackConnectionHealth(connectionId, deviceId, timestamp, healthStatus, latency) {
    try {
      // Record health check timestamp
      metrics.gauge('connection_health_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Record health status (1 for healthy, 0 for unhealthy)
      metrics.gauge('connection_health_status', healthStatus === 'healthy' ? 1 : 0, {
        connectionId,
        deviceId,
        healthStatus
      });

      // Record health check latency
      metrics.histogram('connection_health_check_latency', latency, {
        connectionId,
        deviceId
      });

      logger.debug('Connection health status tracked', {
        connectionId,
        deviceId,
        timestamp,
        healthStatus,
        latency
      });
    } catch (error) {
      logger.error('Error tracking connection health', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Get current connection state
   * @param {string} connectionId - Unique identifier for the connection
   * @returns {string|null} Current connection state or null if not found
   */
  getConnectionState(connectionId) {
    return this.connectionStates.get(connectionId) || null;
  }

  /**
   * Get connection timestamps
   * @param {string} connectionId - Unique identifier for the connection
   * @returns {Object|null} Connection timestamps or null if not found
   */
  getConnectionTimestamps(connectionId) {
    return this.connectionTimestamps.get(connectionId) || null;
  }

  /**
   * Track memory usage for a connection
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} memoryStats - Memory usage statistics
   * @param {number} memoryStats.heapUsed - Heap memory used in bytes
   * @param {number} memoryStats.heapTotal - Total heap memory in bytes
   * @param {number} memoryStats.external - External memory in bytes
   * @param {number} memoryStats.rss - Resident Set Size in bytes
   */
  trackMemoryUsage(connectionId, deviceId, timestamp, memoryStats) {
    try {
      const { heapUsed, heapTotal, external, rss } = memoryStats;

      // Record memory metrics
      metrics.gauge('memory_heap_used', heapUsed, {
        connectionId,
        deviceId
      });
      metrics.gauge('memory_heap_total', heapTotal, {
        connectionId,
        deviceId
      });
      metrics.gauge('memory_external', external, {
        connectionId,
        deviceId
      });
      metrics.gauge('memory_rss', rss, {
        connectionId,
        deviceId
      });
      metrics.gauge('memory_usage_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      logger.debug('Memory usage tracked', {
        connectionId,
        deviceId,
        timestamp,
        heapUsed,
        heapTotal,
        external,
        rss
      });
    } catch (error) {
      logger.error('Error tracking memory usage', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track CPU usage for a connection
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} cpuStats - CPU usage statistics
   * @param {number} cpuStats.userCPUTime - User CPU time in milliseconds
   * @param {number} cpuStats.systemCPUTime - System CPU time in milliseconds
   * @param {number} cpuStats.cpuUsagePercent - CPU usage percentage
   */
  trackCPUUsage(connectionId, deviceId, timestamp, cpuStats) {
    try {
      const { userCPUTime, systemCPUTime, cpuUsagePercent } = cpuStats;

      // Record CPU metrics
      metrics.gauge('cpu_user_time', userCPUTime, {
        connectionId,
        deviceId
      });
      metrics.gauge('cpu_system_time', systemCPUTime, {
        connectionId,
        deviceId
      });
      metrics.gauge('cpu_usage_percent', cpuUsagePercent, {
        connectionId,
        deviceId
      });
      metrics.gauge('cpu_usage_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      logger.debug('CPU usage tracked', {
        connectionId,
        deviceId,
        timestamp,
        userCPUTime,
        systemCPUTime,
        cpuUsagePercent
      });
    } catch (error) {
      logger.error('Error tracking CPU usage', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track network usage for a connection
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} networkStats - Network usage statistics
   * @param {number} networkStats.bytesReceived - Total bytes received
   * @param {number} networkStats.bytesSent - Total bytes sent
   * @param {number} networkStats.packetsReceived - Total packets received
   * @param {number} networkStats.packetsSent - Total packets sent
   * @param {number} networkStats.errorCount - Number of network errors
   * @param {number} networkStats.retransmissionCount - Number of packet retransmissions
   */
  trackNetworkUsage(connectionId, deviceId, timestamp, networkStats) {
    try {
      const {
        bytesReceived,
        bytesSent,
        packetsReceived,
        packetsSent,
        errorCount,
        retransmissionCount
      } = networkStats;

      // Record network metrics
      metrics.gauge('network_bytes_received', bytesReceived, {
        connectionId,
        deviceId
      });
      metrics.gauge('network_bytes_sent', bytesSent, {
        connectionId,
        deviceId
      });
      metrics.gauge('network_packets_received', packetsReceived, {
        connectionId,
        deviceId
      });
      metrics.gauge('network_packets_sent', packetsSent, {
        connectionId,
        deviceId
      });
      metrics.counter('network_errors', errorCount, {
        connectionId,
        deviceId
      });
      metrics.counter('network_retransmissions', retransmissionCount, {
        connectionId,
        deviceId
      });
      metrics.gauge('network_usage_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      logger.debug('Network usage tracked', {
        connectionId,
        deviceId,
        timestamp,
        bytesReceived,
        bytesSent,
        packetsReceived,
        packetsSent,
        errorCount,
        retransmissionCount
      });
    } catch (error) {
      logger.error('Error tracking network usage', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Track resource threshold violations
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} thresholds - Resource threshold status
   * @param {boolean} thresholds.memoryThresholdExceeded - Whether memory threshold is exceeded
   * @param {boolean} thresholds.cpuThresholdExceeded - Whether CPU threshold is exceeded
   * @param {boolean} thresholds.networkThresholdExceeded - Whether network threshold is exceeded
   */
  trackResourceThresholds(connectionId, deviceId, timestamp, thresholds) {
    try {
      const {
        memoryThresholdExceeded,
        cpuThresholdExceeded,
        networkThresholdExceeded
      } = thresholds;

      // Record threshold violations
      metrics.gauge('memory_threshold_exceeded', memoryThresholdExceeded ? 1 : 0, {
        connectionId,
        deviceId
      });
      metrics.gauge('cpu_threshold_exceeded', cpuThresholdExceeded ? 1 : 0, {
        connectionId,
        deviceId
      });
      metrics.gauge('network_threshold_exceeded', networkThresholdExceeded ? 1 : 0, {
        connectionId,
        deviceId
      });
      metrics.gauge('resource_thresholds_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      if (memoryThresholdExceeded || cpuThresholdExceeded || networkThresholdExceeded) {
        logger.warn('Resource thresholds exceeded', {
          connectionId,
          deviceId,
          timestamp,
          memoryThresholdExceeded,
          cpuThresholdExceeded,
          networkThresholdExceeded
        });
      }
    } catch (error) {
      logger.error('Error tracking resource thresholds', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Get current resource thresholds
   * @returns {Object} Current resource thresholds
   */
  getResourceThresholds() {
    return { ...this.resourceThresholds };
  }

  /**
   * Update resource thresholds
   * @param {Object} newThresholds - New threshold values
   * @param {number} [newThresholds.memory] - Memory threshold (0-1)
   * @param {number} [newThresholds.cpu] - CPU threshold (0-1)
   * @param {number} [newThresholds.network] - Network threshold (0-1)
   */
  updateResourceThresholds(newThresholds) {
    try {
      Object.entries(newThresholds).forEach(([key, value]) => {
        if (value >= 0 && value <= 1 && this.resourceThresholds.hasOwnProperty(key)) {
          this.resourceThresholds[key] = value;
        }
      });

      logger.info('Resource thresholds updated', {
        thresholds: this.resourceThresholds
      });
    } catch (error) {
      logger.error('Error updating resource thresholds', {
        error: error.message
      });
    }
  }

  /**
   * Track performance metrics for anomaly detection
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} performanceMetrics - Performance metrics
   * @param {number} performanceMetrics.latency - Response latency in milliseconds
   * @param {number} performanceMetrics.throughput - Operations per second
   * @param {number} performanceMetrics.errorRate - Error rate (0-1)
   * @param {number} performanceMetrics.resourceUsage - Resource usage (0-1)
   */
  trackPerformanceMetrics(connectionId, deviceId, timestamp, performanceMetrics) {
    try {
      const { latency, throughput, errorRate, resourceUsage } = performanceMetrics;

      // Record performance metrics
      performanceMetrics.gauge('performance_latency', latency, {
        connectionId,
        deviceId
      });
      performanceMetrics.gauge('performance_throughput', throughput, {
        connectionId,
        deviceId
      });
      performanceMetrics.gauge('performance_error_rate', errorRate, {
        connectionId,
        deviceId
      });
      performanceMetrics.gauge('performance_resource_usage', resourceUsage, {
        connectionId,
        deviceId
      });
      performanceMetrics.gauge('performance_metrics_timestamp', timestamp, {
        connectionId,
        deviceId
      });

      // Update baselines and detect anomalies
      this.updatePerformanceBaselines(connectionId, deviceId, timestamp, performanceMetrics);
      const anomalies = this.detectPerformanceAnomalies(connectionId, deviceId, timestamp, performanceMetrics);

      logger.debug('Performance metrics tracked', {
        connectionId,
        deviceId,
        timestamp,
        latency,
        throughput,
        errorRate,
        resourceUsage,
        anomalies
      });
    } catch (error) {
      logger.error('Error tracking performance metrics', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Update performance baselines with new measurements
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} metrics - Performance metrics
   */
  updatePerformanceBaselines(connectionId, deviceId, timestamp, metrics) {
    try {
      const baselines = this.performanceBaselines.get(connectionId) || {
        latency: { mean: 0, stdDev: 0, count: 0, lastUpdate: timestamp },
        throughput: { mean: 0, stdDev: 0, count: 0, lastUpdate: timestamp },
        errorRate: { mean: 0, stdDev: 0, count: 0, lastUpdate: timestamp },
        resourceUsage: { mean: 0, stdDev: 0, count: 0, lastUpdate: timestamp }
      };

      // Update each metric's baseline using Welford's online algorithm
      ['latency', 'throughput', 'errorRate', 'resourceUsage'].forEach(key => {
        const value = metrics[key];
        const baseline = baselines[key];
        
        baseline.count++;
        baseline.lastUpdate = timestamp;

        // Update mean
        const delta = value - baseline.mean;
        baseline.mean += delta / baseline.count;

        // Update standard deviation using Welford's online algorithm
        if (baseline.count > 1) {
          const delta2 = value - baseline.mean;
          baseline.stdDev = Math.sqrt(
            ((baseline.count - 2) * Math.pow(baseline.stdDev, 2) + delta * delta2) /
            (baseline.count - 1)
          );
        }
      });

      this.performanceBaselines.set(connectionId, baselines);
    } catch (error) {
      logger.error('Error updating performance baselines', {
        connectionId,
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Get performance baselines for a connection
   * @param {string} connectionId - Unique identifier for the connection
   * @returns {Object|null} Performance baselines or null if not found
   */
  getPerformanceBaselines(connectionId) {
    const baselines = this.performanceBaselines.get(connectionId);
    if (!baselines) {
      return null;
    }

    // Return a copy of the baselines with only the relevant data
    return {
      latency: {
        mean: baselines.latency.mean,
        stdDev: baselines.latency.stdDev,
        lastUpdate: baselines.latency.lastUpdate
      },
      throughput: {
        mean: baselines.throughput.mean,
        stdDev: baselines.throughput.stdDev,
        lastUpdate: baselines.throughput.lastUpdate
      },
      errorRate: {
        mean: baselines.errorRate.mean,
        stdDev: baselines.errorRate.stdDev,
        lastUpdate: baselines.errorRate.lastUpdate
      },
      resourceUsage: {
        mean: baselines.resourceUsage.mean,
        stdDev: baselines.resourceUsage.stdDev,
        lastUpdate: baselines.resourceUsage.lastUpdate
      }
    };
  }

  /**
   * Check if a value is an anomaly based on statistical analysis
   * @private
   * @param {number} value - Current value
   * @param {Object} baseline - Baseline statistics
   * @param {string} metricType - Type of metric being checked
   * @returns {boolean} Whether the value is an anomaly
   */
  isAnomaly(value, baseline, metricType) {
    if (!baseline || baseline.count < 2) {
      return false;
    }

    const threshold = this.performanceThresholds[metricType] || 2.0;
    const zScore = (value - baseline.mean) / (baseline.stdDev || 1); // Avoid division by zero

    // For throughput, lower values are worse (negative threshold)
    // For all others, higher values are worse (positive threshold)
    return metricType === 'throughput' ? 
      zScore < -Math.abs(threshold) : // For throughput
      zScore > Math.abs(threshold);   // For others
  }

  /**
   * Detect performance anomalies based on statistical analysis
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} deviceId - Identifier of the connected device
   * @param {number} timestamp - Timestamp of the measurement
   * @param {Object} metrics - Performance metrics
   * @returns {Object} Detected anomalies
   */
  detectPerformanceAnomalies(connectionId, deviceId, timestamp, metrics) {
    try {
      const baselines = this.performanceBaselines.get(connectionId);
      if (!baselines) {
        return {
          latency: false,
          throughput: false,
          errorRate: false,
          resourceUsage: false
        };
      }

      const anomalies = {
        latency: this.isAnomaly(metrics.latency, baselines.latency, 'latency'),
        throughput: this.isAnomaly(metrics.throughput, baselines.throughput, 'throughput'),
        errorRate: this.isAnomaly(metrics.errorRate, baselines.errorRate, 'errorRate'),
        resourceUsage: this.isAnomaly(metrics.resourceUsage, baselines.resourceUsage, 'resourceUsage')
      };

      // Record anomalies
      Object.entries(anomalies).forEach(([type, isAnomaly]) => {
        if (isAnomaly) {
          metrics.counter('performance_anomalies', 1, {
            connectionId,
            deviceId,
            type: type.toLowerCase()
          });
        }
      });

      if (Object.values(anomalies).some(isAnomaly => isAnomaly)) {
        logger.warn('Performance anomalies detected', {
          connectionId,
          deviceId,
          timestamp,
          anomalies
        });
      }

      return anomalies;
    } catch (error) {
      logger.error('Error detecting performance anomalies', {
        connectionId,
        deviceId,
        error: error.message
      });
      return {
        latency: false,
        throughput: false,
        errorRate: false,
        resourceUsage: false
      };
    }
  }
}

module.exports = AdvancedMetrics; 