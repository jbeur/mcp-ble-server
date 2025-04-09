// Mock logger module
jest.mock('./src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock metrics module
jest.mock('./src/utils/metrics', () => ({
  metrics: {
    gauge: jest.fn(),
    increment: jest.fn(),
    histogram: jest.fn(),
    mcpMessageLatency: {
      observe: jest.fn()
    },
    mcpErrors: {
      inc: jest.fn()
    }
  }
}));

// Mock prom-client
jest.mock('prom-client', () => ({
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn()
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn()
  })),
  Histogram: jest.fn().mockImplementation(() => ({
    observe: jest.fn()
  }))
}));

// Set test environment
process.env.NODE_ENV = 'test'; 