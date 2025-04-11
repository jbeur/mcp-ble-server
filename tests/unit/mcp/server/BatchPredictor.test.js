const BatchPredictor = require('../../../../src/mcp/server/BatchPredictor');

describe('BatchPredictor', () => {
  let predictor;
  let config;

  beforeEach(() => {
    config = {
      minBatchSize: 1,
      maxBatchSize: 100,
      learningRate: 0.01,
      historySize: 1000,
      predictionInterval: 1000,
      featureWindow: 10,
    };
    predictor = new BatchPredictor(config);
  });

  afterEach(() => {
    if (predictor) {
      predictor.stop();
    }
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      predictor = new BatchPredictor();
      expect(predictor.config).toBeDefined();
      expect(predictor.trainingData).toEqual([]);
      expect(predictor.model.weights).toBeDefined();
      expect(predictor.metrics).toBeDefined();
    });

    it('should initialize with custom config', () => {
      expect(predictor.config).toEqual(config);
    });
  });

  describe('feature calculation', () => {
    it('should calculate message rate correctly', () => {
      const history = [
        { timestamp: 1000, messageCount: 10 },
        { timestamp: 2000, messageCount: 20 },
      ];
      const rate = predictor._calculateMessageRate(history);
      expect(rate).toBe(30); // 30 messages per second
    });

    it('should calculate average latency correctly', () => {
      const history = [
        { latency: 100 },
        { latency: 200 },
      ];
      const avg = predictor._calculateAverageLatency(history);
      expect(avg).toBe(150);
    });

    it('should calculate error rate correctly', () => {
      const history = [
        { messageCount: 100, errors: 10 },
        { messageCount: 100, errors: 20 },
      ];
      const rate = predictor._calculateErrorRate(history);
      expect(rate).toBe(0.15); // 30 errors / 200 messages
    });

    it('should calculate compression ratio correctly', () => {
      const history = [
        { compressionRatio: 0.5 },
        { compressionRatio: 0.7 },
      ];
      const ratio = predictor._calculateCompressionRatio(history);
      expect(ratio).toBe(0.6);
    });

    it('should handle empty history gracefully', () => {
      const features = predictor._calculateFeatures([]);
      expect(features).toBeNull();
    });
  });

  describe('prediction', () => {
    it('should make predictions within batch size limits', () => {
      const features = {
        messageRate: 100,
        latency: 50,
        errorRate: 0.1,
        compressionRatio: 0.5,
        resourceUsage: 0.6,
      };
      const prediction = predictor._predict(features);
      expect(prediction).toBeGreaterThanOrEqual(config.minBatchSize);
      expect(prediction).toBeLessThanOrEqual(config.maxBatchSize);
    });

    it('should return minBatchSize for null features', () => {
      const prediction = predictor._predict(null);
      expect(prediction).toBe(config.minBatchSize);
    });

    it('should emit predictions periodically', (done) => {
      jest.useFakeTimers();
      
      predictor.once('prediction', (data) => {
        expect(data).toBeDefined();
        expect(data.recommendedBatchSize).toBeDefined();
        expect(data.confidence).toBeDefined();
        expect(data.features).toBeDefined();
        done();
      });

      jest.advanceTimersByTime(config.predictionInterval);
    });
  });

  describe('model updates', () => {
    it('should update model weights after adding data points', () => {
      const initialWeights = { ...predictor.model.weights };
      
      // Add data points
      for (let i = 0; i < 10; i += 1) {
        predictor.addDataPoint({
          messageCount: 100,
          batchSize: 10,
          latency: 50,
          errors: 5,
          compressionRatio: 0.5,
          resourceUsage: 0.6,
        });
      }

      expect(predictor.model.weights).not.toEqual(initialWeights);
    });

    it('should maintain history size limit', () => {
      // Add more data points than history size
      for (let i = 0; i < config.historySize + 10; i += 1) {
        predictor.addDataPoint({
          messageCount: i,
          batchSize: 10,
        });
      }

      expect(predictor.trainingData.length).toBe(config.historySize);
    });

    it('should track feature importance', () => {
      // Add data points
      for (let i = 0; i < 10; i += 1) {
        predictor.addDataPoint({
          messageCount: 100,
          batchSize: 10,
          latency: 50,
          errors: 5,
          compressionRatio: 0.5,
          resourceUsage: 0.6,
        });
      }

      const metrics = predictor.getMetrics();
      expect(metrics.featureImportance).toBeDefined();
      expect(Object.keys(metrics.featureImportance).length).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset predictor state', () => {
      predictor.addDataPoint({
        messageCount: 100,
        batchSize: 10,
      });

      predictor.reset();

      expect(predictor.trainingData).toEqual([]);
      expect(predictor.metrics.predictions).toBe(0);
      expect(predictor.metrics.accuracy).toBe(0);
    });
  });
}); 