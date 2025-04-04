const TokenAuthentication = require('../../../src/auth/TokenAuthentication');
const AuthService = require('../../../src/auth/AuthService');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics', () => ({
    increment: jest.fn(),
    decrement: jest.fn(),
    gauge: jest.fn(),
    timing: jest.fn()
}));

describe('Token Authentication Integration', () => {
    let tokenAuth;
    let authService;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        // Reset metrics mock
        jest.clearAllMocks();

        mockConfig = {
            security: {
                tokenAuth: {
                    accessTokenSecret: 'test-access-secret',
                    refreshTokenSecret: 'test-refresh-secret',
                    accessTokenExpiry: 15 * 60, // 15 minutes in seconds
                    refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 days in seconds
                    issuer: 'mcp-ble-server',
                    algorithm: 'HS256'
                },
                auth: {
                    jwtSecret: 'test-jwt-secret',
                    sessionDuration: '24h',
                    cleanupInterval: 300000, // 5 minutes
                    sessionTimeout: 3600000 // 1 hour
                }
            }
        };
        mockMetrics = {
            tokenGenerationSuccess: { inc: jest.fn() },
            tokenGenerationError: { inc: jest.fn() },
            tokenValidationSuccess: { inc: jest.fn() },
            tokenValidationError: { inc: jest.fn() },
            tokenRefreshSuccess: { inc: jest.fn() },
            tokenRefreshError: { inc: jest.fn() },
            authSessionCreationSuccess: { inc: jest.fn() },
            authSessionCreationError: { inc: jest.fn() },
            authSessionCleanupSuccess: { inc: jest.fn() },
            authSessionCleanupError: { inc: jest.fn() },
            increment: jest.fn(),
            decrement: jest.fn(),
            gauge: jest.fn(),
            timing: jest.fn()
        };

        tokenAuth = new TokenAuthentication(mockConfig, mockMetrics);
        authService = new AuthService(mockConfig, mockMetrics);
    });

    afterEach(() => {
        if (authService) {
            authService.stop();
        }
    });

    describe('Token-based Session Creation', () => {
        it('should create a session with access and refresh tokens', async () => {
            const clientId = 'test-client';
            const userData = {
                userId: 'test-user',
                roles: ['user'],
                clientId
            };

            const session = await authService.createTokenSession(userData);
            
            expect(session).toHaveProperty('accessToken');
            expect(session).toHaveProperty('refreshToken');
            expect(session).toHaveProperty('expiresIn');
            expect(mockMetrics.tokenGenerationSuccess.inc).toHaveBeenCalled();
            expect(mockMetrics.authSessionCreationSuccess.inc).toHaveBeenCalled();
        });

        it('should validate access token', async () => {
            const clientId = 'test-client';
            const userData = {
                userId: 'test-user',
                roles: ['user'],
                clientId
            };

            const session = await authService.createTokenSession(userData);
            const isValid = await authService.validateTokenSession(session.accessToken);
            
            expect(isValid).toBe(true);
            expect(mockMetrics.tokenValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should refresh tokens', async () => {
            const clientId = 'test-client';
            const userData = {
                userId: 'test-user',
                roles: ['user'],
                clientId
            };

            const session = await authService.createTokenSession(userData);
            const newTokens = await authService.refreshTokenSession(session.refreshToken);
            
            expect(newTokens).toHaveProperty('accessToken');
            expect(newTokens).toHaveProperty('refreshToken');
            expect(newTokens.accessToken).not.toBe(session.accessToken);
            expect(newTokens.refreshToken).not.toBe(session.refreshToken);
            expect(mockMetrics.tokenRefreshSuccess.inc).toHaveBeenCalled();
        });

        it('should reject invalid access tokens', async () => {
            const isValid = await authService.validateTokenSession('invalid-token');
            expect(isValid).toBe(false);
            expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalled();
        });

        it('should reject expired refresh tokens', async () => {
            const clientId = 'test-client';
            const userData = {
                userId: 'test-user',
                roles: ['user'],
                clientId
            };

            // Mock Date.now to simulate token generation time
            const realDateNow = Date.now.bind(global.Date);
            const currentTime = realDateNow();
            global.Date.now = jest.fn(() => currentTime);

            const session = await authService.createTokenSession(userData);

            // Move time forward past refresh token expiration
            global.Date.now = jest.fn(() => currentTime + 8 * 24 * 60 * 60 * 1000); // 8 days later

            await expect(authService.refreshTokenSession(session.refreshToken))
                .rejects
                .toThrow('Refresh token expired');
            expect(mockMetrics.tokenValidationError.inc).toHaveBeenCalled();

            // Restore Date.now
            global.Date.now = realDateNow;
        });
    });
}); 