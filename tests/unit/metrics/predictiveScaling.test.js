const PredictiveScaling = require('../../../src/metrics/predictiveScaling');
const { metrics } = require('../../../src/metrics/metrics');

describe('PredictiveScaling', () => {
  let predictiveScaling;

  beforeEach(() => {
    predictiveScaling = new PredictiveScaling({
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

  describe('addLoadMeasurement', () => {
    it('should add load measurement to history', () => {
      const timestamp = Date.now() / 1000;
      const load = 0.75;

      predictiveScaling.addLoadMeasurement(timestamp, load);
      const prediction = predictiveScaling.getPredictedLoad(timestamp + 300);

      expect(prediction).toBeNull(); // Should be null due to insufficient data points
    });

    it('should handle invalid load values', () => {
      const timestamp = Date.now() / 1000;
      const invalidLoad = -1;

      predictiveScaling.addLoadMeasurement(timestamp, invalidLoad);
      const prediction = predictiveScaling.getPredictedLoad(timestamp + 300);

      expect(prediction).toBeNull();
    });

    it('should clean up old data points', () => {
      const currentTime = Date.now() / 1000;
      const oldTimestamp = currentTime - 7200; // 2 hours ago
      const recentTimestamp = currentTime - 1800; // 30 minutes ago

      predictiveScaling.addLoadMeasurement(oldTimestamp, 0.5);
      predictiveScaling.addLoadMeasurement(recentTimestamp, 0.75);

      const prediction = predictiveScaling.getPredictedLoad(currentTime + 300);
      expect(prediction).toBeNull(); // Should be null due to insufficient data points
    });
  });

  describe('getPredictedLoad', () => {
    it('should return null when insufficient data points', () => {
      const timestamp = Date.now() / 1000;
      const prediction = predictiveScaling.getPredictedLoad(timestamp + 300);
      expect(prediction).toBeNull();
    });

    it('should generate predictions with sufficient data points', () => {
      const currentTime = Date.now() / 1000;
            
      // Add minimum required data points
      for (let i = 0; i < 3; i++) {
        predictiveScaling.addLoadMeasurement(
          currentTime - (2 - i) * 300,
          0.5 + (i * 0.1)
        );
      }

      const prediction = predictiveScaling.getPredictedLoad(currentTime + 300);
      expect(prediction).toBeGreaterThanOrEqual(0);
    });

    it('should handle prediction requests for future timestamps', () => {
      const currentTime = Date.now() / 1000;
            
      // Add minimum required data points
      for (let i = 0; i < 3; i++) {
        predictiveScaling.addLoadMeasurement(
          currentTime - (2 - i) * 300,
          0.5 + (i * 0.1)
        );
      }

      const futureTime = currentTime + 7200; // 2 hours in the future (beyond maxPredictionWindow)
      const prediction = predictiveScaling.getPredictedLoad(futureTime);
      expect(prediction).toBeNull(); // Should be null as it's beyond prediction window
    });
  });

  describe('error handling', () => {
    it('should increment error counter on invalid operations', () => {
      const timestamp = Date.now() / 1000;
      const invalidLoad = 'invalid';

      predictiveScaling.addLoadMeasurement(timestamp, invalidLoad);
      expect(metrics.getCounter('predictive_scaling_errors')).toBeGreaterThan(0);
    });
  });
}); 