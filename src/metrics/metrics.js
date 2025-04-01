class Metrics {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
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
        this.gauges.set(name, value);
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
        return this.gauges.get(name) || 0;
    }

    /**
     * Reset all metrics to their initial state
     */
    reset() {
        this.counters.clear();
        this.gauges.clear();
    }

    /**
     * Get all current metrics as an object
     * @returns {Object} Object containing all metrics
     */
    getAllMetrics() {
        return {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges)
        };
    }
}

// Export a singleton instance
const metrics = new Metrics();
module.exports = { metrics }; 