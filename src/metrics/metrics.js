class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    
    // Initialize maps with proper metric objects
    this.initializeMetrics();
  }

  /**
   * Initialize metric objects with proper interfaces
   * @private
   */
  initializeMetrics() {
    // Initialize gauge interface
    this.Gauge = class {
      constructor() {
        this.value = 0;
      }
      
      set(value) {
        this.value = value;
      }
      
      get() {
        return this.value;
      }
    };

    // Initialize histogram interface
    this.Histogram = class {
      constructor() {
        this.values = [];
      }
      
      observe(value) {
        this.values.push(value);
      }
      
      reset() {
        this.values = [];
      }
      
      getValues() {
        return [...this.values];
      }
    };
  }

  /**
   * Create a new gauge or return existing one
   * @param {string} name - Name of the gauge
   * @returns {Object} Gauge object
   */
  createGauge(name) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new this.Gauge());
    }
    return this.gauges.get(name);
  }

  /**
   * Create a new histogram or return existing one
   * @param {string} name - Name of the histogram
   * @returns {Object} Histogram object
   */
  createHistogram(name) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new this.Histogram());
    }
    return this.histograms.get(name);
  }

  /**
   * Increment a counter metric
   * @param {string} name - Name of the counter
   * @param {number} [value=1] - Value to increment by
   */
  incrementCounter(name, value = 1) {
    const currentValue = this.counters.get(name) || 0;
    this.counters.set(name, currentValue + value);
  }

  /**
   * Set a gauge metric value
   * @param {string} name - Name of the gauge
   * @param {number} value - Value to set
   */
  setGauge(name, value) {
    const gauge = this.createGauge(name);
    gauge.set(value);
  }

  /**
   * Get the current value of a counter
   * @param {string} name - Name of the counter
   * @returns {number} Current value of the counter
   */
  getCounter(name) {
    return this.counters.get(name) || 0;
  }

  /**
   * Get the current value of a gauge
   * @param {string} name - Name of the gauge
   * @returns {number} Current value of the gauge
   */
  getGauge(name) {
    const gauge = this.gauges.get(name);
    return gauge ? gauge.get() : 0;
  }

  /**
   * Reset all metrics to their initial state
   */
  reset() {
    // Reset all counters
    this.counters.clear();
    
    // Reset all gauges
    this.gauges.clear();
    
    // Reset all histograms
    this.histograms.clear();
  }

  /**
   * Get all current metrics as an object
   * @returns {Object} Object containing all metrics
   */
  getAllMetrics() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries([...this.gauges].map(([name, gauge]) => [name, gauge.get()])),
      histograms: Object.fromEntries([...this.histograms].map(([name, hist]) => [name, hist.getValues()]))
    };
  }
}

// Export a singleton instance
const metrics = new Metrics();
module.exports = { metrics }; 