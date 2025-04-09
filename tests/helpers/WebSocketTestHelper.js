const WebSocket = require('ws');
const { logger } = require('../../src/utils/logger');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../src/mcp/protocol/messages');

class WebSocketTestHelper {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.messageHandlers = new Map();
    this.responseQueue = [];
    this.isConnecting = false;
    this.connectionPromise = null;
    this.retryAttempts = 0;
    this.maxRetries = 3;
    this.cleanupTimer = null;
    this.server = null;
    this.clients = new Map();
  }

  async connect() {
    if (this.isConnecting) {
      return this.connectionPromise;
    }

    this.isConnecting = true;
    this.connectionPromise = new Promise((resolve, reject) => {
      this._attemptConnection(resolve, reject)
        .catch(error => {
          this.isConnecting = false;
          reject(error);
        });
    });

    return this.connectionPromise;
  }

  async _attemptConnection(resolve, reject) {
    try {
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.close();
      }

      this.ws = new WebSocket(`ws://localhost:${this.port}`);
            
      this.ws.on('open', () => {
        logger.debug('WebSocket connection opened in test');
        this.isConnecting = false;
        this.retryAttempts = 0;
        resolve();
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket connection error in test', { error: error.message || error });
        if (this.retryAttempts < this.maxRetries) {
          this.retryAttempts++;
          logger.debug(`Retrying connection (attempt ${this.retryAttempts})`);
          setTimeout(() => this._attemptConnection(resolve, reject), 1000);
        } else {
          this.isConnecting = false;
          reject(error);
        }
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          logger.debug('Received message in test', { message });

          // Handle connection acknowledgment
          if (message.type === MESSAGE_TYPES.CONNECTION_ACK) {
            this.responseQueue.push(message);
            return;
          }

          // Handle error messages
          if (message.type === MESSAGE_TYPES.ERROR) {
            this.responseQueue.push(message);
            return;
          }

          // Handle other messages
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          } else {
            this.responseQueue.push(message);
          }
        } catch (error) {
          logger.error('Error handling message in test', { error: error.message || error });
          this.responseQueue.push({ 
            type: MESSAGE_TYPES.ERROR, 
            code: ERROR_CODES.INVALID_MESSAGE,
            error: error.message
          });
        }
      });

      this.ws.on('close', () => {
        logger.debug('WebSocket closed in test');
        this.responseQueue.push({ type: MESSAGE_TYPES.ERROR, code: ERROR_CODES.CONNECTION_CLOSED });
        this.ws = null;
      });
    } catch (error) {
      this.isConnecting = false;
      reject(error);
    }
  }

  async waitForResponse(expectedType = null, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 50;
      let checkTimer = null;

      const cleanup = () => {
        if (checkTimer) {
          clearTimeout(checkTimer);
          checkTimer = null;
        }
      };

      const checkResponse = () => {
        // If connection is closed or closing, resolve with appropriate error
        if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
          cleanup();
          resolve({ type: MESSAGE_TYPES.ERROR, code: ERROR_CODES.CONNECTION_CLOSED });
          return;
        }

        // Check for response
        if (this.responseQueue.length > 0) {
          // First, look for error messages
          const errorIndex = this.responseQueue.findIndex(r => r.type === MESSAGE_TYPES.ERROR);
          if (errorIndex !== -1) {
            cleanup();
            resolve(this.responseQueue.splice(errorIndex, 1)[0]);
            return;
          }

          // Then, look for expected type
          if (expectedType) {
            const matchIndex = this.responseQueue.findIndex(r => r.type === expectedType);
            if (matchIndex !== -1) {
              cleanup();
              resolve(this.responseQueue.splice(matchIndex, 1)[0]);
              return;
            }
          } else {
            // If no specific type expected, take the first message
            cleanup();
            resolve(this.responseQueue.shift());
            return;
          }
        }

        // Check timeout
        if (Date.now() - startTime >= timeout) {
          cleanup();
          reject(new Error(`Response timeout waiting for ${expectedType || 'any message'}`));
          return;
        }

        checkTimer = setTimeout(checkResponse, checkInterval);
      };

      checkResponse();
    });
  }

  async send(message) {
    if (!this.ws) {
      throw new Error('WebSocket is not initialized');
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket is not connected (state: ${this.ws.readyState})`);
    }

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      this.ws.send(messageStr);
      logger.debug('Sent message in test', { message });
    } catch (error) {
      logger.error('Error sending message in test', { error: error.message || error });
      throw error;
    }
  }

  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  async close() {
    return new Promise((resolve) => {
      const cleanup = () => {
        if (this.ws) {
          this.ws.removeAllListeners();
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          this.ws = null;
        }
        this.messageHandlers.clear();
        this.responseQueue = [];
        resolve();
      };

      // If no connection exists or it's already closed, just cleanup
      if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
        cleanup();
        return;
      }

      // Set a short timeout to force cleanup
      const forceCleanupTimer = setTimeout(cleanup, 500);

      // Try graceful close first
      this.ws.once('close', () => {
        clearTimeout(forceCleanupTimer);
        cleanup();
      });
            
      this.ws.close(1000, 'Test cleanup');
    });
  }

  async startServer(port = 8080) {
    return new Promise((resolve, reject) => {
      this.server = new WebSocket.Server({ port }, async () => {
        try {
          await this.initializeServer();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async initializeServer() {
    // Server initialization logic here
  }

  static createTestServer(port) {
    return new Promise((resolve, reject) => {
      const server = new WebSocket.Server({ port });
      
      const cleanup = () => {
        return new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      };

      server.on('listening', () => {
        resolve({
          server,
          cleanup
        });
      });

      server.on('error', (error) => {
        reject(error);
      });
    });
  }
}

module.exports = WebSocketTestHelper; 