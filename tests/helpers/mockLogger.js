const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
};

const resetMockLogger = () => {
  mockLogger.info.mockClear();
  mockLogger.error.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.debug.mockClear();
  mockLogger.trace.mockClear();
};

module.exports = {
  mockLogger,
  resetMockLogger
}; 