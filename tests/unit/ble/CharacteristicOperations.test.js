const { CharacteristicOperations } = require('../../../src/ble/CharacteristicOperations');
const assert = require('assert');

describe('Characteristic Operations', () => {
    let characteristicOps;

    beforeEach(() => {
        characteristicOps = new CharacteristicOperations();
    });

    describe('operation optimization', () => {
        it('should batch read operations', async () => {
            const deviceId = 'device1';
            const characteristics = [
                { uuid: 'char1', handle: 1 },
                { uuid: 'char2', handle: 2 },
                { uuid: 'char3', handle: 3 }
            ];

            // Queue multiple read operations
            const readPromises = characteristics.map(char => 
                characteristicOps.queueRead(deviceId, char.uuid, char.handle)
            );

            // Wait for all reads to complete
            const results = await Promise.all(readPromises);

            // Verify batch processing
            const batchStats = await characteristicOps.getBatchStats(deviceId);
            assert(batchStats.batchedReads > 0, 'Should have batched read operations');
            assert.strictEqual(results.length, characteristics.length);
        });

        it('should prioritize write operations based on importance', async () => {
            const deviceId = 'device1';
            const operations = [
                { uuid: 'char1', value: Buffer.from([1]), priority: 'high' },
                { uuid: 'char2', value: Buffer.from([2]), priority: 'low' },
                { uuid: 'char3', value: Buffer.from([3]), priority: 'medium' }
            ];

            // Queue writes with different priorities
            const writePromises = operations.map(op => 
                characteristicOps.queueWrite(deviceId, op.uuid, op.value, op.priority)
            );

            await Promise.all(writePromises);

            // Get operation history
            const history = await characteristicOps.getOperationHistory(deviceId);
            
            // Verify high priority operations were processed first
            assert(
                history.findIndex(op => op.priority === 'high') <
                history.findIndex(op => op.priority === 'low'),
                'High priority operations should be processed before low priority ones'
            );
        });

        it('should handle notification subscriptions efficiently', async () => {
            const deviceId = 'device1';
            const charUuid = 'notifyChar';
            
            // Set up notification handler
            let notificationCount = 0;
            const handler = () => { notificationCount++; };
            
            // Subscribe to notifications
            await characteristicOps.subscribe(deviceId, charUuid, handler);
            
            // Simulate multiple notifications
            await characteristicOps.simulateNotification(deviceId, charUuid, Buffer.from([1]));
            await characteristicOps.simulateNotification(deviceId, charUuid, Buffer.from([2]));
            
            // Verify notification handling
            assert.strictEqual(notificationCount, 2, 'Should handle all notifications');
            
            // Unsubscribe
            await characteristicOps.unsubscribe(deviceId, charUuid);
            
            // Verify subscription cleanup
            const subscriptions = await characteristicOps.getActiveSubscriptions(deviceId);
            assert.strictEqual(subscriptions.length, 0, 'Should cleanup subscriptions');
        });

        it('should optimize concurrent operations', async () => {
            const deviceId = 'device1';
            const operations = [];
            
            // Queue multiple operations
            for (let i = 0; i < 10; i++) {
                operations.push(
                    characteristicOps.queueWrite(
                        deviceId,
                        `char${i}`,
                        Buffer.from([i]),
                        i < 5 ? 'high' : 'low'
                    )
                );
            }
            
            const startTime = Date.now();
            await Promise.all(operations);
            const duration = Date.now() - startTime;
            
            // Get performance metrics
            const metrics = await characteristicOps.getPerformanceMetrics(deviceId);
            
            // Verify operation optimization
            assert(metrics.averageOperationTime < duration / operations.length,
                'Concurrent operations should be optimized');
            assert(metrics.batchEfficiency > 0.5,
                'Should maintain good batch efficiency');
        });

        it('should handle operation errors gracefully', async () => {
            const deviceId = 'device1';
            const invalidChar = 'invalidChar';
            
            // Attempt operation on invalid characteristic
            await assert.rejects(
                () => characteristicOps.queueRead(deviceId, invalidChar),
                { message: /Invalid characteristic/ }
            );
            
            // Verify error tracking
            const errorStats = await characteristicOps.getErrorStats(deviceId);
            assert(errorStats.totalErrors > 0, 'Should track operation errors');
            assert(errorStats.lastError.includes('Invalid characteristic'),
                'Should record error details');
        });

        it('should maintain operation metrics', async () => {
            const deviceId = 'device1';
            const charUuid = 'testChar';
            
            // Perform some operations
            await characteristicOps.queueWrite(deviceId, charUuid, Buffer.from([1]));
            await characteristicOps.queueRead(deviceId, charUuid);
            
            // Get operation metrics
            const metrics = await characteristicOps.getOperationMetrics(deviceId);
            
            // Verify metric tracking
            assert(metrics.totalOperations > 0, 'Should track total operations');
            assert(metrics.readOperations > 0, 'Should track read operations');
            assert(metrics.writeOperations > 0, 'Should track write operations');
            assert(metrics.averageResponseTime > 0, 'Should track response times');
        });
    });
}); 