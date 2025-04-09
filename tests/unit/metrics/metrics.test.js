const { metrics } = require('../../../src/metrics/metrics');

describe('Metrics', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('Counter operations', () => {
    it('should increment counter by default value', () => {
      metrics.incrementCounter('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(1);
    });

    it('should increment counter by specified value', () => {
      metrics.incrementCounter('test_counter', 5);
      expect(metrics.getCounter('test_counter')).toBe(5);
    });

    it('should handle multiple increments', () => {
      metrics.incrementCounter('test_counter', 3);
      metrics.incrementCounter('test_counter', 2);
      expect(metrics.getCounter('test_counter')).toBe(5);
    });

    it('should return 0 for non-existent counter', () => {
      expect(metrics.getCounter('non_existent')).toBe(0);
    });
  });

  describe('Gauge operations', () => {
    it('should set and get gauge value', () => {
      metrics.setGauge('test_gauge', 42);
      expect(metrics.getGauge('test_gauge')).toBe(42);
    });

    it('should update gauge value', () => {
      metrics.setGauge('test_gauge', 42);
      metrics.setGauge('test_gauge', 24);
      expect(metrics.getGauge('test_gauge')).toBe(24);
    });

    it('should return 0 for non-existent gauge', () => {
      expect(metrics.getGauge('non_existent')).toBe(0);
    });

    it('should create gauge with proper interface', () => {
      const gauge = metrics.createGauge('test_gauge');
      expect(gauge.set).toBeDefined();
      expect(gauge.get).toBeDefined();
    });

    it('should return same gauge instance for same name', () => {
      const gauge1 = metrics.createGauge('test_gauge');
      const gauge2 = metrics.createGauge('test_gauge');
      expect(gauge1).toBe(gauge2);
    });
  });

  describe('Histogram operations', () => {
    it('should create histogram with proper interface', () => {
      const histogram = metrics.createHistogram('test_histogram');
      expect(histogram.observe).toBeDefined();
      expect(histogram.reset).toBeDefined();
      expect(histogram.getValues).toBeDefined();
    });

    it('should observe and store values', () => {
      const histogram = metrics.createHistogram('test_histogram');
      histogram.observe(1);
      histogram.observe(2);
      histogram.observe(3);
      expect(histogram.getValues()).toEqual([1, 2, 3]);
    });

    it('should reset histogram values', () => {
      const histogram = metrics.createHistogram('test_histogram');
      histogram.observe(1);
      histogram.observe(2);
      histogram.reset();
      expect(histogram.getValues()).toEqual([]);
    });

    it('should return same histogram instance for same name', () => {
      const hist1 = metrics.createHistogram('test_histogram');
      const hist2 = metrics.createHistogram('test_histogram');
      expect(hist1).toBe(hist2);
    });
  });

  describe('Reset functionality', () => {
    it('should reset all metrics', () => {
      metrics.incrementCounter('test_counter', 5);
      metrics.setGauge('test_gauge', 42);
      const histogramName = 'test_histogram';
      const histogram = metrics.createHistogram(histogramName);
      histogram.observe(1);
      histogram.observe(2);

      metrics.reset();

      expect(metrics.getCounter('test_counter')).toBe(0);
      expect(metrics.getGauge('test_gauge')).toBe(0);
      const resetHistogram = metrics.createHistogram(histogramName);
      expect(resetHistogram.getValues()).toEqual([]);
    });
  });

  describe('getAllMetrics', () => {
    it('should return all metrics as an object', () => {
      metrics.incrementCounter('test_counter', 5);
      metrics.setGauge('test_gauge', 42);
      const histogram = metrics.createHistogram('test_histogram');
      histogram.observe(1);
      histogram.observe(2);

      const allMetrics = metrics.getAllMetrics();

      expect(allMetrics).toEqual({
        counters: { test_counter: 5 },
        gauges: { test_gauge: 42 },
        histograms: { test_histogram: [1, 2] }
      });
    });

    it('should return empty metrics when reset', () => {
      metrics.reset();
      const allMetrics = metrics.getAllMetrics();

      expect(allMetrics).toEqual({
        counters: {},
        gauges: {},
        histograms: {}
      });
    });
  });
}); 