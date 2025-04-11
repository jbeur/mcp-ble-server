const { CharacteristicOperations } = require('../../../src/ble/CharacteristicOperations');
const assert = require('assert');

describe('Characteristic Operations', () => {
  let characteristicOps;

  beforeEach(() => {
    characteristicOps = new CharacteristicOperations({
      maxBatchSize: 3,
      batchTimeout: 10,
      maxConcurrentOperations: 2,
      retryAttempts: 3,
      retryDelay: 100
    });
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

      // Verify metrics were updated
      const metrics = await characteristicOps.getOperationMetrics(deviceId);
      assert(metrics.totalOperations === characteristics.length, 'Should track all operations');
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

      // Get operation history and verify order
      const history = await characteristicOps.getOperationHistory(deviceId);
      assert(
        history.findIndex(op => op.priority === 'high') <
        history.findIndex(op => op.priority === 'low'),
        'High priority operations should be processed before low priority ones'
      );

      // Verify priority distribution
      const metrics = await characteristicOps.getPerformanceMetrics(deviceId);
      assert.strictEqual(metrics.priorityDistribution.high, 1);
      assert.strictEqual(metrics.priorityDistribution.medium, 1);
      assert.strictEqual(metrics.priorityDistribution.low, 1);
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
            
      // Unsubscribe and verify cleanup
      await characteristicOps.unsubscribe(deviceId, charUuid);
      const subscriptions = await characteristicOps.getActiveSubscriptions(deviceId);
      assert.strictEqual(subscriptions.length, 0, 'Should cleanup subscriptions');

      // Verify unsubscribed notifications don't trigger handler
      await characteristicOps.simulateNotification(deviceId, charUuid, Buffer.from([3]));
      assert.strictEqual(notificationCount, 2, 'Should not handle notifications after unsubscribe');
    });

    it('should optimize concurrent operations and batch processing', async () => {
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
      const batchStats = await characteristicOps.getBatchStats(deviceId);
            
      // Verify operation optimization
      assert(metrics.averageOperationTime < duration / operations.length,
        'Concurrent operations should be optimized');
      assert(metrics.batchEfficiency > 0.5,
        'Should maintain good batch efficiency');
      assert(batchStats.totalBatches > 0,
        'Should create batches for operations');
      assert(batchStats.averageBatchSize > 1,
        'Should batch multiple operations together');
    });

    it('should handle operation errors and retries', async () => {
      const deviceId = 'device1';
      const invalidChar = null;
            
      // Attempt operation with invalid parameters
      await assert.rejects(
        () => characteristicOps.queueRead(deviceId, invalidChar),
        { message: /Invalid device ID or characteristic UUID/ }
      );
            
      // Verify error tracking
      const errorStats = await characteristicOps.getErrorStats(deviceId);
      assert(errorStats.totalErrors > 0, 'Should track operation errors');
      assert(errorStats.lastError.message.includes('Invalid device ID'),
        'Should record error details');

      // Verify error doesn't affect other operations
      const validChar = 'validChar';
      await characteristicOps.queueWrite(deviceId, validChar, Buffer.from([1]));
      const metrics = await characteristicOps.getOperationMetrics(deviceId);
      assert(metrics.totalOperations > 0, 'Should continue processing valid operations');
    });

    it('should maintain comprehensive operation metrics', async () => {
      const deviceId = 'device1';
      const charUuid = 'testChar';
            
      // Perform mixed operations
      await characteristicOps.queueWrite(deviceId, charUuid, Buffer.from([1]), 'high');
      await characteristicOps.queueRead(deviceId, charUuid, 1, 'medium');
      await characteristicOps.queueWrite(deviceId, charUuid, Buffer.from([2]), 'low');
            
      // Get all metrics
      const metrics = await characteristicOps.getOperationMetrics(deviceId);
      const perfMetrics = await characteristicOps.getPerformanceMetrics(deviceId);
      const batchStats = await characteristicOps.getBatchStats(deviceId);
            
      // Verify comprehensive metric tracking
      assert.strictEqual(metrics.totalOperations, 3, 'Should track total operations');
      assert(perfMetrics.averageResponseTime > 0, 'Should track response times');
      assert(perfMetrics.batchEfficiency > 0, 'Should track batch efficiency');
      assert.strictEqual(perfMetrics.priorityDistribution.high, 1);
      assert.strictEqual(perfMetrics.priorityDistribution.medium, 1);
      assert.strictEqual(perfMetrics.priorityDistribution.low, 1);
      assert(batchStats.totalBatches > 0, 'Should track batch statistics');
    });

    it('should handle edge cases and invalid inputs', async () => {
      // Test with invalid device ID
      await assert.rejects(
        () => characteristicOps.queueRead(null, 'char1'),
        { message: /Invalid device ID/ }
      );

      // Test with invalid characteristic UUID
      await assert.rejects(
        () => characteristicOps.queueWrite('device1', null, Buffer.from([1])),
        { message: /Invalid device ID/ }
      );

      // Test with invalid subscription handler
      await assert.rejects(
        () => characteristicOps.subscribe('device1', 'char1', null),
        { message: /Invalid device ID/ }
      );

      // Test unsubscribe from non-existent subscription
      await characteristicOps.unsubscribe('device1', 'nonexistent');
      const subs = await characteristicOps.getActiveSubscriptions('device1');
      assert.strictEqual(subs.length, 0, 'Should handle non-existent subscriptions');
    });
  });
}); 