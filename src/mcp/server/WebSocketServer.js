const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class WebSocketServer {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.maxConnections = options.maxConnections || 100;
    this.wss = null;
    this.clients = new Map();
    this.sessions = new Map();
    this.connectionCount = 0;
    this.authService = options.authService;
    this.sendError = this.sendError.bind(this);
    
    // Message queue settings
    this.messageQueue = new Map(); // clientId -> Array<messages>
    this.processingQueue = new Set(); // Set of clientIds currently being processed
    this.queueProcessingInterval = 50; // Process messages every 50ms
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.batchSize = options.batchSize || 50;

    // Connection management
    this.connectionLock = false;

    // Initialize metrics
    metrics.mcpConnections.set(0);
    metrics.mcpConnectionsRejected.inc(0);
    metrics.authSuccess.inc(0);
    metrics.authError.inc(0);
  }

  start() {
    try {
      this.wss = new WebSocket.Server({ 
        port: this.port,
        perMessageDeflate: true, // Enable compression
        clientTracking: true, // Enable built-in client tracking
        verifyClient: (info, cb) => {
          // Check connection limit before accepting
          if (this.connectionCount >= this.maxConnections) {
            logger.warn('Connection limit reached', { 
              currentConnections: this.connectionCount,
              maxConnections: this.maxConnections,
              ip: info.req.socket.remoteAddress 
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
      
      // Start queue processing
      this.startQueueProcessing();
      
      logger.info(`MCP WebSocket server started on port ${this.port}`);
      metrics.mcpServerStatus.set(1);
    } catch (error) {
      logger.error('Failed to start MCP WebSocket server', { error });
      metrics.mcpServerStatus.set(0);
      throw error;
    }
  }

  startQueueProcessing() {
    setInterval(() => {
      this.processMessageQueues();
    }, this.queueProcessingInterval);
  }

  async processMessageQueues() {
    for (const [clientId, queue] of this.messageQueue.entries()) {
      if (this.processingQueue.has(clientId) || queue.length === 0) continue;
      
      this.processingQueue.add(clientId);
      
      try {
        const batch = queue.splice(0, this.batchSize);
        await Promise.all(batch.map(msg => this.processMessage(clientId, msg)));
      } catch (error) {
        logger.error('Error processing message batch', { clientId, error });
        metrics.mcpErrors.inc({ type: 'batch_processing_error' });
      } finally {
        this.processingQueue.delete(clientId);
      }
    }
  }

  async processMessage(clientId, message) {
    try {
      const data = JSON.parse(message);
      metrics.mcpMessagesReceived.inc();
      await this.handleMCPMessage(clientId, data);
    } catch (error) {
      logger.error('Error processing message', { clientId, error });
      this.sendError(clientId, 'PROCESSING_ERROR', 'Failed to process message');
      metrics.mcpErrors.inc({ type: 'message_processing_error' });
    }
  }

  handleConnection(ws, req) {
    // Double-check connection limit with atomic operation
    if (this.connectionLock || this.connectionCount >= this.maxConnections) {
      logger.warn('Connection limit reached (double-check)', { 
        currentConnections: this.connectionCount,
        maxConnections: this.maxConnections,
        ip: req.socket.remoteAddress 
      });
      metrics.mcpConnectionsRejected.inc();
      ws.close(1008, 'Connection limit reached');
      return;
    }

    // Set lock while updating connection count
    this.connectionLock = true;
    
    try {
      // Final check before accepting connection
      if (this.connectionCount >= this.maxConnections) {
        metrics.mcpConnectionsRejected.inc();
        ws.close(1008, 'Connection limit reached');
        return;
      }

      const clientId = this.generateClientId();
      this.clients.set(clientId, ws);
      this.messageQueue.set(clientId, []);
      this.connectionCount++;
      metrics.mcpConnections.set(this.connectionCount);

      // Log warning when approaching limit
      if (this.connectionCount >= this.maxConnections * 0.9) {
        logger.warn('Connection limit approaching', { 
          currentConnections: this.connectionCount,
          maxConnections: this.maxConnections,
          ip: req.socket.remoteAddress 
        });
      }
      
      // Set up ping/pong for connection health monitoring
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      
      ws.on('message', (message) => {
        // Queue the message instead of processing immediately
        const queue = this.messageQueue.get(clientId);
        if (queue && queue.length < this.maxQueueSize) {
          queue.push(message);
        } else {
          this.sendError(clientId, 'QUEUE_FULL', 'Message queue is full');
          metrics.mcpErrors.inc({ type: 'queue_full' });
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (error) => {
        this.handleClientError(clientId, error);
      });

      // Send connection acknowledgment
      this.sendToClient(clientId, {
        type: 'connection_ack',
        clientId,
        timestamp: Date.now()
      });
    } finally {
      // Always release the lock
      this.connectionLock = false;
    }
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Clear message processing interval
      if (this.queueProcessingInterval) {
        clearInterval(this.queueProcessingInterval);
      }

      // Close all client connections gracefully
      for (const [clientId, client] of this.clients) {
        try {
          client.close(1000, 'Server shutting down');
        } catch (error) {
          logger.error('Error closing client connection', { clientId, error });
        }
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

  handleDisconnect(clientId) {
    try {
      this.clients.delete(clientId);
      this.sessions.delete(clientId);
      this.messageQueue.delete(clientId);
      this.processingQueue.delete(clientId);
      
      if (this.connectionCount > 0) {
        this.connectionCount--;
      }
      
      metrics.mcpConnections.set(this.connectionCount);
      
      logger.info('MCP client disconnected', { 
        clientId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error in handleDisconnect', { 
        clientId, 
        error,
        timestamp: new Date().toISOString()
      });
      metrics.mcpErrors.inc({ type: 'disconnect_error' });
    }
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

  async handleAuth(clientId, message) {
    try {
        // Validate message format
        if (!message.apiKey) {
            metrics.authError.inc({ code: 'INVALID_API_KEY' });
            this.sendError(clientId, 'INVALID_API_KEY', 'API key is required');
            const client = this.clients.get(clientId);
            if (client) {
                client.close(1008, 'Authentication failed: Invalid API key');
            }
            return;
        }

        // Check rate limiting before validating API key
        if (this.authService.isRateLimited(message.apiKey)) {
            metrics.authError.inc({ code: 'RATE_LIMIT_EXCEEDED' });
            this.sendError(clientId, 'RATE_LIMIT_EXCEEDED', 'Too many authentication attempts');
            const client = this.clients.get(clientId);
            if (client) {
                client.close(1008, 'Authentication failed: Rate limit exceeded');
            }
            return;
        }

        // Validate API key
        const session = await this.authService.validateApiKey(message.apiKey);
        
        // Store session
        this.sessions.set(clientId, session);
        
        // Send success response
        this.sendToClient(clientId, {
            type: 'auth_response',
            status: 'success',
            timestamp: Date.now()
        });

        metrics.authSuccess.inc();
        logger.info('Client authenticated', { clientId });

    } catch (error) {
        metrics.authError.inc({ code: error.code || 'AUTH_ERROR' });
        
        const errorCode = error.code || 'AUTH_ERROR';
        logger.warn('Authentication failed', { 
            clientId, 
            error: errorCode,
            timestamp: new Date().toISOString()
        });

        this.sendError(clientId, errorCode, 'Authentication failed');
        
        // Close connection on authentication failure
        const client = this.clients.get(clientId);
        if (client) {
            client.close(1008, 'Authentication failed');
        }
    }
  }
}

module.exports = WebSocketServer; 