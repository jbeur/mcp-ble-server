const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const metrics = require('../utils/metrics');
const { ERROR_CODES } = require('../mcp/protocol/messages');
const SessionEncryption = require('../mcp/security/SessionEncryption');
const ApiKeyManager = require('./ApiKeyManager');
const TokenAuthentication = require('./TokenAuthentication');
const OAuth2Service = require('./OAuth2Service');
const ThreatDetectionService = require('../security/ThreatDetectionService');
const crypto = require('crypto');
const RateLimiter = require('./RateLimiter');

class AuthService {
  constructor(config = {}) {
    this.config = {
      ...config,
      auth: {
        maxFailedAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15 minutes
        sessionDuration: 3600000, // 1 hour
        ...config.auth
      }
    };

    this.logger = logger;
    
    // Initialize metrics
    this.metrics = {
      increment: (name) => metrics.increment(name),
      gauge: (name, value) => metrics.gauge(name, value),
      histogram: (name, value) => metrics.histogram(name, value)
    };

    // Initialize maps
    this.authFailureCount = new Map();
    this.blockedClients = new Map();
    this.sessions = new Map();
    this.activeSessions = new Map();
    this.rateLimiters = new Map();

    // Initialize services
    this.tokenAuth = new TokenAuthentication(config);
    this.oauth2Service = new OAuth2Service(config.security?.oauth2, metrics);
    this.threatDetection = new ThreatDetectionService(config, metrics);
    this.rateLimiter = new RateLimiter(config.rateLimiting);
    this.apiKeyManager = new ApiKeyManager();
    this.sessionEncryption = new SessionEncryption(config.auth?.jwtSecret);

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000); // Run every minute
  }

  /**
     * Authenticates a client using clientId and apiKey
     * @param {string} clientId - Client identifier
     * @param {string} apiKey - API key to validate
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Session data
     */
  async authenticate(clientId, apiKey, options = {}) {
    try {
      if (!clientId || !apiKey) {
        throw new Error('Client ID and API key are required');
      }

      // Check for session fixation attempt
      if (options.sessionId) {
        throw new Error('Invalid session');
      }

      // Check if client is blocked (for brute force protection)
      if (this.blockedClients.has(clientId)) {
        const blockData = this.blockedClients.get(clientId);
        if (Date.now() < blockData.expiresAt) {
          throw new Error('Invalid API key');
        }
        this.blockedClients.delete(clientId);
      }

      // Check for suspicious IP
      if (options.ip && await this.threatDetection.isIpBlocked(options.ip)) {
        throw new Error('Access denied');
      }

      // Check for suspicious patterns
      if (await this.threatDetection.hasHighSeverityThreats(clientId)) {
        throw new Error('Access denied');
      }

      // Check rate limit
      if (this.rateLimiter.isRateLimited(clientId)) {
        throw new Error('Rate limit exceeded');
      }

      // Validate API key
      const isValid = await this.apiKeyManager.validateKey(clientId, apiKey);
      if (!isValid) {
        // Increment auth failure count
        const failures = (this.authFailureCount.get(clientId) || 0) + 1;
        this.authFailureCount.set(clientId, failures);

        // Check if max failures reached
        if (failures >= this.config.auth.maxFailedAttempts) {
          this.blockedClients.set(clientId, {
            expiresAt: Date.now() + this.config.auth.lockoutDuration
          });
          throw new Error('Invalid API key');
        }

        throw new Error('Invalid API key');
      }

      // Reset failure count on successful auth
      this.authFailureCount.delete(clientId);

      // Create session
      const sessionId = await this.createSession(clientId);

      this.metrics.increment('auth.success');
      return sessionId;
    } catch (error) {
      this.metrics.increment('auth.failure');
      this.logger.error('Authentication error:', error.message || 'Unknown error', {
        clientId,
        errorType: error.message === 'Rate limit exceeded' ? 'rate_limit' : 'auth_failure'
      });
      throw error;
    }
  }

  /**
     * Creates a new session for a client
     * @param {string} clientId - Client identifier
     * @param {Object} data - Additional session data
     * @returns {Promise<string>} Session ID
     */
  async createSession(clientId, data = {}) {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      // Check if client is blocked
      if (this.blockedClients.has(clientId)) {
        throw new Error('Access denied');
      }

      // Generate session token
      const sessionToken = await this.tokenAuth.generateToken({
        clientId,
        ...data
      });

      // Encrypt session data
      const encryptedData = await this.sessionEncryption.encrypt({
        clientId,
        ...data
      });

      // Store session
      const session = {
        token: sessionToken,
        data: encryptedData,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.config.auth.sessionDuration
      };

      this.activeSessions.set(sessionToken, session);

      // Track session creation
      this.metrics.increment('auth.sessions.created');
      this.metrics.gauge('auth.active_sessions', this.activeSessions.size);

      return sessionToken;
    } catch (error) {
      this.metrics.increment('auth.sessions.error');
      this.logger.error('Session creation failed:', error);
      throw error;
    }
  }

  /**
     * Validates a session token
     * @param {string} sessionId - Session ID to validate
     * @returns {Promise<boolean>} True if session is valid
     */
  async validateSession(sessionId) {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required');
      }

      const encryptedSession = this.activeSessions.get(sessionId);
      if (!encryptedSession) {
        throw new Error('Session not found');
      }

      const session = await this.sessionEncryption.decryptSession(encryptedSession);
      if (!session) {
        throw new Error('Failed to decrypt session');
      }

      // Check if session has expired
      if (Date.now() > session.expiresAt) {
        this.activeSessions.delete(sessionId);
        throw new Error('Session expired');
      }

      // Update last activity
      session.lastActivity = Date.now();
      const updatedEncryptedSession = await this.sessionEncryption.encryptSession(session);
      this.activeSessions.set(sessionId, updatedEncryptedSession);

      return true;
    } catch (error) {
      this.logger.error('Session validation error:', error);
      throw error;
    }
  }

  /**
     * Validates an API key for a client
     * @param {string} clientId - Client identifier
     * @param {string} apiKey - API key to validate
     * @returns {Promise<boolean>} True if valid, false otherwise
     */
  async validateApiKey(clientId, apiKey) {
    try {
      if (!clientId || !apiKey) {
        return false;
      }

      // Check if client is blocked
      if (this.blockedClients.has(clientId)) {
        return false;
      }

      const isValid = await this.apiKeyManager.validateKey(clientId, apiKey);
      if (!isValid) {
        // Increment failure count
        const failures = (this.authFailureCount.get(clientId) || 0) + 1;
        this.authFailureCount.set(clientId, failures);

        // Check if max failures reached
        if (failures >= this.config.auth.maxFailedAttempts) {
          this.blockedClients.set(clientId, {
            expiresAt: Date.now() + this.config.auth.lockoutDuration
          });
        }

        return false;
      }

      // Reset failure count on successful validation
      this.authFailureCount.delete(clientId);
      return true;
    } catch (error) {
      this.metrics.increment('auth.validation.error');
      this.logger.error('API key validation failed:', error);
      return false;
    }
  }

  async removeSession(sessionId) {
    try {
      const encryptedSession = this.activeSessions.get(sessionId);
      if (!encryptedSession) {
        this.metrics.increment('auth.sessions.error');
        return false;
      }

      const session = await this.sessionEncryption.decryptSession(encryptedSession);
      if (!session) {
        this.metrics.increment('auth.sessions.error');
        return false;
      }

      const sessionData = typeof session === 'string' ? JSON.parse(session) : session;
      
      // Remove the API key
      if (sessionData.apiKey) {
        this.apiKeyManager.deleteKey(sessionData.apiKey);
        this.metrics.increment('auth.api_keys.removed');
      }

      this.activeSessions.delete(sessionId);
      this.metrics.increment('auth.sessions.removed');
      this.metrics.gauge('auth.active_sessions', this.activeSessions.size);
      return true;
    } catch (error) {
      this.logger.error('Error removing session:', error);
      this.metrics.increment('auth.sessions.error');
      return false;
    }
  }

  /**
     * Start the session cleanup interval
     */
  startCleanup() {
    // Clear any existing interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Start new cleanup interval
    this.cleanupInterval = setInterval(() => {
      try {
        this.cleanupSessions();
        this.metrics.increment('auth.session.cleanup.success');
      } catch (error) {
        logger.error('Session cleanup failed:', error);
        this.metrics.increment('auth.session.cleanup.error');
      }
    }, this.config.security?.auth?.cleanupInterval || 300000); // Default to 5 minutes
  }

  /**
     * Stop the cleanup interval
     */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.apiKeyManager.stopRotationInterval();
  }

  /**
     * Clean up expired sessions
     */
  async cleanupSessions() {
    try {
      const now = Date.now();
      let expiredCount = 0;
      let errorCount = 0;
      const sessionIds = Array.from(this.activeSessions.keys());

      for (const sessionId of sessionIds) {
        try {
          const encryptedSession = this.activeSessions.get(sessionId);
          if (!encryptedSession) {
            this.activeSessions.delete(sessionId);
            this.metrics.increment('auth.sessions.error');
            errorCount++;
            continue;
          }

          const session = await this.sessionEncryption.decryptSession(encryptedSession);
          if (!session) {
            this.activeSessions.delete(sessionId);
            this.metrics.increment('auth.sessions.error');
            errorCount++;
            continue;
          }

          // Remove expired sessions
          if (now > session.expiresAt) {
            this.activeSessions.delete(sessionId);
            this.metrics.increment('auth.sessions.expired');
            expiredCount++;
          }
        } catch (error) {
          this.logger.error('Error cleaning up session:', error);
          if (error.message === 'Cleanup failed') {
            throw error;
          }
          // Remove invalid sessions
          this.activeSessions.delete(sessionId);
          this.metrics.increment('auth.sessions.error');
          errorCount++;
        }
      }

      // Update metrics
      this.metrics.gauge('auth.active_sessions', this.activeSessions.size);
      this.metrics.histogram('auth.sessions.cleanup.expired', expiredCount);
      this.metrics.histogram('auth.sessions.cleanup.errors', errorCount);
      this.metrics.increment('auth.sessions.cleanup.success');

      this.logger.info('Session cleanup completed', {
        expiredCount,
        errorCount,
        remainingSessions: this.activeSessions.size
      });
    } catch (error) {
      this.logger.error('Session cleanup error:', error);
      this.metrics.increment('auth.sessions.cleanup.error');
      throw error;
    }
  }

  isRateLimited(key) {
    try {
      if (!this.config.auth?.rateLimit?.enabled) {
        return false;
      }

      const now = Date.now();
      let limiter = this.rateLimiters.get(key);

      if (!limiter) {
        limiter = {
          count: 0,
          lastReset: now
        };
        this.rateLimiters.set(key, limiter);
      }

      // Reset counter if window has expired
      if (now - limiter.lastReset > this.config.auth.rateLimit.windowMs) {
        limiter.count = 0;
        limiter.lastReset = now;
      }

      limiter.count++;
      const isLimited = limiter.count > this.config.auth.rateLimit.maxRequests;

      if (isLimited) {
        this.metrics.increment('auth.rate.limit.exceeded');
      } else {
        this.metrics.increment('auth.rate.limit.check.success');
      }

      return isLimited;
    } catch (error) {
      logger.error('Error checking rate limit', { error: error.message, key });
      return false; // Fail open on error
    }
  }

  /**
     * Create a new token-based session
     * @param {Object} userData - User data including userId, roles, and clientId
     * @returns {Object} Session object with access and refresh tokens
     */
  async createTokenSession(userData) {
    try {
      if (!userData || !userData.userId || !userData.clientId) {
        throw new Error('Invalid user data');
      }

      const accessToken = await this.tokenAuth.generateToken(userData);
      const refreshToken = await this.tokenAuth.generateToken({
        ...userData,
        isRefreshToken: true
      });

      this.metrics.increment('auth.token.session.creation.success');
      return {
        accessToken,
        refreshToken,
        expiresIn: this.config.auth?.tokenExpiration || 3600
      };
    } catch (error) {
      logger.error('Token session creation failed:', error);
      this.metrics.increment('auth.token.session.creation.error');
      throw error;
    }
  }

  /**
     * Validate a token-based session
     * @param {string} token - Token to validate
     * @returns {Object} Decoded token data if valid
     */
  async validateTokenSession(token) {
    try {
      if (!token) {
        throw new Error('Token is required');
      }

      const isValid = await this.tokenAuth.validateToken(token);
      if (!isValid) {
        this.metrics.increment('auth.token.session.validation.error');
        throw new Error('Invalid token');
      }

      this.metrics.increment('auth.token.session.validation.success');
      return isValid;
    } catch (error) {
      logger.error('Token session validation failed:', error);
      this.metrics.increment('auth.token.session.validation.error');
      throw error;
    }
  }

  /**
     * Refresh a token-based session
     * @param {string} refreshToken - Refresh token
     * @returns {Object} New session tokens
     */
  async refreshTokenSession(refreshToken) {
    try {
      if (!refreshToken) {
        throw new Error('Refresh token is required');
      }

      const newTokens = await this.tokenAuth.refreshToken(refreshToken);
      this.metrics.increment('auth.token.session.refresh.success');
      return newTokens;
    } catch (error) {
      logger.error('Token session refresh failed:', error);
      this.metrics.increment('auth.token.session.refresh.error');
      throw error;
    }
  }

  /**
     * Clean up expired sessions and resources
     */
  cleanup() {
    try {
      // Clear all sessions
      this.activeSessions.clear();
      this.sessions.clear();
            
      // Clear rate limiters
      this.rateLimiters.clear();
            
      // Clear auth failure counts
      this.authFailureCount.clear();
            
      // Clear blocked clients
      this.blockedClients.clear();
            
      // Stop cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
            
      // Stop rate limiter
      if (this.rateLimiter) {
        this.rateLimiter.stop();
      }
            
      this.metrics.increment('auth.cleanup.success');
    } catch (error) {
      this.logger.error('Auth service cleanup failed:', error);
      this.metrics.increment('auth.cleanup.error');
    }
  }

  /**
     * Stop the auth service and clean up resources
     */
  stop() {
    this.cleanup();
  }

  /**
     * Signs a message for secure transmission
     * @param {string} message - Message to sign
     * @returns {Promise<string>} Signed message
     */
  async signMessage(message) {
    try {
      const signature = crypto.createHmac('sha256', this.config.auth.jwtSecret)
        .update(message)
        .digest('hex');
            
      const timestamp = Date.now();
      return `${signature}.${timestamp}`;
    } catch (error) {
      this.logger.error('Message signing error:', error);
      throw error;
    }
  }

  /**
     * Verifies a signed message
     * @param {string} message - Original message
     * @param {string} signedMessage - Signed message to verify
     * @returns {Promise<boolean>} True if valid, false otherwise
     */
  async verifyMessage(message, signedMessage) {
    try {
      const [signature, timestamp] = signedMessage.split('.');
      const messageAge = Date.now() - parseInt(timestamp);

      // Check if message has expired (1 second TTL)
      if (messageAge > 1000) {
        throw new Error('Message expired');
      }

      const expectedSignature = crypto.createHmac('sha256', this.config.auth.jwtSecret)
        .update(message)
        .digest('hex');

      if (signature !== expectedSignature) {
        throw new Error('Invalid message signature');
      }

      return true;
    } catch (error) {
      this.logger.error('Message verification error:', error);
      throw error;
    }
  }

  /**
     * Processes large data with size limits
     * @param {string} clientId - Client identifier
     * @param {string} data - Data to process
     * @returns {Promise<void>}
     */
  async processLargeData(clientId, data) {
    try {
      if (!clientId || !data) {
        throw new Error('Client ID and data are required');
      }

      // Check data size (5MB limit)
      if (Buffer.byteLength(data) > 5 * 1024 * 1024) {
        throw new Error('Request too large');
      }

      // Process data
      // ... implementation specific to your needs ...

    } catch (error) {
      this.logger.error('Large data processing error:', error);
      throw error;
    }
  }

  /**
     * Creates a new connection
     * @param {string} clientId - Client identifier
     * @returns {Promise<Object>} Connection object
     */
  async createConnection(clientId) {
    try {
      const activeConnections = Array.from(this.activeSessions.values()).length;
      if (activeConnections >= this.config.auth.maxConnections) {
        throw new Error('Maximum connections reached');
      }

      const connection = {
        id: crypto.randomBytes(16).toString('hex'),
        clientId,
        createdAt: Date.now(),
        close: async () => {
          await this.removeSession(connection.id);
        }
      };

      this.activeSessions.set(connection.id, connection);
      return connection;
    } catch (error) {
      this.logger.error('Connection creation error:', error);
      throw error;
    }
  }

  /**
     * Closes a connection
     * @param {string} connectionId - Connection ID to close
     * @returns {Promise<void>}
     */
  async closeConnection(connectionId) {
    try {
      if (!connectionId) {
        throw new Error('Connection ID is required');
      }

      this.activeSessions.delete(connectionId);
    } catch (error) {
      this.logger.error('Connection closure error:', error);
      throw error;
    }
  }
}

module.exports = AuthService;