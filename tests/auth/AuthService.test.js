const AuthService = require('../../src/auth/AuthService');
const ApiKeyManager = require('../../src/auth/ApiKeyManager');
const TokenAuthentication = require('../../src/auth/TokenAuthentication');
const OAuth2Service = require('../../src/auth/OAuth2Service');
const ThreatDetectionService = require('../../src/security/ThreatDetectionService');
const RateLimiter = require('../../src/auth/RateLimiter');
const SessionEncryption = require('../../src/mcp/security/SessionEncryption');
const logger = require('../../src/utils/logger');
const metrics = require('../../src/utils/metrics');

// Mock dependencies
jest.mock('../../src/auth/ApiKeyManager');
jest.mock('../../src/auth/TokenAuthentication');
jest.mock('../../src/auth/OAuth2Service');
jest.mock('../../src/security/ThreatDetectionService');
jest.mock('../../src/auth/RateLimiter');
jest.mock('../../src/mcp/security/SessionEncryption');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/metrics');

describe('AuthService', () => {
  let authService;
  let mockConfig;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup default config
    mockConfig = {
      auth: {
        maxFailedAttempts: 3,
        lockoutDuration: 900000, // 15 minutes
        sessionDuration: 3600000, // 1 hour
        jwtSecret: 'test-secret'
      },
      rateLimiting: {
        maxRequests: 100,
        windowMs: 60000
      }
    };

    // Setup mock implementations
    ApiKeyManager.mockImplementation(() => ({
      validateKey: jest.fn().mockResolvedValue(true),
      removeKey: jest.fn()
    }));

    TokenAuthentication.mockImplementation(() => ({
      validateToken: jest.fn().mockResolvedValue(true),
      createToken: jest.fn().mockResolvedValue('mock-token')
    }));

    OAuth2Service.mockImplementation(() => ({
      validateToken: jest.fn().mockResolvedValue(true),
      refreshToken: jest.fn().mockResolvedValue('new-token')
    }));

    ThreatDetectionService.mockImplementation(() => ({
      isIpBlocked: jest.fn().mockResolvedValue(false),
      hasHighSeverityThreats: jest.fn().mockResolvedValue(false)
    }));

    RateLimiter.mockImplementation(() => ({
      isRateLimited: jest.fn().mockReturnValue(false)
    }));

    SessionEncryption.mockImplementation(() => ({
      encryptSession: jest.fn().mockResolvedValue('encrypted-data'),
      decryptSession: jest.fn().mockResolvedValue(JSON.stringify({
        sessionId: 'test-session',
        clientId: 'test-client',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        expiresAt: Date.now() + 3600000
      }))
    }));

    // Setup logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();

    // Setup metrics mock
    metrics.increment = jest.fn();

    // Create auth service instance
    authService = new AuthService(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultConfig = {
        auth: {
          jwtSecret: 'default-secret'
        }
      };
      const service = new AuthService(defaultConfig);
      expect(service.config.auth.maxFailedAttempts).toBe(5);
      expect(service.config.auth.lockoutDuration).toBe(15 * 60 * 1000);
      expect(service.config.auth.sessionDuration).toBe(3600000);
    });

    it('should initialize with custom config', () => {
      const service = new AuthService(mockConfig);
      expect(service.config.auth.maxFailedAttempts).toBe(3);
      expect(service.config.auth.lockoutDuration).toBe(900000);
      expect(service.config.auth.sessionDuration).toBe(3600000);
    });
  });

  describe('authenticate', () => {
    it('should successfully authenticate with valid credentials', async () => {
      const result = await authService.authenticate('test-client', 'valid-key');
      expect(result).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('auth.success');
    });

    it('should throw error for missing credentials', async () => {
      await expect(authService.authenticate('', '')).rejects.toThrow('Client ID and API key are required');
      expect(metrics.increment).toHaveBeenCalledWith('auth.failure');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle blocked client', async () => {
      authService.blockedClients.set('blocked-client', { expiresAt: Date.now() + 900000 });
      await expect(authService.authenticate('blocked-client', 'any-key')).rejects.toThrow('Invalid API key');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle rate limiting', async () => {
      RateLimiter.mockImplementation(() => ({
        isRateLimited: jest.fn().mockReturnValue(true)
      }));
      const service = new AuthService(mockConfig);
      await expect(service.authenticate('test-client', 'valid-key')).rejects.toThrow('Rate limit exceeded');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const sessionId = await authService.createSession('test-client');
      expect(sessionId).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('session.creation.success');
    });

    it('should throw error for missing clientId', async () => {
      await expect(authService.createSession('')).rejects.toThrow('Client ID is required');
      expect(metrics.increment).toHaveBeenCalledWith('session.creation.error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('validateSession', () => {
    it('should validate existing session', async () => {
      const sessionId = 'test-session';
      authService.activeSessions.set(sessionId, 'encrypted-data');
      const result = await authService.validateSession(sessionId);
      expect(result).toBe(true);
    });

    it('should throw error for missing session', async () => {
      await expect(authService.validateSession('nonexistent')).rejects.toThrow('Session not found');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle expired session', async () => {
      SessionEncryption.mockImplementation(() => ({
        decryptSession: jest.fn().mockResolvedValue(JSON.stringify({
          sessionId: 'test-session',
          clientId: 'test-client',
          createdAt: Date.now() - 7200000, // 2 hours ago
          lastActivity: Date.now() - 7200000,
          expiresAt: Date.now() - 3600000 // 1 hour ago
        }))
      }));
      const service = new AuthService(mockConfig);
      service.activeSessions.set('test-session', 'encrypted-data');
      await expect(service.validateSession('test-session')).rejects.toThrow('Session expired');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('validateApiKey', () => {
    it('should validate correct API key', async () => {
      const result = await authService.validateApiKey('test-client', 'valid-key');
      expect(result).toBe(true);
    });

    it('should handle invalid API key', async () => {
      ApiKeyManager.mockImplementation(() => ({
        validateKey: jest.fn().mockResolvedValue(false)
      }));
      const service = new AuthService(mockConfig);
      await expect(service.validateApiKey('test-client', 'invalid-key')).rejects.toThrow('Invalid API key');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired sessions', async () => {
      // Mock the decryptSession to return an expired session
      SessionEncryption.mockImplementation(() => ({
        decryptSession: jest.fn().mockResolvedValue(JSON.stringify({
          sessionId: 'old-session',
          clientId: 'test-client',
          createdAt: Date.now() - 7200000,
          lastActivity: Date.now() - 7200000,
          expiresAt: Date.now() - 3600000
        }))
      }));

      const service = new AuthService(mockConfig);
      service.activeSessions.set('old-session', 'encrypted-data');
      await service.cleanupSessions();
      expect(service.activeSessions.has('old-session')).toBe(false);
    });
  });
}); 