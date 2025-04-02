const logger = require('../utils/logger');

class PriorityScanning {
    constructor(config = {}) {
        this.config = {
            minScanInterval: 100, // Minimum scan interval in ms
            maxScanInterval: 5000, // Maximum scan interval in ms
            defaultIntervals: {
                high: 500,
                medium: 1000,
                low: 2000
            },
            adaptationFactor: 0.3, // How quickly to adapt intervals
            ...config
        };

        this.devicePriorities = new Map();
        this.scanHistory = new Map();
        this.metrics = {
            totalScans: 0,
            priorityDistribution: {
                high: 0,
                medium: 0,
                low: 0
            }
        };
    }

    async setDevicePriorities(priorities) {
        try {
            // Validate priorities
            Object.entries(priorities).forEach(([deviceId, priority]) => {
                if (!this._isValidPriority(priority)) {
                    throw new Error(`Invalid priority value for device ${deviceId}: ${priority}`);
                }
            });

            // Update priorities
            this.devicePriorities = new Map(Object.entries(priorities));
            logger.debug('Device priorities updated:', Object.fromEntries(this.devicePriorities));
        } catch (error) {
            logger.error('Error setting device priorities:', error);
            throw error;
        }
    }

    getDevicePriorities() {
        return Object.fromEntries(this.devicePriorities);
    }

    recordScanResult(device, priority) {
        try {
            if (!this._isValidPriority(priority)) {
                throw new Error(`Invalid priority value: ${priority}`);
            }

            // Update metrics
            this.metrics.totalScans++;
            this.metrics.priorityDistribution[priority]++;

            // Update scan history
            const deviceHistory = this.scanHistory.get(device.id) || [];
            deviceHistory.push({
                timestamp: Date.now(),
                priority
            });

            // Keep only last 100 scans per device
            if (deviceHistory.length > 100) {
                deviceHistory.shift();
            }

            this.scanHistory.set(device.id, deviceHistory);

            logger.debug('Scan result recorded:', {
                deviceId: device.id,
                priority,
                totalScans: this.metrics.totalScans
            });
        } catch (error) {
            logger.error('Error recording scan result:', error);
            throw error;
        }
    }

    getScanMetrics() {
        return {
            totalScans: this.metrics.totalScans,
            priorityDistribution: { ...this.metrics.priorityDistribution }
        };
    }

    getOptimizedScanIntervals() {
        const intervals = { ...this.config.defaultIntervals };
        
        // Calculate average scan frequency for each priority
        const priorityFrequencies = this._calculatePriorityFrequencies();
        
        // Adjust intervals based on scan frequency
        Object.entries(priorityFrequencies).forEach(([priority, frequency]) => {
            if (frequency > 0) {
                const targetInterval = Math.max(
                    this.config.minScanInterval,
                    Math.min(
                        this.config.maxScanInterval,
                        Math.round(1000 / frequency)
                    )
                );
                
                // Smoothly adapt the interval
                intervals[priority] = Math.round(
                    intervals[priority] * (1 - this.config.adaptationFactor) +
                    targetInterval * this.config.adaptationFactor
                );
            }
        });

        logger.debug('Optimized scan intervals:', intervals);
        return intervals;
    }

    generateScanSchedule() {
        const schedule = [];
        const intervals = this.getOptimizedScanIntervals();
        const now = Date.now();

        // Group devices by priority
        const devicesByPriority = this._groupDevicesByPriority();

        // Priority weights for scan frequency
        const priorityWeights = {
            high: 4,    // High priority devices get 4x more scans
            medium: 2,  // Medium priority devices get 2x more scans
            low: 1      // Base weight for low priority
        };

        // Generate schedule for each priority level
        Object.entries(devicesByPriority).forEach(([priority, devices]) => {
            const interval = intervals[priority];
            const deviceCount = devices.length;

            if (deviceCount === 0) return;

            // Calculate number of scan slots based on priority weight
            const scanSlots = deviceCount * priorityWeights[priority];

            // Distribute devices across their allocated slots
            for (let slot = 0; slot < scanSlots; slot++) {
                const deviceIndex = slot % deviceCount;
                const device = devices[deviceIndex];
                const slotInterval = interval / priorityWeights[priority];
                const offset = Math.floor(slotInterval * slot);

                schedule.push({
                    deviceId: device.id,
                    priority,
                    timestamp: now + offset
                });
            }
        });

        // Sort schedule by timestamp
        schedule.sort((a, b) => a.timestamp - b.timestamp);

        logger.debug('Generated scan schedule:', {
            totalScans: schedule.length,
            priorityDistribution: this._getPriorityDistribution(schedule)
        });

        return schedule;
    }

    _isValidPriority(priority) {
        return ['high', 'medium', 'low'].includes(priority);
    }

    _calculatePriorityFrequencies() {
        const frequencies = {
            high: 0,
            medium: 0,
            low: 0
        };

        const now = Date.now();
        const timeWindow = 60000; // 1 minute window

        this.scanHistory.forEach(deviceHistory => {
            deviceHistory.forEach(scan => {
                if (now - scan.timestamp <= timeWindow) {
                    frequencies[scan.priority]++;
                }
            });
        });

        // Convert to scans per second
        Object.keys(frequencies).forEach(priority => {
            frequencies[priority] = frequencies[priority] / (timeWindow / 1000);
        });

        return frequencies;
    }

    _groupDevicesByPriority() {
        const groups = {
            high: [],
            medium: [],
            low: []
        };

        this.devicePriorities.forEach((priority, deviceId) => {
            groups[priority].push({ id: deviceId });
        });

        return groups;
    }

    _getPriorityDistribution(schedule) {
        return schedule.reduce((acc, scan) => {
            acc[scan.priority] = (acc[scan.priority] || 0) + 1;
            return acc;
        }, {});
    }
}

module.exports = {
    PriorityScanning
}; 