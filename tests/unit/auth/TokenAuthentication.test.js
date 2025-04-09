const crypto = require('crypto');
const TokenAuthentication = require('../../../src/auth/TokenAuthentication');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics');

describe('TokenAuthentication', () => {
  let tokenAuth;
  let mockConfig;
  let mockMetrics;

  beforeEach(() => {
    mockConfig = {
      security: {
        tokenAuth: {
          accessTokenSecret: 'test-access-secret',
          refreshTokenSecret: 'test-refresh-secret',
          accessTokenExpiry: 15 * 60, // 15 minutes in seconds
          refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 days in seconds
          issuer: 'mcp-ble-server',
          algorithm: 'HS256'
        }
      }
    };
    mockMetrics = {
      tokenGenerationSuccess: { inc: jest.fn() },
      tokenGenerationError: { inc: jest.fn() },
      tokenValidationSuccess: { inc: jest.fn() },
      tokenValidationError: { inc: jest.fn() },
      tokenRefreshSuccess: { inc: jest.fn() },
      tokenRefreshError: { inc: jest.fn() }
    };
    tokenAuth = new TokenAuthentication(mockConfig, mockMetrics);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTokens', () => {
    it('should generate valid access and refresh tokens', () => {
      const userId = 'user123';
      const roles = ['admin', 'user'];
      const clientId = 'client456';

      const tokens = tokenAuth.generateTokens({ userId, roles, clientId });

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.accessToken).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
      expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
      expect(mockMetrics.tokenGenerationSuccess.inc).toHaveBeenCalled();
    });

    it('should include all required claims in access token', () => {
      const userId = 'user123';
      const roles = ['admin'];
      const clientId = 'client456';

      const tokens = tokenAuth.generateTokens({ userId, roles, clientId });
      const decoded = tokenAuth.verifyToken(tokens.accessToken, 'access');

      expect(decoded).toHaveProperty('sub', userId);
      expect(decoded).toHaveProperty('roles');
      expect(decoded.roles).toEqual(roles);
      expect(decoded).toHaveProperty('clientId', clientId);
      expect(decoded).toHaveProperty('iss', mockConfig.security.tokenAuth.issuer);
      expect(decoded).toHaveProperty('exp');
      expect(decoded).toHaveProperty('iat');
      expect(mockMetrics.tokenGenerationSuccess.inc).toHaveBeenCalled();
    });

    it('should handle missing user data', () => {
      expect(() => tokenAuth.generateTokens({})).toThrow('Invalid user data');
      expect(mockMetrics.tokenGenerationError.inc).toHaveBeenCalled();
    });

    it('should handle invalid user data format', () => {
      expect(() => tokenAuth.generateTokens(null)).toThrow('Invalid user data');
      expect(() => tokenAuth.generateTokens('invalid')).toThrow('Invalid user data');
      expect(mockMetrics.tokenGenerationError.inc).toHaveBeenCalledTimes(2);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid access token', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const tokens = tokenAuth.generateTokens(userData);
      const decoded = tokenAuth.verifyToken(tokens.accessToken, 'access');

      expect(decoded).toHaveProperty('sub', userData.userId);
      expect(mockMetrics.tokenValidationSuccess.inc).toHaveBeenCalled();
    });

    it('should verify valid refresh token', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const tokens = tokenAuth.generateTokens(userData);
      const decoded = tokenAuth.verifyToken(tokens.refreshToken, 'refresh');

      expect(decoded).toHaveProperty('sub', userData.userId);
      expect(mockMetrics.tokenValidationSuccess.inc).toHaveBeenCalled();
    });

    it('should reject expired tokens', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      // Mock Date.now to simulate token generation time
      const realDateNow = Date.now.bind(global.Date);
      const currentTime = realDateNow();
      global.Date.now = jest.fn(() => currentTime);

      const tokens = tokenAuth.generateTokens(userData);

      // Move time forward past expiration
      global.Date.now = jest.fn(() => currentTime + 16 * 60 * 1000); // 16 minutes later

      expect(() => tokenAuth.verifyToken(tokens.accessToken, 'access')).toThrow('Token expired');
      expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalled();

      // Restore Date.now
      global.Date.now = realDateNow;
    });

    it('should reject tokens with wrong type', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const tokens = tokenAuth.generateTokens(userData);
      expect(() => tokenAuth.verifyToken(tokens.accessToken, 'refresh')).toThrow('Invalid token type');
      expect(() => tokenAuth.verifyToken(tokens.refreshToken, 'access')).toThrow('Invalid token type');
      expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalledTimes(2);
    });

    it('should reject tampered tokens', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const tokens = tokenAuth.generateTokens(userData);
      const [header, payload, signature] = tokens.accessToken.split('.');
      const tamperedToken = `${header}.${payload}modified.${signature}`;

      expect(() => tokenAuth.verifyToken(tamperedToken, 'access')).toThrow('Invalid token');
      expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalled();
    });

    it('should handle invalid token format', () => {
      expect(() => tokenAuth.verifyToken('invalid-token', 'access')).toThrow('Invalid token format');
      expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('should generate new token pair with valid refresh token', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const initialTokens = tokenAuth.generateTokens(userData);
      const newTokens = tokenAuth.refreshTokens(initialTokens.refreshToken);

      expect(newTokens).toHaveProperty('accessToken');
      expect(newTokens).toHaveProperty('refreshToken');
      expect(newTokens.accessToken).not.toBe(initialTokens.accessToken);
      expect(newTokens.refreshToken).not.toBe(initialTokens.refreshToken);
      expect(mockMetrics.tokenRefreshSuccess.inc).toHaveBeenCalled();
    });

    it('should preserve user data in new tokens', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const initialTokens = tokenAuth.generateTokens(userData);
      const newTokens = tokenAuth.refreshTokens(initialTokens.refreshToken);
      const decoded = tokenAuth.verifyToken(newTokens.accessToken, 'access');

      expect(decoded.sub).toBe(userData.userId);
      expect(decoded.roles).toEqual(userData.roles);
      expect(decoded.clientId).toBe(userData.clientId);
      expect(mockMetrics.tokenRefreshSuccess.inc).toHaveBeenCalled();
    });

    it('should reject expired refresh tokens', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      // Mock Date.now to simulate token generation time
      const realDateNow = Date.now.bind(global.Date);
      const currentTime = realDateNow();
      global.Date.now = jest.fn(() => currentTime);

      const tokens = tokenAuth.generateTokens(userData);

      // Move time forward past refresh token expiration
      global.Date.now = jest.fn(() => currentTime + 8 * 24 * 60 * 60 * 1000); // 8 days later

      expect(() => tokenAuth.refreshTokens(tokens.refreshToken)).toThrow('Refresh token expired');
      expect(mockMetrics.tokenRefreshError.inc).toHaveBeenCalled();

      // Restore Date.now
      global.Date.now = realDateNow;
    });

    it('should reject access tokens used as refresh tokens', () => {
      const userData = {
        userId: 'user123',
        roles: ['admin'],
        clientId: 'client456'
      };

      const tokens = tokenAuth.generateTokens(userData);
      expect(() => tokenAuth.refreshTokens(tokens.accessToken)).toThrow('Invalid token type');
      expect(mockMetrics.tokenRefreshError.inc).toHaveBeenCalled();
    });

    it('should handle invalid refresh token format', () => {
      expect(() => tokenAuth.refreshTokens('invalid-token')).toThrow('Invalid token format');
      expect(mockMetrics.tokenRefreshError.inc).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle missing configuration', () => {
      expect(() => new TokenAuthentication(null, mockMetrics)).toThrow('Configuration is required');
    });

    it('should handle invalid algorithm configuration', () => {
      const invalidConfig = {
        ...mockConfig,
        security: {
          tokenAuth: {
            ...mockConfig.security.tokenAuth,
            algorithm: 'INVALID'
          }
        }
      };
      expect(() => new TokenAuthentication(invalidConfig, mockMetrics)).toThrow('Invalid algorithm');
    });

    it('should handle missing secrets', () => {
      const invalidConfig = {
        security: {
          tokenAuth: {
            ...mockConfig.security.tokenAuth,
            accessTokenSecret: null
          }
        }
      };
      expect(() => new TokenAuthentication(invalidConfig, mockMetrics)).toThrow('Missing required configuration');
    });
  });
}); 