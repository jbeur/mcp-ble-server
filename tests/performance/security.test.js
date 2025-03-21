const WebSocket = require('ws');
const WebSocketServer = require('../../src/mcp/server/WebSocketServer');
const AuthService = require('../../src/auth/AuthService');
const { logger } = require('../../src/utils/logger');
const { metrics } = require('../../src/utils/metrics');

const TEST_PORT = 8081;
const SERVER_STARTUP_TIMEOUT = 5000;
const SERVER_SHUTDOWN_TIMEOUT = 5000;
const TEST_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 5000;

describe('Security Tests', () => {
    let server;
    let authService;
    let isServerRunning = false;

    const ensureServerStopped = async () => {
        if (server) {
            try {
                await server.stop();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error('Error stopping server:', error);
            }
        }
    };

    const waitForResponse = async (ws, timeout = RESPONSE_TIMEOUT) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Response timeout'));
            }, timeout);

            const messageHandler = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'error') {
                        clearTimeout(timer);
                        ws.removeListener('message', messageHandler);
                        resolve(msg);
                    }
                } catch (error) {
                    clearTimeout(timer);
                    ws.removeListener('message', messageHandler);
                    reject(error);
                }
            };

            ws.on('message', messageHandler);
            ws.once('close', () => {
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                resolve({ type: 'error', code: 'CONNECTION_CLOSED' });
            });
            ws.once('error', (error) => {
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                reject(error);
            });
        });
    };

    beforeAll(async () => {
        await ensureServerStopped();

        try {
            authService = new AuthService();
            server = new WebSocketServer({ port: TEST_PORT, authService });
            
            let retries = 3;
            while (retries > 0) {
                try {
                    await server.start();
                    isServerRunning = true;
                    break;
                } catch (error) {
                    logger.error(`Failed to start server (${retries} retries left):`, error);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    retries--;
                    if (retries === 0) throw error;
                }
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            logger.error('Failed to initialize test environment:', error);
            throw error;
        }
    }, TEST_TIMEOUT);

    afterAll(async () => {
        try {
            await ensureServerStopped();
            if (authService) {
                authService.stop();
            }
        } catch (error) {
            logger.error('Error cleaning up test environment:', error);
        }
    }, TEST_TIMEOUT);

    beforeEach(async () => {
        server.clients.forEach((client, clientId) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Test cleanup');
            }
            server.clients.delete(clientId);
        });
        server.connectionCount = 0;
        metrics.mcpConnections.set(0);
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }, TEST_TIMEOUT);

    afterEach(async () => {
        const closePromises = Array.from(server.clients.entries()).map(([clientId, client]) => {
            return new Promise((resolve) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.once('close', resolve);
                    client.close(1000, 'Test cleanup');
                } else {
                    resolve();
                }
                server.clients.delete(clientId);
            });
        });

        await Promise.all(closePromises);
        await new Promise(resolve => setTimeout(resolve, 100));
    }, TEST_TIMEOUT);

    describe('Authentication Security', () => {
        it('should reject invalid API keys', async () => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            
            await new Promise((resolve, reject) => {
                ws.once('open', resolve);
                ws.once('error', reject);
            });

            ws.send(JSON.stringify({
                type: 'auth',
                apiKey: 'invalid_key'
            }));

            const response = await waitForResponse(ws);
            expect(response.code).toBe('INVALID_API_KEY');
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                await new Promise(resolve => ws.once('close', resolve));
            }
        }, TEST_TIMEOUT);

        it('should handle rate limiting for authentication attempts', async () => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            const responses = [];
            let attempts = 0;
            const maxAttempts = 6;
            
            await new Promise((resolve, reject) => {
                ws.once('open', resolve);
                ws.once('error', reject);
            });

            for (let i = 0; i < maxAttempts; i++) {
                ws.send(JSON.stringify({
                    type: 'auth',
                    apiKey: 'invalid_key'
                }));
                attempts++;

                try {
                    const response = await waitForResponse(ws);
                    responses.push(response);
                    
                    if (response.code === 'CONNECTION_CLOSED') {
                        break;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    logger.error('Error during rate limit test:', error);
                    break;
                }
            }

            const rateLimitedResponses = responses.filter(r => r.code === 'RATE_LIMIT_EXCEEDED');
            expect(rateLimitedResponses.length).toBeGreaterThan(0);
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                await new Promise(resolve => ws.once('close', resolve));
            }
        }, TEST_TIMEOUT);
    });

    describe('Message Security', () => {
        it('should reject malformed messages', async () => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            
            await new Promise(resolve => ws.on('open', resolve));

            const response = await new Promise((resolve) => {
                ws.on('message', (data) => {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'error') {
                        resolve(msg);
                    }
                });

                ws.on('close', () => {
                    resolve({ type: 'error', code: 'CONNECTION_CLOSED' });
                });

                ws.send('invalid json');
            });

            expect(response.code).toBe('INVALID_MESSAGE');
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                await new Promise(resolve => ws.on('close', resolve));
            }
        }, RESPONSE_TIMEOUT);

        it('should reject messages without authentication', async () => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            
            await new Promise(resolve => ws.on('open', resolve));

            const response = await new Promise((resolve) => {
                ws.on('message', (data) => {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'error') {
                        resolve(msg);
                    }
                });

                ws.on('close', () => {
                    resolve({ type: 'error', code: 'CONNECTION_CLOSED' });
                });

                ws.send(JSON.stringify({
                    type: 'command',
                    action: 'test'
                }));
            });

            expect(response.code).toBe('INVALID_TOKEN');
            
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                await new Promise(resolve => ws.on('close', resolve));
            }
        }, RESPONSE_TIMEOUT);
    });

    describe('Connection Security', () => {
        it('should handle connection flooding attempts', async () => {
            const numConnections = 150; // Try to create more connections than allowed
            const connections = [];
            let successfulConnections = 0;

            // Create multiple connections
            for (let i = 0; i < numConnections; i++) {
                try {
                    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
                    connections.push(ws);
                    
                    await new Promise((resolve) => {
                        ws.on('open', () => {
                            successfulConnections++;
                            resolve();
                        });
                        ws.on('error', resolve);
                    });

                    // Small delay between connections
                    await new Promise(resolve => setTimeout(resolve, 10));
                } catch (error) {
                    // Connection failed
                }
            }

            // Close all connections
            await Promise.all(connections.map(ws => {
                return new Promise((resolve) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.on('close', resolve);
                        ws.close();
                    } else {
                        resolve();
                    }
                });
            }));

            // Expect some connections to be rejected
            expect(successfulConnections).toBeLessThan(100); // Server max connections is 100
        }, 20000);

        it('should handle malformed WebSocket frames', async () => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            
            await new Promise(resolve => ws.on('open', resolve));
            
            // Send malformed frame
            const malformedFrame = Buffer.from([0x81, 0x02, 0x00, 0x00]); // Invalid WebSocket frame
            ws._socket.write(malformedFrame);
            
            // Wait for the connection to be closed
            await new Promise(resolve => {
                const checkState = () => {
                    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
                        resolve();
                    } else {
                        setTimeout(checkState, 100);
                    }
                };
                checkState();
            });
            
            expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(ws.readyState);
            
            // Ensure connection is fully closed
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
                ws.close();
                await new Promise(resolve => ws.on('close', resolve));
            }
        }, RESPONSE_TIMEOUT);
    });
}); 