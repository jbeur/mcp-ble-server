const WebSocket = require('ws');
const WebSocketServer = require('../../../../src/mcp/server/WebSocketServer');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');
const MessageBatcher = require('../../../../src/mcp/server/MessageBatcher');
const AuthService = require('../../../../src/auth/AuthService');
const { MESSAGE_TYPES, ERROR_CODES, MessageBuilder } = require('../../../../src/mcp/protocol/messages');

// Mock WebSocket
jest.mock('ws', () => {
    const WebSocket = jest.fn();
    WebSocket.Server = jest.fn();
    return WebSocket;
});

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
}));

// Mock metrics
jest.mock('../../../../src/utils/metrics', () => ({
    metrics: {
        mcpAverageBatchSize: { get: jest.fn(), set: jest.fn() },
        mcpMaxBatchSize: { get: jest.fn(), set: jest.fn() },
        mcpMinBatchSize: { get: jest.fn(), set: jest.fn() },
        mcpAverageLatency: { get: jest.fn(), set: jest.fn() },
        mcpMaxLatency: { get: jest.fn(), set: jest.fn() },
        mcpMinLatency: { get: jest.fn(), set: jest.fn() },
        mcpCompressionRatio: { get: jest.fn(), set: jest.fn() },
        mcpBytesSavedTotal: { get: jest.fn(), set: jest.fn() }
    }
}));

