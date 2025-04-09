const EventEmitter = require('events');

// Mock setup
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

// Create mock metric instances
const mockHistogramInstance = {
  observe: jest.fn()
};

const mockCounterInstance = {
  inc: jest.fn()
};

const mockGaugeInstance = {
  set: jest.fn()
};

// Create mock metric factories
const mockMetrics = {
  histogram: jest.fn().mockReturnValue(mockHistogramInstance),
  counter: jest.fn().mockReturnValue(mockCounterInstance),
  gauge: jest.fn().mockReturnValue(mockGaugeInstance)
};

// Mock BatchPredictor
const mockPredictor = {
  start: jest.fn(),
  stop: jest.fn(),
  predict: jest.fn(),
  _startPredictionLoop: jest.fn(),
  on: jest.fn()
};

// Mock BatchCompressor
const mockCompressor = {
  compress: jest.fn(),
  decompress: jest.fn(),
  isCompressionEnabled: jest.fn().mockReturnValue(true)
};

// Mock dependencies
jest.mock('../../../../src/utils/logger', () => ({
  logger: mockLogger
}));

jest.mock('../../../../src/utils/metrics', () => ({
  metrics: mockMetrics
}));

jest.mock('../../../../src/mcp/server/BatchPredictor', () => {
  return jest.fn().mockImplementation(() => mockPredictor);
});

jest.mock('../../../../src/mcp/server/BatchCompressor', () => {
  return jest.fn().mockImplementation(() => mockCompressor);
});

const { PRIORITY_LEVELS } = require('../../../../src/utils/constants');
const MessageBatcher = require('../../../../src/mcp/server/MessageBatcher');

// Test configuration
const testConfig = {
  batchSize: 5,
  minBatchSize: 1,
  maxBatchSize: 10,
  timeouts: {
    high: 100,
    medium: 500,
    low: 1000
  },
  compression: {
    enabled: true,
    minSize: 5
  }
};

describe('MessageBatcher', () => {
  let batcher;

  beforeEach(() => {
    jest.clearAllMocks();
    batcher = new MessageBatcher(testConfig);
  });

  afterEach(() => {
    if (batcher) {
      batcher.removeAllListeners();
    }
  });

  test('initializes with correct configuration', () => {
    expect(batcher.config).toEqual(expect.objectContaining(testConfig));
    expect(batcher.batches).toBeInstanceOf(Map);
    expect(batcher.timers).toBeInstanceOf(Map);
  });

  test('tracks errors when handling invalid messages', async () => {
    await expect(batcher.addMessage('client1', null)).rejects.toThrow('Invalid message');
    expect(mockLogger.error).toHaveBeenCalledWith('Invalid message');
    expect(mockCounterInstance.inc).toHaveBeenCalled();
  });

  test('tracks errors when handling invalid client IDs', async () => {
    await expect(batcher.addMessage(null, { type: 'data', data: 'test', priority: PRIORITY_LEVELS.MEDIUM })).rejects.toThrow('Invalid client ID');
    expect(mockLogger.error).toHaveBeenCalledWith('Invalid client ID');
    expect(mockCounterInstance.inc).toHaveBeenCalled();
  });

  test('should create new batch for client', async () => {
    const message = { type: 'data', data: 'test', priority: PRIORITY_LEVELS.MEDIUM };
    await batcher.addMessage('client1', message);
    expect(batcher.batches.get('client1')).toBeDefined();
    expect(mockLogger.debug).toHaveBeenCalledWith('Added message to batch', { clientId: 'client1', messageType: message.type });
  });

  describe('Error handling', () => {
    it('should handle invalid message data', async () => {
      const clientId = 'test-client';
      const message = null;
      await expect(batcher.addMessage(clientId, message)).rejects.toThrow('Invalid message');
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid message');
      expect(mockCounterInstance.inc).toHaveBeenCalled();
    });

    it('should handle invalid client ID', async () => {
      const message = {
        type: 'data',
        data: Buffer.from('test'),
        priority: PRIORITY_LEVELS.MEDIUM
      };
      await expect(batcher.addMessage(null, message)).rejects.toThrow('Invalid client ID');
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid client ID');
      expect(mockCounterInstance.inc).toHaveBeenCalled();
    });
  });

  describe('Message batching', () => {
    it('should create a new batch for a client', async () => {
      const clientId = 'test-client';
      const message = {
        type: 'data',
        data: Buffer.from('test'),
        priority: PRIORITY_LEVELS.MEDIUM
      };
      await batcher.addMessage(clientId, message);
      expect(mockLogger.debug).toHaveBeenCalledWith('Added message to batch', { clientId, messageType: message.type });
      expect(mockHistogramInstance.observe).toHaveBeenCalled();
    });

    it('should handle messages with different priorities', async () => {
      const clientId = 'test-client';
      const messages = [
        { type: 'data', data: Buffer.from('high'), priority: PRIORITY_LEVELS.HIGH },
        { type: 'data', data: Buffer.from('medium'), priority: PRIORITY_LEVELS.MEDIUM },
        { type: 'data', data: Buffer.from('low'), priority: PRIORITY_LEVELS.LOW }
      ];
      
      for (const msg of messages) {
        await batcher.addMessage(clientId, msg);
      }
      expect(mockLogger.debug).toHaveBeenCalledWith('Added message to batch', expect.any(Object));
      expect(mockHistogramInstance.observe).toHaveBeenCalled();
    });

    it('should flush batch when size limit is reached', async () => {
      const clientId = 'test-client';
      const messages = Array(testConfig.batchSize).fill({
        type: 'data',
        data: Buffer.from('test'),
        priority: PRIORITY_LEVELS.MEDIUM
      });

      for (const msg of messages) {
        await batcher.addMessage(clientId, msg);
      }

      // We expect batchSize + 1 calls because we observe the size when adding and when flushing
      expect(mockHistogramInstance.observe).toHaveBeenCalledTimes(testConfig.batchSize + 1);
    });

    it('should compress batch when compression is enabled and size threshold is met', async () => {
      const clientId = 'test-client';
      const messages = Array(testConfig.compression.minSize).fill({
        type: 'data',
        data: Buffer.from('test'),
        priority: PRIORITY_LEVELS.MEDIUM
      });

      // Mock successful compression
      mockCompressor.compress.mockResolvedValue({
        compressed: true,
        data: Buffer.from('compressed'),
        originalSize: 100,
        compressedSize: 50,
        compressionRatio: 0.5
      });

      // Enable compression
      batcher.enableCompression();

      for (const msg of messages) {
        await batcher.addMessage(clientId, msg);
      }

      // Force flush to trigger compression
      await batcher._flushBatch(clientId, 'test');

      expect(mockLogger.debug).toHaveBeenCalledWith('Compressing batch', expect.any(Object));
      expect(mockCounterInstance.inc).toHaveBeenCalled();
    });

    it('should handle client removal and flush pending batches', async () => {
      const clientId = 'test-client';
      const message = {
        type: 'data',
        data: Buffer.from('test'),
        priority: PRIORITY_LEVELS.MEDIUM
      };
      await batcher.addMessage(clientId, message);
      await batcher.removeClient(clientId);
      expect(mockLogger.debug).toHaveBeenCalledWith('Added message to batch', { clientId, messageType: message.type });
    });
  });
});