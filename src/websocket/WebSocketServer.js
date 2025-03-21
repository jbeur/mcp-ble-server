const WebSocket = require('ws');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const { HandlerFactory } = require('../mcp/handlers/HandlerFactory');
const { BLEService } = require('../ble/BLEService');

class WebSocketServer {
    constructor(config) {
        this.config = config;
        this.wss = null;
        this.clients = new Map();
        this.bleService = new BLEService();
        this.handlerFactory = new HandlerFactory(this.bleService);
    }

    start() {
        try {
            logger.info('Starting WebSocket server...', { port: this.config.port });

            this.wss = new WebSocket.Server({ port: this.config.port });

            this.wss.on('connection', this.handleConnection.bind(this));
            this.wss.on('error', this.handleError.bind(this));

            metrics.increment('websocket.server.start');
            logger.info('WebSocket server started successfully');
        } catch (error) {
            logger.error('Failed to start WebSocket server', { error });
            metrics.increment('websocket.server.start.error');
            throw error;
        }
    }

    stop() {
        try {
            logger.info('Stopping WebSocket server...');

            // Close all client connections
            for (const client of this.clients.values()) {
                client.close();
            }
            this.clients.clear();

            // Close the server
            if (this.wss) {
                this.wss.close();
                this.wss = null;
            }

            metrics.increment('websocket.server.stop');
            logger.info('WebSocket server stopped successfully');
        } catch (error) {
            logger.error('Failed to stop WebSocket server', { error });
            metrics.increment('websocket.server.stop.error');
            throw error;
        }
    }

    handleConnection(ws) {
        const clientId = this.generateClientId();
        logger.info(`New client connected: ${clientId}`);

        // Store client connection
        this.clients.set(clientId, ws);

        // Set up event handlers
        ws.on('message', (message) => this.handleMessage(clientId, message));
        ws.on('close', () => this.handleClientDisconnect(clientId));
        ws.on('error', (error) => this.handleClientError(clientId, error));

        // Send welcome message
        this.sendToClient(clientId, {
            type: 'WELCOME',
            params: {
                clientId,
                version: this.config.version
            }
        });

        metrics.increment('websocket.client.connect');
    }

    handleMessage(clientId, message) {
        try {
            logger.debug(`Received message from client ${clientId}`, { message });

            // Parse message
            let parsedMessage;
            try {
                parsedMessage = JSON.parse(message);
            } catch (error) {
                throw new Error('Invalid message format');
            }

            // Handle message using appropriate handler
            this.handlerFactory.handleMessage(clientId, parsedMessage)
                .catch(error => this.handleHandlerError(clientId, error));

            metrics.increment('websocket.message.received');
        } catch (error) {
            logger.error(`Error processing message from client ${clientId}`, { error });
            metrics.increment('websocket.message.error');
            this.sendError(clientId, error);
        }
    }

    handleClientDisconnect(clientId) {
        logger.info(`Client disconnected: ${clientId}`);

        // Remove client from active connections
        this.clients.delete(clientId);

        // Clean up client's resources
        this.handlerFactory.handleClientDisconnect(clientId);

        metrics.increment('websocket.client.disconnect');
    }

    handleClientError(clientId, error) {
        logger.error(`Error with client ${clientId}`, { error });
        metrics.increment('websocket.client.error');
    }

    handleHandlerError(clientId, error) {
        logger.error(`Handler error for client ${clientId}`, { error });
        metrics.increment('websocket.handler.error');
        this.sendError(clientId, error);
    }

    handleError(error) {
        logger.error('WebSocket server error', { error });
        metrics.increment('websocket.server.error');
    }

    sendToClient(clientId, message) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }

            const messageStr = JSON.stringify(message);
            client.send(messageStr);

            metrics.increment('websocket.message.sent');
        } catch (error) {
            logger.error(`Failed to send message to client ${clientId}`, { error });
            metrics.increment('websocket.message.send.error');
        }
    }

    sendError(clientId, error) {
        this.sendToClient(clientId, {
            type: 'ERROR',
            params: {
                code: error.code || 'UNKNOWN_ERROR',
                message: error.message || 'An unknown error occurred'
            }
        });
    }

    generateClientId() {
        return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = { WebSocketServer }; 