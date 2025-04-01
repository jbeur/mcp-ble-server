const AdvancedMetrics = require('../../../../src/mcp/server/AdvancedMetrics');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
  metrics: {
    gauge: jest.fn(),
    counter: jest.fn(),
    histogram: jest.fn()
  }
}));

describe('AdvancedMetrics', () => {
  let advancedMetrics;

  beforeEach(() => {
    jest.clearAllMocks();
    advancedMetrics = new AdvancedMetrics();
  });

  describe('Connection Lifecycle Tracking', () => {
    const connectionId = 'test-connection-1';
    const deviceId = 'test-device-1';

    test('should track connection initialization', () => {
      const timestamp = Date.now();
      advancedMetrics.trackConnectionInit(connectionId, deviceId, timestamp);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_init_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'connection_init_count',
        1,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Connection initialization tracked',
        { connectionId, deviceId, timestamp }
      );
    });

    test('should track connection establishment', () => {
      const timestamp = Date.now();
      const latency = 100;
      advancedMetrics.trackConnectionEstablished(connectionId, deviceId, timestamp, latency);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_established_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.histogram).toHaveBeenCalledWith(
        'connection_establishment_latency',
        latency,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'connection_established_count',
        1,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Connection establishment tracked',
        { connectionId, deviceId, timestamp, latency }
      );
    });

    test('should track connection termination', () => {
      const timestamp = Date.now();
      const duration = 5000;
      const reason = 'normal';
      advancedMetrics.trackConnectionTerminated(connectionId, deviceId, timestamp, duration, reason);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_terminated_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.histogram).toHaveBeenCalledWith(
        'connection_duration',
        duration,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'connection_terminated_count',
        1,
        { connectionId, deviceId, reason }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Connection termination tracked',
        { connectionId, deviceId, timestamp, duration, reason }
      );
    });

    test('should track connection state changes', () => {
      const timestamp = Date.now();
      const oldState = 'connecting';
      const newState = 'connected';
      advancedMetrics.trackConnectionStateChange(connectionId, deviceId, timestamp, oldState, newState);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_state_change_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'connection_state_changes',
        1,
        { connectionId, deviceId, oldState, newState }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Connection state change tracked',
        { connectionId, deviceId, timestamp, oldState, newState }
      );
    });

    test('should track connection errors', () => {
      const timestamp = Date.now();
      const errorType = 'timeout';
      const errorMessage = 'Connection timeout';
      advancedMetrics.trackConnectionError(connectionId, deviceId, timestamp, errorType, errorMessage);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_error_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'connection_errors',
        1,
        { connectionId, deviceId, errorType }
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Connection error tracked',
        { connectionId, deviceId, timestamp, errorType, errorMessage }
      );
    });

    test('should track connection health status', () => {
      const timestamp = Date.now();
      const healthStatus = 'healthy';
      const latency = 50;
      advancedMetrics.trackConnectionHealth(connectionId, deviceId, timestamp, healthStatus, latency);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_health_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'connection_health_status',
        1,
        { connectionId, deviceId, healthStatus }
      );
      expect(metrics.histogram).toHaveBeenCalledWith(
        'connection_health_check_latency',
        latency,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Connection health status tracked',
        { connectionId, deviceId, timestamp, healthStatus, latency }
      );
    });

    test('should handle errors in connection initialization tracking', () => {
      const timestamp = Date.now();
      metrics.gauge.mockImplementationOnce(() => {
        throw new Error('Metrics error');
      });

      advancedMetrics.trackConnectionInit(connectionId, deviceId, timestamp);

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracking connection initialization',
        {
          connectionId,
          deviceId,
          error: 'Metrics error'
        }
      );
    });

    test('should handle errors in connection establishment tracking', () => {
      const timestamp = Date.now();
      const latency = 100;
      metrics.gauge.mockImplementationOnce(() => {
        throw new Error('Metrics error');
      });

      advancedMetrics.trackConnectionEstablished(connectionId, deviceId, timestamp, latency);

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracking connection establishment',
        {
          connectionId,
          deviceId,
          error: 'Metrics error'
        }
      );
    });

    test('should maintain connection state through lifecycle', () => {
      const timestamp = Date.now();
      const latency = 100;
      const duration = 5000;

      // Test initialization
      advancedMetrics.trackConnectionInit(connectionId, deviceId, timestamp);
      expect(advancedMetrics.getConnectionState(connectionId)).toBe('initializing');

      // Test establishment
      advancedMetrics.trackConnectionEstablished(connectionId, deviceId, timestamp + 100, latency);
      expect(advancedMetrics.getConnectionState(connectionId)).toBe('connected');

      // Test state change
      advancedMetrics.trackConnectionStateChange(connectionId, deviceId, timestamp + 200, 'connected', 'reconnecting');
      expect(advancedMetrics.getConnectionState(connectionId)).toBe('reconnecting');

      // Test termination
      advancedMetrics.trackConnectionTerminated(connectionId, deviceId, timestamp + 5000, duration, 'normal');
      expect(advancedMetrics.getConnectionState(connectionId)).toBe('terminated');
    });

    test('should track connection timestamps through lifecycle', () => {
      const baseTimestamp = Date.now();
      const latency = 100;
      const duration = 5000;

      // Test initialization timestamp
      advancedMetrics.trackConnectionInit(connectionId, deviceId, baseTimestamp);
      let timestamps = advancedMetrics.getConnectionTimestamps(connectionId);
      expect(timestamps.init).toBe(baseTimestamp);

      // Test establishment timestamp
      const establishedTimestamp = baseTimestamp + 100;
      advancedMetrics.trackConnectionEstablished(connectionId, deviceId, establishedTimestamp, latency);
      timestamps = advancedMetrics.getConnectionTimestamps(connectionId);
      expect(timestamps.established).toBe(establishedTimestamp);

      // Test termination timestamp
      const terminatedTimestamp = baseTimestamp + 5000;
      advancedMetrics.trackConnectionTerminated(connectionId, deviceId, terminatedTimestamp, duration, 'normal');
      timestamps = advancedMetrics.getConnectionTimestamps(connectionId);
      expect(timestamps.terminated).toBe(terminatedTimestamp);
    });

    test('should return null for unknown connection state', () => {
      expect(advancedMetrics.getConnectionState('unknown-connection')).toBeNull();
    });

    test('should return null for unknown connection timestamps', () => {
      expect(advancedMetrics.getConnectionTimestamps('unknown-connection')).toBeNull();
    });
  });

  describe('Resource Utilization Metrics', () => {
    const connectionId = 'test-connection-1';
    const deviceId = 'test-device-1';

    test('should track memory usage', () => {
      const timestamp = Date.now();
      const heapUsed = 50000000;
      const heapTotal = 100000000;
      const external = 10000000;
      const rss = 150000000;

      advancedMetrics.trackMemoryUsage(connectionId, deviceId, timestamp, {
        heapUsed,
        heapTotal,
        external,
        rss
      });

      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_heap_used',
        heapUsed,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_heap_total',
        heapTotal,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_external',
        external,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_rss',
        rss,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_usage_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Memory usage tracked',
        { connectionId, deviceId, timestamp, heapUsed, heapTotal, external, rss }
      );
    });

    test('should track CPU usage', () => {
      const timestamp = Date.now();
      const userCPUTime = 1000;
      const systemCPUTime = 500;
      const cpuUsagePercent = 45.5;

      advancedMetrics.trackCPUUsage(connectionId, deviceId, timestamp, {
        userCPUTime,
        systemCPUTime,
        cpuUsagePercent
      });

      expect(metrics.gauge).toHaveBeenCalledWith(
        'cpu_user_time',
        userCPUTime,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'cpu_system_time',
        systemCPUTime,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'cpu_usage_percent',
        cpuUsagePercent,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'cpu_usage_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'CPU usage tracked',
        { connectionId, deviceId, timestamp, userCPUTime, systemCPUTime, cpuUsagePercent }
      );
    });

    test('should track network usage', () => {
      const timestamp = Date.now();
      const bytesReceived = 1000000;
      const bytesSent = 500000;
      const packetsReceived = 1000;
      const packetsSent = 500;
      const errorCount = 5;
      const retransmissionCount = 2;

      advancedMetrics.trackNetworkUsage(connectionId, deviceId, timestamp, {
        bytesReceived,
        bytesSent,
        packetsReceived,
        packetsSent,
        errorCount,
        retransmissionCount
      });

      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_bytes_received',
        bytesReceived,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_bytes_sent',
        bytesSent,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_packets_received',
        packetsReceived,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_packets_sent',
        packetsSent,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'network_errors',
        errorCount,
        { connectionId, deviceId }
      );
      expect(metrics.counter).toHaveBeenCalledWith(
        'network_retransmissions',
        retransmissionCount,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_usage_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Network usage tracked',
        {
          connectionId,
          deviceId,
          timestamp,
          bytesReceived,
          bytesSent,
          packetsReceived,
          packetsSent,
          errorCount,
          retransmissionCount
        }
      );
    });

    test('should handle errors in resource tracking', () => {
      const timestamp = Date.now();
      metrics.gauge.mockImplementationOnce(() => {
        throw new Error('Metrics error');
      });

      advancedMetrics.trackMemoryUsage(connectionId, deviceId, timestamp, {
        heapUsed: 50000000,
        heapTotal: 100000000,
        external: 10000000,
        rss: 150000000
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracking memory usage',
        {
          connectionId,
          deviceId,
          error: 'Metrics error'
        }
      );
    });

    test('should track resource thresholds and alerts', () => {
      const timestamp = Date.now();
      const memoryThresholdExceeded = true;
      const cpuThresholdExceeded = true;
      const networkThresholdExceeded = false;

      advancedMetrics.trackResourceThresholds(connectionId, deviceId, timestamp, {
        memoryThresholdExceeded,
        cpuThresholdExceeded,
        networkThresholdExceeded
      });

      expect(metrics.gauge).toHaveBeenCalledWith(
        'memory_threshold_exceeded',
        1,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'cpu_threshold_exceeded',
        1,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'network_threshold_exceeded',
        0,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'resource_thresholds_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Resource thresholds exceeded',
        {
          connectionId,
          deviceId,
          timestamp,
          memoryThresholdExceeded,
          cpuThresholdExceeded,
          networkThresholdExceeded
        }
      );
    });
  });

  describe('Resource Threshold Management', () => {
    test('should initialize with default thresholds', () => {
      const thresholds = advancedMetrics.getResourceThresholds();
      expect(thresholds).toEqual({
        memory: 0.8,
        cpu: 0.8,
        network: 0.8
      });
    });

    test('should update valid resource thresholds', () => {
      const newThresholds = {
        memory: 0.7,
        cpu: 0.6,
        network: 0.9
      };

      advancedMetrics.updateResourceThresholds(newThresholds);
      const thresholds = advancedMetrics.getResourceThresholds();

      expect(thresholds).toEqual(newThresholds);
      expect(logger.info).toHaveBeenCalledWith(
        'Resource thresholds updated',
        { thresholds: newThresholds }
      );
    });

    test('should ignore invalid threshold values', () => {
      const originalThresholds = advancedMetrics.getResourceThresholds();
      const invalidThresholds = {
        memory: 1.5,
        cpu: -0.1,
        network: 'invalid'
      };

      advancedMetrics.updateResourceThresholds(invalidThresholds);
      const thresholds = advancedMetrics.getResourceThresholds();

      expect(thresholds).toEqual(originalThresholds);
    });

    test('should handle partial threshold updates', () => {
      const originalThresholds = advancedMetrics.getResourceThresholds();
      const partialUpdate = {
        memory: 0.7
      };

      advancedMetrics.updateResourceThresholds(partialUpdate);
      const thresholds = advancedMetrics.getResourceThresholds();

      expect(thresholds).toEqual({
        ...originalThresholds,
        memory: 0.7
      });
    });

    test('should handle errors in threshold updates', () => {
      const invalidThresholds = null;

      advancedMetrics.updateResourceThresholds(invalidThresholds);

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating resource thresholds',
        {
          error: expect.any(String)
        }
      );
    });

    test('should ignore unknown threshold keys', () => {
      const originalThresholds = advancedMetrics.getResourceThresholds();
      const invalidKeys = {
        memory: 0.7,
        unknownKey: 0.5
      };

      advancedMetrics.updateResourceThresholds(invalidKeys);
      const thresholds = advancedMetrics.getResourceThresholds();

      expect(thresholds).toEqual({
        ...originalThresholds,
        memory: 0.7
      });
    });
  });

  describe('Performance Anomaly Detection', () => {
    let connectionId;
    let deviceId;
    let timestamp;
    let metrics;

    beforeEach(() => {
      connectionId = 'test-connection';
      deviceId = 'test-device';
      timestamp = Date.now();
      metrics = {
        latency: 100,
        throughput: 50,
        errorRate: 0.05,
        resourceUsage: 0.7,
        gauge: jest.fn(),
        counter: jest.fn()
      };
    });

    it('should track performance metrics for anomaly detection', () => {
      advancedMetrics.trackPerformanceMetrics(connectionId, deviceId, timestamp, metrics);

      expect(metrics.gauge).toHaveBeenCalledWith(
        'performance_latency',
        metrics.latency,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'performance_throughput',
        metrics.throughput,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'performance_error_rate',
        metrics.errorRate,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'performance_resource_usage',
        metrics.resourceUsage,
        { connectionId, deviceId }
      );
      expect(metrics.gauge).toHaveBeenCalledWith(
        'performance_metrics_timestamp',
        timestamp,
        { connectionId, deviceId }
      );
    });

    it('should detect performance anomalies', () => {
      // First, establish a baseline with more samples
      for (let i = 0; i < 30; i++) {
        advancedMetrics.trackPerformanceMetrics(connectionId, deviceId, timestamp + i * 1000, {
          latency: 50 + Math.random() * 10,       // Mean ~55, small variance
          throughput: 100 + Math.random() * 10,   // Mean ~105, small variance
          errorRate: 0.01 + Math.random() * 0.01, // Mean ~0.015, small variance
          resourceUsage: 0.5 + Math.random() * 0.1, // Mean ~0.55, small variance
          gauge: jest.fn(),
          counter: jest.fn()
        });
      }

      // Then test with anomalous values (significantly different from baseline)
      const anomalousMetrics = {
        latency: 200,         // Much higher than baseline (~55)
        throughput: 20,       // Much lower than baseline (~105)
        errorRate: 0.1,       // Much higher than baseline (~0.015)
        resourceUsage: 0.95,  // Much higher than baseline (~0.55)
        gauge: jest.fn(),
        counter: jest.fn()
      };

      const anomalies = advancedMetrics.detectPerformanceAnomalies(connectionId, deviceId, timestamp, anomalousMetrics);

      expect(anomalies).toEqual({
        latency: true,
        throughput: true,
        errorRate: true,
        resourceUsage: true
      });
    });

    it('should handle errors in performance tracking', () => {
      const invalidMetrics = {
        latency: 100,
        throughput: 50,
        errorRate: 0.05,
        resourceUsage: 0.7
        // Missing gauge and counter functions
      };

      advancedMetrics.trackPerformanceMetrics(connectionId, deviceId, timestamp, invalidMetrics);

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracking performance metrics',
        {
          connectionId,
          deviceId,
          error: "performanceMetrics.gauge is not a function"
        }
      );
    });

    test('should update performance baselines', () => {
      const connectionId = 'test-connection-1';
      const deviceId = 'test-device-1';
      const timestamp = Date.now();
      const metrics = {
        latency: 100,
        throughput: 1000,
        errorRate: 0.01,
        resourceUsage: 0.5
      };

      advancedMetrics.updatePerformanceBaselines(connectionId, deviceId, timestamp, metrics);

      const baselines = advancedMetrics.getPerformanceBaselines(connectionId);
      expect(baselines).toEqual({
        latency: {
          mean: 100,
          stdDev: 0,
          lastUpdate: timestamp
        },
        throughput: {
          mean: 1000,
          stdDev: 0,
          lastUpdate: timestamp
        },
        errorRate: {
          mean: 0.01,
          stdDev: 0,
          lastUpdate: timestamp
        },
        resourceUsage: {
          mean: 0.5,
          stdDev: 0,
          lastUpdate: timestamp
        }
      });
    });

    test('should return null for unknown connection baselines', () => {
      expect(advancedMetrics.getPerformanceBaselines('unknown-connection')).toBeNull();
    });

    test('should calculate statistical measures correctly', () => {
      const connectionId = 'test-connection-1';
      const deviceId = 'test-device-1';
      const timestamp = Date.now();

      // Add multiple measurements
      const measurements = [
        { latency: 100, throughput: 1000, errorRate: 0.01, resourceUsage: 0.5 },
        { latency: 120, throughput: 950, errorRate: 0.02, resourceUsage: 0.6 },
        { latency: 110, throughput: 980, errorRate: 0.015, resourceUsage: 0.55 }
      ];

      measurements.forEach((metric, index) => {
        advancedMetrics.updatePerformanceBaselines(
          connectionId,
          deviceId,
          timestamp + index * 1000,
          metric
        );
      });

      const baselines = advancedMetrics.getPerformanceBaselines(connectionId);
      expect(baselines.latency.mean).toBeCloseTo(110, 2);
      expect(baselines.throughput.mean).toBeCloseTo(976.67, 2);
      expect(baselines.errorRate.mean).toBeCloseTo(0.015, 3);
      expect(baselines.resourceUsage.mean).toBeCloseTo(0.55, 2);
    });
  });
}); 