const { RSSIThresholds } = require('../../../src/ble/RSSIThresholds');
const assert = require('assert');

describe('RSSI Thresholds', () => {
    let rssiThresholds;

    beforeEach(() => {
        rssiThresholds = new RSSIThresholds();
    });

    describe('threshold configuration', () => {
        it('should set and get RSSI thresholds', async () => {
            const thresholds = {
                excellent: -50,
                good: -70,
                fair: -85,
                poor: -100
            };
            
            await rssiThresholds.setThresholds(thresholds);
            const currentThresholds = rssiThresholds.getThresholds();
            
            assert.deepStrictEqual(currentThresholds, thresholds);
        });

        it('should validate RSSI threshold values', async () => {
            // Test invalid threshold values
            await assert.rejects(
                () => rssiThresholds.setThresholds({ excellent: 0 }), // RSSI can't be positive
                { message: /Invalid RSSI value/ }
            );

            await assert.rejects(
                () => rssiThresholds.setThresholds({ excellent: -120 }), // Too low
                { message: /Invalid RSSI value/ }
            );
        });

        it('should validate threshold order', async () => {
            // Test invalid threshold order
            await assert.rejects(
                () => rssiThresholds.setThresholds({
                    excellent: -70,
                    good: -60 // Good threshold higher than excellent
                }),
                { message: /Invalid threshold order/ }
            );
        });

        it('should classify signal strength', async () => {
            await rssiThresholds.setThresholds({
                excellent: -50,
                good: -70,
                fair: -85,
                poor: -100
            });

            assert.strictEqual(rssiThresholds.classifySignalStrength(-45), 'excellent');
            assert.strictEqual(rssiThresholds.classifySignalStrength(-60), 'good');
            assert.strictEqual(rssiThresholds.classifySignalStrength(-80), 'fair');
            assert.strictEqual(rssiThresholds.classifySignalStrength(-95), 'poor');
            assert.strictEqual(rssiThresholds.classifySignalStrength(-105), 'unusable');
        });

        it('should track RSSI statistics', () => {
            const testValues = [-45, -60, -75, -90];
            
            testValues.forEach(rssi => {
                rssiThresholds.recordRSSI(rssi);
            });

            const stats = rssiThresholds.getStatistics();
            assert.strictEqual(stats.totalReadings, 4);
            assert.strictEqual(stats.categoryDistribution.excellent, 1);
            assert.strictEqual(stats.categoryDistribution.good, 1);
            assert.strictEqual(stats.categoryDistribution.fair, 1);
            assert.strictEqual(stats.categoryDistribution.poor, 1);

            // Test invalid RSSI value
            assert.throws(() => {
                rssiThresholds.recordRSSI(-105);
            }, /Invalid RSSI value/);
        });

        it('should adapt thresholds based on environment', () => {
            // Record strong signals to simulate good environment
            [-45, -48, -50, -52, -55].forEach(rssi => {
                rssiThresholds.recordRSSI(rssi);
            });

            const adaptedThresholds = rssiThresholds.adaptThresholds();
            
            // Thresholds should be adjusted for good environment
            assert(adaptedThresholds.excellent > -50, 'Should increase excellent threshold');
            assert(adaptedThresholds.good > -70, 'Should increase good threshold');
            assert(adaptedThresholds.fair > -85, 'Should increase fair threshold');
            assert(adaptedThresholds.poor > -100, 'Should increase poor threshold');
        });

        it('should handle moving average calculations', async () => {
            await rssiThresholds.setThresholds({
                excellent: -50,
                good: -70,
                fair: -85,
                poor: -100
            });

            // Record sequence of RSSI values
            const rssiSequence = [-60, -65, -70, -75, -80];
            rssiSequence.forEach(rssi => {
                rssiThresholds.recordRSSI(rssi);
            });

            const movingAverage = rssiThresholds.getMovingAverage(3); // 3-point moving average
            assert(movingAverage === -75, 'Should calculate correct moving average');
        });

        it('should detect signal anomalies', () => {
            // Record stable signals
            [-60, -65, -70, -75, -80].forEach(rssi => {
                rssiThresholds.recordRSSI(rssi);
            });

            // Test sudden signal drop (15 dBm drop from moving average)
            const isAnomaly = rssiThresholds.detectAnomaly(-85);
            assert(isAnomaly, 'Should detect sudden signal drop as anomaly');
        });
    });
}); 