const { ScanHandler } = require('../../../../src/mcp/handlers/ScanHandler');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock message types and error codes
jest.mock('../../../../src/mcp/protocol/messages', () => ({
    MESSAGE_TYPES: {
        START_SCAN: 'START_SCAN',
        STOP_SCAN: 'STOP_SCAN',
        SCAN_STARTED: 'SCAN_STARTED',
        SCAN_STOPPED: 'SCAN_STOPPED',
        DEVICE_DISCOVERED: 'DEVICE_DISCOVERED'
    },
    ERROR_CODES: {
        INVALID_MESSAGE_TYPE: 'INVALID_MESSAGE_TYPE',
        SCAN_ALREADY_ACTIVE: 'SCAN_ALREADY_ACTIVE',
        NO_ACTIVE_SCAN: 'NO_ACTIVE_SCAN'
    }
}));

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
    metrics: {
        increment: jest.fn()
    }
}));
jest.mock('../../../../src/ble/BLEService', () => {
    return {
        BLEService: jest.fn().mockImplementation(() => ({
            startScan: jest.fn().mockResolvedValue(undefined),
            stopScan: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
            removeListener: jest.fn()
        }))
    };
});

const { BLEService } = require('../../../../src/ble/BLEService');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../../../src/mcp/protocol/messages');

describe('ScanHandler', () => {
    let handler;
    let bleService;
    const clientId = 'test-client-1';

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create fresh instances
        bleService = new BLEService();
        handler = new ScanHandler(bleService);
        
        // Mock sendToClient method
        handler.sendToClient = jest.fn();
    });

    describe('processMessage', () => {
        it('should handle START_SCAN message', async () => {
            const message = { type: MESSAGE_TYPES.START_SCAN };
            await handler.processMessage(clientId, message);
            expect(bleService.startScan).toHaveBeenCalled();
        });

        it('should handle STOP_SCAN message', async () => {
            // First start a scan
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });
            
            // Then stop it
            const message = { type: MESSAGE_TYPES.STOP_SCAN };
            await handler.processMessage(clientId, message);
            
            expect(bleService.stopScan).toHaveBeenCalled();
        });

        it('should throw error for invalid message type', async () => {
            const message = { type: 'INVALID_TYPE' };
            await expect(handler.processMessage(clientId, message))
                .rejects
                .toThrow('Unsupported message type: INVALID_TYPE');
        });
    });

    describe('handleStartScan', () => {
        it('should start scan and set up device discovery handler', async () => {
            const message = {
                type: MESSAGE_TYPES.START_SCAN,
                params: { timeout: 5000 }
            };

            await handler.handleStartScan(clientId, message);

            expect(bleService.startScan).toHaveBeenCalledWith({ timeout: 5000 });
            expect(bleService.on).toHaveBeenCalledWith('deviceDiscovered', expect.any(Function));
            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.SCAN_STARTED
            });
            expect(metrics.increment).toHaveBeenCalledWith('scan.start.success');
        });

        it('should handle device discovery events', async () => {
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });

            // Get the discovery handler that was registered
            const discoveryHandler = bleService.on.mock.calls[0][1];

            // Simulate device discovery
            const mockDevice = {
                id: 'device-1',
                name: 'Test Device',
                address: '00:11:22:33:44:55',
                rssi: -70,
                manufacturerData: Buffer.from('test')
            };

            discoveryHandler(mockDevice);

            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.DEVICE_DISCOVERED,
                params: mockDevice
            });
        });

        it('should throw error if scan is already active', async () => {
            // Start first scan
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });

            // Try to start second scan
            await expect(handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN }))
                .rejects
                .toThrow('Scan already in progress for this client');
            
            expect(metrics.increment).toHaveBeenCalledWith('scan.start.error');
        });
    });

    describe('handleStopScan', () => {
        it('should stop scan and clean up handlers', async () => {
            // First start a scan
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });
            
            // Then stop it
            await handler.handleStopScan(clientId);

            expect(bleService.removeListener).toHaveBeenCalled();
            expect(bleService.stopScan).toHaveBeenCalled();
            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.SCAN_STOPPED
            });
            expect(metrics.increment).toHaveBeenCalledWith('scan.stop.success');
        });

        it('should throw error if no active scan exists', async () => {
            await expect(handler.handleStopScan(clientId))
                .rejects
                .toThrow('No active scan found for this client');
            
            expect(metrics.increment).toHaveBeenCalledWith('scan.stop.error');
        });

        it('should not stop BLE scan if other clients are still scanning', async () => {
            const clientId2 = 'test-client-2';

            // Start scans for both clients
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });
            await handler.handleStartScan(clientId2, { type: MESSAGE_TYPES.START_SCAN });

            // Stop scan for first client
            await handler.handleStopScan(clientId);

            expect(bleService.removeListener).toHaveBeenCalled();
            expect(bleService.stopScan).not.toHaveBeenCalled();
        });
    });

    describe('handleClientDisconnect', () => {
        it('should clean up scan when client disconnects', async () => {
            // Start a scan
            await handler.handleStartScan(clientId, { type: MESSAGE_TYPES.START_SCAN });
            
            // Simulate disconnect
            await handler.handleClientDisconnect(clientId);

            expect(bleService.removeListener).toHaveBeenCalled();
            expect(bleService.stopScan).toHaveBeenCalled();
        });

        it('should handle disconnect for client without active scan', async () => {
            await handler.handleClientDisconnect(clientId);
            expect(logger.error).not.toHaveBeenCalled();
        });
    });
}); 