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
    });

    describe('Reset functionality', () => {
        it('should reset all metrics', () => {
            metrics.incrementCounter('test_counter', 5);
            metrics.setGauge('test_gauge', 42);

            metrics.reset();

            expect(metrics.getCounter('test_counter')).toBe(0);
            expect(metrics.getGauge('test_gauge')).toBe(0);
        });
    });

    describe('getAllMetrics', () => {
        it('should return all metrics as an object', () => {
            metrics.incrementCounter('test_counter', 5);
            metrics.setGauge('test_gauge', 42);

            const allMetrics = metrics.getAllMetrics();

            expect(allMetrics).toEqual({
                counters: { test_counter: 5 },
                gauges: { test_gauge: 42 }
            });
        });

        it('should return empty metrics when reset', () => {
            metrics.reset();
            const allMetrics = metrics.getAllMetrics();

            expect(allMetrics).toEqual({
                counters: {},
                gauges: {}
            });
        });
    });
}); 