describe('WebSocketServer', () => {
    let server;
    let mockWs;
    let mockClient;
    let mockConfig;
    let mockAuthService;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Set up WebSocket server mock
        mockWs = {
            on: jest.fn(),
            close: jest.fn((callback) => callback()),
            clients: new Map()
        };
        WebSocket.Server.mockImplementation(() => mockWs);

        // Set up mock client
        mockClient = {
            on: jest.fn(),
            send: jest.fn(),
            readyState: WebSocket.OPEN,
            close: jest.fn()
        };

        // Set up mock config
        mockConfig = {
            port: 8080,
            maxConnections: 100,
            messageQueueSize: 1000,
            maxMessageSize: 1024 * 1024,
            auth: {
                enabled: true,
                apiKeys: ['valid-api-key'],
                jwtSecret: 'test-secret',
                sessionDuration: 3600,
                rateLimit: {
                    windowMs: 60000,
                    maxRequests: 5
                }
            },
            batching: {
                enabled: true,
                batchSize: 5,
                batchTimeout: 100,
                compression: {
                    enabled: true,
                    minSize: 100,
                    level: 6,
                    priorityThresholds: {
                        high: 50,
                        medium: 100,
                        low: 200
                    }
                },
                timeouts: {
                    high: 50,
                    medium: 100,
                    low: 200
                },
                analytics: {
                    enabled: true,
                    interval: 100,
                    metrics: {
                        batchSizes: true,
                        latencies: true,
                        compression: true,
                        priorities: true
                    }
                }
            }
        };

        // Set up WebSocket constants
        WebSocket.CONNECTING = 0;
        WebSocket.OPEN = 1;
        WebSocket.CLOSING = 2;
        WebSocket.CLOSED = 3;

        mockAuthService = {
            validateSession: jest.fn().mockResolvedValue(true),
            removeSession: jest.fn().mockResolvedValue(true),
            authenticate: jest.fn().mockResolvedValue({ token: 'test-token' }),
            stop: jest.fn().mockResolvedValue(undefined)
        };

        server = new WebSocketServer(mockConfig, mockAuthService);
        server.authService = mockAuthService;
    });

    afterEach(async () => {
        if (server) {
            await server.stop();
        }
    });

    describe('start', () => {
        it('should start the WebSocket server successfully', async () => {
            await server.start();
            expect(WebSocket.Server).toHaveBeenCalledWith(expect.any(Object));
            expect(mockWs.on).toHaveBeenCalledWith('connection', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(logger.info).toHaveBeenCalledWith('WebSocket server started', expect.any(Object));
            expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(1);
        });

        it('should handle server start errors', async () => {
            const error = new Error('Failed to start server');
            WebSocket.Server.mockImplementationOnce(() => {
                throw error;
            });

            await expect(server.start()).rejects.toThrow('Failed to start server');
            expect(logger.error).toHaveBeenCalledWith('Failed to start WebSocket server', { error });
            expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(0);
        });
    });

    describe('stop', () => {
        it('should stop the WebSocket server successfully', async () => {
            server.wss = mockWs;
            await server.stop();
            expect(mockWs.close).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('WebSocket server stopped', expect.any(Object));
            expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(0);
        });

        it('should handle server stop errors', async () => {
            const error = new Error('Failed to stop server');
            mockWs.close.mockImplementationOnce((callback) => {
                callback(error);
            });

            server.wss = mockWs;
            await expect(server.stop()).rejects.toThrow('Failed to stop server');
            expect(logger.error).toHaveBeenCalledWith('Error stopping WebSocket server', { error });
        });
    });

    describe('handleConnection', () => {
        it('should handle new client connections', () => {
            const mockWs = {
                on: jest.fn(),
                send: jest.fn(),
                readyState: WebSocket.OPEN,
                close: jest.fn()
            };

            server.handleConnection(mockWs);

            const clientId = Array.from(server.clients.keys())[0];
            expect(server.clients.size).toBe(1);
            expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(logger.info).toHaveBeenCalledWith('New client connected', expect.any(Object));
            expect(metrics.mcpConnections.inc).toHaveBeenCalled();

            // Verify the connection acknowledgment message
            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('CONNECTION_ACK');
            expect(sentMessage.data.clientId).toBe(clientId);
            expect(sentMessage.timestamp).toBeDefined();
        });
    });

    describe('handleMessage', () => {
        it('should handle valid JSON messages', () => {
            const clientId = 'test-client';
            const message = Buffer.from(JSON.stringify({ type: MESSAGE_TYPES.AUTHENTICATE, data: { apiKey: 'valid-api-key' } }));
            server.clients.set(clientId, { ws: mockClient, authenticated: false });

            server.handleMessage(clientId, message);

            expect(logger.debug).toHaveBeenCalledWith('Received message', expect.any(Object));
            expect(logger.debug).toHaveBeenCalledWith('Handling authentication', expect.any(Object));
        });

        it('should handle invalid JSON messages', () => {
            const clientId = 'test-client';
            const invalidMessage = 'invalid json';
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            server.handleMessage(clientId, invalidMessage);

            expect(mockWs.send).toHaveBeenCalled();
            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe('INVALID_MESSAGE');
            expect(sentMessage.timestamp).toBeDefined();
            // Error metrics are not incremented for invalid messages
        });

        it('should handle messages that are too large', () => {
            const clientId = 'test-client';
            const largeMessage = Buffer.alloc(server.config.maxMessageSize + 1);
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            server.handleMessage(clientId, largeMessage);

            expect(mockWs.send).toHaveBeenCalled();
            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe('MESSAGE_TOO_LARGE');
            expect(sentMessage.timestamp).toBeDefined();
            // Error metrics are not incremented for oversized messages
        });
    });

    describe('handleDisconnect', () => {
        it('should handle client disconnections', () => {
            const clientId = 'test-client';
            server.clients.set(clientId, { ws: mockClient });

            server.handleDisconnect(clientId);

            expect(server.clients.has(clientId)).toBeFalsy();
            expect(logger.info).toHaveBeenCalledWith('Client disconnected', expect.any(Object));
            expect(metrics.mcpConnections.dec).toHaveBeenCalled();
        });
    });

    describe('sendMessage', () => {
        it('should send messages to connected clients', () => {
            const clientId = 'test-client';
            const message = { type: 'test' };
            server.clients.set(clientId, { ws: mockClient });

            server.sendMessage(clientId, message);

            expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify(message));
            expect(metrics.mcpMessagesSent.inc).toHaveBeenCalled();
        });

        it('should handle sending to disconnected clients', () => {
            const clientId = 'test-client';
            const message = { type: 'test' };

            server.sendMessage(clientId, message);

            expect(logger.warn).toHaveBeenCalledWith('Client not connected, dropping message', expect.any(Object));
        });
    });

    describe('handleClientError', () => {
        it('should handle client errors and disconnect the client', () => {
            const clientId = 'test-client';
            const error = new Error('Test error');
            server.clients.set(clientId, { ws: mockClient });

            server.handleClientError(clientId, error);

            expect(logger.error).toHaveBeenCalledWith('Client error', expect.any(Object));
            expect(server.clients.has(clientId)).toBeFalsy();
            expect(metrics.mcpConnections.dec).toHaveBeenCalled();
        });

        it('should handle errors during client error handling', () => {
            const clientId = 'test-client';
            const error = new Error('Test error');
            server.clients.set(clientId, { ws: mockClient });

            // Mock handleDisconnect to throw an error
            const originalHandleDisconnect = server.handleDisconnect;
            server.handleDisconnect = jest.fn().mockImplementation(() => {
                throw new Error('Disconnect error');
            });

            server.handleClientError(clientId, error);

            expect(logger.error).toHaveBeenCalledWith('Error handling client error', expect.any(Object));
            server.handleDisconnect = originalHandleDisconnect;
        });
    });

    describe('handleError', () => {
        it('should handle WebSocket server errors', () => {
            const error = new Error('Server error');
            error.code = 'TEST_ERROR';

            server.handleError(error);

            expect(logger.error).toHaveBeenCalledWith('WebSocket server error', expect.any(Object));
            expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: 'TEST_ERROR' });
        });

        it('should use default error type when code is not provided', () => {
            const error = new Error('Server error');

            server.handleError(error);

            expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: 'AUTH_ERROR' });
        });
    });

    describe('handleBatch', () => {
        it('should handle batch messages successfully', () => {
            const clientId = 'test-client';
            const messages = [{ type: 'test1' }, { type: 'test2' }];
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            server.handleBatch(clientId, messages);

            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
                type: MESSAGE_TYPES.BATCH,
                data: { messages }
            }));
            expect(metrics.mcpMessagesSent.inc).toHaveBeenCalledWith(2);
        });

        it('should handle batch messages for disconnected clients', () => {
            const clientId = 'test-client';
            const messages = [{ type: 'test1' }];

            server.handleBatch(clientId, messages);

            expect(logger.warn).toHaveBeenCalledWith('Client not connected, dropping batch', expect.any(Object));
        });

        it('should handle errors during batch message handling', () => {
            const clientId = 'test-client';
            const messages = [{ type: 'test1' }];
            const mockWs = {
                send: jest.fn().mockImplementation(() => {
                    throw new Error('Send error');
                }),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            server.handleBatch(clientId, messages);

            expect(logger.error).toHaveBeenCalledWith('Error sending batch message:', expect.any(Object));
        });
    });

    describe('sendMessage', () => {
        it('should handle errors during message sending', () => {
            const clientId = 'test-client';
            const message = { type: 'test' };
            const mockWs = {
                send: jest.fn().mockImplementation(() => {
                    throw new Error('Send error');
                }),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            server.sendMessage(clientId, message);

            expect(logger.error).toHaveBeenCalledWith('Error sending message:', expect.any(Object));
        });

        it('should use message batcher when enabled', () => {
            const clientId = 'test-client';
            const message = { type: 'test' };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });
            server.config.batching.enabled = true;
            server.messageBatcher = {
                addMessage: jest.fn()
            };

            server.sendMessage(clientId, message);

            expect(server.messageBatcher.addMessage).toHaveBeenCalledWith(clientId, message);
            expect(mockWs.send).not.toHaveBeenCalled();
        });
    });

    describe('processMessage', () => {
        it('should handle session validation messages', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { token: 'valid-token' }
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true });
            server.authService.validateSession = jest.fn().mockResolvedValue(true);

            await server.processMessage(clientId, message);

            expect(server.authService.validateSession).toHaveBeenCalledWith('valid-token');
            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { valid: true }
            }));
        });

        it('should handle invalid session tokens', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { token: 'invalid-token' }
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true });
            server.authService.validateSession = jest.fn().mockResolvedValue(false);

            await server.processMessage(clientId, message);

            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe(ERROR_CODES.INVALID_TOKEN);
            expect(sentMessage.message).toBeDefined();
            expect(sentMessage.timestamp).toBeDefined();
        });

        it('should handle session validation errors', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { token: 'error-token' }
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true });
            server.authService.validateSession = jest.fn().mockRejectedValue(new Error('Validation error'));

            await server.processMessage(clientId, message);

            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe(ERROR_CODES.INVALID_TOKEN);
            expect(sentMessage.message).toBeDefined();
            expect(sentMessage.timestamp).toBeDefined();
        });

        it('should handle logout messages', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.LOGOUT
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { 
                ws: mockWs, 
                authenticated: true, 
                apiKey: 'test-key' 
            });

            await server.processMessage(clientId, message);

            expect(mockAuthService.removeSession).toHaveBeenCalledWith('test-key');
            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
                type: MESSAGE_TYPES.LOGGED_OUT,
                data: { success: true }
            }));
            expect(server.clients.has(clientId)).toBeFalsy();
        });

        it('should handle successful logout', async () => {
            const clientId = 'test-client';
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { 
                ws: mockWs, 
                authenticated: true, 
                apiKey: 'test-key' 
            });

            await server.handleLogout(clientId);

            expect(mockAuthService.removeSession).toHaveBeenCalledWith('test-key');
            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
                type: MESSAGE_TYPES.LOGGED_OUT,
                data: { success: true }
            }));
            expect(server.clients.has(clientId)).toBeFalsy();
            expect(metrics.mcpConnections.dec).toHaveBeenCalled();
        });

        it('should handle logout errors', async () => {
            const clientId = 'test-client';
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { 
                ws: mockWs, 
                authenticated: true, 
                apiKey: 'test-key' 
            });

            mockAuthService.removeSession.mockRejectedValueOnce(new Error('Test error'));

            await server.handleLogout(clientId);

            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe(MESSAGE_TYPES.ERROR);
            expect(sentMessage.code).toBe(ERROR_CODES.PROCESSING_ERROR);
            expect(sentMessage.message).toBe('');
            expect(sentMessage.timestamp).toBeDefined();
            expect(server.clients.has(clientId)).toBeTruthy();
        });

        it('should handle unknown message types', async () => {
            const clientId = 'test-client';
            const message = {
                type: 'UNKNOWN_TYPE'
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs });

            await server.processMessage(clientId, message);

            expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('NOT_AUTHENTICATED'));
        });

        it('should handle missing message data', async () => {
            const clientId = 'test-client';
            const message = {
                type: MESSAGE_TYPES.SESSION_VALID
            };
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true });

            await server.processMessage(clientId, message);

            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe(ERROR_CODES.INVALID_TOKEN);
            expect(sentMessage.message).toBeDefined();
            expect(sentMessage.timestamp).toBeDefined();
        });
    });

    describe('handleLogout', () => {
        it('should handle successful logout', async () => {
            const clientId = 'test-client';
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true, apiKey: 'test-key' });

            // Mock sendMessage to directly send through mockWs
            const originalSendMessage = server.sendMessage;
            server.sendMessage = jest.fn().mockImplementation((cid, msg) => {
                mockWs.send(JSON.stringify(msg));
            });

            await server.handleLogout(clientId);

            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
                type: MESSAGE_TYPES.LOGGED_OUT,
                data: { success: true }
            }));
            expect(server.clients.has(clientId)).toBeFalsy();
            expect(metrics.mcpConnections.dec).toHaveBeenCalled();

            // Restore original sendMessage
            server.sendMessage = originalSendMessage;
        });

        it('should handle logout errors', async () => {
            const clientId = 'test-client';
            const mockWs = {
                send: jest.fn(),
                readyState: WebSocket.OPEN
            };
            server.clients.set(clientId, { ws: mockWs, authenticated: true, apiKey: 'test-key' });
            server.authService.removeSession = jest.fn().mockImplementation(() => {
                throw new Error('Logout error');
            });

            await server.handleLogout(clientId);

            expect(logger.error).toHaveBeenCalledWith('Error handling logout', expect.any(Object));
            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(sentMessage.type).toBe('ERROR');
            expect(sentMessage.code).toBe(ERROR_CODES.PROCESSING_ERROR);
            expect(sentMessage.message).toBeDefined();
            expect(sentMessage.timestamp).toBeDefined();
        });
    });

    describe('batch compression', () => {
        it('should compress large batches', async () => {
            // Start server
            await server.start();

            // Simulate client connection
            const connectionCallback = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionCallback(mockClient);

            // Send multiple messages to trigger batch compression
            const messages = Array(10).fill({ type: 'test', data: 'large data' });
            for (const msg of messages) {
                const messageCallback = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];
                messageCallback(JSON.stringify(msg));
            }

            // Wait for batch to be processed
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify batch was sent with compression
            const batchCall = mockClient.send.mock.calls.find(call => {
                const parsedMessage = JSON.parse(call[0]);
                return parsedMessage.type === MESSAGE_TYPES.BATCH && parsedMessage.data.compressed;
            });

            expect(batchCall).toBeDefined();
            const batchMessage = JSON.parse(batchCall[0]);
            expect(batchMessage.data.compressed).toBe(true);
            expect(batchMessage.data.algorithm).toBe('gzip');
            expect(batchMessage.data.originalSize).toBeGreaterThan(batchMessage.data.compressedSize);
        });

        it('should not compress small batches', async () => {
            // Start server
            await server.start();

            // Simulate client connection
            const connectionCallback = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionCallback(mockClient);

            // Send a small message
            const msg = { type: 'test', data: 'small' };
            const messageCallback = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];
            messageCallback(JSON.stringify(msg));

            // Wait for batch to be processed
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify batch was sent without compression
            const batchCall = mockClient.send.mock.calls.find(call => {
                const parsedMessage = JSON.parse(call[0]);
                return parsedMessage.type === MESSAGE_TYPES.BATCH;
            });

            expect(batchCall).toBeDefined();
            const batchMessage = JSON.parse(batchCall[0]);
            expect(batchMessage.data.compressed).toBe(false);
        });
    });

    describe('analytics', () => {
        it('should handle analytics events from message batcher', async () => {
            // Start server
            await server.start();

            // Simulate client connection
            const connectionCallback = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionCallback(mockClient);

            // Send messages to generate analytics
            const messages = Array(10).fill({ type: 'test', data: 'data' });
            for (const msg of messages) {
                const messageCallback = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];
                messageCallback(JSON.stringify(msg));
            }

            // Wait for analytics to be processed
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify analytics were logged
            const logCalls = require('../../../../src/utils/logger').info.mock.calls;
            const analyticsLog = logCalls.find(call => 
                call[0] === 'Message batching analytics update:'
            );

            expect(analyticsLog).toBeDefined();
            const analytics = analyticsLog[1];
            expect(analytics.batchSizes).toBeDefined();
            expect(analytics.latencies).toBeDefined();
            expect(analytics.compression).toBeDefined();
            expect(analytics.priorityDistribution).toBeDefined();
        });

        it('should update Prometheus metrics with analytics data', async () => {
            // Start server
            await server.start();

            // Simulate client connection
            const connectionCallback = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionCallback(mockClient);

            // Send messages to generate analytics
            const messages = Array(10).fill({ type: 'test', data: 'data' });
            for (const msg of messages) {
                const messageCallback = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];
                messageCallback(JSON.stringify(msg));
            }

            // Wait for analytics to be processed
            await new Promise(resolve => setTimeout(resolve, 150));

            // Verify metrics were updated
            const metrics = require('../../../../src/utils/metrics').metrics;
            expect(metrics.mcpAverageBatchSize.get).toHaveBeenCalled();
            expect(metrics.mcpMaxBatchSize.get).toHaveBeenCalled();
            expect(metrics.mcpMinBatchSize.get).toHaveBeenCalled();
            expect(metrics.mcpAverageLatency.get).toHaveBeenCalled();
            expect(metrics.mcpMaxLatency.get).toHaveBeenCalled();
            expect(metrics.mcpMinLatency.get).toHaveBeenCalled();
            expect(metrics.mcpCompressionRatio.get).toHaveBeenCalled();
            expect(metrics.mcpBytesSavedTotal.get).toHaveBeenCalled();
        });
    });

    describe('priority-based timeouts', () => {
        it('should respect priority-based timeouts for different message types', async () => {
            // Start server
            await server.start();

            // Simulate client connection
            const connectionCallback = mockWs.on.mock.calls.find(call => call[0] === 'connection')[1];
            connectionCallback(mockClient);

            // Send high priority message
            const highMsg = { type: 'test', data: 'high', priority: 'high' };
            const messageCallback = mockClient.on.mock.calls.find(call => call[0] === 'message')[1];
            messageCallback(JSON.stringify(highMsg));

            // Wait for high priority timeout
            await new Promise(resolve => setTimeout(resolve, 60));

            // Verify high priority batch was sent
            const highBatchCall = mockClient.send.mock.calls.find(call => {
                const parsedMessage = JSON.parse(call[0]);
                return parsedMessage.type === MESSAGE_TYPES.BATCH;
            });
            expect(highBatchCall).toBeDefined();

            // Send medium priority message
            const mediumMsg = { type: 'test', data: 'medium', priority: 'medium' };
            messageCallback(JSON.stringify(mediumMsg));

            // Wait for medium priority timeout
            await new Promise(resolve => setTimeout(resolve, 110));

            // Verify medium priority batch was sent
            const mediumBatchCall = mockClient.send.mock.calls.find(call => {
                const parsedMessage = JSON.parse(call[0]);
                return parsedMessage.type === MESSAGE_TYPES.BATCH && 
                       parsedMessage.data.messages[0].data === 'medium';
            });
            expect(mediumBatchCall).toBeDefined();

            // Send low priority message
            const lowMsg = { type: 'test', data: 'low', priority: 'low' };
            messageCallback(JSON.stringify(lowMsg));

            // Wait for low priority timeout
            await new Promise(resolve => setTimeout(resolve, 210));

            // Verify low priority batch was sent
            const lowBatchCall = mockClient.send.mock.calls.find(call => {
                const parsedMessage = JSON.parse(call[0]);
                return parsedMessage.type === MESSAGE_TYPES.BATCH && 
                       parsedMessage.data.messages[0].data === 'low';
            });
            expect(lowBatchCall).toBeDefined();
        });
    });
}); 