const { PriorityScanning } = require('../../../src/ble/PriorityScanning');
const assert = require('assert');

describe('Priority Scanning', () => {
    let priorityScanning;

    beforeEach(() => {
        priorityScanning = new PriorityScanning();
    });

    describe('priority configuration', () => {
        it('should set and get device priorities', async () => {
            const priorities = {
                'device1': 'high',
                'device2': 'medium',
                'device3': 'low'
            };
            
            await priorityScanning.setDevicePriorities(priorities);
            const currentPriorities = priorityScanning.getDevicePriorities();
            
            assert.deepStrictEqual(currentPriorities, priorities);
        });

        it('should validate priority values', async () => {
            await assert.rejects(
                () => priorityScanning.setDevicePriorities({ 'device1': 'invalid' }),
                { message: /Invalid priority value/ }
            );
        });

        it('should track scanning metrics', () => {
            const device = { id: 'device1', name: 'Test Device' };
            priorityScanning.recordScanResult(device, 'high');
            
            const metrics = priorityScanning.getScanMetrics();
            assert.strictEqual(metrics.totalScans, 1);
            assert.strictEqual(metrics.priorityDistribution.high, 1);
            assert.strictEqual(metrics.priorityDistribution.medium, 0);
            assert.strictEqual(metrics.priorityDistribution.low, 0);
        });

        it('should optimize scan intervals based on priority', () => {
            // Record some scan results
            const devices = [
                { id: 'device1', name: 'High Priority Device' },
                { id: 'device2', name: 'Medium Priority Device' },
                { id: 'device3', name: 'Low Priority Device' }
            ];
            
            devices.forEach(device => {
                priorityScanning.recordScanResult(device, device.name.includes('High') ? 'high' : 
                    device.name.includes('Medium') ? 'medium' : 'low');
            });
            
            const intervals = priorityScanning.getOptimizedScanIntervals();
            assert(intervals.high < intervals.medium, 'High priority should have shorter interval');
            assert(intervals.medium < intervals.low, 'Medium priority should have shorter interval than low');
        });

        it('should handle priority-based scan scheduling', async () => {
            // Set some device priorities first
            const priorities = {
                'device1': 'high',
                'device2': 'medium',
                'device3': 'low'
            };
            await priorityScanning.setDevicePriorities(priorities);

            const schedule = priorityScanning.generateScanSchedule();
            
            // Verify schedule structure
            assert(Array.isArray(schedule), 'Schedule should be an array');
            assert(schedule.length > 0, 'Schedule should not be empty');
            
            // Verify priority distribution
            const highPriorityScans = schedule.filter(s => s.priority === 'high').length;
            const mediumPriorityScans = schedule.filter(s => s.priority === 'medium').length;
            const lowPriorityScans = schedule.filter(s => s.priority === 'low').length;
            
            assert(highPriorityScans > mediumPriorityScans, 'Should have more high priority scans');
            assert(mediumPriorityScans > lowPriorityScans, 'Should have more medium priority scans');
        });

        it('should adapt scan intervals based on device behavior', () => {
            // Record some scan results with different patterns
            const devices = [
                { id: 'device1', name: 'Frequent Device' },
                { id: 'device2', name: 'Occasional Device' }
            ];
            
            // Simulate frequent scans for device1
            for (let i = 0; i < 10; i++) {
                priorityScanning.recordScanResult(devices[0], 'high');
            }
            
            // Simulate occasional scans for device2
            for (let i = 0; i < 3; i++) {
                priorityScanning.recordScanResult(devices[1], 'medium');
            }
            
            const intervals = priorityScanning.getOptimizedScanIntervals();
            assert(intervals.high < intervals.medium, 'Should adapt intervals based on scan frequency');
        });

        it('should handle priority conflicts', async () => {
            const priorities = {
                'device1': 'high',
                'device2': 'high',
                'device3': 'high'
            };
            
            await priorityScanning.setDevicePriorities(priorities);
            const schedule = priorityScanning.generateScanSchedule();
            
            // Verify that high priority devices are distributed evenly
            const highPriorityDevices = schedule.filter(s => s.priority === 'high');
            const timeGaps = highPriorityDevices.slice(1).map((s, i) => 
                s.timestamp - highPriorityDevices[i].timestamp
            );
            
            const avgGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
            const maxGap = Math.max(...timeGaps);
            
            assert(maxGap / avgGap < 2, 'High priority devices should be distributed evenly');
        });
    });
}); 