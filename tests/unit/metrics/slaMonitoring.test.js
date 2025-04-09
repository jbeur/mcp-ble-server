const { SLAMonitoring } = require('../../../src/metrics/slaMonitoring');
const { metrics } = require('../../../src/metrics/metrics');

describe('SLAMonitoring', () => {
  let slaMonitoring;
  let config;

  beforeEach(() => {
    // Reset metrics before each test
    metrics.reset();

    // Create test configuration
    config = {
      responseTimeThreshold: 1000,
      availabilityThreshold: 0.99,
      errorRateThreshold: 0.01,
      windowSize: 60, // 1 minute for testing
      checkInterval: 10 // 10 seconds for testing
    };

    slaMonitoring = new SLAMonitoring(config);
  });

  afterEach(() => {
    // Clean up any timers
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config if none provided', () => {
      const defaultMonitoring = new SLAMonitoring();
      expect(defaultMonitoring.config.responseTimeThreshold).toBe(1000);
      expect(defaultMonitoring.config.availabilityThreshold).toBe(0.99);
      expect(defaultMonitoring.config.errorRateThreshold).toBe(0.01);
    });

    it('should initialize with provided config', () => {
      const customConfig = {
        responseTimeThreshold: 2000,
        availabilityThreshold: 0.95,
        errorRateThreshold: 0.05
      };
      const customMonitoring = new SLAMonitoring(customConfig);
      expect(customMonitoring.config.responseTimeThreshold).toBe(2000);
      expect(customMonitoring.config.availabilityThreshold).toBe(0.95);
      expect(customMonitoring.config.errorRateThreshold).toBe(0.05);
    });
  });

  describe('recordRequest', () => {
    it('should record successful requests correctly', () => {
      slaMonitoring.recordRequest(500, true);
      const metrics = slaMonitoring.getMetrics();
      expect(metrics.responseTime).toBe(500);
      expect(metrics.availability).toBe(100);
      expect(metrics.errorRate).toBe(0);
    });

    it('should record failed requests correctly', () => {
      slaMonitoring.recordRequest(1500, false);
      const metrics = slaMonitoring.getMetrics();
      expect(metrics.responseTime).toBe(1500);
      expect(metrics.availability).toBe(0);
      expect(metrics.errorRate).toBe(100);
    });

    it('should calculate average response time correctly', () => {
      slaMonitoring.recordRequest(500, true);
      slaMonitoring.recordRequest(1000, true);
      slaMonitoring.recordRequest(1500, false);
      const metrics = slaMonitoring.getMetrics();
      expect(metrics.responseTime).toBe(1000); // (500 + 1000 + 1500) / 3
      expect(metrics.availability).toBe(66.67); // 2/3 successful
      expect(metrics.errorRate).toBe(33.33); // 1/3 failed
    });
  });

  describe('SLA violations', () => {
    it('should detect response time violations', () => {
      slaMonitoring.recordRequest(1500, true); // Above 1000ms threshold
      const violations = slaMonitoring.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].type).toBe('response_time');
      expect(violations[0].threshold).toBe(1000);
      expect(violations[0].actual).toBe(1500);
    });

    it('should detect availability violations', () => {
      // Record 2 successful and 3 failed requests (40% availability)
      slaMonitoring.recordRequest(500, true);
      slaMonitoring.recordRequest(500, true);
      slaMonitoring.recordRequest(500, false);
      slaMonitoring.recordRequest(500, false);
      slaMonitoring.recordRequest(500, false);
      const violations = slaMonitoring.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].type).toBe('availability');
      expect(violations[0].threshold).toBe(0.99);
      expect(violations[0].actual).toBe(0.4);
    });

    it('should detect error rate violations', () => {
      // Record 1 successful and 2 failed requests (66.67% error rate)
      slaMonitoring.recordRequest(500, true);
      slaMonitoring.recordRequest(500, false);
      slaMonitoring.recordRequest(500, false);
      const violations = slaMonitoring.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].type).toBe('error_rate');
      expect(violations[0].threshold).toBe(0.01);
      expect(violations[0].actual).toBe(0.67);
    });

    it('should emit violation alerts', () => {
      const violationHandler = jest.fn();
      process.on('sla_violation', violationHandler);

      slaMonitoring.recordRequest(1500, true);
      expect(violationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'sla_violation',
        violation: 'response_time',
        threshold: 1000,
        actual: 1500
      }));

      process.removeListener('sla_violation', violationHandler);
    });
  });

  describe('data cleanup', () => {
    it('should clean up old data after window size', () => {
      jest.useFakeTimers();

      // Record initial data
      slaMonitoring.recordRequest(500, true);
      const initialMetrics = slaMonitoring.getMetrics();
      expect(initialMetrics.responseTime).toBe(500);

      // Advance time beyond window size
      jest.advanceTimersByTime(61000); // 61 seconds > 60 second window

      // Record new data
      slaMonitoring.recordRequest(1000, true);
      const newMetrics = slaMonitoring.getMetrics();
      expect(newMetrics.responseTime).toBe(1000); // Only new data
    });
  });

  describe('metrics', () => {
    it('should increment violation counter on violations', () => {
      slaMonitoring.recordRequest(1500, true);
      const metrics = slaMonitoring.getMetrics();
      expect(metrics.violations).toBe(1);
    });

    it('should track multiple violations', () => {
      // Record data that violates multiple SLAs
      slaMonitoring.recordRequest(1500, false);
      const metrics = slaMonitoring.getMetrics();
      expect(metrics.violations).toBe(2); // response_time + error_rate violations
    });
  });
}); 