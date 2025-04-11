const MessageBatcher = require('../../../../src/mcp/server/MessageBatcher');
const logger = require('../../../../src/utils/logger');

jest.mock('../../../../src/utils/logger');

describe('MessageBatcher', () => {
  let batcher;
  let mockMetrics;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock metrics
    mockMetrics = {
      increment: jest.fn(),
      decrement: jest.fn(),
      gauge: jest.fn(),
      timing: jest.fn(),
      record: jest.fn()
    };
    
    // Create batcher instance with test configuration
    batcher = new MessageBatcher({
      batchSize: 5,
      batchTimeout: 1000,
      compression: {
        enabled: true,
        threshold: 1000
      },
      metrics: mockMetrics
    });
  });

  afterEach(async () => {
    // Cleanup after each test
    if (batcher) {
      await batcher.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(batcher.config.batchSize).toBe(5);
      expect(batcher.config.batchTimeout).toBe(1000);
      expect(batcher.compressionEnabled).toBe(true);
      expect(batcher.compressionThreshold).toBe(1000);
      expect(batcher.batches).toBeDefined();
      expect(batcher.sequenceNumbers).toBeDefined();
    });

    it('should initialize with default values if not provided', () => {
      batcher = new MessageBatcher();
      expect(batcher.config.batchSize).toBe(5); // Default from DEFAULT_CONFIG
      expect(batcher.config.batchTimeout).toBe(1000);
      expect(batcher.compressionEnabled).toBe(true);
      expect(batcher.compressionThreshold).toBe(1000);
    });
  });

  describe('Basic Message Handling', () => {
    it('should create a new batch for a client', async () => {
      const clientId = 'test-client';
      const message = { id: 1, data: 'test', priority: 'medium' };
      
      await batcher.addMessage(clientId, message);
      
      const batch = batcher.batches.get(clientId);
      expect(batch).toBeDefined();
      expect(batch.messages).toHaveLength(1);
      expect(batch.messages[0]).toEqual(message);
    });

    it('should reject invalid message data', async () => {
      const clientId = 'test-client';
      const invalidMessage = null;
      
      await expect(async () => {
        await batcher.addMessage(clientId, invalidMessage);
      }).rejects.toThrow();
    });

    it('should handle message with missing priority', async () => {
      const clientId = 'test-client';
      const message = { id: 1, data: 'test' };
      
      await batcher.addMessage(clientId, message);
      
      const batch = batcher.batches.get(clientId);
      expect(batch).toBeDefined();
      expect(batch.messages[0].priority).toBe('medium'); // Default priority
    });
  });

  describe('Batch Management', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(async () => {
      // Clear all timers first
      jest.clearAllTimers();
      jest.useRealTimers();
      
      // Stop the batcher and ensure cleanup
      if (batcher) {
        await batcher.stop();
        batcher = null;
      }
    });

    it('should flush batch when size limit is reached', async () => {
      const clientId = 'test-client';
      const messages = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        data: `test${i + 1}`,
        priority: 'medium'
      }));

      // Create a promise that resolves when all messages are processed
      const allMessagesProcessed = new Promise(resolve => {
        let count = 0;
        batcher.on('message', () => {
          count++;
          if (count === messages.length) {
            resolve();
          }
        });
      });

      // Add all messages
      await Promise.all(messages.map(message => batcher.addMessage(clientId, message)));

      // Wait for all messages to be processed
      await allMessagesProcessed;

      // Verify batch was flushed
      expect(batcher.batches.get(clientId)).toBeUndefined();
      expect(batcher.timers.get(clientId)).toBeUndefined();
    });

    // TODO: Re-implement timeout test after fixing timer issues
    // it('should handle batch timeouts', async () => { ... });
  });
}); 