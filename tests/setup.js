// Mock console methods to avoid noise during tests
global.console = {
  ...console,
  // Keep error logging for debugging
  error: jest.fn(),
  // Mock other console methods
  log: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Mock setInterval and clearInterval
global.setInterval = jest.fn();
global.clearInterval = jest.fn();

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
}); 