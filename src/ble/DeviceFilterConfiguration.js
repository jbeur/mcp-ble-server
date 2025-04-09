const { logger } = require('../utils/logger');

class DeviceFilterConfiguration {
  constructor(config = {}) {
    this.config = {
      maxServiceUUIDs: 10,
      maxNamePatterns: 5,
      optimizationThreshold: 0.7,
      ...config
    };

    this.filters = {
      serviceUUIDs: [],
      manufacturerData: null,
      namePatterns: []
    };

    this.metrics = {
      totalDevices: 0,
      filteredDevices: 0,
      serviceUUIDStats: new Map(),
      namePatternStats: new Map(),
      manufacturerStats: new Map()
    };
  }

  async setServiceFilters(uuids) {
    try {
      // Validate UUIDs
      uuids.forEach(uuid => {
        if (!this.isValidUUID(uuid)) {
          throw new Error('Invalid service UUID format');
        }
      });

      // Check limits
      if (uuids.length > this.config.maxServiceUUIDs) {
        throw new Error(`Too many service UUIDs. Maximum is ${this.config.maxServiceUUIDs}`);
      }

      this.filters.serviceUUIDs = [...uuids];
      logger.debug('Service UUID filters updated:', { uuids });
    } catch (error) {
      logger.error('Error setting service filters:', error);
      throw error;
    }
  }

  async setManufacturerFilter(data) {
    try {
      // Validate manufacturer data
      if (!data.companyId || !this.isValidCompanyId(data.companyId)) {
        throw new Error('Invalid manufacturer data format');
      }

      if (!Buffer.isBuffer(data.data)) {
        throw new Error('Manufacturer data must be a Buffer');
      }

      this.filters.manufacturerData = {
        companyId: data.companyId,
        data: Buffer.from(data.data)
      };
      logger.debug('Manufacturer filter updated:', { companyId: data.companyId });
    } catch (error) {
      logger.error('Error setting manufacturer filter:', error);
      throw error;
    }
  }

  async setNameFilters(patterns) {
    try {
      // Validate patterns
      patterns.forEach(pattern => {
        if (!pattern || typeof pattern !== 'string') {
          throw new Error('Invalid name pattern');
        }
      });

      // Check limits
      if (patterns.length > this.config.maxNamePatterns) {
        throw new Error(`Too many name patterns. Maximum is ${this.config.maxNamePatterns}`);
      }

      this.filters.namePatterns = [...patterns];
      logger.debug('Name filters updated:', { patterns });
    } catch (error) {
      logger.error('Error setting name filters:', error);
      throw error;
    }
  }

  async clearFilters() {
    this.filters = {
      serviceUUIDs: [],
      manufacturerData: null,
      namePatterns: []
    };
    logger.debug('All filters cleared');
  }

  getActiveFilters() {
    return { ...this.filters };
  }

  recordDeviceDiscovery(device) {
    try {
      this.metrics.totalDevices++;

      // Update service UUID stats
      if (device.serviceUUIDs) {
        device.serviceUUIDs.forEach(uuid => {
          const count = this.metrics.serviceUUIDStats.get(uuid) || 0;
          this.metrics.serviceUUIDStats.set(uuid, count + 1);
        });
      }

      // Update name pattern stats
      if (device.name) {
        // Add the device name pattern to stats
        const pattern = `${device.name.split(/[0-9]/)[0]}*`;
        const count = this.metrics.namePatternStats.get(pattern) || 0;
        this.metrics.namePatternStats.set(pattern, count + 1);

        // Also check existing patterns
        this.filters.namePatterns.forEach(pattern => {
          if (this.matchesPattern(device.name, pattern)) {
            const count = this.metrics.namePatternStats.get(pattern) || 0;
            this.metrics.namePatternStats.set(pattern, count + 1);
          }
        });
      }

      // Update manufacturer stats
      if (device.manufacturerData) {
        const key = `${device.manufacturerData.companyId}`;
        const count = this.metrics.manufacturerStats.get(key) || 0;
        this.metrics.manufacturerStats.set(key, count + 1);
      }

      // Check if device matches any active filters
      if (this.matchesFilters(device)) {
        this.metrics.filteredDevices++;
      }
    } catch (error) {
      logger.error('Error recording device discovery:', error);
    }
  }

