const MessageBatcher = require('../../../../src/mcp/server/MessageBatcher');
const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');

describe('MessageBatcher', () => {
    let batcher;
    const TEST_CONFIG = {
        batchSize: 3,
        batchTimeout: 100
    };

    beforeEach(() => {
        batcher = new MessageBatcher(TEST_CONFIG);
    });

    afterEach(() => {
        // Clean up any remaining timers
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should initialize with default config', () => {
            const defaultBatcher = new MessageBatcher();
            expect(defaultBatcher.batchSize).toBe(10);
            expect(defaultBatcher.batchTimeout).toBe(100);
        });

        it('should initialize with custom config', () => {
            expect(batcher.batchSize).toBe(TEST_CONFIG.batchSize);
            expect(batcher.batchTimeout).toBe(TEST_CONFIG.batchTimeout);
        });
    });

    describe('addMessage', () => {
        it('should add message to new batch', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '123' } };

            batcher.addMessage(clientId, message);
            const metrics = batcher.getMetrics();
            expect(metrics.totalMessages).toBe(1);
            expect(metrics.activeClients).toBe(1);
            expect(metrics.activeBatches).toBe(1);
        });

        it('should flush batch when size limit is reached', () => {
            const clientId = 'test-client';
            const messages = [
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }
            ];

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            messages.forEach(msg => batcher.addMessage(clientId, msg));

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(3);
            expect(batchHandler.mock.calls[0][0]).toBe(clientId);
        });
    });

    describe('batch timeout', () => {
        it('should flush batch after timeout', async () => {
            jest.useFakeTimers();
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.batchTimeout);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
        });
    });

    describe('removeClient', () => {
        it('should remove client and flush remaining messages', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            batcher.addMessage(clientId, message);
            batcher.removeClient(clientId);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
            expect(batchHandler.mock.calls[0][0]).toBe(clientId);
        });

        it('should clean up timers and batches', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            batcher.addMessage(clientId, message);
            batcher.removeClient(clientId);

            const metrics = batcher.getMetrics();
            expect(metrics.activeClients).toBe(0);
            expect(metrics.activeBatches).toBe(0);
        });
    });

    describe('metrics', () => {
        it('should track batch sizes correctly', () => {
            const clientId = 'test-client';
            const messages = [
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }
            ];

            batcher.on('batch', () => {}); // Prevent unhandled event warnings
            messages.forEach(msg => batcher.addMessage(clientId, msg));

            const metrics = batcher.getMetrics();
            expect(metrics.maxBatchSize).toBe(3);
            expect(metrics.minBatchSize).toBe(3);
            expect(metrics.averageBatchSize).toBe(3);
        });

        it('should track batch flush reasons', () => {
            jest.useFakeTimers();
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            batcher.on('batch', () => {}); // Prevent unhandled event warnings
            
            // Test size-based flush
            batcher.addMessage(clientId, message);
            batcher.addMessage(clientId, message);
            batcher.addMessage(clientId, message);

            // Test timeout-based flush
            batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.batchTimeout);

            // Test client disconnect flush
            batcher.addMessage(clientId, message);
            batcher.removeClient(clientId);

            const metrics = batcher.getMetrics();
            expect(metrics.batchFlushReasons.size).toBe(1);
            expect(metrics.batchFlushReasons.timeout).toBe(1);
            expect(metrics.batchFlushReasons.clientDisconnect).toBe(1);
        });

        it('should track errors', () => {
            const clientId = 'test-client';
            
            // Simulate error by trying to access a property of undefined
            const invalidMessage = { data: undefined };
            try {
                batcher.addMessage(clientId, invalidMessage);
            } catch (error) {
                // Expected error
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.addMessage).toBe(1);
        });
    });

    describe('resetMetrics', () => {
        it('should reset all metrics to initial values', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            batcher.on('batch', () => {}); // Prevent unhandled event warnings
            batcher.addMessage(clientId, message);
            batcher.addMessage(clientId, message);
            batcher.addMessage(clientId, message);

            const beforeReset = batcher.getMetrics();
            expect(beforeReset.totalMessages).toBe(3);
            expect(beforeReset.activeClients).toBe(1);

            batcher.resetMetrics();
            const afterReset = batcher.getMetrics();
            expect(afterReset.totalMessages).toBe(0);
            expect(afterReset.activeClients).toBe(0);
            expect(afterReset.maxBatchSize).toBe(0);
            expect(afterReset.minBatchSize).toBe(Infinity);
        });
    });
}); 