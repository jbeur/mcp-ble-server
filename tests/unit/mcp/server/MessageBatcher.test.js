const MessageBatcher = require('../../../../src/mcp/server/MessageBatcher');
const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
}));

describe('MessageBatcher', () => {
    let batcher;
    const TEST_CONFIG = {
        batchSize: 3,
        batchTimeout: 100
    };

    beforeEach(() => {
        jest.clearAllMocks();
        batcher = new MessageBatcher(TEST_CONFIG);
    });

    afterEach(() => {
        // Clean up any remaining timers
        if (batcher) {
            batcher.stop();
        }
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
            
            // Simulate error by passing null message
            try {
                batcher.addMessage(clientId, null);
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

    describe('dynamic batch sizing', () => {
        let batcher;
        const TEST_CONFIG = {
            batchSize: 10,
            minBatchSize: 5,
            maxBatchSize: 20,
            adaptiveInterval: 1000, // 1 second for testing
            performanceThreshold: 0.8
        };

        beforeEach(() => {
            jest.useFakeTimers();
            batcher = new MessageBatcher(TEST_CONFIG);
        });

        afterEach(() => {
            if (batcher) {
                batcher.stop();
            }
            jest.useRealTimers();
        });

        it('should initialize with correct dynamic sizing config', () => {
            expect(batcher.minBatchSize).toBe(TEST_CONFIG.minBatchSize);
            expect(batcher.maxBatchSize).toBe(TEST_CONFIG.maxBatchSize);
            expect(batcher.adaptiveInterval).toBe(TEST_CONFIG.adaptiveInterval);
            expect(batcher.performanceThreshold).toBe(TEST_CONFIG.performanceThreshold);
        });

        it('should adjust batch size based on load', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            const initialBatchSize = batcher.batchSize;

            // Mock _calculateCurrentLoad to simulate high load
            const originalCalculateLoad = batcher._calculateCurrentLoad;
            batcher._calculateCurrentLoad = jest.fn().mockReturnValue(0.9); // 90% load

            // Add some messages
            for (let i = 0; i < 10; i++) {
                batcher.addMessage(clientId, message);
            }

            // Trigger adjustment
            jest.advanceTimersByTime(TEST_CONFIG.adaptiveInterval);

            // Check if batch size was adjusted
            const metrics = batcher.getMetrics();
            expect(metrics.performance.adjustmentHistory.length).toBeGreaterThan(0);
            expect(metrics.performance.currentLoad).toBeGreaterThan(0);
            expect(batcher.batchSize).toBeGreaterThan(initialBatchSize);

            // Restore original method
            batcher._calculateCurrentLoad = originalCalculateLoad;
        });

        it('should respect min and max batch size limits', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Simulate very high load
            for (let i = 0; i < 50; i++) {
                batcher.addMessage(clientId, message);
                if (i % 3 === 0) {
                    jest.advanceTimersByTime(TEST_CONFIG.adaptiveInterval);
                }
            }

            // Trigger final adjustment
            jest.advanceTimersByTime(TEST_CONFIG.adaptiveInterval);

            // Check if batch size stayed within limits
            expect(batcher.batchSize).toBeLessThanOrEqual(TEST_CONFIG.maxBatchSize);
            expect(batcher.batchSize).toBeGreaterThanOrEqual(TEST_CONFIG.minBatchSize);
        });

        it('should maintain adjustment history', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Generate varying load over time
            for (let i = 0; i < 12; i++) {
                const messageCount = Math.floor(Math.random() * 10) + 1;
                for (let j = 0; j < messageCount; j++) {
                    batcher.addMessage(clientId, message);
                }
                jest.advanceTimersByTime(TEST_CONFIG.adaptiveInterval);
            }

            const metrics = batcher.getMetrics();
            expect(metrics.performance.adjustmentHistory.length).toBeLessThanOrEqual(10);
            expect(metrics.performance.adjustmentHistory.length).toBeGreaterThan(0);
        });

        it('should handle errors during batch size adjustment', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            const initialBatchSize = batcher.batchSize;

            // Mock _calculateCurrentLoad to throw an error
            const originalCalculateLoad = batcher._calculateCurrentLoad;
            batcher._calculateCurrentLoad = jest.fn().mockImplementation(() => {
                throw new Error('Test error');
            });

            // Generate some load
            for (let i = 0; i < 5; i++) {
                batcher.addMessage(clientId, message);
            }

            // Trigger adjustment
            jest.advanceTimersByTime(TEST_CONFIG.adaptiveInterval);

            // Verify error was handled and batch size remained unchanged
            expect(batcher.batchSize).toBe(initialBatchSize);

            // Restore original method
            batcher._calculateCurrentLoad = originalCalculateLoad;
        });
    });

    describe('cleanup', () => {
        it('should clean up resources when stopped', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add some messages to create batches
            batcher.addMessage(clientId, message);
            batcher.addMessage(clientId, message);

            // Stop the batcher
            batcher.stop();

            // Verify cleanup
            expect(batcher.adaptiveTimer).toBeNull();
            expect(batcher.batches.size).toBe(0);
            expect(batcher.timers.size).toBe(0);
            expect(batcher.batchStartTimes.size).toBe(0);
        });

        it('should flush remaining batches when stopped', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            const batchHandler = jest.fn();

            batcher.on('batch', batchHandler);
            batcher.addMessage(clientId, message);
            batcher.stop();

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][0]).toBe(clientId);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
        });
    });
}); 