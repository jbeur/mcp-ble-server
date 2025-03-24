const WebSocket = require('ws');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES, MessageBuilder } = require('../protocol/messages');
const AuthService = require('../../auth/AuthService');
const { MessageBatcher, PRIORITY_LEVELS } = require('./MessageBatcher');

class WebSocketServer {
    constructor(config) {
        this.config = config || {
            port: 8083,
            maxConnections: 100,
            messageQueueSize: 1000,
            maxMessageSize: 1024 * 1024, // 1MB
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
                batchSize: 10,
                batchTimeout: 100,
                compression: {
                    enabled: true,
                    minSize: 1024,
                    level: 6,
                    priorityThresholds: {
                        high: 512,
                        medium: 1024,
                        low: 2048
                    }
                },
                timeouts: {
                    high: 50,
                    medium: 100,
                    low: 200
                },
                analytics: {
                    enabled: true,
                    interval: 5000,
                    metrics: {
                        batchSizes: true,
                        latencies: true,
                        compression: true,
                        priorities: true
                    }
                }
            }
        };

        this.wss = null;
        this.clients = new Map();
        this.authService = new AuthService(this.config, metrics);
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.isShuttingDown = false;
        
        // Initialize message batcher if enabled
        this.messageBatcher = this.config.batching.enabled ? 
            new MessageBatcher({
                batchSize: this.config.batching.batchSize,
                batchTimeout: this.config.batching.batchTimeout,
                compression: this.config.batching.compression,
                timeouts: this.config.batching.timeouts,
                analytics: this.config.batching.analytics
            }) : null;

        if (this.messageBatcher) {
            this.messageBatcher.on('batch', this.handleBatch.bind(this));
            this.messageBatcher.on('analytics', this.handleAnalytics.bind(this));
        }
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                this.wss = new WebSocket.Server({
                    port: this.config.port,
                    verifyClient: (info, cb) => {
                        // Check connection limit before accepting
                        if (this.clients.size >= this.config.maxConnections) {
                            logger.warn('Connection limit reached', {
                                current: this.clients.size,
                                max: this.config.maxConnections
                            });
                            metrics.mcpConnectionsRejected.inc();
                            cb(false, 503, 'Connection limit reached');
                            return;
                        }
                        cb(true);
                    }
                });

                this.wss.on('connection', this.handleConnection.bind(this));
                this.wss.on('error', this.handleError.bind(this));

                logger.info('WebSocket server started', {
                    port: this.config.port,
                    maxConnections: this.config.maxConnections
                });

