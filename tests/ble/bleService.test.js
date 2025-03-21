const noble = require('@abandonware/noble');
const winston = require('winston');
const BLEService = require('../../src/ble/bleService');

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
        error: jest.fn()
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
    const mockConfig = {
        ble: {
            scan_duration: 5,
            connection_timeout: 1,
            mtu_size: 512,
            auto_reconnect: true,
            reconnection_attempts: 3,
            device_filters: [
                {
                    name: 'TestDevice',
                    address: '00:11:22:33:44:55',
                    services: ['180f'],
                    alias: 'test-device'
                }
            ]
        }
    };

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        noble.removeAllListeners();
        
        // Initialize BLE service
        bleService = new BLEService(mockConfig);
    });

    describe('initialization', () => {
        it('should initialize successfully', () => {
            expect(noble.listenerCount('stateChange')).toBe(1);
            expect(noble.listenerCount('discover')).toBe(1);
        });

        it('should handle initialization errors', () => {
            const originalOn = noble.on;
            noble.on = jest.fn().mockImplementation(() => {
                throw new Error('Initialization error');
            });

            expect(() => new BLEService(mockConfig)).toThrow('Initialization error');
            noble.on = originalOn;
        });
    });

    describe('device discovery', () => {
        it('should handle device discovery', () => {
            const mockDevice = {
                id: 'test-device-id',
                address: '00:11:22:33:44:55',
                rssi: -50,
                advertisement: {
                    localName: 'TestDevice',
                    serviceUuids: ['180f']
                }
            };

            noble.emit('discover', mockDevice);

            expect(bleService.discoveredDevices).toHaveProperty(mockDevice.id);
            expect(bleService.discoveredDevices[mockDevice.id]).toEqual(mockDevice);
        });

        it('should match device filters', () => {
            const mockDevice = {
                id: 'test-device-id',
                address: '00:11:22:33:44:55',
                rssi: -50,
                advertisement: {
                    localName: 'TestDevice',
                    serviceUuids: ['180f']
                }
            };

            noble.emit('discover', mockDevice);

            expect(bleService.discoveredDevices[mockDevice.id].alias).toBe('test-device');
        });
    });

    describe('device connection', () => {
        it('should connect to device successfully', async () => {
            const mockDevice = {
                id: 'test-device-id',
                connect: jest.fn().mockResolvedValue(),
                discoverServices: jest.fn().mockResolvedValue([]),
                on: jest.fn()
            };

            bleService.discoveredDevices[mockDevice.id] = mockDevice;
            await bleService.connectToDevice(mockDevice.id);

            expect(mockDevice.connect).toHaveBeenCalled();
            expect(mockDevice.discoverServices).toHaveBeenCalled();
            expect(bleService.connectedDevices).toHaveProperty(mockDevice.id);
        });

        it('should handle connection timeout', async () => {
            let timeoutId;
            const mockDevice = {
                id: 'test-device-id',
                connect: jest.fn().mockImplementation(() => new Promise(resolve => {
                    timeoutId = setTimeout(resolve, 2000);
                })),
                on: jest.fn()
            };

            bleService.discoveredDevices[mockDevice.id] = mockDevice;
            
            try {
                await bleService.connectToDevice(mockDevice.id);
            } catch (error) {
                expect(error.message).toBe('Connection timeout');
            }

            // Clean up timeout
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }, 3000);
    });

    describe('device disconnection', () => {
        it('should disconnect device successfully', async () => {
            const mockDevice = {
                id: 'test-device-id',
                disconnect: jest.fn().mockResolvedValue(),
                on: jest.fn()
            };

            bleService.connectedDevices[mockDevice.id] = mockDevice;
            await bleService.disconnectDevice(mockDevice.id);

            expect(mockDevice.disconnect).toHaveBeenCalled();
            expect(bleService.connectedDevices).not.toHaveProperty(mockDevice.id);
        });
    });

    describe('scanning control', () => {
        it('should start and stop scanning', async () => {
            await bleService.startScanning();
            expect(noble.startScanningAsync).toHaveBeenCalled();

            await bleService.stopScanning();
            expect(noble.stopScanningAsync).toHaveBeenCalled();
        });
    });
}); 