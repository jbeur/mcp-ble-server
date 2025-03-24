const { MessageBatcher, PRIORITY_LEVELS } = require('../../../../src/mcp/server/MessageBatcher');
const BatchCompressor = require('../../../../src/mcp/server/BatchCompressor');
const logger = require('../../../../src/utils/logger');

// Mock MESSAGE_TYPES
jest.mock('../../../../src/mcp/protocol/messages', () => ({
    MESSAGE_TYPES: {
        DEVICE_FOUND: 'DEVICE_FOUND',
        CONNECT: 'CONNECT',
        DISCONNECT: 'DISCONNECT',
        ERROR: 'ERROR'
    }
}));

const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../../src/mcp/server/BatchCompressor', () => {
    return jest.fn().mockImplementation(() => ({
        compress: jest.fn().mockResolvedValue({
            compressed: true,
            data: Buffer.from('compressed'),
            originalSize: 100,
            compressedSize: 50,
            compressionRatio: 0.5,
            algorithm: 'gzip',
            compressionTime: 10
        }),
        getMetrics: jest.fn().mockReturnValue({
            totalCompressed: 1,
            totalBytesSaved: 50,
            averageCompressionRatio: 0.5,
            averageCompressionTimes: {
                high: 10,
                medium: 10,
                low: 10
            }
        })
    }));
});