                metrics.mcpServerStatus.set(1);
                resolve();
            } catch (error) {
                logger.error('Failed to start WebSocket server', { error });
                metrics.mcpServerStatus.set(0);
                reject(error);
            }
        });
    }

    handleConnection(ws) {
        if (this.isShuttingDown) {
            ws.close(1000, 'Server shutting down');
            return;
        }

        const clientId = this.generateClientId();
        logger.info('New client connected', { clientId, timestamp: new Date().toISOString() });

        // Store client information
        this.clients.set(clientId, {
            ws,
            connectedAt: Date.now(),
            lastActivity: Date.now(),
            authenticated: false,
            apiKey: null,
            session: null
        });

        // Send connection acknowledgment
        logger.debug('Sending connection acknowledgment', { clientId });
        this.sendMessage(clientId, MessageBuilder.buildConnectionAck(clientId));

        // Set up message handler
        ws.on('message', (message) => {
            this.handleMessage(clientId, message);
        });

        // Set up close handler
        ws.on('close', () => {
            this.handleDisconnect(clientId);
        });

        // Set up error handler
        ws.on('error', (error) => {
            logger.error('WebSocket error', { error: error.message || error, clientId });
            this.handleDisconnect(clientId);
        });

        metrics.mcpConnections.inc();
    }

    handleMessage(clientId, message) {
        if (this.isShuttingDown) {
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.SERVER_SHUTTING_DOWN));
            return;
        }

        const client = this.clients.get(clientId);
        if (!client) {
            logger.error('Client not found', { clientId });
            return;
        }

        client.lastActivity = Date.now();

        // Check message size
        if (message.length > this.config.maxMessageSize) {
            logger.error('Message too large', { clientId, size: message.length });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.MESSAGE_TOO_LARGE));
            return;
        }

        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message.toString());
            logger.debug('Received message', { clientId, message: parsedMessage });
        } catch (error) {
            logger.error('Error parsing message', { error: error.message || error, clientId });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_MESSAGE));
            return;
        }

        // Validate message structure
        if (!parsedMessage.type || !MESSAGE_TYPES[parsedMessage.type]) {
            logger.error('Invalid message type', { clientId, type: parsedMessage.type });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_MESSAGE_TYPE));
            return;
        }

        // Handle authentication
        if (parsedMessage.type === MESSAGE_TYPES.AUTHENTICATE) {
            logger.debug('Handling authentication', { clientId });
            this.handleAuth(clientId, parsedMessage.data).catch(error => {
                logger.error('Error handling authentication', { error: error.message || error, clientId });
                this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.PROCESSING_ERROR));
            });
            return;
        }

        // Check authentication for other messages
        if (this.config.auth.enabled && !client.authenticated) {
            logger.error('Client not authenticated', { clientId });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.NOT_AUTHENTICATED));
            return;
        }

        // Process message
        logger.debug('Processing message', { clientId, type: parsedMessage.type });
        this.processMessage(clientId, parsedMessage).catch(error => {
            logger.error('Error processing message', { error: error.message || error, clientId });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.PROCESSING_ERROR));
        });
    }

    async handleAuth(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client) {
            logger.error('Client not found during authentication', { clientId });
            return;
        }

        try {
            if (!data || !data.apiKey) {
                logger.error('Missing API key', { clientId });
                this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_API_KEY));
                return;
            }

            logger.debug('Validating API key', { clientId });
            const session = await this.authService.validateApiKey(data.apiKey);
            if (!session) {
                logger.error('Invalid API key', { clientId });
                this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_API_KEY));
                return;
            }

            client.authenticated = true;
            client.apiKey = data.apiKey;
            client.session = session;

            logger.debug('Authentication successful', { clientId });
            this.sendMessage(clientId, MessageBuilder.buildAuthenticated(session.token));

            metrics.authSuccess.inc();
        } catch (error) {
            logger.error('Authentication failed', { error: error.message || error, clientId });
            const errorCode = error.code || ERROR_CODES.AUTH_ERROR;
            this.sendMessage(clientId, MessageBuilder.buildError(errorCode));
            
            // Close connection on rate limit exceeded
            if (errorCode === ERROR_CODES.RATE_LIMIT_EXCEEDED) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Give time for error message to be sent
                this.handleDisconnect(clientId);
            }
            metrics.authError.inc();
        }
    }

    async processMessage(clientId, message) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                logger.error('Client not found during message processing', { clientId });
                return;
            }

            // Check authentication for all messages except AUTHENTICATE
            if (message.type !== MESSAGE_TYPES.AUTHENTICATE && this.config.auth.enabled && !client.authenticated) {
                logger.error('Client not authenticated', { clientId });
                this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.NOT_AUTHENTICATED));
                return;
            }

            // Process message based on type
            switch (message.type) {
                case MESSAGE_TYPES.SESSION_VALID:
                    logger.debug('Processing session validation', { clientId });
                    if (!message.data || !message.data.token) {
                        this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_TOKEN));
                        return;
                    }
                    try {
                        const isValid = await this.authService.validateSession(message.data.token);
                        if (isValid) {
                            this.sendMessage(clientId, {
                                type: MESSAGE_TYPES.SESSION_VALID,
                                data: { valid: true }
                            });
                        } else {
                            client.authenticated = false;
                            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_TOKEN));
                        }
                    } catch (error) {
                        logger.error('Session validation error', { error: error.message || error, clientId });
                        client.authenticated = false;
                        this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.INVALID_TOKEN));
                    }
                    break;
                    
                case MESSAGE_TYPES.AUTHENTICATE:
                    await this.handleAuth(clientId, message.data);
                    break;

                case MESSAGE_TYPES.LOGOUT:
                    logger.debug('Processing logout', { clientId });
                    await this.handleLogout(clientId);
                    break;

                default:
                    if (!client.authenticated) {
                        this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.NOT_AUTHENTICATED));
                        return;
                    }
                    // Handle other message types...
                    break;
            }
        } catch (error) {
            logger.error('Error processing message', { error: error.message || error, clientId });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.PROCESSING_ERROR));
        }
    }

    async handleLogout(clientId) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                return;
            }

            if (client.authenticated) {
                await this.authService.removeSession(client.apiKey);
            }

            this.sendMessage(clientId, {
                type: MESSAGE_TYPES.LOGGED_OUT,
                data: { success: true }
            });

            this.clients.delete(clientId);
            metrics.mcpConnections.dec();
        } catch (error) {
            logger.error('Error handling logout', { error, clientId });
            this.sendMessage(clientId, MessageBuilder.buildError(ERROR_CODES.PROCESSING_ERROR));
        }
    }

    handleDisconnect(clientId) {
        const client = this.clients.get(clientId);
        if (!client) {
            logger.debug('Client already removed', { clientId });
            return;
        }

        logger.info('Client disconnected', { clientId });

        try {
            if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                client.ws.close(1000, 'Client disconnected');
            }
        } catch (error) {
            logger.error('Error closing client WebSocket', { error: error.message || error, clientId });
        }

        this.clients.delete(clientId);
        metrics.mcpConnections.dec();
    }

    handleClientError(clientId, error) {
        try {
            logger.error('Client error', { error: error.message || error, clientId });
            this.handleDisconnect(clientId);
        } catch (err) {
            logger.error('Error handling client error', { error: err.message || err, clientId });
        }
    }

    handleError(error) {
        logger.error('WebSocket server error', { error: error.message || error });
        metrics.mcpErrors.inc({ type: error.code || 'AUTH_ERROR' });
    }

    sendMessage(clientId, message) {
        try {
            if (this.isShuttingDown) return;

            const client = this.clients.get(clientId);
            if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
                logger.warn('Client not connected, dropping message', { clientId });
                return;
            }

            // Use message batcher if enabled
            if (this.messageBatcher) {
                this.messageBatcher.addMessage(clientId, message);
            } else {
                client.ws.send(JSON.stringify(message));
                metrics.mcpMessagesSent.inc();
            }
        } catch (error) {
            logger.error('Error sending message:', { error, clientId });
        }
    }

    generateClientId() {
        return Math.random().toString(36).substring(2, 15);
    }

    stop() {
        return new Promise((resolve, reject) => {
            if (!this.wss) {
                resolve();
                return;
            }

            this.isShuttingDown = true;

            // Close all client connections
            for (const [clientId, client] of this.clients) {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close(1000, 'Server shutting down');
                }
            }

            // Stop message batcher if enabled
            if (this.messageBatcher) {
                this.messageBatcher.stop();
            }

            // Stop auth service
            this.authService.stop();

            // Close WebSocket server
            this.wss.close((error) => {
                if (error) {
                    logger.error('Error stopping WebSocket server', { error });
                    metrics.mcpServerStatus.set(0);
                    reject(new Error('Failed to stop server'));
                    return;
                }

                logger.info('WebSocket server stopped', {
                    port: this.config.port
                });

                metrics.mcpServerStatus.set(0);
                resolve();
            });
        });
    }

    /**
     * Handle a batch of messages for a client
     * @param {string} clientId - The client identifier
     * @param {Array|Object} messages - Array of messages or compressed batch to send
     */
    handleBatch(clientId, messages) {
        try {
            const client = this.clients.get(clientId);
            if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
                logger.warn('Client not connected, dropping batch', { clientId });
                return;
            }

            const batchMessage = {
                type: MESSAGE_TYPES.BATCH,
                data: { 
                    messages: messages.compressed ? messages.data : messages,
                    compressed: messages.compressed || false,
                    algorithm: messages.algorithm,
                    originalSize: messages.originalSize,
                    compressedSize: messages.compressedSize
                }
            };

            client.ws.send(JSON.stringify(batchMessage));
            metrics.mcpMessagesSent.inc(messages.compressed ? 1 : messages.length);
            
            // Update compression metrics if applicable
            if (messages.compressed) {
                metrics.mcpCompressedBatches.inc();
                metrics.mcpBytesSaved.inc(messages.originalSize - messages.compressedSize);
            }
        } catch (error) {
            logger.error('Error sending batch message:', { error, clientId });
        }
    }

    /**
     * Handle analytics updates from the message batcher
     * @param {Object} analytics - Analytics data
     */
    handleAnalytics(analytics) {
        try {
            // Update Prometheus metrics
            if (analytics.batchSizeHistory.length > 0) {
                const latest = analytics.batchSizeHistory[analytics.batchSizeHistory.length - 1];
                metrics.mcpAverageBatchSize.set(latest.average);
                metrics.mcpMaxBatchSize.set(latest.max);
                metrics.mcpMinBatchSize.set(latest.min);
            }

            if (analytics.latencyHistory.length > 0) {
                const latest = analytics.latencyHistory[analytics.latencyHistory.length - 1];
                metrics.mcpAverageLatency.set(latest.average);
                metrics.mcpMaxLatency.set(latest.max);
                metrics.mcpMinLatency.set(latest.min);
            }

            if (analytics.compressionHistory.length > 0) {
                const latest = analytics.compressionHistory[analytics.compressionHistory.length - 1];
                metrics.mcpCompressionRatio.set(latest.ratio);
                metrics.mcpBytesSavedTotal.set(latest.bytesSaved);
            }

            // Update priority distribution metrics
            metrics.mcpPriorityDistribution.set(analytics.priorityDistribution);

            // Log analytics summary
            logger.info('Message batching analytics update:', {
                batchSizes: analytics.batchSizeHistory.length > 0 ? 
                    analytics.batchSizeHistory[analytics.batchSizeHistory.length - 1] : null,
                latencies: analytics.latencyHistory.length > 0 ? 
                    analytics.latencyHistory[analytics.latencyHistory.length - 1] : null,
                compression: analytics.compressionHistory.length > 0 ? 
                    analytics.compressionHistory[analytics.compressionHistory.length - 1] : null,
                priorityDistribution: analytics.priorityDistribution
            });
        } catch (error) {
            logger.error('Error handling analytics:', { error });
        }
    }
}

module.exports = WebSocketServer; 