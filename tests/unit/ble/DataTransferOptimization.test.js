const { CharacteristicOperations } = require('../../../src/ble/CharacteristicOperations');
const assert = require('assert');

describe('Data Transfer Optimization', () => {
    let characteristicOps;

    beforeEach(() => {
        characteristicOps = new CharacteristicOperations({
            maxBatchSize: 5,
            batchTimeout: 50,
            maxConcurrentOperations: 3
        });
    });

    describe('Batch Operations', () => {
        it('should efficiently batch multiple read operations', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 10;

            // Queue multiple read operations
            for (let i = 0; i < numOperations; i++) {
                operations.push(
                    characteristicOps.queueRead(deviceId, `char${i}`, i)
                );
            }

            const startTime = Date.now();
            await Promise.all(operations);
            const totalTime = Date.now() - startTime;

            // Get batch statistics
            const batchStats = await characteristicOps.getBatchStats(deviceId);
            const metrics = await characteristicOps.getPerformanceMetrics(deviceId);

            // Verify batching efficiency
            assert(batchStats.totalBatches > 0, 'Should have created batches');
            assert(batchStats.averageBatchSize > 1, 'Should have batched multiple operations');
            assert(metrics.batchEfficiency > 0.5, 'Should maintain good batch efficiency');
            assert(totalTime < numOperations * 100, 'Should process operations faster than sequential');
        });

        it('should handle mixed read/write operations in batches', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 10;

            // Queue mixed operations
            for (let i = 0; i < numOperations; i++) {
                if (i % 2 === 0) {
                    operations.push(
                        characteristicOps.queueRead(deviceId, `char${i}`, i)
                    );
                } else {
                    operations.push(
                        characteristicOps.queueWrite(deviceId, `char${i}`, Buffer.from([i]))
                    );
                }
            }

            await Promise.all(operations);

            // Get batch statistics
            const batchStats = await characteristicOps.getBatchStats(deviceId);

            // Verify mixed operation handling
            assert(batchStats.batchedReads > 0, 'Should have batched read operations');
            assert(batchStats.batchedWrites > 0, 'Should have batched write operations');
            assert(batchStats.totalBatches > 0, 'Should have created batches');
        });

        it('should respect maximum batch size limit', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 15; // More than maxBatchSize

            // Queue operations
            for (let i = 0; i < numOperations; i++) {
                operations.push(
                    characteristicOps.queueRead(deviceId, `char${i}`, i)
                );
            }

            await Promise.all(operations);

            // Get batch statistics
            const batchStats = await characteristicOps.getBatchStats(deviceId);

            // Verify batch size limits
            assert(batchStats.averageBatchSize <= 5, 'Should respect max batch size');
            assert(batchStats.totalBatches >= 3, 'Should create multiple batches');
        });

        it('should handle batch timeouts correctly', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 3; // Less than maxBatchSize

            // Queue operations
            for (let i = 0; i < numOperations; i++) {
                operations.push(
                    characteristicOps.queueRead(deviceId, `char${i}`, i)
                );
            }

            const startTime = Date.now();
            await Promise.all(operations);
            const totalTime = Date.now() - startTime;

            // Verify timeout behavior
            assert(totalTime >= 50, 'Should wait for batch timeout');
            assert(totalTime < 100, 'Should not wait too long');
        });

        it('should maintain operation order within batches', async () => {
            const deviceId = 'device1';
            const operations = [];
            const numOperations = 5;

            // Queue operations with timestamps
            for (let i = 0; i < numOperations; i++) {
                operations.push(
                    characteristicOps.queueRead(deviceId, `char${i}`, i)
                );
            }

            await Promise.all(operations);

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);

            // Verify operation order
            for (let i = 0; i < history.length - 1; i++) {
                assert(history[i].timestamp <= history[i + 1].timestamp,
                    'Operations should maintain order within batches');
            }
        });

        it('should handle batch processing errors gracefully', async () => {
            const deviceId = 'device1';
            const operations = [];

            // Queue operations including one that will fail
            operations.push(
                characteristicOps.queueRead(deviceId, 'invalidChar', 1)
                    .catch(error => error)
            );

            for (let i = 0; i < 4; i++) {
                operations.push(
                    characteristicOps.queueRead(deviceId, `char${i}`, i)
                );
            }

            const results = await Promise.all(operations);

            // Verify error handling
            assert(results[0] instanceof Error, 'Should handle invalid operation errors');
            assert(results.slice(1).every(r => !(r instanceof Error)),
                'Should process valid operations despite errors');

            // Get error statistics
            const errorStats = await characteristicOps.getErrorStats(deviceId);
            assert(errorStats.totalErrors > 0, 'Should track operation errors');
        });
    });
}); 