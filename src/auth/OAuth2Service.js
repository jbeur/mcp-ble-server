const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const { metrics } = require('../metrics/metrics');

class OAuth2Service {
  constructor(config) {
    if (!config) {
      throw new Error('OAuth2 config is required');
    }

    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new Error('Required OAuth2 config parameters missing');
    }

    this.config = config;
    
    this.authorizationCodes = new Map();
    this.sessions = new Map();
    this.csrfTokens = new Map();
    this.usedAuthorizationCodes = new Set();
    this.activeSessions = new Map();
    this.sessionExpiry = config.sessionExpiry || 3600000; // 1 hour default
    this.maxConcurrentSessions = config.maxConcurrentSessions || 3;

    this.metrics = {
      oauth2AuthorizationCodeGenerated: {
        inc: () => metrics.increment('oauth2_authorization_code_generated')
      },
      oauth2CleanupSuccess: {
        inc: () => metrics.increment('oauth2_cleanup_success')
      },
      oauth2TokenExchangeSuccess: {
        inc: () => metrics.increment('oauth2_token_exchange_success')
      },
      oauth2TokenRefreshSuccess: {
        inc: () => metrics.increment('oauth2_token_refresh_success')
      },
      oauth2TokenValidationSuccess: {
        inc: () => metrics.increment('oauth2_token_validation_success')
      },
      oauth2Error: {
        inc: () => metrics.increment('oauth2_error')
      },
      oauth2AuthorizationUrlGenerated: {
        inc: () => metrics.increment('oauth2_authorization_url_generated')
      },
      oauth2SessionCreated: {
        inc: () => metrics.increment('oauth2_session_created')
      },
      oauth2SessionDeleted: {
        inc: () => metrics.increment('oauth2_session_deleted')
      },
      oauth2AuthorizationCodeExpired: {
        inc: () => metrics.increment('oauth2_authorization_code_expired')
      }
    };
  }

  generateAuthorizationUrl(clientId, redirectUri, state, nonce) {
    if (!clientId || !redirectUri || !state || !nonce) {
      throw new Error('Missing required parameters');
    }

    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('redirect_uri', redirectUri);
    url.searchParams.append('state', state);
    url.searchParams.append('nonce', nonce);
    url.searchParams.append('response_type', 'code');

    this.metrics.oauth2AuthorizationUrlGenerated.inc();
    return url.toString();
  }

  generateAuthorizationCode(clientId, redirectUri) {
    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.config.authorizationCodeExpiry;

    this.authorizationCodes.set(code, {
      clientId,
      redirectUri,
      expiresAt
    });

    this.metrics.oauth2AuthorizationCodeGenerated.inc();
    return code;
  }

  async exchangeCodeForToken(code, clientId, clientSecret) {
    const storedCode = this.authorizationCodes.get(code);

    if (!storedCode) {
      logger.error('Authorization code not found');
      this.metrics.oauth2Error.inc();
      throw new Error('Invalid authorization code');
    }

    if (storedCode.expiresAt < Date.now()) {
      logger.error('Authorization code expired');
      this.metrics.oauth2Error.inc();
      throw new Error('Authorization code expired');
    }

    if (storedCode.clientId !== clientId) {
      logger.error('Client ID mismatch');
      this.metrics.oauth2Error.inc();
      throw new Error('Invalid client credentials');
    }

    if (this.usedAuthorizationCodes.has(code)) {
      logger.error('Authorization code already used');
      this.metrics.oauth2Error.inc();
      throw new Error('Authorization code already used');
    }

    this.usedAuthorizationCodes.add(code);
    this.authorizationCodes.delete(code);

    const access_token = jwt.sign(
      { clientId },
      this.config.jwtSecret,
      { expiresIn: this.config.accessTokenExpiry }
    );

    const refresh_token = jwt.sign(
      { clientId },
      this.config.jwtSecret,
      { expiresIn: this.config.refreshTokenExpiry }
    );

    this.metrics.oauth2TokenExchangeSuccess.inc();
    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenExpiry
    };
  }

  async refreshAccessToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, this.config.jwtSecret);
      
      const access_token = jwt.sign(
        { clientId: decoded.clientId },
        this.config.jwtSecret,
        { expiresIn: this.config.accessTokenExpiry }
      );

      this.metrics.oauth2TokenRefreshSuccess.inc();
      return {
        access_token,
        token_type: 'Bearer',
        expires_in: this.config.accessTokenExpiry
      };
    } catch (error) {
      this.metrics.oauth2Error.inc();
      if (error.name === 'TokenExpiredError') {
        logger.error('Refresh token expired');
        throw new Error('Refresh token expired');
      }
      logger.error('Invalid refresh token', { error: error.message });
      throw new Error('Invalid refresh token');
    }
  }

  async validateAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret);
      logger.debug('Token validated successfully');
      this.metrics.oauth2TokenValidationSuccess.inc();
      return decoded;
    } catch (error) {
      this.metrics.oauth2Error.inc();
      if (error.name === 'TokenExpiredError') {
        logger.error('Token validation failed: Token expired');
        throw new Error('Token expired');
      }
      if (error.name === 'JsonWebTokenError') {
        logger.error('Token validation failed: Invalid token format', { error: error.message });
        throw new Error('Invalid token format');
      }
      logger.error('Token validation failed', { error: error.message });
      throw error;
    }
  }

  async validateCSRFToken(req) {
    if (!req || !req.headers || !req.headers.csrfToken) {
      logger.error('Missing CSRF token in request');
      this.metrics.oauth2Error.inc();
      throw new Error('CSRF token validation failed');
    }

    const { csrfToken } = req.headers;
    const storedToken = this.csrfTokens.get(csrfToken);

    if (!storedToken) {
      logger.error('CSRF token not found');
      this.metrics.oauth2Error.inc();
      throw new Error('CSRF token validation failed');
    }

    if (storedToken.expiresAt < Date.now()) {
      logger.error('CSRF token expired');
      this.metrics.oauth2Error.inc();
      throw new Error('CSRF token expired');
    }

    logger.debug('CSRF token validated successfully');
    return true;
  }

  createSession(userId) {
    const activeSessions = Array.from(this.activeSessions.values())
      .filter(session => session.userId === userId);

    if (activeSessions.length >= this.maxConcurrentSessions) {
      logger.error('Session limit reached for user: ' + userId);
      this.metrics.oauth2Error.inc();
      throw new Error('Maximum concurrent sessions reached');
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    const session = {
      id: sessionId,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionExpiry
    };

    this.activeSessions.set(sessionId, session);
    logger.debug(`Created new session: ${sessionId}`);
    this.metrics.oauth2SessionCreated.inc();
    return sessionId;
  }

  deleteSession(sessionId) {
    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.delete(sessionId);
      logger.debug(`Deleted session: ${sessionId}`);
      this.metrics.oauth2SessionDeleted.inc();
      return true;
    }
    return false;
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.expiresAt < now) {
        this.activeSessions.delete(sessionId);
        logger.debug(`Cleaned up expired session: ${sessionId}`);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up expired sessions', { count: cleanedCount });
      this.metrics.oauth2CleanupSuccess.inc();
    }
  }

  cleanupExpiredTokens() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [code, data] of this.authorizationCodes.entries()) {
      if (data.expiresAt < now) {
        this.authorizationCodes.delete(code);
        cleanedCount++;
        this.metrics.oauth2Error.inc();
      }
    }

    for (const [tokenId, token] of this.csrfTokens.entries()) {
      if (token.expiresAt < now) {
        this.csrfTokens.delete(tokenId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired tokens`);
      logger.debug('Cleaned up expired tokens', { count: cleanedCount });
      this.metrics.oauth2CleanupSuccess.inc();
      this.metrics.oauth2AuthorizationCodeExpired.inc();
    }
  }

  stop() {
    this.authorizationCodes.clear();
    this.sessions.clear();
    this.csrfTokens.clear();
    this.usedAuthorizationCodes.clear();
  }
}

module.exports = OAuth2Service; 