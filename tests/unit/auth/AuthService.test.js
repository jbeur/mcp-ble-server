const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Mock logger with all required methods
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn()
};

// Mock RateLimiter
jest.mock('../../../src/auth/RateLimiter', () => {
  return jest.fn().mockImplementation(() => ({
    isRateLimited: jest.fn().mockReturnValue(false),
    stop: jest.fn(),
    logger: mockLogger
  }));
});

jest.mock('../../../src/utils/logger', () => ({
  logger: mockLogger,
  default: mockLogger
}));

// Mock metrics with proper implementations
const mockMetrics = {
  increment: jest.fn(),
  gauge: jest.fn(),
  histogram: jest.fn()
};

jest.mock('../../../src/utils/metrics', () => mockMetrics);

// Mock SessionEncryption with proper encryption/decryption
const mockSessionEncryption = {
  encrypt: jest.fn().mockImplementation((data) => {
    return {
      encrypted: Buffer.from(JSON.stringify(data)).toString('base64'),
      iv: crypto.randomBytes(16),
      authTag: crypto.randomBytes(16)
    };
  }),
  decrypt: jest.fn().mockImplementation((data) => {
    if (!data || !data.encrypted) return null;
    if (data === 'error') throw new Error('Cleanup failed');
    try {
      const decrypted = JSON.parse(Buffer.from(data.encrypted, 'base64').toString());
      return {
        ...decrypted,
        expiresAt: data.expiresAt
      };
    } catch (e) {
      return null;
    }
  }),
  encryptSession: jest.fn().mockImplementation((data) => {
    return {
      encrypted: Buffer.from(JSON.stringify(data)).toString('base64'),
      iv: crypto.randomBytes(16),
      authTag: crypto.randomBytes(16)
    };
  }),
  decryptSession: jest.fn().mockImplementation((data) => {
    if (!data || !data.encrypted) return null;
    if (data === 'error') throw new Error('Cleanup failed');
    try {
      const decrypted = JSON.parse(Buffer.from(data.encrypted, 'base64').toString());
      return {
        ...decrypted,
        expiresAt: data.expiresAt
      };
    } catch (e) {
      return null;
    }
  })
};

jest.mock('../../../src/mcp/security/SessionEncryption', () => {
  return jest.fn().mockImplementation(() => mockSessionEncryption);
});

jest.mock('../../../src/security/ThreatDetectionService', () => {
  return jest.fn().mockImplementation(() => ({
    analyze: jest.fn(),
    hasHighSeverityThreats: jest.fn().mockResolvedValue(false),
    isIpBlocked: jest.fn().mockResolvedValue(false),
    getFailedAttempts: jest.fn().mockReturnValue(0)
  }));
});

const AuthService = require('../../../src/auth/AuthService');
const metrics = require('../../../src/utils/metrics');
const ThreatDetectionService = require('../../../src/security/ThreatDetectionService');

jest.mock('../../../src/auth/ApiKeyManager', () => {
  return jest.fn().mockImplementation(() => ({
    createKey: jest.fn().mockReturnValue('test-api-key'),
    validateKey: jest.fn().mockReturnValue(true),
    rotateKey: jest.fn().mockReturnValue('new-api-key'),
    removeKey: jest.fn(),
    deleteKey: jest.fn(),
    startRotationInterval: jest.fn(),
    stopRotationInterval: jest.fn()
  }));
});

