const { ScanHandler } = require('./ScanHandler');
const { ConnectionHandler } = require('./ConnectionHandler');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES } = require('../protocol/messages');

class HandlerFactory {
    constructor(bleService) {
        this.bleService = bleService;
        this.handlers = new Map();
        this.initializeHandlers();
    }

    initializeHandlers() {
        // Initialize all message handlers
        this.handlers.set(MESSAGE_TYPES.START_SCAN, new ScanHandler(this.bleService));
        this.handlers.set(MESSAGE_TYPES.STOP_SCAN, new ScanHandler(this.bleService));
        this.handlers.set(MESSAGE_TYPES.CONNECT, new ConnectionHandler(this.bleService));
        this.handlers.set(MESSAGE_TYPES.DISCONNECT, new ConnectionHandler(this.bleService));
    }

    getHandler(messageType) {
        const handler = this.handlers.get(messageType);
        if (!handler) {
            logger.error(`No handler found for message type: ${messageType}`);
            metrics.increment('handler.not_found');
            throw new Error(`Unsupported message type: ${messageType}`);
        }
        return handler;
    }

    async handleMessage(clientId, message) {
        try {
            logger.debug(`Handling message for client ${clientId}`, { message });
            
            if (!message || !message.type) {
                throw new Error('Invalid message format');
            }

            const handler = this.getHandler(message.type);
            await handler.handleMessage(clientId, message);
            
            metrics.increment('message.handle.success');
        } catch (error) {
            metrics.increment('message.handle.error');
            logger.error(`Error handling message for client ${clientId}`, { error, message });
            throw error;
        }
    }

    handleClientDisconnect(clientId) {
        logger.debug(`Handling client disconnect: ${clientId}`);
        
        // Notify all handlers about client disconnect
        for (const handler of this.handlers.values()) {
            try {
                handler.handleClientDisconnect(clientId);
            } catch (error) {
                logger.error(`Error in handler cleanup for client ${clientId}`, { error });
            }
        }
    }
}

module.exports = { HandlerFactory }; 