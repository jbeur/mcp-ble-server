const TrendAnalysis = require('../../../src/metrics/trendAnalysis');
const { metrics } = require('../../../src/metrics/metrics');

describe('TrendAnalysis', () => {
  let trendAnalysis;
  let originalDateNow;

  beforeEach(() => {
    originalDateNow = Date.now;
    const currentTime = 1000000;
    Date.now = jest.fn(() => currentTime);

    trendAnalysis = new TrendAnalysis({
      historyWindow: 3600,
      minDataPoints: 5,
      trendThreshold: 0.1
    });
    metrics.reset();
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('addMeasurement', () => {
    it('should handle invalid measurements', () => {
      trendAnalysis.addMeasurement(null);
      expect(metrics.getCounter('trend_analysis_errors')).toBe(1);
    });

    it('should add valid measurements', () => {
      const measurement = {
        memory: 1000,
        cpu: 50,
        network: 10
      };
      trendAnalysis.addMeasurement(measurement);
      expect(metrics.getCounter('trend_analysis_measurements_added')).toBe(1);

      const data = trendAnalysis.getMetrics();
      expect(data.memory).toHaveLength(1);
      expect(data.cpu).toHaveLength(1);
      expect(data.network).toHaveLength(1);
    });

    it('should clean up old data points', () => {
      // Add initial data point
      trendAnalysis.addMeasurement({
        memory: 1000,
        cpu: 50,
        network: 10
      });

      // Advance time beyond history window
      Date.now.mockReturnValue(1000000 + 4000 * 1000);

      // Add new data point
      trendAnalysis.addMeasurement({
        memory: 1200,
        cpu: 60,
        network: 12
      });

      const data = trendAnalysis.getMetrics();
      expect(data.memory).toHaveLength(1);
      expect(data.memory[0].memory).toBe(1200);
    });
  });

  describe('analyzeTrends', () => {
    it('should return insufficient data when not enough data points', () => {
      const results = trendAnalysis.analyzeTrends();
      expect(results.memory.trend).toBe('insufficient_data');
      expect(results.cpu.trend).toBe('insufficient_data');
      expect(results.network.trend).toBe('insufficient_data');
    });

    it('should detect increasing trend', () => {
      // Add increasing memory usage data points
      for (let i = 0; i < 10; i++) {
        Date.now.mockReturnValue(1000000 + i * 60 * 1000);
        trendAnalysis.addMeasurement({
          memory: 1000 + i * 100
        });
      }

      const results = trendAnalysis.analyzeTrends();
      expect(results.memory.trend).toBe('increasing');
      expect(results.memory.change).toBeGreaterThan(0);
      expect(results.memory.confidence).toBeGreaterThan(0);
    });

    it('should detect decreasing trend', () => {
      // Add decreasing CPU usage data points
      for (let i = 0; i < 10; i++) {
        Date.now.mockReturnValue(1000000 + i * 60 * 1000);
        trendAnalysis.addMeasurement({
          cpu: 100 - i * 5
        });
      }

      const results = trendAnalysis.analyzeTrends();
      expect(results.cpu.trend).toBe('decreasing');
      expect(results.cpu.change).toBeLessThan(0);
      expect(results.cpu.confidence).toBeGreaterThan(0);
    });

    it('should detect stable trend', () => {
      // Add stable network usage data points
      for (let i = 0; i < 10; i++) {
        Date.now.mockReturnValue(1000000 + i * 60 * 1000);
        trendAnalysis.addMeasurement({
          network: 10 + (Math.random() * 0.2 - 0.1) // Small random fluctuations
        });
      }

      const results = trendAnalysis.analyzeTrends();
      expect(results.network.trend).toBe('stable');
      expect(Math.abs(results.network.change)).toBeLessThan(10);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all metrics data', () => {
      trendAnalysis.addMeasurement({
        memory: 1000,
        cpu: 50,
        network: 10
      });

      trendAnalysis.clearMetrics();
      const data = trendAnalysis.getMetrics();
      expect(data.memory).toHaveLength(0);
      expect(data.cpu).toHaveLength(0);
      expect(data.network).toHaveLength(0);
    });
  });
}); 