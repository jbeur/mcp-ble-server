const { ConnectionHandler } = require('../../../../src/mcp/handlers/ConnectionHandler');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock message types and error codes
jest.mock('../../../../src/mcp/protocol/messages', () => ({
    MESSAGE_TYPES: {
        CONNECT: 'CONNECT',
        DISCONNECT: 'DISCONNECT',
        CONNECTED: 'CONNECTED',
        DISCONNECTED: 'DISCONNECTED'
    },
    ERROR_CODES: {
        INVALID_MESSAGE_TYPE: 'INVALID_MESSAGE_TYPE',
        ALREADY_CONNECTED: 'ALREADY_CONNECTED',
        NOT_CONNECTED: 'NOT_CONNECTED',
        INVALID_PARAMS: 'INVALID_PARAMS'
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
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
            removeListener: jest.fn()
        }))
    };
});

const { BLEService } = require('../../../../src/ble/BLEService');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../../../src/mcp/protocol/messages');

describe('ConnectionHandler', () => {
    let handler;
    let bleService;
    const clientId = 'test-client-1';
    const deviceId = 'test-device-1';

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create fresh instances
        bleService = new BLEService();
        handler = new ConnectionHandler(bleService);
        
        // Mock sendToClient method
        handler.sendToClient = jest.fn();
    });

    describe('processMessage', () => {
        it('should handle CONNECT message', async () => {
            const message = { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            };
            await handler.processMessage(clientId, message);
            expect(bleService.connect).toHaveBeenCalledWith(deviceId);
        });

        it('should handle DISCONNECT message', async () => {
            // First connect to a device
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });
            
            // Then disconnect
            const message = { type: MESSAGE_TYPES.DISCONNECT };
            await handler.processMessage(clientId, message);
            
            expect(bleService.disconnect).toHaveBeenCalledWith(deviceId);
        });

        it('should throw error for invalid message type', async () => {
            const message = { type: 'INVALID_TYPE' };
            await expect(handler.processMessage(clientId, message))
                .rejects
                .toThrow('Unsupported message type: INVALID_TYPE');
        });
    });

    describe('handleConnect', () => {
        it('should connect to device and set up event handlers', async () => {
            const message = {
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            };

            await handler.handleConnect(clientId, message);

            expect(bleService.connect).toHaveBeenCalledWith(deviceId);
            expect(bleService.on).toHaveBeenCalledWith('connected', expect.any(Function));
            expect(bleService.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
            expect(metrics.increment).toHaveBeenCalledWith('connection.connect.success');
        });

        it('should handle connection events', async () => {
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });

            // Get the connection handler that was registered
            const connectionHandler = bleService.on.mock.calls[0][1];

            // Simulate connection
            const mockDevice = {
                id: deviceId,
                name: 'Test Device',
                address: '00:11:22:33:44:55'
            };

            connectionHandler(mockDevice);

            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.CONNECTED,
                params: {
                    deviceId: mockDevice.id,
                    name: mockDevice.name,
                    address: mockDevice.address
                }
            });
        });

        it('should handle disconnection events', async () => {
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });

            // Get the disconnection handler that was registered
            const disconnectionHandler = bleService.on.mock.calls[1][1];

            // Simulate disconnection
            const mockDevice = { id: deviceId };
            disconnectionHandler(mockDevice);

            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.DISCONNECTED,
                params: {
                    deviceId: mockDevice.id
                }
            });
        });

        it('should throw error if already connected', async () => {
            // First connect
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });

            // Try to connect again
            await expect(handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId: 'another-device' }
            }))
                .rejects
                .toThrow('Already connected to a device');
            
            expect(metrics.increment).toHaveBeenCalledWith('connection.connect.error');
        });

        it('should throw error if deviceId is missing', async () => {
            const message = {
                type: MESSAGE_TYPES.CONNECT,
                params: {}
            };

            await expect(handler.handleConnect(clientId, message))
                .rejects
                .toThrow('Device ID is required');
            
            expect(metrics.increment).toHaveBeenCalledWith('connection.connect.error');
        });
    });

    describe('handleDisconnect', () => {
        it('should disconnect from device and clean up handlers', async () => {
            // First connect
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });
            
            // Then disconnect
            await handler.handleDisconnect(clientId);

            expect(bleService.removeListener).toHaveBeenCalledTimes(2);
            expect(bleService.disconnect).toHaveBeenCalledWith(deviceId);
            expect(handler.sendToClient).toHaveBeenCalledWith(clientId, {
                type: MESSAGE_TYPES.DISCONNECTED,
                params: { deviceId }
            });
            expect(metrics.increment).toHaveBeenCalledWith('connection.disconnect.success');
        });

        it('should throw error if not connected', async () => {
            await expect(handler.handleDisconnect(clientId))
                .rejects
                .toThrow('Not connected to any device');
            
            expect(metrics.increment).toHaveBeenCalledWith('connection.disconnect.error');
        });
    });

    describe('handleClientDisconnect', () => {
        it('should clean up connection when client disconnects', async () => {
            // First connect
            await handler.handleConnect(clientId, { 
                type: MESSAGE_TYPES.CONNECT,
                params: { deviceId }
            });
            
            // Simulate disconnect
            await handler.handleClientDisconnect(clientId);

            expect(bleService.removeListener).toHaveBeenCalledTimes(2);
            expect(bleService.disconnect).toHaveBeenCalledWith(deviceId);
        });

        it('should handle disconnect for client without active connection', async () => {
            await handler.handleClientDisconnect(clientId);
            expect(logger.error).not.toHaveBeenCalled();
        });
    });
}); 