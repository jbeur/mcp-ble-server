const AuthHandler = require('../../../../src/mcp/handlers/AuthHandler');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../../../src/mcp/protocol/messages');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
  metrics: {
    increment: jest.fn()
  }
}));

describe('AuthHandler', () => {
  let authHandler;
  let mockAuthService;
  let mockClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock auth service
    mockAuthService = {
      validateApiKey: jest.fn(),
      createSession: jest.fn(),
      validateSession: jest.fn(),
      activeSessions: new Map(),
      rateLimiter: new Map(),
      isRateLimited: jest.fn()
    };

    // Create mock client
    mockClient = {
      send: jest.fn()
    };

    // Create handler instance
    authHandler = new AuthHandler(mockAuthService);
    authHandler.sendToClient = jest.fn();
  });

  describe('handleAuthenticate', () => {
    it('should handle successful authentication', async () => {
      const clientId = 'test-client';
      const apiKey = 'valid-api-key';
      const mockToken = 'mock-jwt-token';

      mockAuthService.validateApiKey.mockResolvedValue(true);
      mockAuthService.isRateLimited.mockReturnValue(false);
      mockAuthService.createSession.mockResolvedValue(mockToken);

      await authHandler.handleAuthenticate(clientId, {
        type: MESSAGE_TYPES.AUTHENTICATE,
        params: { apiKey }
      });

      expect(mockAuthService.validateApiKey).toHaveBeenCalledWith(apiKey);
      expect(mockAuthService.createSession).toHaveBeenCalledWith(clientId, apiKey);
      expect(authHandler.sendToClient).toHaveBeenCalledWith(clientId, {
        type: MESSAGE_TYPES.AUTHENTICATED,
        params: {
          token: mockToken,
          expiresIn: '24h'
        }
      });
      expect(metrics.increment).toHaveBeenCalledWith('auth.authenticate.success');
    });

    it('should handle invalid API key', async () => {
      const clientId = 'test-client';
      const apiKey = 'invalid-api-key';

      mockAuthService.validateApiKey.mockResolvedValue(false);
      mockAuthService.isRateLimited.mockReturnValue(false);

      await expect(authHandler.handleAuthenticate(clientId, {
        type: MESSAGE_TYPES.AUTHENTICATE,
        params: { apiKey }
      })).rejects.toThrow('Invalid API key');

      expect(metrics.increment).toHaveBeenCalledWith('auth.authenticate.error');
    });

    it('should handle rate limiting', async () => {
      const clientId = 'test-client';
      const apiKey = 'valid-api-key';

      mockAuthService.isRateLimited.mockReturnValue(true);

      await expect(authHandler.handleAuthenticate(clientId, {
        type: MESSAGE_TYPES.AUTHENTICATE,
        params: { apiKey }
      })).rejects.toThrow('Rate limit exceeded');

      expect(metrics.increment).toHaveBeenCalledWith('auth.authenticate.error');
    });

    it('should handle missing API key', async () => {
      const clientId = 'test-client';

      const error = new Error('API key is required');
      error.code = ERROR_CODES.INVALID_PARAMS;

      await expect(authHandler.handleAuthenticate(clientId, {
        type: MESSAGE_TYPES.AUTHENTICATE,
        params: {}
      })).rejects.toThrow(error);

      expect(metrics.increment).toHaveBeenCalledWith('auth.authenticate.error');
    });
  });

  describe('handleValidateSession', () => {
    it('should handle valid session', async () => {
      const clientId = 'test-client';
      const token = 'valid-token';

      mockAuthService.validateSession.mockResolvedValue(true);

      await authHandler.handleValidateSession(clientId, {
        type: MESSAGE_TYPES.SESSION_VALID,
        params: { token }
      });

      expect(mockAuthService.validateSession).toHaveBeenCalledWith(clientId, token);
      expect(authHandler.sendToClient).toHaveBeenCalledWith(clientId, {
        type: MESSAGE_TYPES.SESSION_VALID,
        params: { valid: true }
      });
      expect(metrics.increment).toHaveBeenCalledWith('auth.session.validate.success');
    });

    it('should handle invalid session', async () => {
      const clientId = 'test-client';
      const token = 'invalid-token';

      mockAuthService.validateSession.mockResolvedValue(false);

      await authHandler.handleValidateSession(clientId, {
        type: MESSAGE_TYPES.SESSION_VALID,
        params: { token }
      });

      expect(authHandler.sendToClient).toHaveBeenCalledWith(clientId, {
        type: MESSAGE_TYPES.SESSION_VALID,
        params: { valid: false }
      });
      expect(metrics.increment).toHaveBeenCalledWith('auth.session.validate.success');
    });

    it('should handle missing token', async () => {
      const clientId = 'test-client';

      const error = new Error('Token is required');
      error.code = ERROR_CODES.INVALID_PARAMS;

      await expect(authHandler.handleValidateSession(clientId, {
        type: MESSAGE_TYPES.SESSION_VALID,
        params: {}
      })).rejects.toThrow(error);

      expect(metrics.increment).toHaveBeenCalledWith('auth.session.validate.error');
    });
  });

  describe('handleLogout', () => {
    it('should handle successful logout', async () => {
      const clientId = 'test-client';

      // Set up mock session
      mockAuthService.activeSessions.set(clientId, {
        clientId,
        token: 'test-token'
      });

      await authHandler.handleLogout(clientId);

      expect(mockAuthService.activeSessions.has(clientId)).toBe(false);
      expect(authHandler.sendToClient).toHaveBeenCalledWith(clientId, {
        type: MESSAGE_TYPES.LOGGED_OUT
      });
      expect(metrics.increment).toHaveBeenCalledWith('auth.logout.success');
    });

    it('should handle logout for non-existent session', async () => {
      const clientId = 'non-existent';

      await authHandler.handleLogout(clientId);

      expect(authHandler.sendToClient).toHaveBeenCalledWith(clientId, {
        type: MESSAGE_TYPES.LOGGED_OUT
      });
      expect(metrics.increment).toHaveBeenCalledWith('auth.logout.success');
    });
  });
}); 