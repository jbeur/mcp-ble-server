const crypto = require('crypto');

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../src/metrics/metrics', () => ({
  metrics: {
    increment: jest.fn()
  }
}));

const { logger } = require('../../../src/utils/logger');
const { metrics } = require('../../../src/metrics/metrics');
const OAuth2Service = require('../../../src/auth/OAuth2Service');

describe('OAuth2Service', () => {
  let oauth2Service;
  let testConfig;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    testConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      sessionExpiry: 3600000,
      maxConcurrentSessions: 3,
      authorizationEndpoint: 'https://auth.example.com/authorize',
      authorizationCodeExpiry: 300000,
      accessTokenExpiry: 3600,
      refreshTokenExpiry: 86400,
      jwtSecret: 'test-jwt-secret'
    };

    oauth2Service = new OAuth2Service(testConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      expect(oauth2Service).toBeDefined();
    });

    it('should throw error if config is missing', () => {
      expect(() => new OAuth2Service()).toThrow('OAuth2 config is required');
    });

    it('should throw error if required config params are missing', () => {
      expect(() => new OAuth2Service({})).toThrow('Required OAuth2 config parameters missing');
    });
  });

  describe('generateAuthorizationUrl', () => {
    it('should generate a valid authorization URL', () => {
      const state = 'test-state';
      const nonce = 'test-nonce';
      const url = oauth2Service.generateAuthorizationUrl(
        testConfig.clientId,
        testConfig.redirectUri,
        state,
        nonce
      );

      expect(url).toContain(testConfig.authorizationEndpoint);
      expect(url).toContain(`client_id=${testConfig.clientId}`);
      expect(url).toContain(`redirect_uri=${encodeURIComponent(testConfig.redirectUri)}`);
      expect(url).toContain(`state=${state}`);
      expect(url).toContain(`nonce=${nonce}`);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_authorization_url_generated');
    });

    it('should throw error if required parameters are missing', () => {
      expect(() => oauth2Service.generateAuthorizationUrl()).toThrow('Missing required parameters');
    });
  });

  describe('generateAuthorizationCode', () => {
    it('should generate a valid authorization code', () => {
      const code = oauth2Service.generateAuthorizationCode(
        testConfig.clientId,
        testConfig.redirectUri
      );

      expect(code).toBeDefined();
      expect(code).toHaveLength(64); // 32 bytes in hex
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_authorization_code_generated');
    });
  });

  describe('exchangeCodeForToken', () => {
    let code;

    beforeEach(() => {
      code = oauth2Service.generateAuthorizationCode(
        testConfig.clientId,
        testConfig.redirectUri
      );
    });

    it('should exchange valid authorization code for tokens', async () => {
      const tokens = await oauth2Service.exchangeCodeForToken(
        code,
        testConfig.clientId,
        testConfig.clientSecret
      );

      expect(tokens).toHaveProperty('access_token');
      expect(tokens).toHaveProperty('refresh_token');
      expect(tokens).toHaveProperty('token_type', 'Bearer');
      expect(tokens).toHaveProperty('expires_in', testConfig.accessTokenExpiry);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_token_exchange_success');
    });

    it('should reject invalid client credentials', async () => {
      await expect(oauth2Service.exchangeCodeForToken(
        code,
        'wrong-client',
        'wrong-secret'
      )).rejects.toThrow('Invalid client credentials');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });

    it('should reject expired authorization code', async () => {
      jest.advanceTimersByTime(testConfig.authorizationCodeExpiry + 1);
      
      await expect(oauth2Service.exchangeCodeForToken(
        code,
        testConfig.clientId,
        testConfig.clientSecret
      )).rejects.toThrow('Authorization code expired');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });
  });

  describe('refreshAccessToken', () => {
    let refresh_token;

    beforeEach(async () => {
      const code = oauth2Service.generateAuthorizationCode(
        testConfig.clientId,
        testConfig.redirectUri
      );
      const tokens = await oauth2Service.exchangeCodeForToken(
        code,
        testConfig.clientId,
        testConfig.clientSecret
      );
      refresh_token = tokens.refresh_token;
    });

    it('should refresh access token with valid refresh token', async () => {
      const newTokens = await oauth2Service.refreshAccessToken(refresh_token);
      expect(newTokens).toHaveProperty('access_token');
      expect(newTokens).toHaveProperty('token_type', 'Bearer');
      expect(newTokens).toHaveProperty('expires_in', testConfig.accessTokenExpiry);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_token_refresh_success');
    });

    it('should reject expired refresh token', async () => {
      jest.advanceTimersByTime(testConfig.refreshTokenExpiry * 1000 + 1);
      
      await expect(oauth2Service.refreshAccessToken(refresh_token))
        .rejects.toThrow('Refresh token expired');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });
  });

  describe('validateAccessToken', () => {
    let access_token;

    beforeEach(async () => {
      const code = oauth2Service.generateAuthorizationCode(
        testConfig.clientId,
        testConfig.redirectUri
      );
      const tokens = await oauth2Service.exchangeCodeForToken(
        code,
        testConfig.clientId,
        testConfig.clientSecret
      );
      access_token = tokens.access_token;
    });

    it('should validate valid access token', async () => {
      const decoded = await oauth2Service.validateAccessToken(access_token);
      expect(decoded).toHaveProperty('clientId', testConfig.clientId);
      expect(logger.debug).toHaveBeenCalledWith('Token validated successfully');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_token_validation_success');
    });

    it('should reject expired access token', async () => {
      jest.advanceTimersByTime(testConfig.accessTokenExpiry * 1000 + 1);
      
      await expect(oauth2Service.validateAccessToken(access_token))
        .rejects.toThrow('Token expired');
      expect(logger.error).toHaveBeenCalledWith('Token validation failed: Token expired');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });

    it('should reject invalid token format', async () => {
      await expect(oauth2Service.validateAccessToken('invalid-token'))
        .rejects.toThrow('Invalid token format');
      expect(logger.error).toHaveBeenCalledWith('Token validation failed: Invalid token format', expect.any(Object));
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });
  });

  describe('validateCSRFToken', () => {
    let csrfToken;

    beforeEach(() => {
      csrfToken = crypto.randomBytes(32).toString('hex');
      oauth2Service.csrfTokens.set(csrfToken, {
        expiresAt: Date.now() + 3600000
      });
    });

    it('should validate matching CSRF tokens', async () => {
      const req = { headers: { csrfToken } };
      await expect(oauth2Service.validateCSRFToken(req)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith('CSRF token validated successfully');
    });

    it('should reject missing CSRF token', async () => {
      const req = { headers: {} };
      await expect(oauth2Service.validateCSRFToken(req))
        .rejects.toThrow('CSRF token validation failed');
      expect(logger.error).toHaveBeenCalledWith('Missing CSRF token in request');
    });

    it('should reject mismatched CSRF tokens', async () => {
      const req = { headers: { csrfToken: 'wrong-token' } };
      await expect(oauth2Service.validateCSRFToken(req))
        .rejects.toThrow('CSRF token validation failed');
      expect(logger.error).toHaveBeenCalledWith('CSRF token not found');
    });

    it('should reject expired CSRF tokens', async () => {
      const req = { headers: { csrfToken } };
      jest.advanceTimersByTime(3600000 + 1);
      
      await expect(oauth2Service.validateCSRFToken(req))
        .rejects.toThrow('CSRF token expired');
      expect(logger.error).toHaveBeenCalledWith('CSRF token expired');
    });
  });

  describe('session management', () => {
    it('should create and delete sessions', () => {
      const userId = 'test-user';
      const sessionId = oauth2Service.createSession(userId);
      
      expect(sessionId).toBeDefined();
      expect(oauth2Service.activeSessions.get(sessionId)).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_session_created');
      
      oauth2Service.deleteSession(sessionId);
      expect(oauth2Service.activeSessions.has(sessionId)).toBeFalsy();
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_session_deleted');
    });

    it('should enforce concurrent session limits', () => {
      const userId = 'test-user';
      
      // Create max number of sessions
      for (let i = 0; i < testConfig.maxConcurrentSessions; i++) {
        oauth2Service.createSession(userId);
      }
      
      // Attempt to create one more session
      expect(() => oauth2Service.createSession(userId))
        .toThrow('Maximum concurrent sessions reached');
      expect(logger.error).toHaveBeenCalledWith('Session limit reached for user: ' + userId);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_error');
    });

    it('should cleanup expired sessions', () => {
      const userId = 'test-user';
      const sessionId = oauth2Service.createSession(userId);
      
      jest.advanceTimersByTime(testConfig.sessionExpiry + 1);
      
      oauth2Service.cleanupExpiredSessions();
      expect(oauth2Service.activeSessions.has(sessionId)).toBeFalsy();
      expect(logger.info).toHaveBeenCalledWith('Cleaned up expired sessions', { count: 1 });
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_cleanup_success');
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should clean up expired tokens', async () => {
      const code = oauth2Service.generateAuthorizationCode(testConfig.clientId, testConfig.redirectUri);
      jest.advanceTimersByTime(testConfig.authorizationCodeExpiry + 1);
      
      oauth2Service.cleanupExpiredTokens();
      
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_cleanup_success');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2_authorization_code_expired');
    });
  });
}); 