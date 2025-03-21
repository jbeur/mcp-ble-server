const WebSocket = require('ws');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class WebSocketServer {
  constructor(port = 8080) {
    this.port = port;
    this.wss = null;
    this.clients = new Map();
    this.connectionCount = 0;
    this.sendError = this.sendError.bind(this);
  }

  start() {
    try {
      this.wss = new WebSocket.Server({ port: this.port });
      
      this.wss.on('connection', this.handleConnection.bind(this));
      this.wss.on('error', this.handleError.bind(this));
      
      logger.info(`MCP WebSocket server started on port ${this.port}`);
      metrics.mcpServerStatus.set(1);
    } catch (error) {
      logger.error('Failed to start MCP WebSocket server', { error });
      metrics.mcpServerStatus.set(0);
      throw error;
    }
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }

      this.wss.close((error) => {
        if (error) {
          logger.error('Error stopping MCP WebSocket server', { error });
          reject(error);
          return;
        }
        logger.info('MCP WebSocket server stopped');
        metrics.mcpServerStatus.set(0);
        resolve();
      });
    });
  }

  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    this.clients.set(clientId, ws);
    this.connectionCount++;
    
    metrics.mcpConnections.set(this.connectionCount);
    logger.info('New MCP client connected', { clientId, ip: req.socket.remoteAddress });

    ws.on('message', (message) => this.handleMessage(clientId, message));
    ws.on('close', () => this.handleDisconnect(clientId));
    ws.on('error', (error) => this.handleClientError(clientId, error));

    // Send initial connection acknowledgment
    this.sendToClient(clientId, {
      type: 'connection_ack',
      clientId,
      timestamp: Date.now()
    });
  }

  handleMessage(clientId, message) {
    try {
      const data = JSON.parse(message);
      metrics.mcpMessagesReceived.inc();
      logger.debug('Received MCP message', { clientId, messageType: data.type });
      
      // Message handling will be implemented in the next step
      this.handleMCPMessage(clientId, data);
    } catch (error) {
      logger.error('Error handling MCP message', { clientId, error });
      this.sendError(clientId, 'INVALID_MESSAGE', 'Failed to parse message');
      metrics.mcpErrors.inc({ type: 'message_parse_error' });
    }
  }

  handleDisconnect(clientId) {
    this.clients.delete(clientId);
    this.connectionCount--;
    metrics.mcpConnections.set(this.connectionCount);
    logger.info('MCP client disconnected', { clientId });
  }

  handleClientError(clientId, error) {
    logger.error('MCP client error', { clientId, error });
    metrics.mcpErrors.inc({ type: 'client_error' });
    this.handleDisconnect(clientId);
  }

  handleError(error) {
    logger.error('MCP WebSocket server error', { error });
    metrics.mcpServerStatus.set(0);
    metrics.mcpErrors.inc({ type: 'server_error' });
  }

  sendToClient(clientId, message) {
    try {
      const client = this.clients.get(clientId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
        metrics.mcpMessagesSent.inc();
      } else {
        logger.warn('Attempted to send message to disconnected client', { clientId });
      }
    } catch (error) {
      logger.error('Error sending message to client', { clientId, error });
      metrics.mcpErrors.inc({ type: 'message_send_error' });
    }
  }

  sendError(clientId, code, message) {
    this.sendToClient(clientId, {
      type: 'error',
      code,
      message,
      timestamp: Date.now()
    });
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  handleMCPMessage(clientId, message) {
    // This will be implemented in the next step with proper message handling
    logger.debug('Processing MCP message', { clientId, messageType: message.type });
  }
}

module.exports = WebSocketServer; 