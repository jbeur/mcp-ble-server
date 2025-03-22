const WebSocketServer = require('../../src/mcp/server/WebSocketServer');
const { logger } = require('../../src/utils/logger');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../src/mcp/protocol/messages');
const WebSocketTestHelper = require('../helpers/WebSocketTestHelper');

const TEST_PORT = 8083;
const SERVER_STARTUP_TIMEOUT = 5000;
const SERVER_SHUTDOWN_TIMEOUT = 5000;
const TEST_TIMEOUT = 30000;
const VALID_API_KEY = 'valid-api-key';
const TEST_CONFIG = {
    port: TEST_PORT,
    maxConnections: 100,
    messageQueueSize: 1000,
    maxMessageSize: 1024 * 1024,
    auth: {
        enabled: true,
        apiKeys: [VALID_API_KEY],
        jwtSecret: 'test-secret',
        sessionDuration: 3600,
        rateLimit: {
            windowMs: 60000,
            maxRequests: 5
        }
    }
};

let server;
let activeConnections = [];

const ensureServerStopped = async () => {
    if (server) {
        try {
            await server.stop();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
            server = null;
        } catch (error) {
            logger.error('Error stopping server:', error);
        }
    }
};

const cleanupConnections = async () => {
    if (activeConnections.length === 0) return;
    
    const closePromises = activeConnections.map(async (ws) => {
        try {
            await ws.close();
        } catch (error) {
            logger.error('Error closing connection:', error);
        }
    });
    
    await Promise.all(closePromises);
    activeConnections = [];
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for cleanup
};

describe('Security Tests', () => {
    beforeAll(async () => {
        await ensureServerStopped();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for port to be released

        server = new WebSocketServer(TEST_CONFIG);
        await server.start();
    }, SERVER_STARTUP_TIMEOUT);

    beforeEach(async () => {
        await cleanupConnections();
    });

    afterEach(async () => {
        await cleanupConnections();
    });

    afterAll(async () => {
        await cleanupConnections();
        await ensureServerStopped();
    }, SERVER_SHUTDOWN_TIMEOUT);

    describe('Authentication Security', () => {
        it('should reject invalid API keys', async () => {
            const ws = new WebSocketTestHelper(TEST_PORT);
            activeConnections.push(ws);

            await ws.connect();
            const ack = await ws.waitForResponse(MESSAGE_TYPES.CONNECTION_ACK);
            expect(ack.type).toBe(MESSAGE_TYPES.CONNECTION_ACK);

            await ws.send({
                type: MESSAGE_TYPES.AUTHENTICATE,
                data: { apiKey: 'invalid_key' }
            });

            const response = await ws.waitForResponse(MESSAGE_TYPES.ERROR);
            expect(response.type).toBe(MESSAGE_TYPES.ERROR);
            expect(response.code).toBe(ERROR_CODES.INVALID_API_KEY);

            await ws.close();
        }, TEST_TIMEOUT);

        it('should validate session tokens', async () => {
            const ws = new WebSocketTestHelper(TEST_PORT);
            activeConnections.push(ws);

            await ws.connect();
            const ack = await ws.waitForResponse(MESSAGE_TYPES.CONNECTION_ACK);
            expect(ack.type).toBe(MESSAGE_TYPES.CONNECTION_ACK);

            await ws.send({
                type: MESSAGE_TYPES.AUTHENTICATE,
                data: { apiKey: VALID_API_KEY }
            });

            const authResponse = await ws.waitForResponse(MESSAGE_TYPES.AUTHENTICATED);
            expect(authResponse.type).toBe(MESSAGE_TYPES.AUTHENTICATED);
            expect(authResponse.data.token).toBeDefined();
            const token = authResponse.data.token;

            // Test invalid token
            await ws.send({
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { token: 'invalid-token' }
            });

            const invalidResponse = await ws.waitForResponse(MESSAGE_TYPES.ERROR);
            expect(invalidResponse.type).toBe(MESSAGE_TYPES.ERROR);
            expect(invalidResponse.code).toBe(ERROR_CODES.INVALID_TOKEN);

            // Test valid token
            await ws.send({
                type: MESSAGE_TYPES.SESSION_VALID,
                data: { token }
            });

            const validResponse = await ws.waitForResponse(MESSAGE_TYPES.SESSION_VALID);
            expect(validResponse.type).toBe(MESSAGE_TYPES.SESSION_VALID);
            expect(validResponse.data.valid).toBe(true);

            await ws.close();
        }, TEST_TIMEOUT);
    });

    describe('Input Validation Security', () => {
        it('should reject malformed messages', async () => {
            const ws = new WebSocketTestHelper(TEST_PORT);
            activeConnections.push(ws);

            await ws.connect();
            const ack = await ws.waitForResponse(MESSAGE_TYPES.CONNECTION_ACK);
            expect(ack.type).toBe(MESSAGE_TYPES.CONNECTION_ACK);

            // Authenticate first
            await ws.send({
                type: MESSAGE_TYPES.AUTHENTICATE,
                data: { apiKey: VALID_API_KEY }
            });
            await ws.waitForResponse(MESSAGE_TYPES.AUTHENTICATED);

            // Test invalid messages
            await ws.send('invalid json');
            const response1 = await ws.waitForResponse(MESSAGE_TYPES.ERROR);
            expect(response1.type).toBe(MESSAGE_TYPES.ERROR);
            expect(response1.code).toBe(ERROR_CODES.INVALID_MESSAGE);

            await ws.send(JSON.stringify({ data: {} }));
            const response2 = await ws.waitForResponse(MESSAGE_TYPES.ERROR);
            expect(response2.type).toBe(MESSAGE_TYPES.ERROR);
            expect(response2.code).toBe(ERROR_CODES.INVALID_MESSAGE_TYPE);

            await ws.close();
        }, TEST_TIMEOUT);
    });
}); 