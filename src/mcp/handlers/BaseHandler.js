const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MessageBuilder, ErrorCodes } = require('../protocol/messages');

class BaseHandler {
  constructor(server, bleService) {
    this.server = server;
    this.bleService = bleService;
    this.handleMessage = this.handleMessage.bind(this);
  }

  /**
   * Handle an incoming message
   * @param {string} clientId - The client ID
   * @param {Object} message - The message to handle
   * @returns {Promise<void>}
   */
  async handleMessage(clientId, message) {
    const startTime = Date.now();
    try {
      await this.validateMessage(message);
      await this.processMessage(clientId, message);
    } catch (error) {
      this.handleError(clientId, error);
    } finally {
      const duration = (Date.now() - startTime) / 1000;
      metrics.mcpMessageLatency.observe(duration);
    }
  }

  /**
   * Validate the message format and parameters
   * @param {Object} message - The message to validate
   * @returns {Promise<void>}
   */
  async validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message format');
    }

    if (!message.type) {
      throw new Error('Message type is required');
    }
  }

  /**
   * Process the validated message
   * @param {string} clientId - The client ID
   * @param {Object} message - The message to process
   * @returns {Promise<void>}
   */
  async processMessage(clientId, message) {
    throw new Error('processMessage must be implemented by subclasses');
  }

  /**
   * Handle any errors that occur during message processing
   * @param {string} clientId - The client ID
   * @param {Error} error - The error that occurred
   */
  handleError(clientId, error) {
    logger.error('Error handling message', { clientId, error });
    
    const errorCode = error.code || ErrorCodes.INTERNAL_ERROR;
    const errorMessage = error.message || 'An internal error occurred';
    
    metrics.mcpErrors.inc({ type: errorCode });
    
    this.server.sendToClient(clientId, MessageBuilder.buildError(errorCode, errorMessage));
  }

  /**
   * Send a message to a client
   * @param {string} clientId - The client ID
   * @param {Object} message - The message to send
   */
  sendToClient(clientId, message) {
    this.server.sendToClient(clientId, message);
  }

  /**
   * Create a custom error with a specific error code
   * @param {string} code - The error code
   * @param {string} message - The error message
   * @returns {Error}
   */
  createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

module.exports = BaseHandler; 