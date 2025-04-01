const ResourceForecasting = require('../../../src/metrics/resourceForecasting');
const { metrics } = require('../../../src/metrics/metrics');

describe('ResourceForecasting', () => {
    let resourceForecasting;

    beforeEach(() => {
        resourceForecasting = new ResourceForecasting({
            historyWindow: 3600,
            predictionInterval: 300,
            minDataPoints: 3,
            maxPredictionWindow: 3600
        });
    });

    afterEach(() => {
        // Reset metrics
        metrics.reset();
    });

    describe('addResourceMeasurement', () => {
        it('should add resource measurements to history', () => {
            const timestamp = Date.now() / 1000;
            const resources = {
                memory: 1024, // 1GB
                cpu: 45.5,
                network: 10.5
            };

            resourceForecasting.addResourceMeasurement(timestamp, resources);
            const prediction = resourceForecasting.getPredictedResources(timestamp + 300);

            expect(prediction).toBeNull(); // Should be null due to insufficient data points
        });

        it('should handle invalid resource values', () => {
            const timestamp = Date.now() / 1000;
            const invalidResources = {
                memory: -1,
                cpu: 101,
                network: -0.5
            };

            resourceForecasting.addResourceMeasurement(timestamp, invalidResources);
            const prediction = resourceForecasting.getPredictedResources(timestamp + 300);

            expect(prediction).toBeNull();
            expect(metrics.getCounter('resource_forecasting_errors')).toBeGreaterThan(0);
        });

        it('should clean up old data points', () => {
            const currentTime = Date.now() / 1000;
            const oldTimestamp = currentTime - 7200; // 2 hours ago
            const recentTimestamp = currentTime - 1800; // 30 minutes ago

            const oldResources = {
                memory: 1024,
                cpu: 45.5,
                network: 10.5
            };

            const recentResources = {
                memory: 2048,
                cpu: 55.5,
                network: 15.5
            };

            resourceForecasting.addResourceMeasurement(oldTimestamp, oldResources);
            resourceForecasting.addResourceMeasurement(recentTimestamp, recentResources);

            const prediction = resourceForecasting.getPredictedResources(currentTime + 300);
            expect(prediction).toBeNull(); // Should be null due to insufficient data points
        });
    });

    describe('getPredictedResources', () => {
        it('should return null when insufficient data points', () => {
            const timestamp = Date.now() / 1000;
            const prediction = resourceForecasting.getPredictedResources(timestamp + 300);
            expect(prediction).toBeNull();
        });

        it('should generate predictions with sufficient data points', () => {
            const currentTime = Date.now() / 1000;
            
            // Add minimum required data points
            for (let i = 0; i < 3; i++) {
                resourceForecasting.addResourceMeasurement(
                    currentTime - (2 - i) * 300,
                    {
                        memory: 1024 + (i * 100),
                        cpu: 45.5 + (i * 5),
                        network: 10.5 + (i * 1)
                    }
                );
            }

            const prediction = resourceForecasting.getPredictedResources(currentTime + 300);
            expect(prediction).toBeDefined();
            expect(prediction.memory).toBeGreaterThanOrEqual(0);
            expect(prediction.cpu).toBeGreaterThanOrEqual(0);
            expect(prediction.cpu).toBeLessThanOrEqual(100);
            expect(prediction.network).toBeGreaterThanOrEqual(0);
        });

        it('should handle prediction requests for future timestamps', () => {
            const currentTime = Date.now() / 1000;
            
            // Add minimum required data points
            for (let i = 0; i < 3; i++) {
                resourceForecasting.addResourceMeasurement(
                    currentTime - (2 - i) * 300,
                    {
                        memory: 1024 + (i * 100),
                        cpu: 45.5 + (i * 5),
                        network: 10.5 + (i * 1)
                    }
                );
            }

            const futureTime = currentTime + 7200; // 2 hours in the future (beyond maxPredictionWindow)
            const prediction = resourceForecasting.getPredictedResources(futureTime);
            expect(prediction).toBeNull(); // Should be null as it's beyond prediction window
        });
    });

    describe('error handling', () => {
        it('should increment error counter on invalid operations', () => {
            const timestamp = Date.now() / 1000;
            const invalidResources = {
                memory: 'invalid',
                cpu: 'invalid',
                network: 'invalid'
            };

            resourceForecasting.addResourceMeasurement(timestamp, invalidResources);
            expect(metrics.getCounter('resource_forecasting_errors')).toBeGreaterThan(0);
        });
    });
}); 