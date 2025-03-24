const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

class ConnectionRetry {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      initialDelay: options.initialDelay || 1000, // 1 second
      maxDelay: options.maxDelay || 30000, // 30 seconds
      backoffFactor: options.backoffFactor || 2,
      ...options
    };

    // Initialize metrics
    this.retryCount = metrics.counter('connection_retries', 'Number of connection retry attempts', ['connection_id']);
    this.retryDelay = metrics.gauge('connection_retry_delay', 'Delay between retry attempts in milliseconds', ['connection_id']);
    this.retryErrors = metrics.counter('connection_retry_errors', 'Number of retry errors by category', ['connection_id', 'error_category']);
  }

  shouldRetry(error, connection) {
    if (!error || !error.retryable) {
      return false;
    }

    if (connection && connection.retryCount >= this.options.maxRetries) {
      logger.warn('Max retries reached', {
        connectionId: connection.id,
        retryCount: connection.retryCount
      });
      return false;
    }

    return true;
  }

  calculateDelay(retryCount) {
    const delay = Math.min(
      this.options.initialDelay * Math.pow(this.options.backoffFactor, retryCount),
      this.options.maxDelay
    );

    return delay;
  }

  async retry(connection, error) {
    if (!this.shouldRetry(error, connection)) {
      return;
    }

    try {
      // Initialize retry count if not exists
      if (!connection.retryCount) {
        connection.retryCount = 0;
      }

      // Calculate delay for this retry
      const delay = this.calculateDelay(connection.retryCount);

      logger.info('Attempting connection retry', {
        connectionId: connection.id,
        retryCount: connection.retryCount + 1,
        delay
      });

      // Track retry metrics
      this.retryCount.inc({ connection_id: connection.id });
      this.retryDelay.set({ connection_id: connection.id }, delay);

      // Wait for the calculated delay
      await new Promise(resolve => setTimeout(resolve, delay));

      // Attempt to reconnect
      await connection.connect();

      // Reset retry count on successful connection
      this.resetRetryCount(connection);

      logger.info('Connection retry successful', {
        connectionId: connection.id,
        retryCount: connection.retryCount
      });
    } catch (retryError) {
      // Increment retry count
      connection.retryCount = (connection.retryCount || 0) + 1;

      // Classify and track the error
      const classifiedError = this.classifyError(retryError);
      this.retryErrors.inc({
        connection_id: connection.id,
        error_category: classifiedError.category
      });

      logger.error('Connection retry failed', {
        connectionId: connection.id,
        retryCount: connection.retryCount,
        error: retryError.message,
        category: classifiedError.category
      });

      throw retryError;
    }
  }

  resetRetryCount(connection) {
    if (connection) {
      connection.retryCount = 0;
    }
  }

  classifyError(error) {
    const errorMessage = error.message.toLowerCase();
    let category = 'unknown';
    let retryable = false;

    // Network-related errors
    if (errorMessage.includes('network') || 
        errorMessage.includes('timeout') || 
        errorMessage.includes('connection refused') ||
        errorMessage.includes('econnreset')) {
      category = 'network';
      retryable = true;
    }
    // Authentication errors
    else if (errorMessage.includes('auth') || 
             errorMessage.includes('credentials') || 
             errorMessage.includes('unauthorized')) {
      category = 'authentication';
      retryable = false;
    }
    // Resource errors
    else if (errorMessage.includes('resource') || 
             errorMessage.includes('memory') || 
             errorMessage.includes('cpu')) {
      category = 'resource';
      retryable = true;
    }
    // Service errors
    else if (errorMessage.includes('service') || 
             errorMessage.includes('server') || 
             errorMessage.includes('500')) {
      category = 'service';
      retryable = true;
    }

    return {
      ...error,
      category,
      retryable
    };
  }
}

module.exports = ConnectionRetry; 