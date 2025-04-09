const OAuth2Service = require('../../src/auth/OAuth2Service');
const jwt = require('jsonwebtoken');
const logger = require('../../src/utils/logger');
const metrics = require('../../src/utils/metrics');

jest.mock('jsonwebtoken');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/metrics');

describe('OAuth2Service', () => {
  let oauth2Service;
  let mockConfig;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup environment variables
    process.env = {
      ...originalEnv,
      OAUTH2_REDIRECT_URI: 'http://localhost:3000/callback',
      JWT_SECRET: 'test-secret'
    };

    // Setup mock config
    mockConfig = {
      oauth2: {
        authCodeExpiry: 600000, // 10 minutes
        sessionExpiry: 3600000 // 1 hour
      }
    };

    // Setup mock implementations
    jwt.sign = jest.fn().mockReturnValue('mock-token');

    // Setup logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();

    // Setup metrics mock
    metrics.increment = jest.fn();

    // Create service instance
    oauth2Service = new OAuth2Service(mockConfig);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const service = new OAuth2Service();
      expect(service.config).toEqual({});
      expect(service.authorizationCodes).toBeDefined();
      expect(service.activeSessions).toBeDefined();
      expect(service.csrfTokens).toBeDefined();
      expect(service.usedAuthCodes).toBeDefined();
    });

    it('should initialize with custom config', () => {
      const service = new OAuth2Service(mockConfig);
      expect(service.config).toEqual(mockConfig);
    });
  });

  describe('generateAuthorizationUrl', () => {
    it('should generate valid authorization URL', () => {
      const clientId = 'test-client';
      const state = 'test-state';
      const url = oauth2Service.generateAuthorizationUrl(clientId, state);
      
      expect(url).toContain(process.env.OAUTH2_REDIRECT_URI);
      expect(url).toContain(`client_id=${clientId}`);
      expect(url).toContain(`state=${state}`);
      expect(url).toContain('response_type=code');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.url.generation.success');
    });

    it('should generate CSRF token when state is not provided', () => {
      const clientId = 'test-client';
      const url = oauth2Service.generateAuthorizationUrl(clientId);
      
      expect(url).toContain(process.env.OAUTH2_REDIRECT_URI);
      expect(url).toContain(`client_id=${clientId}`);
      expect(url).toContain('state=');
      expect(oauth2Service.csrfTokens.size).toBe(1);
    });

    it('should throw error for missing client ID', () => {
      expect(() => oauth2Service.generateAuthorizationUrl()).toThrow('Client ID is required');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.url.generation.error');
    });
  });

  describe('createAuthorizationCode', () => {
    it('should create valid authorization code', async () => {
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';
      const scope = 'read write';
      const state = 'test-state';

      // Setup CSRF token
      oauth2Service.csrfTokens.set(state, {
        clientId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000
      });

      const code = await oauth2Service.createAuthorizationCode(clientId, redirectUri, scope, state);
      
      expect(code).toBeDefined();
      expect(oauth2Service.authorizationCodes.has(code)).toBe(true);
      expect(oauth2Service.csrfTokens.has(state)).toBe(false);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.code.generation.success');
    });

    it('should throw error for missing parameters', async () => {
      await expect(oauth2Service.createAuthorizationCode()).rejects.toThrow('Missing required parameters');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.code.generation.error');
    });

    it('should throw error for invalid CSRF token', async () => {
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';
      const scope = 'read write';
      const state = 'invalid-state';

      await expect(oauth2Service.createAuthorizationCode(clientId, redirectUri, scope, state))
        .rejects.toThrow('Invalid CSRF token');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.csrf.validation.error');
    });
  });

  describe('createOAuth2Session', () => {
    it('should create valid OAuth2 session', async () => {
      const code = 'test-code';
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';

      // Setup authorization code
      oauth2Service.authorizationCodes.set(code, {
        clientId,
        redirectUri,
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000
      });

      const session = await oauth2Service.createOAuth2Session(code, clientId, redirectUri);
      
      expect(session).toBeDefined();
      expect(session.token).toBe('mock-token');
      expect(oauth2Service.activeSessions.has(clientId)).toBe(true);
      expect(oauth2Service.usedAuthCodes.has(code)).toBe(true);
      expect(oauth2Service.authorizationCodes.has(code)).toBe(false);
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.session.creation.success');
    });

    it('should throw error for missing parameters', async () => {
      await expect(oauth2Service.createOAuth2Session()).rejects.toThrow('Missing required parameters');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.session.creation.error');
    });

    it('should throw error for used authorization code', async () => {
      const code = 'used-code';
      oauth2Service.usedAuthCodes.add(code);

      await expect(oauth2Service.createOAuth2Session(code, 'test-client', 'http://localhost:3000/callback'))
        .rejects.toThrow('Authorization code has already been used');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.validation.error');
    });

    it('should throw error for invalid authorization code', async () => {
      await expect(oauth2Service.createOAuth2Session('invalid-code', 'test-client', 'http://localhost:3000/callback'))
        .rejects.toThrow('Invalid authorization code');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.validation.error');
    });

    it('should throw error for client ID mismatch', async () => {
      const code = 'test-code';
      oauth2Service.authorizationCodes.set(code, {
        clientId: 'original-client',
        redirectUri: 'http://localhost:3000/callback',
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000
      });

      await expect(oauth2Service.createOAuth2Session(code, 'different-client', 'http://localhost:3000/callback'))
        .rejects.toThrow('Client ID mismatch');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.validation.error');
    });

    it('should throw error for redirect URI mismatch', async () => {
      const code = 'test-code';
      oauth2Service.authorizationCodes.set(code, {
        clientId: 'test-client',
        redirectUri: 'http://localhost:3000/callback',
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000
      });

      await expect(oauth2Service.createOAuth2Session(code, 'test-client', 'http://different-uri/callback'))
        .rejects.toThrow('Redirect URI mismatch');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.validation.error');
    });

    it('should throw error for expired authorization code', async () => {
      const code = 'expired-code';
      oauth2Service.authorizationCodes.set(code, {
        clientId: 'test-client',
        redirectUri: 'http://localhost:3000/callback',
        createdAt: Date.now() - 7200000, // 2 hours ago
        expiresAt: Date.now() - 3600000 // 1 hour ago
      });

      await expect(oauth2Service.createOAuth2Session(code, 'test-client', 'http://localhost:3000/callback'))
        .rejects.toThrow('Authorization code expired');
      expect(metrics.increment).toHaveBeenCalledWith('oauth2.validation.error');
    });
  });

  describe('stop', () => {
    it('should clear all data structures', async () => {
      // Setup some data
      oauth2Service.authorizationCodes.set('test', {});
      oauth2Service.activeSessions.set('test', {});
      oauth2Service.csrfTokens.set('test', {});
      oauth2Service.usedAuthCodes.add('test');

      await oauth2Service.stop();

      expect(oauth2Service.authorizationCodes.size).toBe(0);
      expect(oauth2Service.activeSessions.size).toBe(0);
      expect(oauth2Service.csrfTokens.size).toBe(0);
      expect(oauth2Service.usedAuthCodes.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('OAuth2Service stopped');
    });

    it('should handle errors gracefully', async () => {
      // Mock Map.clear to throw error
      const mockClear = jest.fn().mockImplementation(() => {
        throw new Error('Clear failed');
      });
      oauth2Service.authorizationCodes.clear = mockClear;

      await oauth2Service.stop();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should call stop and log completion', async () => {
      await oauth2Service.cleanup();
      expect(logger.info).toHaveBeenCalledWith('OAuth2Service cleanup completed');
    });

    it('should handle errors gracefully', async () => {
      // Mock stop to throw error
      oauth2Service.stop = jest.fn().mockRejectedValue(new Error('Stop failed'));

      await oauth2Service.cleanup();
      expect(logger.error).toHaveBeenCalled();
    });
  });
}); 