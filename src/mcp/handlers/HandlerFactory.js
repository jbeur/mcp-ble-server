const { MESSAGE_TYPES } = require('../protocol/messages');
const { AuthHandler } = require('./AuthHandler');
const { ScanHandler } = require('./ScanHandler');
const { ConnectionHandler } = require('./ConnectionHandler');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class HandlerFactory {
    constructor(authService, bleService) {
        this.authService = authService;
        this.bleService = bleService;
        this.handlers = new Map();
        this.initializeHandlers();
    }

    initializeHandlers() {
        try {
            // Auth handlers
            const authHandler = new AuthHandler(this.authService);
            this.handlers.set(MESSAGE_TYPES.AUTHENTICATE, authHandler);
            this.handlers.set(MESSAGE_TYPES.SESSION_VALID, authHandler);
            this.handlers.set(MESSAGE_TYPES.LOGOUT, authHandler);

            // BLE handlers
            const scanHandler = new ScanHandler(this.bleService);
            this.handlers.set(MESSAGE_TYPES.START_SCAN, scanHandler);
            this.handlers.set(MESSAGE_TYPES.STOP_SCAN, scanHandler);

            const connectionHandler = new ConnectionHandler(this.bleService);
            this.handlers.set(MESSAGE_TYPES.CONNECT, connectionHandler);
            this.handlers.set(MESSAGE_TYPES.DISCONNECT, connectionHandler);
            this.handlers.set(MESSAGE_TYPES.CHARACTERISTIC_READ, connectionHandler);
            this.handlers.set(MESSAGE_TYPES.CHARACTERISTIC_WRITE, connectionHandler);

            logger.info('Handlers initialized successfully');
            metrics.increment('handler_factory.init.success');
        } catch (error) {
            logger.error('Failed to initialize handlers', { error });
            metrics.increment('handler_factory.init.error');
            throw error;
        }
    }

    getHandler(messageType) {
        try {
            const handler = this.handlers.get(messageType);
            if (!handler) {
                metrics.increment('handler_factory.get_handler.not_found');
                throw new Error(`No handler found for message type: ${messageType}`);
            }
            metrics.increment('handler_factory.get_handler.success');
            return handler;
        } catch (error) {
            logger.error('Error getting handler', { error, messageType });
            throw error;
        }
    }

    async handleMessage(clientId, message) {
        try {
            if (!message || typeof message !== 'object') {
                metrics.increment('handler_factory.handle_message.invalid_format');
                throw new Error('Invalid message format');
            }

            if (!message.type || typeof message.type !== 'string') {
                metrics.increment('handler_factory.handle_message.missing_type');
                throw new Error('Invalid message format: missing or invalid type');
            }

            const handler = this.getHandler(message.type);
            await handler.handleMessage(clientId, message);
            metrics.increment('handler_factory.handle_message.success');
        } catch (error) {
            logger.error('Error handling message', { 
                error, 
                clientId, 
                messageType: message?.type 
            });
            metrics.increment('handler_factory.handle_message.error');
            throw error;
        }
    }

    async handleClientDisconnect(clientId) {
        const errors = [];
        try {
            // Use a Set to deduplicate handlers
            const uniqueHandlers = new Set(this.handlers.values());
            const promises = Array.from(uniqueHandlers).map(async (handler) => {
                try {
                    await handler.handleClientDisconnect(clientId);
                } catch (error) {
                    errors.push(error);
                    logger.error('Error in handler during client disconnect', {
                        error,
                        clientId,
                        handlerType: handler.constructor.name
                    });
                }
            });

            await Promise.all(promises);

            if (errors.length > 0) {
                metrics.increment('handler_factory.client_disconnect.error');
                throw new Error(`Failed to disconnect client: ${errors.length} handlers reported errors`);
            }

            metrics.increment('handler_factory.client_disconnect.success');
        } catch (error) {
            logger.error('Error handling client disconnect', { error, clientId });
            throw error;
        }
    }
}

module.exports = { HandlerFactory }; 