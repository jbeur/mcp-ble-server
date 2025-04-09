const ThreatDetectionService = require('../../../src/security/ThreatDetectionService');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics', () => ({
  authFailures: { inc: jest.fn() },
  requestRate: { inc: jest.fn() },
  suspiciousPatterns: { inc: jest.fn() },
  threatDetectionErrors: { inc: jest.fn() }
}));

describe('ThreatDetectionService', () => {
  let threatDetectionService;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      failedAuthThreshold: 3,
      requestRateThreshold: 50,
      suspiciousPatterns: ['sql_injection', 'xss_attempt']
    };
    threatDetectionService = new ThreatDetectionService(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with default config when none provided', () => {
      const service = new ThreatDetectionService();
      expect(service.thresholds.failedAuthAttempts).toBe(5);
      expect(service.thresholds.requestRate).toBe(100);
      expect(service.thresholds.suspiciousPatterns).toEqual([]);
    });

    it('should initialize with provided config', () => {
      expect(threatDetectionService.thresholds.failedAuthAttempts).toBe(3);
      expect(threatDetectionService.thresholds.requestRate).toBe(50);
      expect(threatDetectionService.thresholds.suspiciousPatterns).toEqual(['sql_injection', 'xss_attempt']);
    });
  });

  describe('analyze', () => {
    it('should detect multiple failed authentication attempts', () => {
      const data = {
        type: 'auth_failure',
        count: 4,
        source: '192.168.1.1'
      };

      const threats = threatDetectionService.analyze(data);
      expect(threats).toHaveLength(1);
      expect(threats[0].severity).toBe('high');
      expect(threats[0].message).toBe('Multiple failed authentication attempts detected');
      expect(metrics.authFailures.inc).toHaveBeenCalled();
    });

    it('should detect high request rate', () => {
      const data = {
        type: 'request_rate',
        rate: 60,
        source: '192.168.1.1'
      };

      const threats = threatDetectionService.analyze(data);
      expect(threats).toHaveLength(1);
      expect(threats[0].severity).toBe('medium');
      expect(threats[0].message).toBe('High request rate detected');
      expect(metrics.requestRate.inc).toHaveBeenCalled();
    });

    it('should detect suspicious patterns', () => {
      const data = {
        type: 'request',
        content: 'SELECT * FROM users; sql_injection',
        source: '192.168.1.1'
      };

      const threats = threatDetectionService.analyze(data);
      expect(threats).toHaveLength(1);
      expect(threats[0].severity).toBe('high');
      expect(threats[0].message).toBe('Suspicious pattern detected');
      expect(metrics.suspiciousPatterns.inc).toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      const data = null;
      const threats = threatDetectionService.analyze(data);
      expect(threats).toEqual([]);
      expect(metrics.threatDetectionErrors.inc).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateThresholds', () => {
    it('should update thresholds and log the change', () => {
      const newThresholds = {
        failedAuthAttempts: 10,
        requestRate: 200
      };

      threatDetectionService.updateThresholds(newThresholds);
      expect(threatDetectionService.thresholds.failedAuthAttempts).toBe(10);
      expect(threatDetectionService.thresholds.requestRate).toBe(200);
      expect(logger.info).toHaveBeenCalledWith('Updated threat detection thresholds', { newThresholds });
    });
  });

  describe('addCustomRule', () => {
    it('should add a custom rule and log the addition', () => {
      const customRule = {
        name: 'custom_rule',
        check: (data) => null
      };

      threatDetectionService.addCustomRule(customRule);
      expect(threatDetectionService.detectionRules).toContain(customRule);
      expect(logger.info).toHaveBeenCalledWith('Added custom threat detection rule', { ruleName: 'custom_rule' });
    });
  });
}); 