describe('MessageBatcher', () => {
    let batcher;
    let batchHandler;
    let analyticsHandler;

    const TEST_CONFIG = {
        batchSize: 3,
        batchTimeout: 100,
        minBatchSize: 2,
        maxBatchSize: 5,
        adaptiveInterval: 1000,
        performanceThreshold: 0.8,
        timeouts: {
            high: 50,
            medium: 100,
            low: 200
        },
        compression: {
            enabled: true,
            minSize: 1,
            level: 6,
            algorithm: 'gzip',
            priorityThresholds: {
                high: 1,
                medium: 1,
                low: 1
            }
        },
        analytics: {
            enabled: true,
            interval: 1000
        }
    };

    beforeEach(() => {
        jest.useFakeTimers();
        batcher = new MessageBatcher(TEST_CONFIG);
        batchHandler = jest.fn();
        analyticsHandler = jest.fn();
        batcher.on('batch', batchHandler);
        batcher.on('analytics', analyticsHandler);
    });

    afterEach(async () => {
        await batcher.stop();
        if (batcher.predictor) {
            batcher.predictor.stop();
        }
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should initialize with default config', () => {
            const defaultBatcher = new MessageBatcher();
            expect(defaultBatcher.batchSize).toBeDefined();
            expect(defaultBatcher.compressionEnabled).toBeDefined();
        });

        it('should initialize with custom config', () => {
            expect(batcher.batchSize).toBe(TEST_CONFIG.batchSize);
            expect(batcher.compressionEnabled).toBe(TEST_CONFIG.compression.enabled);
        });
    });

    describe('addMessage', () => {
        it('should add message to new batch', () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            batcher.addMessage(clientId, message);
            expect(batcher.batches.get(clientId)).toHaveLength(1);
        });

        it('should flush batch when size limit is reached', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            expect(batch.messages).toHaveLength(3);
            expect(batchHandler.mock.calls[0][0]).toBe(clientId);
        });
    });

    describe('batch timeout', () => {
        it('should flush batch after timeout', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            await batcher.addMessage(clientId, message);

            // Advance timers by medium priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.medium);
            await Promise.resolve(); // Allow any pending promises to resolve

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            const messages = Array.isArray(batch) ? batch : batch.messages;
            expect(messages).toHaveLength(1);
        });
    });

    describe('metrics', () => {
        it('should track batch sizes correctly', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            // Force flush
            await batcher._flushBatch(clientId, 'size');
            await Promise.resolve(); // Allow any pending promises to resolve

            const metrics = batcher.getMetrics();
            expect(metrics.maxBatchSize).toBe(3);
            expect(metrics.minBatchSize).toBe(3);
            expect(metrics.averageBatchSize).toBe(3);
        });

        it('should track batch flush reasons', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            await batcher.addMessage(clientId, message);

            // Advance timers by medium priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.medium);
            await Promise.resolve(); // Allow any pending promises to resolve

            const metrics = batcher.getMetrics();
            expect(metrics.batchFlushReasons.timeout).toBe(1);
        });

        it('should track errors', async () => {
            const clientId = 'test-client';
            const invalidMessage = null;

            try {
                await batcher.addMessage(clientId, invalidMessage);
            } catch (error) {
                // Expected error
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidMessage).toBe(1);
        });
    });

    describe('error handling', () => {
        it('should handle invalid message gracefully', async () => {
            const clientId = 'test-client';
            const invalidMessage = null;

            try {
                await batcher.addMessage(clientId, invalidMessage);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).toBe('Invalid message');
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidMessage).toBe(1);
        });

        it('should handle invalid client ID gracefully', async () => {
            const invalidClientId = null;
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };

            try {
                await batcher.addMessage(invalidClientId, message);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).toBe('Invalid client ID');
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidClientId).toBe(1);
        });

        it('should handle message without type gracefully', async () => {
            const clientId = 'test-client';
            const invalidMessage = { data: { id: '1' } };

            try {
                await batcher.addMessage(clientId, invalidMessage);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).toBe('Invalid message');
            }

            const metrics = batcher.getMetrics();
            expect(metrics.errors.invalidMessage).toBe(1);
        });
    });

    describe('compression', () => {
        it('should compress batch when enabled', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            const isCompressed = batchHandler.mock.calls[0][2];
            expect(isCompressed).toBe(true);
            expect(batch.messages).toHaveLength(3);
        });

        it('should not compress batch when disabled', async () => {
            const batcher = new MessageBatcher({
                compression: { enabled: false }
            });

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            // Add messages
            for (let i = 0; i < 3; i++) {
                await batcher.addMessage('client1', {
                    type: 'DEVICE_FOUND',
                    data: { id: '1' }
                });
            }

            // Force flush
            await batcher._flushBatch('client1', 'size');

            const batch = batchHandler.mock.calls[0][1];
            const isCompressed = batchHandler.mock.calls[0][2];
            expect(isCompressed).toBe(false);
            expect(batch.messages).toHaveLength(3);
        });

        it('should handle compression failures gracefully', async () => {
            const batcher = new MessageBatcher({
                ...TEST_CONFIG,
                compression: {
                    enabled: true,
                    minSize: 1
                }
            });

            // Mock the compressor to throw an error
            batcher.compressor = {
                compress: jest.fn().mockRejectedValue(new Error('Compression failed')),
                getMetrics: jest.fn().mockReturnValue({
                    averageCompressionTimes: 0
                })
            };

            const batchHandler = jest.fn();
            batcher.on('batch', batchHandler);

            for (let i = 0; i < 3; i++) {
                await batcher.addMessage('client1', {
                    type: 'DEVICE_FOUND',
                    data: { id: '1' },
                    priority: 'medium'
                });
            }

            // Force flush
            await batcher._flushBatch('client1', 'size');

            const batch = batchHandler.mock.calls[0][1];
            const isCompressed = batchHandler.mock.calls[0][2];
            expect(isCompressed).toBe(false);
            expect(batch.messages).toHaveLength(3);
            expect(batcher.metrics.errors.compression).toBe(1);

            await batcher.stop();
            if (batcher.predictor) {
                batcher.predictor.stop();
            }
        });

        it('should track compression metrics accurately', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            const metrics = batcher.getMetrics();
            expect(metrics.compression.totalCompressed).toBe(1);
            expect(metrics.compression.totalBytesSaved).toBeGreaterThan(0);
            expect(metrics.compression.averageCompressionRatio).toBeGreaterThan(0);
        });
    });

    describe('priority handling', () => {
        it('should handle high priority messages with shorter timeout', async () => {
            const clientId = 'test-client';
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'high'
            });

            // Advance timers by high priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.high);
            await Promise.resolve(); // Allow any pending promises to resolve

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            const messages = Array.isArray(batch) ? batch : batch.messages;
            expect(messages).toHaveLength(1);
            const metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(1);
        });

        it('should handle low priority messages with longer timeout', async () => {
            const clientId = 'test-client';
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'low'
            });

            // Advance timers by low priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.low);
            await Promise.resolve(); // Allow any pending promises to resolve

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            const messages = Array.isArray(batch) ? batch : batch.messages;
            expect(messages).toHaveLength(1);
            const metrics = batcher.getMetrics();
            expect(metrics.priorities.low.count).toBe(1);
        });

        it('should mix priorities in the same batch correctly', async () => {
            const clientId = 'test-client';
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'high'
            });
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '2' },
                priority: 'medium'
            });
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '3' },
                priority: 'low'
            });

            const metrics = batcher.getMetrics();
            expect(metrics.priorities.high.count).toBe(1);
            expect(metrics.priorities.medium.count).toBe(1);
            expect(metrics.priorities.low.count).toBe(1);
        });
    });

    describe('priority-based timeouts', () => {
        it('should handle timeout conflicts between priorities', async () => {
            const clientId = 'test-client';
            
            // Add high priority message
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'high'
            });
            
            // Add low priority message before high priority timeout
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '2' },
                priority: 'low'
            });
            
            // Advance timers by high priority timeout
            jest.advanceTimersByTime(TEST_CONFIG.timeouts.high);
            await Promise.resolve(); // Allow any pending promises to resolve

            expect(batchHandler).toHaveBeenCalledTimes(1);
            const batch = batchHandler.mock.calls[0][1];
            const messages = Array.isArray(batch) ? batch : batch.messages;
            expect(messages).toHaveLength(2);
            expect(messages[0].priority).toBe('high');
            expect(messages[1].priority).toBe('low');
        });

        it('should cancel timeouts when batch is flushed', async () => {
            const clientId = 'test-client';
            await batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } }, PRIORITY_LEVELS.HIGH);
            
            // Add enough messages to trigger size-based flush
            await batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '2' } }, PRIORITY_LEVELS.HIGH);
            await batcher.addMessage(clientId, { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '3' } }, PRIORITY_LEVELS.HIGH);
            
            // Verify timer was cleared
            expect(batcher.timers.has(clientId)).toBe(false);
        });
    });

    describe('analytics', () => {
        it('should emit analytics events periodically', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            await batcher.addMessage(clientId, message);

            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);

            expect(analyticsHandler).toHaveBeenCalledTimes(1);
            const analytics = analyticsHandler.mock.calls[0][0];
            expect(analytics.batchSizeHistory).toBeDefined();
            expect(analytics.latencyHistory).toBeDefined();
            expect(analytics.compressionHistory).toBeDefined();
        });

        it('should track batch sizes correctly', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);

            const analytics = analyticsHandler.mock.calls[0][0];
            expect(analytics.batchSizeHistory[0].average).toBe(3);
        });

        it('should track compression metrics', async () => {
            const clientId = 'test-client';
            const messages = Array(3).fill({ type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } });

            for (const message of messages) {
                await batcher.addMessage(clientId, message);
            }

            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);

            const analytics = analyticsHandler.mock.calls[0][0];
            expect(analytics.compressionHistory[0].ratio).toBeGreaterThan(0);
            expect(analytics.compressionHistory[0].bytesSaved).toBeGreaterThan(0);
        });

        it('should track priority distribution', async () => {
            const clientId = 'test-client';
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'high'
            });
            await batcher.addMessage(clientId, {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '2' },
                priority: 'low'
            });

            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);

            const analytics = analyticsHandler.mock.calls[0][0];
            expect(analytics.priorityDistribution.high).toBe(0.5);
            expect(analytics.priorityDistribution.low).toBe(0.5);
        });

        it('should throttle analytics events', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' },
                priority: 'medium'
            };
            
            // Add multiple messages quickly
            for (let i = 0; i < 10; i++) {
                await batcher.addMessage(clientId, message);
            }
            
            // Advance time past analytics interval
            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);
            
            // Verify only one analytics event was emitted
            expect(analyticsHandler).toHaveBeenCalledTimes(1);
        });

        it('should aggregate analytics data correctly', async () => {
            const clientId = 'test-client';
            const messages = Array(5).fill({
                type: MESSAGE_TYPES.DEVICE_FOUND,
                data: { id: '1' }
            });
            
            // Add messages with different priorities and flush after every 2 messages
            for (let i = 0; i < messages.length; i++) {
                const priority = i % 2 === 0 ? 'high' : 'low';
                await batcher.addMessage(clientId, {
                    ...messages[i],
                    priority
                });

                if (i % 2 === 1 || i === messages.length - 1) {
                    await batcher._flushBatch(clientId, 'manual');
                }
            }
            
            // Advance timers by analytics interval
            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);
            
            const analytics = analyticsHandler.mock.calls[0][0];
            expect(analytics.priorityDistribution.high).toBe(0.6);
            expect(analytics.priorityDistribution.low).toBe(0.4);
            expect(analytics.batchSizeHistory[0].average).toBeCloseTo(1.67, 2);
        });

        it('should persist analytics data between intervals', async () => {
            const clientId = 'test-client';
            const message = { type: MESSAGE_TYPES.DEVICE_FOUND, data: { id: '1' } };
            
            // Add messages in first interval
            await batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);
            
            // Add messages in second interval
            await batcher.addMessage(clientId, message);
            jest.advanceTimersByTime(TEST_CONFIG.analytics.interval);
            
            expect(analyticsHandler).toHaveBeenCalledTimes(2);
            const firstAnalytics = analyticsHandler.mock.calls[0][0];
            const secondAnalytics = analyticsHandler.mock.calls[1][0];
            
            expect(secondAnalytics.batchSizeHistory.length).toBeGreaterThan(firstAnalytics.batchSizeHistory.length);
            expect(secondAnalytics.latencyHistory.length).toBeGreaterThan(firstAnalytics.latencyHistory.length);
        });
    });
}); 