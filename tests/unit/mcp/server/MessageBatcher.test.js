const { MessageBatcher, PRIORITY_LEVELS } = require('../../../../src/mcp/server/MessageBatcher');
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
        batchTimeout: 100,
        enableAdaptiveSizing: false // Disable adaptive sizing for tests
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
        it('should add message to new batch', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '123' } };

            await batcher.addMessage(clientId, message);
            const metrics = batcher.getMetrics();
            expect(metrics.totalMessages).toBe(1);
            expect(metrics.activeClients).toBe(1);
            expect(metrics.activeBatches).toBe(1);
            expect(metrics.priorities.medium.count).toBe(1); // Default priority
        });

        it('should flush batch when size limit is reached', async () => {
            const clientId = 'test-client';
            const messages = [
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }
            ];

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            for (const msg of messages) {
                await batcher.addMessage(clientId, msg);
            }

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

            await batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.batchTimeout);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
        });
    });

    describe('removeClient', () => {
        it('should remove client and flush remaining messages', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            await batcher.addMessage(clientId, message);
            await batcher.removeClient(clientId);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
            expect(batchHandler.mock.calls[0][0]).toBe(clientId);
        });

        it('should clean up timers and batches', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            await batcher.addMessage(clientId, message);
            await batcher.removeClient(clientId);

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
            expect(beforeReset.priorities.medium.count).toBe(3);

            batcher.resetMetrics();
            const afterReset = batcher.getMetrics();
            expect(afterReset.totalMessages).toBe(0);
            expect(afterReset.activeClients).toBe(0);
            expect(afterReset.maxBatchSize).toBe(0);
            expect(afterReset.minBatchSize).toBe(Infinity);
            expect(afterReset.priorities.medium.count).toBe(0);
        });
    });

    describe('dynamic batch sizing', () => {
        let batcher;
        const TEST_CONFIG = {
            batchSize: 10,
            minBatchSize: 5,
            maxBatchSize: 20,
            adaptiveInterval: 1000, // 1 second for testing
            performanceThreshold: 0.8,
            enableAdaptiveSizing: false // Disable automatic adjustments
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
                batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            }

            // Manually trigger adjustment
            batcher._adjustBatchSize();

            // Verify batch size was adjusted
            expect(batcher.batchSize).toBeLessThan(initialBatchSize);
            expect(batcher.batchSize).toBeGreaterThanOrEqual(TEST_CONFIG.minBatchSize);

            // Restore original method
            batcher._calculateCurrentLoad = originalCalculateLoad;
        });

        it('should respect min and max batch size limits', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Mock _calculateCurrentLoad to simulate extreme load
            const originalCalculateLoad = batcher._calculateCurrentLoad;
            batcher._calculateCurrentLoad = jest.fn().mockReturnValue(1.0); // 100% load

            // Add messages to trigger adjustment
            for (let i = 0; i < 20; i++) {
                batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            }

            // Manually trigger adjustment
            batcher._adjustBatchSize();

            // Verify batch size stays within limits
            expect(batcher.batchSize).toBeGreaterThanOrEqual(TEST_CONFIG.minBatchSize);
            expect(batcher.batchSize).toBeLessThanOrEqual(TEST_CONFIG.maxBatchSize);

            // Restore original method
            batcher._calculateCurrentLoad = originalCalculateLoad;
        });

        it('should maintain adjustment history', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Mock _calculateCurrentLoad to simulate varying load
            const originalCalculateLoad = batcher._calculateCurrentLoad;
            batcher._calculateCurrentLoad = jest.fn()
                .mockReturnValueOnce(0.9)  // First adjustment
                .mockReturnValueOnce(0.7)  // Second adjustment
                .mockReturnValueOnce(0.8); // Third adjustment

            // Add messages and trigger adjustments
            for (let i = 0; i < 15; i++) {
                batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            }

            // Trigger multiple adjustments
            batcher._adjustBatchSize();
            batcher._adjustBatchSize();
            batcher._adjustBatchSize();

            // Verify adjustment history
            const history = batcher.metrics.performance.adjustmentHistory;
            expect(history.length).toBeLessThanOrEqual(10); // Should not exceed max history size
            expect(history[0]).toHaveProperty('timestamp');
            expect(history[0]).toHaveProperty('oldSize');
            expect(history[0]).toHaveProperty('newSize');
            expect(history[0]).toHaveProperty('loadDiff');
            expect(history[0]).toHaveProperty('currentLoad');
            expect(history[0]).toHaveProperty('targetLoad');

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

    describe('priority-based batching', () => {
        let batcher;
        const TEST_CONFIG = {
            batchSize: 5,
            batchTimeout: 100
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

        it('should maintain message order by priority', () => {
            const clientId = 'test-client';
            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Add messages with different priorities
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } }, PRIORITY_LEVELS.LOW);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } }, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }, PRIORITY_LEVELS.MEDIUM);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '4' } }, PRIORITY_LEVELS.LOW);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '5' } }, PRIORITY_LEVELS.HIGH);

            // Force flush
            batcher._flushBatch(clientId, 'size');

            // Verify order: high priority messages first, then medium, then low
            const batch = batchHandler.mock.calls[0][1];
            expect(batch[0].data.id).toBe('2'); // First high priority
            expect(batch[1].data.id).toBe('5'); // Second high priority
            expect(batch[2].data.id).toBe('3'); // Medium priority
            expect(batch[3].data.id).toBe('1'); // First low priority
            expect(batch[4].data.id).toBe('4'); // Second low priority
        });

        it('should track priority-based metrics', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add messages with different priorities
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.LOW);

            const metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(2);
            expect(metrics.priorities.medium.count).toBe(2);
            expect(metrics.priorities.low.count).toBe(1);
        });

        it('should handle default priority for messages without priority specified', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add message without priority (should default to MEDIUM)
            batcher.addMessage(clientId, message);

            const metrics = batcher.getMetrics();
            expect(metrics.priorities.medium.count).toBe(1);
            expect(metrics.priorities.high.count).toBe(0);
            expect(metrics.priorities.low.count).toBe(0);
        });

        it('should maintain priority order when flushing due to timeout', async () => {
            const clientId = 'test-client';
            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Add messages with different priorities
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } }, PRIORITY_LEVELS.LOW);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } }, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }, PRIORITY_LEVELS.MEDIUM);

            // Trigger timeout
            jest.advanceTimersByTime(TEST_CONFIG.batchTimeout);

            // Verify order: high priority messages first, then medium, then low
            const batch = batchHandler.mock.calls[0][1];
            expect(batch[0].data.id).toBe('2'); // High priority
            expect(batch[1].data.id).toBe('3'); // Medium priority
            expect(batch[2].data.id).toBe('1'); // Low priority
        });

        it('should reset priority metrics when resetMetrics is called', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add messages with different priorities
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.LOW);

            // Verify metrics are populated
            let metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(1);
            expect(metrics.priorities.medium.count).toBe(1);
            expect(metrics.priorities.low.count).toBe(1);

            // Reset metrics
            batcher.resetMetrics();

            // Verify metrics are reset
            metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(0);
            expect(metrics.priorities.medium.count).toBe(0);
            expect(metrics.priorities.low.count).toBe(0);
        });
    });

    describe('batch compression', () => {
        let batcher;
        const TEST_CONFIG = {
            batchSize: 3,
            batchTimeout: 100,
            enableAdaptiveSizing: false,
            compression: {
                enabled: true,
                minSize: 100, // Small size for testing
                level: 6,
                priorityThresholds: {
                    high: 50,
                    medium: 100,
                    low: 200
                }
            }
        };

        beforeEach(() => {
            batcher = new MessageBatcher(TEST_CONFIG);
        });

        afterEach(() => {
            if (batcher) {
                batcher.stop();
            }
        });

        it('should compress large batches based on priority thresholds', async () => {
            const clientId = 'test-client';
            const largeMessage = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1'.repeat(100) } };

            // Add messages to exceed threshold
            for (let i = 0; i < 3; i++) {
                batcher.addMessage(clientId, largeMessage, PRIORITY_LEVELS.HIGH);
            }

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Flush batch
            await batcher._flushBatch(clientId, 'size');

            // Verify compression
            const emittedBatch = batchHandler.mock.calls[0][1];
            expect(emittedBatch.compressed).toBe(true);
            expect(emittedBatch.data).toBeDefined();

            // Verify metrics
            const metrics = batcher.getMetrics();
            expect(metrics.compression.totalCompressed).toBe(1);
            expect(metrics.compression.totalBytesSaved).toBeGreaterThan(0);
        });

        it('should not compress small batches', async () => {
            const clientId = 'test-client';
            const smallMessage = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add small messages
            for (let i = 0; i < 3; i++) {
                batcher.addMessage(clientId, smallMessage, PRIORITY_LEVELS.HIGH);
            }

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Flush batch
            await batcher._flushBatch(clientId, 'size');

            // Verify no compression
            const emittedBatch = batchHandler.mock.calls[0][1];
            expect(emittedBatch.compressed).toBeUndefined();
            expect(emittedBatch.data).toBeUndefined();

            // Verify metrics
            const metrics = batcher.getMetrics();
            expect(metrics.compression.totalCompressed).toBe(0);
            expect(metrics.compression.totalUncompressed).toBe(1);
        });

        it('should handle compression errors gracefully', async () => {
            const clientId = 'test-client';
            const largeMessage = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1'.repeat(100) } };

            // Mock compression to fail
            const originalCompress = batcher._compressBatch;
            batcher._compressBatch = jest.fn().mockImplementation(async () => {
                throw new Error('Compression failed');
            });

            // Add messages
            for (let i = 0; i < 3; i++) {
                batcher.addMessage(clientId, largeMessage, PRIORITY_LEVELS.HIGH);
            }

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Flush batch
            await batcher._flushBatch(clientId, 'size');

            // Verify error handling
            const metrics = batcher.getMetrics();
            expect(metrics.errors.compression).toBe(1);

            // Restore original method
            batcher._compressBatch = originalCompress;
        });
    });

    describe('priority-based timeouts', () => {
        let batcher;
        const TEST_CONFIG = {
            batchSize: 3,
            batchTimeout: 100,
            enableAdaptiveSizing: false,
            timeouts: {
                high: 50,
                medium: 100,
                low: 200
            }
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

        it('should use priority-specific timeouts', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add messages with different priorities
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.MEDIUM);
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.LOW);

            // Get the timer for the last message (LOW priority)
            const timer = batcher.timers.get(clientId);
            expect(timer).toBeDefined();

            // Verify timeout duration
            const timeout = timer._idleTimeout;
            expect(timeout).toBe(TEST_CONFIG.timeouts.low);
        });

        it('should update timeout when message priority changes', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            // Add low priority message
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.LOW);
            let timer = batcher.timers.get(clientId);
            expect(timer._idleTimeout).toBe(TEST_CONFIG.timeouts.low);

            // Add high priority message
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);
            timer = batcher.timers.get(clientId);
            expect(timer._idleTimeout).toBe(TEST_CONFIG.timeouts.high);
        });

        it('should flush batch after priority-specific timeout', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Add high priority message
            batcher.addMessage(clientId, message, PRIORITY_LEVELS.HIGH);

            // Advance timer by high priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.high);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            expect(batchHandler.mock.calls[0][1]).toHaveLength(1);
        });
    });

    describe('error handling', () => {
        it('should handle invalid message gracefully', async () => {
            const clientId = 'test-client';
            const invalidMessage = null;

            try {
                await batcher.addMessage(clientId, invalidMessage);
            } catch (error) {
                expect(error.message).toContain('Invalid message');
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidMessage).toBe(1);
        });

        it('should handle invalid client ID gracefully', async () => {
            const invalidClientId = null;
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            try {
                await batcher.addMessage(invalidClientId, message);
            } catch (error) {
                expect(error.message).toContain('Invalid client ID');
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidClientId).toBe(1);
        });
    });

    describe('compression', () => {
        it('should compress batch when enabled', async () => {
            const clientId = 'test-client';
            const messages = Array(5).fill().map((_, i) => ({
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: String(i) }
            }));

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);
            batcher.enableCompression();

            for (const msg of messages) {
                await batcher.addMessage(clientId, msg);
            }

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const [_, batch, isCompressed] = batchHandler.mock.calls[0];
            expect(isCompressed).toBe(true);
            expect(batch.length).toBe(5);
        });

        it('should not compress batch when disabled', async () => {
            const clientId = 'test-client';
            const messages = Array(5).fill().map((_, i) => ({
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: String(i) }
            }));

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);
            batcher.disableCompression();

            for (const msg of messages) {
                await batcher.addMessage(clientId, msg);
            }

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const [_, batch, isCompressed] = batchHandler.mock.calls[0];
            expect(isCompressed).toBe(false);
            expect(batch.length).toBe(5);
        });
    });

    describe('priority handling', () => {
        it('should handle high priority messages with shorter timeout', async () => {
            jest.useFakeTimers();
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'high'
            };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            await batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.highPriorityTimeout);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(1);
        });

        it('should handle low priority messages with longer timeout', async () => {
            jest.useFakeTimers();
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'low'
            };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            await batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.lowPriorityTimeout);

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const metrics = batcher.getMetrics();
            expect(metrics.priorities.low.count).toBe(1);
        });

        it('should mix priorities in the same batch correctly', async () => {
            const clientId = 'test-client';
            const messages = [
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' }, priority: 'high' },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' }, priority: 'medium' },
                { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' }, priority: 'low' }
            ];

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            for (const msg of messages) {
                await batcher.addMessage(clientId, msg);
            }

            const metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(1);
            expect(metrics.priorities.medium.count).toBe(1);
            expect(metrics.priorities.low.count).toBe(1);
        });
    });
}); 