  getFilterMetrics() {
    return {
      totalDevices: this.metrics.totalDevices,
      filteredDevices: this.metrics.filteredDevices,
      filterRate: this.metrics.totalDevices > 0 
        ? this.metrics.filteredDevices / this.metrics.totalDevices 
        : 0,
      serviceUUIDStats: Object.fromEntries(this.metrics.serviceUUIDStats),
      namePatternStats: Object.fromEntries(this.metrics.namePatternStats),
      manufacturerStats: Object.fromEntries(this.metrics.manufacturerStats)
    };
  }

  async optimizeFilters() {
    try {
      // Optimize service UUID filters
      const serviceUUIDs = Array.from(this.metrics.serviceUUIDStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.config.maxServiceUUIDs)
        .map(([uuid]) => uuid);

      // Optimize name patterns
      const namePatterns = Array.from(this.metrics.namePatternStats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.config.maxNamePatterns)
        .map(([pattern]) => pattern);

      // Optimize manufacturer filter
      const manufacturerData = Array.from(this.metrics.manufacturerStats.entries())
        .sort((a, b) => b[1] - a[1])[0];

      // Apply optimized filters
      if (serviceUUIDs.length > 0) {
        await this.setServiceFilters(serviceUUIDs);
      }
      if (namePatterns.length > 0) {
        await this.setNameFilters(namePatterns);
      } else {
        // If no name patterns are found in stats, use default patterns based on device names
        const deviceNames = Array.from(this.metrics.namePatternStats.keys());
        if (deviceNames.length > 0) {
          const commonPrefix = this.findCommonPrefix(deviceNames);
          if (commonPrefix) {
            await this.setNameFilters([`${commonPrefix}*`]);
          }
        }
      }
      if (manufacturerData) {
        await this.setManufacturerFilter({
          companyId: manufacturerData[0],
          data: Buffer.from([]) // Default empty data
        });
      }

      logger.debug('Filters optimized:', {
        serviceUUIDs,
        namePatterns,
        manufacturerData: manufacturerData ? manufacturerData[0] : null
      });
    } catch (error) {
      logger.error('Error optimizing filters:', error);
      throw error;
    }
  }

  findCommonPrefix(names) {
    if (names.length === 0) return null;
        
    // Sort names to find common prefix
    const sortedNames = [...names].sort();
    const first = sortedNames[0];
    const last = sortedNames[sortedNames.length - 1];
        
    let prefix = '';
    for (let i = 0; i < Math.min(first.length, last.length); i++) {
      if (first[i] === last[i]) {
        prefix += first[i];
      } else {
        break;
      }
    }
        
    return prefix || null;
  }

  matchesFilters(device) {
    // Check service UUIDs
    if (this.filters.serviceUUIDs.length > 0 && device.serviceUUIDs) {
      const hasMatchingService = device.serviceUUIDs.some(uuid => 
        this.filters.serviceUUIDs.includes(uuid)
      );
      if (!hasMatchingService) return false;
    }

    // Check manufacturer data
    if (this.filters.manufacturerData && device.manufacturerData) {
      if (device.manufacturerData.companyId !== this.filters.manufacturerData.companyId) {
        return false;
      }
      if (this.filters.manufacturerData.data.length > 0) {
        const hasMatchingData = device.manufacturerData.data.includes(this.filters.manufacturerData.data);
        if (!hasMatchingData) return false;
      }
    }

    // Check name patterns
    if (this.filters.namePatterns.length > 0 && device.name) {
      const hasMatchingName = this.filters.namePatterns.some(pattern =>
        this.matchesPattern(device.name, pattern)
      );
      if (!hasMatchingName) return false;
    }

    return true;
  }

  matchesPattern(name, pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  }

  isValidUUID(uuid) {
    return /^[0-9A-F]{4}$/i.test(uuid);
  }

  isValidCompanyId(companyId) {
    return /^0x[0-9A-F]{4}$/i.test(companyId);
  }
}

module.exports = {
  DeviceFilterConfiguration
}; 