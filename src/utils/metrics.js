/**
 * Simple metrics tracking module
 */
const { logger } = require('./logger');

class Metrics {
  constructor() {
    this.metrics = new Map();
    this.gauges = new Map();
    this.metricsModule = null;
    this.prometheusMetrics = null;
  }

  /**
     * Increment a counter
     * @param {string} name - Counter name
     * @param {object} labels - Optional labels
     */
  increment(name, labels = {}) {
    const key = this._getKey(name, labels);
    const currentValue = this.metrics.get(key) || 0;
    this.metrics.set(key, currentValue + 1);
    logger.info(`Metric incremented: ${name}`);
  }

  /**
     * Set a gauge value
     * @param {string} name - Gauge name
     * @param {number} value - Gauge value
     * @param {object} labels - Optional labels
     */
  gauge(name, value, labels = {}) {
    const key = this._getKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
     * Record a histogram value
     * @param {string} name - Histogram name
     * @param {number} value - Value to record
     * @param {object} labels - Optional labels
     */
  histogram(name, value, labels = {}) {
    const key = this._getKey(name, labels);
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key).push(value);
  }

  /**
     * Get current value of a counter
     * @param {string} name - Counter name
     * @param {object} labels - Optional labels
     * @returns {number} Counter value
     */
  getCounter(name, labels = {}) {
    const key = this._getKey(name, labels);
    return this.metrics.get(key) || 0;
  }

  /**
     * Get current value of a gauge
     * @param {string} name - Gauge name
     * @param {object} labels - Optional labels
     * @returns {number} Gauge value
     */
  getGauge(name, labels = {}) {
    const key = this._getKey(name, labels);
    return this.gauges.get(key) || 0;
  }

  /**
     * Get histogram values
     * @param {string} name - Histogram name
     * @param {object} labels - Optional labels
     * @returns {number[]} Histogram values
     */
  getHistogram(name, labels = {}) {
    const key = this._getKey(name, labels);
    return this.metrics.get(key) || [];
  }

  /**
     * Reset metrics. If name is provided, only that metric is reset.
     * Otherwise, all metrics are reset.
     * @param {string} [name] - Optional name of metric to reset
     */
  reset(name) {
    if (name) {
      this.metrics.delete(name);
      this.gauges.delete(name);
    } else {
      this.metrics.clear();
      this.gauges.clear();
      if (this.metricsModule) {
        this.metricsModule.reset();
      }
      if (this.prometheusMetrics) {
        this.prometheusMetrics.reset();
      }
    }
  }

  /**
     * Get a unique key for a metric
     * @private
     * @param {string} name - Metric name
     * @param {object} labels - Labels
     * @returns {string} Unique key
     */
  _getKey(name, labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  observe(name, value, labels = {}) {
    const key = this._getKey(name, labels);
    const currentValue = this.metrics.get(key) || 0;
    this.metrics.set(key, (currentValue + value) / 2); // Simple average
  }

  get(name) {
    return this.metrics.get(name) || 0;
  }

  resetAll() {
    this.metrics.clear();
    if (this.metricsModule) {
      this.metricsModule.reset();
    }
    if (this.prometheusMetrics) {
      this.prometheusMetrics.reset();
    }
  }
}

// Export singleton instance
const metrics = new Metrics();

const metricsModule = {
  requestSigningSuccess: { inc: () => {} },
  requestSigningError: { inc: () => {} },
  requestVerificationSuccess: { inc: () => {} },
  requestVerificationError: { inc: () => {} }
};

const prometheus = require('prom-client');

const prometheusMetrics = {
  requestSigningSuccess: new prometheus.Counter({
    name: 'request_signing_success_total',
    help: 'Total number of successful request signings'
  }),
  requestSigningError: new prometheus.Counter({
    name: 'request_signing_error_total',
    help: 'Total number of failed request signings'
  }),
  requestVerificationSuccess: new prometheus.Counter({
    name: 'request_verification_success_total',
    help: 'Total number of successful request verifications'
  }),
  requestVerificationError: new prometheus.Counter({
    name: 'request_verification_error_total',
    help: 'Total number of failed request verifications'
  })
};

module.exports = { Metrics, metrics }; 