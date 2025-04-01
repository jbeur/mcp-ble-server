const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({ register });

// Create metrics
const gauge = (name, value, labels = {}) => {
    const metric = new promClient.Gauge({
        name,
        help: `Gauge metric for ${name}`,
        labelNames: Object.keys(labels)
    });
    register.registerMetric(metric);
    metric.set(labels, value);
};

const histogram = (name, value, labels = {}) => {
    const metric = new promClient.Histogram({
        name,
        help: `Histogram metric for ${name}`,
        labelNames: Object.keys(labels)
    });
    register.registerMetric(metric);
    metric.observe(labels, value);
};

module.exports = {
    gauge,
    histogram,
    register
}; 