const { HandlerFactory } = require('../../../../src/mcp/handlers/HandlerFactory');
const { ScanHandler } = require('../../../../src/mcp/handlers/ScanHandler');
const { ConnectionHandler } = require('../../../../src/mcp/handlers/ConnectionHandler');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock message types and error codes
jest.mock('../../../../src/mcp/protocol/messages', () => ({
    MESSAGE_TYPES: {
        START_SCAN: 'START_SCAN',
        STOP_SCAN: 'STOP_SCAN',
        CONNECT: 'CONNECT',
        DISCONNECT: 'DISCONNECT'
    },
    ERROR_CODES: {
        INVALID_MESSAGE_TYPE: 'INVALID_MESSAGE_TYPE'
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
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
            removeListener: jest.fn()
        }))
    };
});

// Mock handlers
jest.mock('../../../../src/mcp/handlers/ScanHandler');
jest.mock('../../../../src/mcp/handlers/ConnectionHandler');

const { BLEService } = require('../../../../src/ble/BLEService');
const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');

describe('HandlerFactory', () => {
    let factory;
    let bleService;
    const clientId = 'test-client-1';
    const deviceId = 'test-device-1';

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create fresh instances
        bleService = new BLEService();
        factory = new HandlerFactory(bleService);
    });

    describe('initializeHandlers', () => {
        it('should initialize all required handlers', () => {
            expect(ScanHandler).toHaveBeenCalledTimes(2);
            expect(ConnectionHandler).toHaveBeenCalledTimes(2);
            
            // Verify handler mapping
            expect(factory.handlers.get(MESSAGE_TYPES.START_SCAN)).toBeDefined();
            expect(factory.handlers.get(MESSAGE_TYPES.STOP_SCAN)).toBeDefined();
            expect(factory.handlers.get(MESSAGE_TYPES.CONNECT)).toBeDefined();
            expect(factory.handlers.get(MESSAGE_TYPES.DISCONNECT)).toBeDefined();
        });
    });

    describe('getHandler', () => {
        it('should return handler for valid message type', () => {
            const handler = factory.getHandler(MESSAGE_TYPES.START_SCAN);
            expect(handler).toBeDefined();
            expect(handler instanceof ScanHandler).toBe(true);
        });

        it('should throw error for invalid message type', () => {
            expect(() => factory.getHandler('INVALID_TYPE'))
                .toThrow('Unsupported message type: INVALID_TYPE');
            
            expect(metrics.increment).toHaveBeenCalledWith('handler.not_found');
            expect(logger.error).toHaveBeenCalledWith(
                'No handler found for message type: INVALID_TYPE'
            );
        });
    });

    describe('handleMessage', () => {
        it('should handle valid message', async () => {
            const message = {
                type: MESSAGE_TYPES.START_SCAN,
                params: { timeout: 5000 }
            };

            // Mock handler's handleMessage method
            const mockHandler = {
                handleMessage: jest.fn().mockResolvedValue(undefined)
            };
            factory.handlers.set(MESSAGE_TYPES.START_SCAN, mockHandler);

            await factory.handleMessage(clientId, message);

            expect(mockHandler.handleMessage).toHaveBeenCalledWith(clientId, message);
            expect(metrics.increment).toHaveBeenCalledWith('message.handle.success');
        });

        it('should handle invalid message format', async () => {
            const message = {};

            await expect(factory.handleMessage(clientId, message))
                .rejects
                .toThrow('Invalid message format');
            
            expect(metrics.increment).toHaveBeenCalledWith('message.handle.error');
            expect(logger.error).toHaveBeenCalledWith(
                `Error handling message for client ${clientId}`,
                expect.any(Object)
            );
        });

        it('should handle handler errors', async () => {
            const message = {
                type: MESSAGE_TYPES.START_SCAN,
                params: { timeout: 5000 }
            };

            // Mock handler's handleMessage method to throw error
            const mockHandler = {
                handleMessage: jest.fn().mockRejectedValue(new Error('Handler error'))
            };
            factory.handlers.set(MESSAGE_TYPES.START_SCAN, mockHandler);

            await expect(factory.handleMessage(clientId, message))
                .rejects
                .toThrow('Handler error');
            
            expect(metrics.increment).toHaveBeenCalledWith('message.handle.error');
            expect(logger.error).toHaveBeenCalledWith(
                `Error handling message for client ${clientId}`,
                expect.any(Object)
            );
        });
    });

    describe('handleClientDisconnect', () => {
        it('should notify all handlers about client disconnect', () => {
            // Mock handlers
            const mockScanHandler = {
                handleClientDisconnect: jest.fn()
            };
            const mockConnectionHandler = {
                handleClientDisconnect: jest.fn()
            };

            factory.handlers.set(MESSAGE_TYPES.START_SCAN, mockScanHandler);
            factory.handlers.set(MESSAGE_TYPES.CONNECT, mockConnectionHandler);

            factory.handleClientDisconnect(clientId);

            expect(mockScanHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
            expect(mockConnectionHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
            expect(logger.debug).toHaveBeenCalledWith(
                `Handling client disconnect: ${clientId}`
            );
        });

        it('should handle handler cleanup errors', () => {
            // Mock handlers
            const mockScanHandler = {
                handleClientDisconnect: jest.fn().mockImplementation(() => {
                    throw new Error('Cleanup error');
                })
            };
            const mockConnectionHandler = {
                handleClientDisconnect: jest.fn()
            };

            factory.handlers.set(MESSAGE_TYPES.START_SCAN, mockScanHandler);
            factory.handlers.set(MESSAGE_TYPES.CONNECT, mockConnectionHandler);

            factory.handleClientDisconnect(clientId);

            expect(mockScanHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
            expect(mockConnectionHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
            expect(logger.error).toHaveBeenCalledWith(
                `Error in handler cleanup for client ${clientId}`,
                expect.any(Object)
            );
        });
    });
}); 