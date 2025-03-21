const noble = require('@abandonware/noble');
const winston = require('winston');
const BLEService = require('../../src/ble/bleService');
const { BLEDeviceError, BLEScanError, BLEConnectionError } = require('../../src/utils/bleErrors');

// Mock winston
jest.mock('winston', () => ({
    format: {
        timestamp: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        simple: jest.fn().mockReturnThis(),
        combine: jest.fn().mockReturnThis()
    },
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }),
    transports: {
        File: jest.fn(),
        Console: jest.fn()
    }
}));

// Mock noble module
jest.mock('@abandonware/noble', () => {
    const EventEmitter = require('events');
    const noble = new EventEmitter();
    noble.state = 'poweredOn';
    noble.startScanningAsync = jest.fn().mockResolvedValue();
    noble.stopScanningAsync = jest.fn().mockResolvedValue();
    return noble;
});

describe('BLEService', () => {
    let bleService;
    let mockLogger;
    let mockDevice;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock logger
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };
        winston.createLogger.mockReturnValue(mockLogger);

        // Mock noble state and methods
        noble.state = 'poweredOn';
        noble.setMaxListeners = jest.fn();
        noble.removeListener = jest.fn();

        // Mock device
        mockDevice = {
            id: 'test-device',
            address: '00:11:22:33:44:55',
            advertisement: {
                localName: 'Test Device',
                serviceUuids: ['1234']
            },
            connect: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue(),
            discoverServices: jest.fn().mockResolvedValue([]),
            on: jest.fn()
        };

        // Mock noble functions
        noble.startScanningAsync = jest.fn().mockResolvedValue();
        noble.stopScanningAsync = jest.fn().mockResolvedValue();

        // Create BLE service instance
        bleService = new BLEService({
            ble: {
                device_filters: [],
                scan_duration: 10,
                connection_timeout: 5,
                auto_reconnect: true,
                reconnection_attempts: 3
            }
        });
    });

    afterEach(() => {
        // Clean up BLE service
        bleService.cleanup();
        jest.useRealTimers();
    });

    describe('initialization', () => {
        it('should initialize and start scanning when powered on', async () => {
            await bleService.initialize();
            expect(noble.startScanningAsync).toHaveBeenCalled();
            expect(bleService.isScanning).toBe(true);
        });

        it('should set max listeners on noble', () => {
            expect(noble.setMaxListeners).toHaveBeenCalledWith(20);
        });
    });

    describe('device discovery', () => {
        it('should handle discovered devices', () => {
            bleService.handleDeviceDiscover(mockDevice);
            expect(bleService.discoveredDevices[mockDevice.id]).toBe(mockDevice);
        });

        it('should apply device filters when configured', () => {
            bleService = new BLEService({
                ble: {
                    device_filters: [
                        { name: 'Test Device', alias: 'TestAlias' }
                    ]
                }
            });

            bleService.handleDeviceDiscover(mockDevice);
            expect(bleService.discoveredDevices[mockDevice.id].alias).toBe('TestAlias');
        });
    });

    describe('scanning control', () => {
        it('should start and stop scanning', async () => {
            await bleService.startScanning();
            expect(noble.startScanningAsync).toHaveBeenCalled();
            expect(bleService.isScanning).toBe(true);

            await bleService.stopScanning();
            expect(noble.stopScanningAsync).toHaveBeenCalled();
            expect(bleService.isScanning).toBe(false);
        });

        it('should handle scanning errors with retry', async () => {
            jest.useFakeTimers();

            // Make first scan attempt fail
            noble.startScanningAsync.mockRejectedValueOnce(new Error('Scan failed'));
            
            // Second attempt should succeed
            noble.startScanningAsync.mockResolvedValueOnce();

            // Start scanning - this should fail
            const scanPromise = bleService.startScanning().catch(() => {});
            await scanPromise;

            expect(noble.startScanningAsync).toHaveBeenCalledTimes(1);
            expect(bleService.isScanning).toBe(false);

            // Fast-forward past retry delay and run all timers
            await jest.runAllTimersAsync();

            // Verify retry was successful
            expect(noble.startScanningAsync).toHaveBeenCalledTimes(2);
            expect(bleService.isScanning).toBe(true);
        }, 15000); // Increase timeout to 15 seconds
    });

    describe('device connection', () => {
        beforeEach(() => {
            bleService.discoveredDevices[mockDevice.id] = mockDevice;
        });

        it('should connect to discovered device', async () => {
            await bleService.connectToDevice(mockDevice.id);
            expect(mockDevice.connect).toHaveBeenCalled();
            expect(mockDevice.discoverServices).toHaveBeenCalled();
            expect(bleService.connectedDevices[mockDevice.id]).toBe(mockDevice);
        });

        it('should handle connection timeout', async () => {
            jest.useFakeTimers();

            // Make connect hang
            mockDevice.connect.mockImplementation(() => new Promise(() => {}));

            const connectPromise = bleService.connectToDevice(mockDevice.id);
            
            // Fast-forward past connection timeout
            jest.advanceTimersByTime(5000);

            await expect(connectPromise).rejects.toThrow(BLEConnectionError);
            expect(bleService.connectedDevices[mockDevice.id]).toBeUndefined();
        });

        it('should handle disconnection', async () => {
            await bleService.connectToDevice(mockDevice.id);
            await bleService.disconnectDevice(mockDevice.id);
            expect(mockDevice.disconnect).toHaveBeenCalled();
            expect(bleService.connectedDevices[mockDevice.id]).toBeUndefined();
        });
    });

    describe('device management', () => {
        it('should return discovered devices', () => {
            bleService.discoveredDevices[mockDevice.id] = mockDevice;
            expect(bleService.getDiscoveredDevices()).toContain(mockDevice);
        });

        it('should return connected devices', async () => {
            bleService.discoveredDevices[mockDevice.id] = mockDevice;
            await bleService.connectToDevice(mockDevice.id);
            expect(bleService.getConnectedDevices()).toContain(mockDevice);
        });
    });

    describe('cleanup', () => {
        it('should clean up resources properly', async () => {
            // Set up some state
            bleService.discoveredDevices[mockDevice.id] = mockDevice;
            await bleService.connectToDevice(mockDevice.id);
            bleService.isScanning = true;

            // Perform cleanup
            bleService.cleanup();

            // Verify cleanup
            expect(noble.removeListener).toHaveBeenCalledWith('stateChange', bleService.handleStateChange);
            expect(noble.removeListener).toHaveBeenCalledWith('discover', bleService.handleDeviceDiscover);
            expect(bleService.isScanning).toBe(false);
            expect(Object.keys(bleService.discoveredDevices)).toHaveLength(0);
            expect(Object.keys(bleService.connectedDevices)).toHaveLength(0);
        });
    });
}); 