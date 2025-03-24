const ResourceLimiter = require('../../../../src/mcp/server/ResourceLimiter');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('ResourceLimiter', () => {
  let limiter;
  let mockMetrics;
  let mockGaugeSet;
  let mockCounterInc;
  let originalProcess;

  beforeEach(() => {
    // Store original process
    originalProcess = global.process;

    // Mock process.memoryUsage
    global.process = {
      ...originalProcess,
      memoryUsage: jest.fn().mockReturnValue({
        heapUsed: 100 * 1024 * 1024, // 100MB
        heapTotal: 200 * 1024 * 1024, // 200MB
        external: 50 * 1024 * 1024 // 50MB
      }),
      cpuUsage: jest.fn().mockReturnValue({
        user: 1000,
        system: 500
      })
    };

    // Reset mocks
    jest.clearAllMocks();

    // Create mock gauge and counter functions
    mockGaugeSet = jest.fn();
    mockCounterInc = jest.fn();

    // Create mock metrics
    mockMetrics = {
      gauge: jest.fn().mockReturnValue({
        set: mockGaugeSet
      }),
      counter: jest.fn().mockReturnValue({
        inc: mockCounterInc
      })
    };
    metrics.gauge = mockMetrics.gauge;
    metrics.counter = mockMetrics.counter;

    limiter = new ResourceLimiter();
  });

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;
  });

  describe('constructor', () => {
    it('should initialize with default limits', () => {
      expect(limiter.options.maxConnections).toBe(100);
      expect(limiter.options.maxMemoryUsage).toBe(0.8); // 80% of total memory
      expect(limiter.options.maxCpuUsage).toBe(0.8); // 80% of CPU
      expect(limiter.options.maxNetworkUsage).toBe(1024 * 1024 * 1024); // 1GB
    });

    it('should use custom resource limits', () => {
      const customOptions = {
        maxConnections: 50,
        maxMemoryUsage: 0.7,
        maxCpuUsage: 0.7,
        maxNetworkUsage: 512 * 1024 * 1024
      };
      limiter = new ResourceLimiter(customOptions);
      expect(limiter.options.maxConnections).toBe(50);
      expect(limiter.options.maxMemoryUsage).toBe(0.7);
      expect(limiter.options.maxCpuUsage).toBe(0.7);
      expect(limiter.options.maxNetworkUsage).toBe(512 * 1024 * 1024);
    });
  });

  describe('connection limits', () => {
    it('should allow connections within limit', () => {
      expect(limiter.canAcceptConnection()).toBe(true);
    });

    it('should reject connections exceeding limit', () => {
      // Simulate max connections reached
      limiter.currentConnections = limiter.options.maxConnections;
      expect(limiter.canAcceptConnection()).toBe(false);
    });

    it('should track connection count', () => {
      limiter.incrementConnections();
      expect(limiter.currentConnections).toBe(1);
      limiter.decrementConnections();
      expect(limiter.currentConnections).toBe(0);
    });
  });

  describe('memory limits', () => {
    it('should allow operations within memory limit', () => {
      expect(limiter.checkMemoryUsage('test-connection')).toBe(true);
    });

    it('should reject operations exceeding memory limit', () => {
      // Mock high memory usage
      global.process.memoryUsage.mockReturnValue({
        heapUsed: 180 * 1024 * 1024, // 180MB
        heapTotal: 200 * 1024 * 1024, // 200MB
        external: 50 * 1024 * 1024 // 50MB
      });
      expect(limiter.checkMemoryUsage('test-connection')).toBe(false);
    });

    it('should track memory metrics', () => {
      limiter.checkMemoryUsage('test-connection');
      expect(mockGaugeSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: 'test-connection',
          resource_type: 'memory'
        }),
        expect.any(Number)
      );
    });
  });

  describe('CPU limits', () => {
    it('should allow operations within CPU limit', () => {
      expect(limiter.checkCpuUsage('test-connection')).toBe(true);
    });

    it('should reject operations exceeding CPU limit', () => {
      // Mock high CPU usage
      global.process.cpuUsage.mockReturnValue({
        user: 900000000,
        system: 100000000
      });
      expect(limiter.checkCpuUsage('test-connection')).toBe(false);
    });

    it('should track CPU metrics', () => {
      limiter.checkCpuUsage('test-connection');
      expect(mockGaugeSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: 'test-connection',
          resource_type: 'cpu'
        }),
        expect.any(Number)
      );
    });
  });

  describe('network limits', () => {
    it('should allow operations within network limit', () => {
      expect(limiter.checkNetworkUsage('test-connection', 100 * 1024 * 1024)).toBe(true);
    });

    it('should reject operations exceeding network limit', () => {
      expect(limiter.checkNetworkUsage('test-connection', 2 * 1024 * 1024 * 1024)).toBe(false);
    });

    it('should track network metrics', () => {
      limiter.checkNetworkUsage('test-connection', 100 * 1024 * 1024);
      expect(mockGaugeSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: 'test-connection',
          resource_type: 'network'
        }),
        expect.any(Number)
      );
    });
  });

  describe('resource enforcement', () => {
    it('should enforce all resource limits', () => {
      // Mock high resource usage
      global.process.memoryUsage.mockReturnValue({
        heapUsed: 180 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 50 * 1024 * 1024
      });
      global.process.cpuUsage.mockReturnValue({
        user: 900000000,
        system: 100000000
      });

      const result = limiter.enforceLimits({
        connectionId: 'test-connection',
        networkBytes: 2 * 1024 * 1024 * 1024
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Resource limits exceeded');
      expect(result.details).toContain('memory');
      expect(result.details).toContain('cpu');
      expect(result.details).toContain('network');
    });

    it('should allow operations within all limits', () => {
      const result = limiter.enforceLimits({
        connectionId: 'test-connection',
        networkBytes: 100 * 1024 * 1024
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('All resource limits satisfied');
    });
  });

  describe('metrics tracking', () => {
    it('should track resource limit violations', () => {
      // Mock high resource usage
      global.process.memoryUsage.mockReturnValue({
        heapUsed: 180 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 50 * 1024 * 1024
      });

      limiter.enforceLimits({
        connectionId: 'test-connection',
        networkBytes: 100 * 1024 * 1024
      });

      expect(mockCounterInc).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: 'test-connection',
          resource_type: 'memory'
        })
      );
    });

    it('should track resource usage metrics', () => {
      limiter.enforceLimits({
        connectionId: 'test-connection',
        networkBytes: 100 * 1024 * 1024
      });

      expect(mockGaugeSet).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: 'test-connection',
          resource_type: 'memory'
        }),
        expect.any(Number)
      );
    });
  });
}); 