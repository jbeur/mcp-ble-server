const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const VALID_ENVIRONMENTS = ['development', 'test', 'production'];

class Logger {
  constructor(config = {}) {
    this.validateConfig(config);
    this.config = {
      level: config.level || 'info',
      environment: config.environment || process.env.NODE_ENV || 'development',
      ...config
    };
  }

  validateConfig(config) {
    if (config.level && !VALID_LOG_LEVELS.includes(config.level)) {
      throw new Error(`Invalid log level: ${config.level}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}`);
    }

    if (config.environment && !VALID_ENVIRONMENTS.includes(config.environment)) {
      throw new Error(`Invalid environment: ${config.environment}. Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
    }
  }

  shouldLog(level) {
    const levelIndex = VALID_LOG_LEVELS.indexOf(level);
    const configLevelIndex = VALID_LOG_LEVELS.indexOf(this.config.level);
    return levelIndex <= configLevelIndex;
  }

  formatMessage(level, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = this.config.environment === 'test' ? `[TEST] ${level.toUpperCase()}` : level.toUpperCase();
    return [`[${timestamp}] ${prefix}:`, ...args];
  }

  info(...args) {
    if (this.shouldLog('info')) {
      console.log(...this.formatMessage('info', ...args));
    }
  }

  error(...args) {
    if (this.shouldLog('error')) {
      console.error(...this.formatMessage('error', ...args));
    }
  }

  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn(...this.formatMessage('warn', ...args));
    }
  }

  debug(...args) {
    if (this.shouldLog('debug')) {
      console.debug(...this.formatMessage('debug', ...args));
    }
  }
}

// Create and export a default logger instance
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  environment: process.env.NODE_ENV || 'development'
});

module.exports = { Logger, logger }; 