const { Logger } = require('../../../src/utils/logger');

describe('Logger', () => {
  let logger;

  beforeEach(() => {
    logger = new Logger();
  });

  describe('Configuration Validation', () => {
    it('should accept valid log levels', () => {
      const validLevels = ['info', 'error', 'warn', 'debug'];
      validLevels.forEach(level => {
        expect(() => new Logger({ level })).not.toThrow();
      });
    });

    it('should reject invalid log levels', () => {
      expect(() => new Logger({ level: 'invalid' })).toThrow('Invalid log level');
    });

    it('should accept valid environments', () => {
      const validEnvironments = ['development', 'test', 'production'];
      validEnvironments.forEach(env => {
        expect(() => new Logger({ environment: env })).not.toThrow();
      });
    });

    it('should reject invalid environments', () => {
      expect(() => new Logger({ environment: 'invalid' })).toThrow('Invalid environment');
    });
  });

  describe('Log Level Filtering', () => {
    it('should log messages at or above the configured level', () => {
      const testLogger = new Logger({ level: 'warn' });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('Message Formatting', () => {
    it('should include timestamp in log messages', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.info('test message');
      
      const logCall = consoleSpy.mock.calls[0][0];
      expect(logCall).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      
      consoleSpy.mockRestore();
    });

    it('should include test prefix in test environment', () => {
      const testLogger = new Logger({ environment: 'test' });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      testLogger.info('test message');
      
      const logCall = consoleSpy.mock.calls[0][0];
      expect(logCall).toContain('[TEST] INFO:');
      
      consoleSpy.mockRestore();
    });
  });
}); 