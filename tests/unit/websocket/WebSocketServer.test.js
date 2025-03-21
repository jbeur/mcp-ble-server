const WebSocket = require('ws');
const { WebSocketServer } = require('../../../src/websocket/WebSocketServer');
const { logger } = require('../../../src/utils/logger');
const { metrics } = require('../../../src/utils/metrics');
const { HandlerFactory } = require('../../../src/mcp/handlers/HandlerFactory');
const { BLEService } = require('../../../src/ble/BLEService');

// Mock dependencies
jest.mock('ws');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics', () => ({
    metrics: {
        increment: jest.fn()
    }
}));

// Mock BLEService
jest.mock('../../../src/ble/BLEService', () => ({
    BLEService: jest.fn().mockImplementation(() => ({
        startScan: jest.fn().mockResolvedValue(undefined),
        stopScan: jest.fn().mockResolvedValue(undefined),
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        removeListener: jest.fn()
    }))
}));

// Mock HandlerFactory
jest.mock('../../../src/mcp/handlers/HandlerFactory', () => ({
    HandlerFactory: jest.fn().mockImplementation(() => ({
        handleMessage: jest.fn().mockResolvedValue(undefined),
        handleClientDisconnect: jest.fn()
    }))
}));

describe('WebSocketServer', () => {
    let server;
    let config;
    let mockWs;
    let mockClient;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Create test configuration
        config = {
            port: 8080,
            version: '1.0.0'
        };

        // Create mock WebSocket client
        mockClient = {
            send: jest.fn(),
            close: jest.fn(),
            on: jest.fn()
        };

        // Create mock WebSocket server
        mockWs = {
            on: jest.fn(),
            close: jest.fn()
        };

        // Mock WebSocket.Server
        WebSocket.Server.mockImplementation(() => mockWs);

        // Create server instance
        server = new WebSocketServer(config);
    });

    describe('start', () => {
        it('should start the WebSocket server successfully', () => {
            server.start();

            expect(WebSocket.Server).toHaveBeenCalledWith({ port: config.port });
            expect(mockWs.on).toHaveBeenCalledWith('connection', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(metrics.increment).toHaveBeenCalledWith('websocket.server.start');
            expect(logger.info).toHaveBeenCalledWith('WebSocket server started successfully');
        });

        it('should handle errors when starting the server', () => {
            const error = new Error('Failed to start server');
            WebSocket.Server.mockImplementationOnce(() => {
                throw error;
            });

            expect(() => server.start()).toThrow(error);
            expect(metrics.increment).toHaveBeenCalledWith('websocket.server.start.error');
            expect(logger.error).toHaveBeenCalledWith('Failed to start WebSocket server', { error });
        });
    });

    describe('stop', () => {
        beforeEach(() => {
            // Add a mock client
            server.clients.set('test-client', mockClient);
            server.start();
        });

        it('should stop the WebSocket server and close all connections', () => {
            server.stop();

            expect(mockClient.close).toHaveBeenCalled();
            expect(server.clients.size).toBe(0);
            expect(mockWs.close).toHaveBeenCalled();
            expect(metrics.increment).toHaveBeenCalledWith('websocket.server.stop');
            expect(logger.info).toHaveBeenCalledWith('WebSocket server stopped successfully');
        });

        it('should handle errors when stopping the server', () => {
            const error = new Error('Failed to stop server');
            mockWs.close.mockImplementationOnce(() => {
                throw error;
            });

            expect(() => server.stop()).toThrow(error);
            expect(metrics.increment).toHaveBeenCalledWith('websocket.server.stop.error');
            expect(logger.error).toHaveBeenCalledWith('Failed to stop WebSocket server', { error });
        });
    });

    describe('handleConnection', () => {
        beforeEach(() => {
            server.start();
        });

        it('should handle new client connections', () => {
            // Simulate connection event
            const connectionHandler = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionHandler(mockClient);

            expect(server.clients.size).toBe(1);
            expect(mockClient.on).toHaveBeenCalledWith('message', expect.any(Function));
            expect(mockClient.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockClient.send).toHaveBeenCalledWith(expect.stringContaining('WELCOME'));
            expect(metrics.increment).toHaveBeenCalledWith('websocket.client.connect');
        });
    });

    describe('handleMessage', () => {
        let messageHandler;
        let generatedClientId;
        const message = { type: 'TEST', params: {} };

        beforeEach(() => {
            server.start();

            // Get connection handler and simulate connection
            const connectionHandler = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionHandler(mockClient);

            // Get the generated client ID from the welcome message
            const welcomeMessage = JSON.parse(mockClient.send.mock.calls[0][0]);
            generatedClientId = welcomeMessage.params.clientId;

            // Get message handler
            messageHandler = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];

            // Reset mock calls after setup
            jest.clearAllMocks();
        });

        it('should handle valid messages', () => {
            messageHandler(JSON.stringify(message));

            expect(server.handlerFactory.handleMessage).toHaveBeenCalledWith(generatedClientId, message);
            expect(metrics.increment).toHaveBeenCalledWith('websocket.message.received');
        });

        it('should handle invalid message format', () => {
            messageHandler('invalid json');

            expect(mockClient.send).toHaveBeenCalledWith(expect.stringContaining('ERROR'));
            expect(metrics.increment).toHaveBeenCalledWith('websocket.message.error');
        });

        it('should handle handler errors', async () => {
            const error = new Error('Handler error');
            server.handlerFactory.handleMessage.mockRejectedValueOnce(error);

            await messageHandler(JSON.stringify(message));

            const errorMessage = mockClient.send.mock.calls[0][0];
            expect(errorMessage).toContain('ERROR');
            expect(metrics.increment).toHaveBeenCalledWith('websocket.handler.error');
        });
    });

    describe('handleClientDisconnect', () => {
        const clientId = 'test-client';

        beforeEach(() => {
            server.start();
            server.clients.set(clientId, mockClient);
        });

        it('should handle client disconnection', () => {
            server.handleClientDisconnect(clientId);

            expect(server.clients.has(clientId)).toBe(false);
            expect(server.handlerFactory.handleClientDisconnect).toHaveBeenCalledWith(clientId);
            expect(metrics.increment).toHaveBeenCalledWith('websocket.client.disconnect');
        });
    });

    describe('sendToClient', () => {
        const clientId = 'test-client';
        const message = { type: 'TEST', params: {} };

        beforeEach(() => {
            server.start();
            server.clients.set(clientId, mockClient);
        });

        it('should send message to client', () => {
            server.sendToClient(clientId, message);

            expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify(message));
            expect(metrics.increment).toHaveBeenCalledWith('websocket.message.sent');
        });

        it('should handle sending to non-existent client', () => {
            server.clients.delete(clientId);

            server.sendToClient(clientId, message);

            expect(logger.error).toHaveBeenCalledWith(
                `Failed to send message to client ${clientId}`,
                expect.any(Object)
            );
            expect(metrics.increment).toHaveBeenCalledWith('websocket.message.send.error');
        });
    });
}); 