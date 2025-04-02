const { CharacteristicOperations } = require('../../../src/ble/CharacteristicOperations');
const assert = require('assert');

describe('Priority Queuing', () => {
    let characteristicOps;

    beforeEach(() => {
        characteristicOps = new CharacteristicOperations({
            maxBatchSize: 5,
            batchTimeout: 50,
            maxConcurrentOperations: 3
        });
    });

    describe('Priority-based Operation Processing', () => {
        it('should process high priority operations first', async () => {
            const deviceId = 'device1';
            const operations = [];

            // Queue operations with different priorities
            operations.push(
                characteristicOps.queueWrite(deviceId, 'char1', Buffer.from([1]), 'low'),
                characteristicOps.queueWrite(deviceId, 'char2', Buffer.from([2]), 'high'),
                characteristicOps.queueWrite(deviceId, 'char3', Buffer.from([3]), 'medium')
            );

            await Promise.all(operations);

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);

            // Verify high priority operation was processed first
            assert(history[0].priority === 'high', 'High priority operation should be processed first');
        });

        it('should maintain priority order within batches', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 10;

            // Queue operations with different priorities
            for (let i = 0; i < numOperations; i++) {
                const priority = i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low';
                operations.push(
                    characteristicOps.queueWrite(
                        deviceId,
                        `char${i}`,
                        Buffer.from([i]),
                        priority
                    )
                );
            }

            await Promise.all(operations);

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);

            // Verify priority order
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            for (let i = 0; i < history.length - 1; i++) {
                const currentPriority = priorityOrder[history[i].priority];
                const nextPriority = priorityOrder[history[i + 1].priority];
                assert(currentPriority <= nextPriority,
                    'Operations should maintain priority order');
            }
        });

        it('should handle priority-based timeouts', async () => {
            const deviceId = 'device1';
            const operations = [];

            // Queue operations with different priorities
            operations.push(
                characteristicOps.queueWrite(deviceId, 'char1', Buffer.from([1]), 'low'),
                characteristicOps.queueWrite(deviceId, 'char2', Buffer.from([2]), 'high')
            );

            const startTime = Date.now();
            await Promise.all(operations);
            const totalTime = Date.now() - startTime;

            // Verify high priority operation was processed quickly
            const history = await characteristicOps.getOperationHistory(deviceId);
            const highPriorityIndex = history.findIndex(op => op.priority === 'high');
            assert(highPriorityIndex === 0, 'High priority operation should be processed first');
            assert(totalTime < 100, 'Should process high priority operations quickly');
        });

        it('should balance priority and timestamp ordering', async () => {
            const deviceId = 'device1';
            const operations = [];

            // Queue operations with same priority but different timestamps
            operations.push(
                characteristicOps.queueWrite(deviceId, 'char1', Buffer.from([1]), 'high'),
                characteristicOps.queueWrite(deviceId, 'char2', Buffer.from([2]), 'high'),
                characteristicOps.queueWrite(deviceId, 'char3', Buffer.from([3]), 'high')
            );

            await Promise.all(operations);

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);

            // Verify timestamp order within same priority
            for (let i = 0; i < history.length - 1; i++) {
                if (history[i].priority === history[i + 1].priority) {
                    assert(history[i].timestamp <= history[i + 1].timestamp,
                        'Operations with same priority should maintain timestamp order');
                }
            }
        });

        it('should handle priority-based error recovery', async () => {
            const deviceId = 'device1';
            const operations = [];

            // Queue operations including one that will fail
            operations.push(
                characteristicOps.queueWrite(deviceId, 'invalidChar', Buffer.from([1]), 'high')
                    .catch(error => error)
            );

            // Queue valid operations with different priorities
            operations.push(
                characteristicOps.queueWrite(deviceId, 'char1', Buffer.from([1]), 'low'),
                characteristicOps.queueWrite(deviceId, 'char2', Buffer.from([2]), 'medium')
            );

            const results = await Promise.all(operations);

            // Verify error handling and priority processing
            assert(results[0] instanceof Error, 'Should handle invalid operation errors');
            assert(results.slice(1).every(r => !(r instanceof Error)),
                'Should process valid operations despite errors');

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);
            assert(history[0].priority === 'high', 'High priority operation should be processed first');
        });

        it('should track priority-based metrics', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 10;

            // Queue operations with different priorities
            for (let i = 0; i < numOperations; i++) {
                const priority = i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low';
                operations.push(
                    characteristicOps.queueWrite(
                        deviceId,
                        `char${i}`,
                        Buffer.from([i]),
                        priority
                    )
                );
            }

            await Promise.all(operations);

            // Get performance metrics
            const metrics = await characteristicOps.getPerformanceMetrics(deviceId);

            // Verify priority-based metrics
            assert(metrics.priorityDistribution, 'Should track priority distribution');
            assert(metrics.priorityDistribution.high > 0, 'Should track high priority operations');
            assert(metrics.priorityDistribution.medium > 0, 'Should track medium priority operations');
            assert(metrics.priorityDistribution.low > 0, 'Should track low priority operations');
        });
    });
}); 