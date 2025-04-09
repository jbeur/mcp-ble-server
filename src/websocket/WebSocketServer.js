const WebSocket = require('ws');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const { HandlerFactory } = require('../mcp/handlers/HandlerFactory');
const BLEService = require('../ble/bleService');

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
      logger.error(`Error handling message from client ${clientId}`, { error });
      metrics.increment('websocket.message.error');
      this.handleClientError(clientId, error);
    }
  }

  handleClientDisconnect(clientId) {
    try {
      logger.info(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
      metrics.increment('websocket.client.disconnect');
    } catch (error) {
      logger.error(`Error handling client disconnect: ${clientId}`, { error });
      metrics.increment('websocket.client.disconnect.error');
    }
  }

  handleClientError(clientId, error) {
    try {
      logger.error(`Client error: ${clientId}`, { error });
      metrics.increment('websocket.client.error');
            
      const client = this.clients.get(clientId);
      if (client) {
        client.close();
        this.clients.delete(clientId);
      }
    } catch (err) {
      logger.error(`Error handling client error: ${clientId}`, { error: err });
    }
  }

  handleError(error) {
    logger.error('WebSocket server error:', { error });
    metrics.increment('websocket.server.error');
  }

  handleHandlerError(clientId, error) {
    logger.error(`Handler error for client ${clientId}:`, { error });
    metrics.increment('websocket.handler.error');
    this.sendToClient(clientId, {
      type: 'ERROR',
      params: {
        message: error.message
      }
    });
  }

  sendToClient(clientId, message) {
    try {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
        metrics.increment('websocket.message.sent');
      } else {
        logger.warn(`Cannot send message to disconnected client: ${clientId}`);
        metrics.increment('websocket.message.send.failed');
      }
    } catch (error) {
      logger.error(`Error sending message to client ${clientId}:`, { error });
      metrics.increment('websocket.message.send.error');
    }
  }

  generateClientId() {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
     * Get the number of active WebSocket connections
     * @returns {number} Number of active WebSocket connections
     */
  getActiveConnections() {
    return this.clients.size;
  }
}

module.exports = { WebSocketServer }; 