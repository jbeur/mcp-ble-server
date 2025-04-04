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

describe('OAuth2 Integration', () => {
    let authService;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockConfig = {
            security: {
                oauth2: {
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                    redirectUri: 'http://localhost:3000/callback',
                    tokenEndpoint: 'http://localhost:3000/token',
                    authorizationEndpoint: 'http://localhost:3000/auth',
                    scopes: ['openid', 'profile', 'email'],
                    accessTokenExpiry: 3600,
                    refreshTokenExpiry: 86400 * 30
                },
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
            oauth2AuthorizationUrlGenerated: { inc: jest.fn() },
            oauth2AuthorizationCodeGenerated: { inc: jest.fn() },
            oauth2TokenExchangeSuccess: { inc: jest.fn() },
            oauth2AccessTokenGenerated: { inc: jest.fn() },
            oauth2RefreshTokenGenerated: { inc: jest.fn() },
            oauth2TokenRefreshSuccess: { inc: jest.fn() },
            oauth2TokenValidationSuccess: { inc: jest.fn() },
            oauth2CleanupSuccess: { inc: jest.fn() },
            oauth2Error: { inc: jest.fn() },
            authSessionCreationSuccess: { inc: jest.fn() },
            authSessionCreationError: { inc: jest.fn() }
        };

        authService = new AuthService(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.useRealTimers();
        if (authService) {
            authService.stop();
        }
    });

    describe('OAuth2 Flow', () => {
        it('should generate authorization URL', () => {
            const state = 'test-state';
            const nonce = 'test-nonce';
            const url = authService.generateOAuth2AuthorizationUrl(state, nonce);

            expect(url).toContain(mockConfig.security.oauth2.authorizationEndpoint);
            expect(url).toContain(`client_id=${mockConfig.security.oauth2.clientId}`);
            expect(url).toContain(`redirect_uri=${encodeURIComponent(mockConfig.security.oauth2.redirectUri)}`);
            expect(url).toContain(`scope=openid+profile+email`);
            expect(url).toContain(`state=${state}`);
            expect(url).toContain(`nonce=${nonce}`);
            expect(mockMetrics.oauth2AuthorizationUrlGenerated.inc).toHaveBeenCalled();
        });

        it('should create OAuth2 session from authorization code', async () => {
            // First generate an authorization code through the OAuth2 service
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);

            // Create session using the code
            const session = await authService.createOAuth2Session(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            expect(session).toHaveProperty('access_token');
            expect(session).toHaveProperty('refresh_token');
            expect(session).toHaveProperty('token_type', 'Bearer');
            expect(session).toHaveProperty('expires_in', mockConfig.security.oauth2.accessTokenExpiry);
            expect(mockMetrics.oauth2TokenExchangeSuccess.inc).toHaveBeenCalled();
            expect(mockMetrics.authSessionCreationSuccess.inc).toHaveBeenCalled();
        });

        it('should validate OAuth2 access token', async () => {
            // Create a session first
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);
            const session = await authService.createOAuth2Session(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Validate the access token
            const isValid = await authService.validateOAuth2Token(session.access_token);
            expect(isValid).toBe(true);
            expect(mockMetrics.oauth2TokenValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should refresh OAuth2 tokens', async () => {
            // Create a session first
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);
            const session = await authService.createOAuth2Session(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Refresh the tokens
            const newTokens = await authService.refreshOAuth2Token(session.refresh_token);

            expect(newTokens).toHaveProperty('access_token');
            expect(newTokens).toHaveProperty('refresh_token');
            expect(newTokens.access_token).not.toBe(session.access_token);
            expect(newTokens.refresh_token).not.toBe(session.refresh_token);
            expect(mockMetrics.oauth2TokenRefreshSuccess.inc).toHaveBeenCalled();
        });

        it('should reject expired OAuth2 access token', async () => {
            // Create a session first
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);
            const session = await authService.createOAuth2Session(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Move time forward past access token expiration
            jest.advanceTimersByTime(mockConfig.security.oauth2.accessTokenExpiry * 1000 + 1);

            // Validate the expired access token
            const isValid = await authService.validateOAuth2Token(session.access_token);
            expect(isValid).toBe(false);
        });

        it('should reject expired OAuth2 refresh token', async () => {
            // Create a session first
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);
            const session = await authService.createOAuth2Session(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Move time forward past refresh token expiration
            jest.advanceTimersByTime(mockConfig.security.oauth2.refreshTokenExpiry * 1000 + 1);

            // Try to refresh with expired token
            await expect(authService.refreshOAuth2Token(session.refresh_token))
                .rejects.toThrow('Refresh token expired');
        });

        it('should handle invalid authorization code', async () => {
            const clientId = mockConfig.security.oauth2.clientId;
            await expect(authService.createOAuth2Session(
                'invalid-code',
                clientId,
                mockConfig.security.oauth2.clientSecret
            )).rejects.toThrow('Invalid authorization code');
            expect(mockMetrics.authSessionCreationError.inc).toHaveBeenCalled();
        });

        it('should handle invalid client credentials', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = authService.oauth2Service.generateAuthorizationCode(userId, clientId);

            await expect(authService.createOAuth2Session(
                code,
                'invalid-client',
                'invalid-secret'
            )).rejects.toThrow('Invalid client credentials');
            expect(mockMetrics.authSessionCreationError.inc).toHaveBeenCalled();
        });
    });
}); 