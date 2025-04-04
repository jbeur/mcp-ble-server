const OAuth2Service = require('../../../src/auth/OAuth2Service');
const jwt = require('jsonwebtoken');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics', () => ({
    increment: jest.fn(),
    decrement: jest.fn(),
    gauge: jest.fn(),
    timing: jest.fn()
}));

describe('OAuth2Service', () => {
    let oauth2Service;
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
            oauth2Error: { inc: jest.fn() }
        };

        oauth2Service = new OAuth2Service(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should throw error if config is missing', () => {
            expect(() => new OAuth2Service()).toThrow('Configuration is required');
        });

        it('should throw error if required OAuth2 config is missing', () => {
            const invalidConfig = {
                security: {
                    oauth2: {
                        // Missing required fields
                    }
                }
            };
            expect(() => new OAuth2Service(invalidConfig)).toThrow('Missing required OAuth2 configuration');
        });
    });

    describe('generateAuthorizationUrl', () => {
        it('should generate a valid authorization URL', () => {
            const state = 'test-state';
            const nonce = 'test-nonce';
            const url = oauth2Service.generateAuthorizationUrl(state, nonce);

            expect(url).toContain(mockConfig.security.oauth2.authorizationEndpoint);
            expect(url).toContain(`client_id=${mockConfig.security.oauth2.clientId}`);
            expect(url).toContain(`redirect_uri=${encodeURIComponent(mockConfig.security.oauth2.redirectUri)}`);
            expect(url).toContain(`scope=openid+profile+email`);
            expect(url).toContain(`state=${state}`);
            expect(url).toContain(`nonce=${nonce}`);
            expect(mockMetrics.oauth2AuthorizationUrlGenerated.inc).toHaveBeenCalled();
        });
    });

    describe('generateAuthorizationCode', () => {
        it('should generate a valid authorization code', () => {
            const userId = 'test-user';
            const clientId = 'test-client';
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);

            expect(code).toBeDefined();
            expect(code).toHaveLength(64); // 32 bytes in hex
            expect(mockMetrics.oauth2AuthorizationCodeGenerated.inc).toHaveBeenCalled();
        });
    });

    describe('exchangeCodeForToken', () => {
        it('should exchange valid authorization code for tokens', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);

            const result = await oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            expect(result).toHaveProperty('access_token');
            expect(result).toHaveProperty('refresh_token');
            expect(result).toHaveProperty('token_type', 'Bearer');
            expect(result).toHaveProperty('expires_in', mockConfig.security.oauth2.accessTokenExpiry);
            expect(mockMetrics.oauth2TokenExchangeSuccess.inc).toHaveBeenCalled();
        });

        it('should reject invalid client credentials', async () => {
            const userId = 'test-user';
            const code = oauth2Service.generateAuthorizationCode(userId, 'test-client');

            await expect(oauth2Service.exchangeCodeForToken(
                code,
                'invalid-client',
                'invalid-secret'
            )).rejects.toThrow('Invalid client credentials');
        });

        it('should reject expired authorization code', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);

            // Move time forward past code expiration (10 minutes)
            jest.advanceTimersByTime(11 * 60 * 1000);

            await expect(oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            )).rejects.toThrow('Authorization code expired');
        });
    });

    describe('refreshAccessToken', () => {
        it('should refresh access token with valid refresh token', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);
            const { refresh_token } = await oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            const result = await oauth2Service.refreshAccessToken(refresh_token);

            expect(result).toHaveProperty('access_token');
            expect(result).toHaveProperty('refresh_token');
            expect(result).toHaveProperty('token_type', 'Bearer');
            expect(result).toHaveProperty('expires_in', mockConfig.security.oauth2.accessTokenExpiry);
            expect(mockMetrics.oauth2TokenRefreshSuccess.inc).toHaveBeenCalled();
        });

        it('should reject expired refresh token', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);
            const { refresh_token } = await oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Move time forward past refresh token expiration
            jest.advanceTimersByTime(mockConfig.security.oauth2.refreshTokenExpiry * 1000 + 1);

            await expect(oauth2Service.refreshAccessToken(refresh_token))
                .rejects.toThrow('Refresh token expired');
        });
    });

    describe('validateAccessToken', () => {
        it('should validate valid access token', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);
            const { access_token } = await oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            const decoded = await oauth2Service.validateAccessToken(access_token);

            expect(decoded).toHaveProperty('sub', userId);
            expect(decoded).toHaveProperty('client_id', clientId);
            expect(decoded).toHaveProperty('type', 'access');
            expect(mockMetrics.oauth2TokenValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should reject expired access token', async () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);
            const { access_token } = await oauth2Service.exchangeCodeForToken(
                code,
                clientId,
                mockConfig.security.oauth2.clientSecret
            );

            // Move time forward past access token expiration
            jest.advanceTimersByTime(mockConfig.security.oauth2.accessTokenExpiry * 1000 + 1);

            await expect(oauth2Service.validateAccessToken(access_token))
                .rejects.toThrow('Access token expired');
        });
    });

    describe('cleanupExpiredTokens', () => {
        it('should clean up expired tokens', () => {
            const userId = 'test-user';
            const clientId = mockConfig.security.oauth2.clientId;
            const code = oauth2Service.generateAuthorizationCode(userId, clientId);

            // Move time forward past all token expirations
            jest.advanceTimersByTime(Math.max(
                mockConfig.security.oauth2.accessTokenExpiry,
                mockConfig.security.oauth2.refreshTokenExpiry
            ) * 1000 + 1);

            oauth2Service.cleanupExpiredTokens();

            expect(mockMetrics.oauth2CleanupSuccess.inc).toHaveBeenCalled();
        });
    });
}); 