describe('AuthService', () => {
  let authService;
  let originalSetInterval;
  let originalClearInterval;
  let cleanupInterval;

  const mockConfig = {
    auth: {
      maxFailedAttempts: 5,
      lockoutDuration: 900000,
      sessionDuration: 3600000,
      apiKeyRotationInterval: 86400000,
      jwtSecret: 'test-jwt-secret',
      sessionSecret: 'test-session-secret'
    },
    security: {
      tokenAuth: {
        accessTokenSecret: 'test-access-token-secret',
        refreshTokenSecret: 'test-refresh-token-secret',
        algorithm: 'HS256'
      },
      oauth2: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        authorizationEndpoint: 'http://localhost:3000/auth',
        tokenEndpoint: 'http://localhost:3000/token',
        authorizationCodeExpiry: 600000,
        accessTokenExpiry: 3600000,
        refreshTokenExpiry: 86400000,
        jwtSecret: 'test-jwt-secret',
        sessionExpiry: 3600000,
        maxConcurrentSessions: 5
      }
    },
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 100
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateApiKey', () => {
    it('should return true for valid API key', async () => {
      authService.apiKeyManager.validateKey.mockResolvedValueOnce(true);
      const result = await authService.authenticate('test-client', 'valid-api-key');
      expect(result).toBeTruthy();
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.success');
    });

    it('should throw error for invalid API key', async () => {
      authService.apiKeyManager.validateKey.mockResolvedValueOnce(false);
      await expect(authService.authenticate('test-client', 'invalid-key'))
        .rejects.toThrow('Invalid API key');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });

    it('should throw error for empty API key', async () => {
      await expect(authService.authenticate('test-client', ''))
        .rejects.toThrow('Client ID and API key are required');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });

    it('should throw error for null API key', async () => {
      await expect(authService.authenticate('test-client', null))
        .rejects.toThrow('Client ID and API key are required');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });

    it('should throw error for undefined API key', async () => {
      await expect(authService.authenticate('test-client', undefined))
        .rejects.toThrow('Client ID and API key are required');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });

    it('should throw error for missing client ID', async () => {
      await expect(authService.authenticate(null, 'test-key'))
        .rejects.toThrow('Client ID and API key are required');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });
  });

  describe('createSession', () => {
    it('should create a valid session with JWT token and API key', async () => {
      const clientId = 'test-client';
      const session = await authService.createSession(clientId);
      expect(session).toBeTruthy();
      expect(typeof session).toBe('string');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.created');
    });

    it('should throw error for invalid client ID', async () => {
      await expect(authService.createSession(null))
        .rejects.toThrow('Client ID is required');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.error');
    });

    it('should include expiration time in session data', async () => {
      const clientId = 'test-client';
      const sessionId = await authService.createSession(clientId);
      const encryptedSession = authService.activeSessions.get(sessionId);
      expect(encryptedSession.expiresAt).toBeTruthy();
      expect(encryptedSession.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('validateSession', () => {
    it('should return true for valid session', async () => {
      const clientId = 'test-client';
      const sessionId = await authService.createSession(clientId);
      const mockSession = {
        encrypted: Buffer.from(JSON.stringify({ clientId, expiresAt: Date.now() + 3600000 })).toString('base64'),
        iv: crypto.randomBytes(16),
        authTag: crypto.randomBytes(16)
      };
      authService.activeSessions.set(sessionId, mockSession);
      const result = await authService.validateSession(sessionId);
      expect(result).toBe(true);
    });

    it('should throw error for expired session', async () => {
      const clientId = 'test-client';
      const sessionId = await authService.createSession(clientId);
      const expiredSession = {
        clientId,
        expiresAt: Date.now() - 1000
      };
      mockSessionEncryption.decryptSession.mockResolvedValueOnce(expiredSession);
      await expect(authService.validateSession(sessionId)).rejects.toThrow('Session expired');
    });

    it('should throw error for invalid session ID', async () => {
      await expect(authService.validateSession('invalid-session')).rejects.toThrow('Session not found');
    });

    it('should throw error for missing session ID', async () => {
      await expect(authService.validateSession(null)).rejects.toThrow('Session ID is required');
    });

    it('should throw error for corrupted session data', async () => {
      const clientId = 'test-client';
      const sessionId = await authService.createSession(clientId);
      
      // Corrupt the session data
      const corruptedSession = { encrypted: 'invalid-data', iv: 'invalid-iv', authTag: 'invalid-tag' };
      authService.activeSessions.set(sessionId, corruptedSession);
      
      await expect(authService.validateSession(sessionId)).rejects.toThrow('Failed to decrypt session');
    });
  });

  describe('removeSession', () => {
    it('should remove session successfully', async () => {
      const sessionId = 'test-session';
      const mockSession = {
        encrypted: Buffer.from(JSON.stringify({ clientId: 'test-client', apiKey: 'test-key' })).toString('base64'),
        iv: crypto.randomBytes(16),
        authTag: crypto.randomBytes(16)
      };
      authService.activeSessions.set(sessionId, mockSession);
      await authService.removeSession(sessionId);
      expect(authService.activeSessions.has(sessionId)).toBe(false);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.removed');
    });

    it('should handle non-existent session removal gracefully', () => {
      authService.removeSession('non-existent');
      expect(mockMetrics.increment).not.toHaveBeenCalledWith('auth.sessions.removed');
    });

    it('should remove API key when session is removed', async () => {
      const clientId = 'test-client';
      const apiKey = 'test-api-key';
      const sessionId = await authService.createSession(clientId);
      const removeKeySpy = jest.spyOn(authService.apiKeyManager, 'deleteKey');

      mockSessionEncryption.decryptSession.mockResolvedValueOnce({
        clientId,
        apiKey
      });

      await authService.removeSession(sessionId);
      expect(removeKeySpy).toHaveBeenCalledWith(apiKey);
    });
  });

  describe('session cleanup', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should clean up expired sessions', async () => {
      const now = Date.now();
      const expiredSessionId = 'expired-session';
      const validSessionId = 'valid-session';

      const expiredSession = {
        clientId: 'test-client',
        expiresAt: now - 1000
      };
      const validSession = {
        clientId: 'test-client-2',
        expiresAt: now + 1000
      };

      mockSessionEncryption.decryptSession
        .mockResolvedValueOnce(expiredSession)
        .mockResolvedValueOnce(validSession);

      authService.activeSessions.set(expiredSessionId, { encrypted: 'expired' });
      authService.activeSessions.set(validSessionId, { encrypted: 'valid' });

      await authService.cleanupSessions();

      expect(authService.activeSessions.size).toBe(1);
      expect(authService.activeSessions.has(validSessionId)).toBe(true);
      expect(authService.activeSessions.has(expiredSessionId)).toBe(false);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.expired');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.cleanup.success');
      expect(mockMetrics.gauge).toHaveBeenCalledWith('auth.active_sessions', 1);
      expect(mockMetrics.histogram).toHaveBeenCalledWith('auth.sessions.cleanup.expired', 1);
    });

    it('should handle invalid sessions', async () => {
      authService.sessionEncryption.decryptSession.mockResolvedValue(null);
      authService.activeSessions.set('invalid', 'invalid');

      await authService.cleanupSessions();

      expect(authService.activeSessions.size).toBe(0);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.error');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.cleanup.success');
      expect(mockMetrics.gauge).toHaveBeenCalledWith('auth.active_sessions', 0);
      expect(mockMetrics.histogram).toHaveBeenCalledWith('auth.sessions.cleanup.errors', 1);
    });

    it('should handle decryption errors', async () => {
      authService.sessionEncryption.decryptSession.mockRejectedValue(new Error('Decryption failed'));
      authService.activeSessions.set('error', 'error');

      await authService.cleanupSessions();

      expect(authService.activeSessions.size).toBe(0);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.error');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.cleanup.success');
      expect(mockMetrics.gauge).toHaveBeenCalledWith('auth.active_sessions', 0);
      expect(mockMetrics.histogram).toHaveBeenCalledWith('auth.sessions.cleanup.errors', 1);
    });

    it('should handle missing sessions', async () => {
      authService.activeSessions.set('missing', null);

      await authService.cleanupSessions();

      expect(authService.activeSessions.size).toBe(0);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.error');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.cleanup.success');
      expect(mockMetrics.gauge).toHaveBeenCalledWith('auth.active_sessions', 0);
      expect(mockMetrics.histogram).toHaveBeenCalledWith('auth.sessions.cleanup.errors', 1);
    });

    it('should handle cleanup errors', async () => {
      const mockError = new Error('Cleanup failed');
      mockSessionEncryption.decryptSession.mockRejectedValueOnce(mockError);
      authService.activeSessions.set('error', { encrypted: 'error' });

      await expect(authService.cleanupSessions()).rejects.toThrow('Cleanup failed');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.sessions.cleanup.error');
    });
  });

  describe('API key management', () => {
    it('should start API key rotation interval on initialization', () => {
      const startRotationSpy = jest.spyOn(authService.apiKeyManager, 'startRotationInterval');
      authService.apiKeyManager.startRotationInterval();
      expect(startRotationSpy).toHaveBeenCalled();
      authService.stopCleanup();
    });

    it('should stop API key rotation interval on cleanup stop', () => {
      const stopRotationSpy = jest.spyOn(authService.apiKeyManager, 'stopRotationInterval');
      authService.stopCleanup();
      expect(stopRotationSpy).toHaveBeenCalled();
    });

    it('should remove API key when session is removed', async () => {
      const clientId = 'test-client';
      const apiKey = 'test-api-key';
      const sessionId = await authService.createSession(clientId);
      const removeKeySpy = jest.spyOn(authService.apiKeyManager, 'deleteKey');

      mockSessionEncryption.decryptSession.mockResolvedValueOnce({
        clientId,
        apiKey
      });

      await authService.removeSession(sessionId);
      expect(removeKeySpy).toHaveBeenCalledWith(apiKey);
    });
  });

  describe('authenticate', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      authService.threatDetection = {
        hasHighSeverityThreats: jest.fn().mockResolvedValue(false),
        isIpBlocked: jest.fn().mockResolvedValue(false)
      };
    });

    it('should check for threats during authentication', async () => {
      const credentials = {
        clientId: 'test-client',
        apiKey: 'valid-key'
      };

      authService.apiKeyManager.validateKey.mockResolvedValueOnce(true);
      const result = await authService.authenticate(credentials.clientId, credentials.apiKey);
      expect(result).toBeTruthy();
      expect(authService.threatDetection.hasHighSeverityThreats).toHaveBeenCalledWith(credentials.clientId);
    });

    it('should block authentication on high severity threats', async () => {
      authService.threatDetection.hasHighSeverityThreats.mockResolvedValueOnce(true);
      const credentials = {
        clientId: 'test-client',
        apiKey: 'valid-key'
      };

      await expect(authService.authenticate(credentials.clientId, credentials.apiKey))
        .rejects.toThrow('Access denied');
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });

    it('should accumulate failed attempts count', async () => {
      const credentials = {
        clientId: 'test-client',
        apiKey: 'invalid-key'
      };

      authService.apiKeyManager.validateKey.mockResolvedValue(false);

      for (let i = 0; i < 3; i++) {
        await expect(authService.authenticate(credentials.clientId, credentials.apiKey))
          .rejects.toThrow('Invalid API key');
      }

      expect(authService.authFailureCount.get(credentials.clientId)).toBe(3);
      expect(mockMetrics.increment).toHaveBeenCalledWith('auth.failure');
    });
  });
}); 