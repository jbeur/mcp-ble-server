const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { logger } = require('../utils/logger');

class WebSocketServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.server = new WebSocket.Server({
      port: config.port,
      path: config.path,
      protocol: config.protocol
    });

    // Bind methods
    this.handleConnection = this.handleConnection.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleClientError = this.handleClientError.bind(this);

    // Set up event listeners
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);
  }

  handleConnection(ws) {
    logger.info('New WebSocket client connected');

    // Set up client event listeners
    ws.on('message', (message) => {
      try {
        this.handleMessage(ws, message);
      } catch (error) {
        this.handleClientError(ws, error);
      }
    });
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.handleClientError(ws, error));

    // Emit connection event
    this.emit('connection', ws);
  }

  handleMessage(ws, message) {
    try {
      const parsedMessage = JSON.parse(message);
      logger.debug('Received WebSocket message:', parsedMessage);

      // Process message based on type
      switch (parsedMessage.type) {
        case 'test':
          // Handle test message
          break;
        case 'error':
          throw new Error('Test error message');
        default:
          logger.warn('Unknown message type:', parsedMessage.type);
      }

      // Emit message event
      this.emit('message', ws, parsedMessage);
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
      // Don't re-emit error events to avoid infinite recursion
      if (!(error instanceof SyntaxError)) {
        this.handleClientError(ws, error);
      }
    }
  }

  handleClose(ws) {
    logger.info('WebSocket client disconnected');
    this.emit('close', ws);
  }

  handleClientError(ws, error) {
    logger.error('WebSocket client error:', error);
    // Don't re-emit error events to avoid infinite recursion
    ws.close();
  }

  handleError(error) {
    logger.error('WebSocket server error:', error);
    // Don't re-emit error events to avoid infinite recursion
  }

  async cleanup() {
    try {
      // Close all client connections
      const closePromises = Array.from(this.server.clients).map(client => {
        return new Promise((resolve) => {
          client.once('close', resolve);
          client.close();
        });
      });

      // Wait for all clients to close
      await Promise.all(closePromises);

      // Close the server
      await new Promise((resolve, reject) => {
        this.server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      logger.info('WebSocket server closed');
    } catch (error) {
      logger.error('Error closing WebSocket server:', error);
      throw error;
    }
  }

  // Helper method to broadcast message to all connected clients
  broadcast(message, exclude = null) {
    this.server.clients.forEach(client => {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

module.exports = WebSocketServer; 