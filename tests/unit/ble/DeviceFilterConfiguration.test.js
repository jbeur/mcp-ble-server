const { DeviceFilterConfiguration } = require('../../../src/ble/DeviceFilterConfiguration');
const assert = require('assert');

describe('Device Filter Configuration', () => {
  let filterConfig;

  beforeEach(() => {
    filterConfig = new DeviceFilterConfiguration();
  });

  describe('filter configuration', () => {
    it('should apply service UUID filters', async () => {
      const serviceUUIDs = ['180D', '180F'];
      await filterConfig.setServiceFilters(serviceUUIDs);
            
      const filters = filterConfig.getActiveFilters();
      assert(filters.serviceUUIDs.length === 2, 'Should have 2 service UUIDs');
      assert(filters.serviceUUIDs.includes('180D'), 'Should include first service UUID');
      assert(filters.serviceUUIDs.includes('180F'), 'Should include second service UUID');
    });

    it('should apply manufacturer data filters', async () => {
      const manufacturerData = {
        companyId: '0x004C',
        data: Buffer.from([0x01, 0x02])
      };
      await filterConfig.setManufacturerFilter(manufacturerData);
            
      const filters = filterConfig.getActiveFilters();
      assert(filters.manufacturerData.companyId === '0x004C', 'Should have correct company ID');
      assert(Buffer.isBuffer(filters.manufacturerData.data), 'Should have buffer data');
    });

    it('should apply name filters', async () => {
      const namePatterns = ['Device*', 'Sensor*'];
      await filterConfig.setNameFilters(namePatterns);
            
      const filters = filterConfig.getActiveFilters();
      assert(filters.namePatterns.length === 2, 'Should have 2 name patterns');
      assert(filters.namePatterns.includes('Device*'), 'Should include first pattern');
      assert(filters.namePatterns.includes('Sensor*'), 'Should include second pattern');
    });

    it('should clear filters', async () => {
      // Set some filters first
      await filterConfig.setServiceFilters(['180D']);
      await filterConfig.setNameFilters(['Device*']);
            
      // Clear all filters
      await filterConfig.clearFilters();
            
      const filters = filterConfig.getActiveFilters();
      assert(filters.serviceUUIDs.length === 0, 'Should have no service UUIDs');
      assert(filters.namePatterns.length === 0, 'Should have no name patterns');
      assert(!filters.manufacturerData, 'Should have no manufacturer data');
    });

    it('should track filter performance metrics', async () => {
      // Set some filters and simulate device discovery
      await filterConfig.setServiceFilters(['180D']);
      await filterConfig.setNameFilters(['Device*']);
            
      // Simulate device discovery events
      const devices = [
        { name: 'Device1', serviceUUIDs: ['180D'] },
        { name: 'Other', serviceUUIDs: ['180F'] },
        { name: 'Device2', serviceUUIDs: ['180D'] }
      ];
            
      devices.forEach(device => {
        filterConfig.recordDeviceDiscovery(device);
      });
            
      const metrics = filterConfig.getFilterMetrics();
      assert(metrics.totalDevices === 3, 'Should track total devices');
      assert(metrics.filteredDevices === 2, 'Should track filtered devices');
      assert(metrics.filterRate === 2/3, 'Should calculate correct filter rate');
    });

    it('should handle invalid filter configurations', async () => {
      // Test invalid service UUID
      await assert.rejects(
        () => filterConfig.setServiceFilters(['invalid-uuid']),
        { message: /Invalid service UUID format/ }
      );
            
      // Test invalid manufacturer data
      await assert.rejects(
        () => filterConfig.setManufacturerFilter({ companyId: 'invalid' }),
        { message: /Invalid manufacturer data format/ }
      );
            
      // Test invalid name pattern
      await assert.rejects(
        () => filterConfig.setNameFilters(['']),
        { message: /Invalid name pattern/ }
      );
    });

    it('should optimize filters based on discovery patterns', async () => {
      // Record some device discoveries
      const devices = [
        { name: 'Device1', serviceUUIDs: ['180D'] },
        { name: 'Device2', serviceUUIDs: ['180D'] },
        { name: 'Other', serviceUUIDs: ['180F'] }
      ];
            
      devices.forEach(device => {
        filterConfig.recordDeviceDiscovery(device);
      });
            
      // Optimize filters
      await filterConfig.optimizeFilters();
            
      const filters = filterConfig.getActiveFilters();
      assert(filters.serviceUUIDs.includes('180D'), 'Should optimize for common service UUID');
      assert(filters.namePatterns.includes('Device*'), 'Should optimize for common name pattern');
    });
  });
}); 