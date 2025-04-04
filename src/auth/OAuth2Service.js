const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class OAuth2Service {
    constructor(config, metrics) {
        if (!config) {
            throw new Error('Configuration is required');
        }

        this.config = config;
        this.metrics = metrics;
        this.authCodes = new Map(); // Store authorization codes temporarily
        this.accessTokens = new Map(); // Store access tokens
        this.refreshTokens = new Map(); // Store refresh tokens

        // Validate configuration
        const oauthConfig = this.config.security?.oauth2;
        if (!oauthConfig?.clientId || !oauthConfig?.clientSecret) {
            throw new Error('Missing required OAuth2 configuration');
        }

        this.clientId = oauthConfig.clientId;
        this.clientSecret = oauthConfig.clientSecret;
        this.redirectUri = oauthConfig.redirectUri;
        this.tokenEndpoint = oauthConfig.tokenEndpoint;
        this.authorizationEndpoint = oauthConfig.authorizationEndpoint;
        this.scopes = oauthConfig.scopes || ['openid', 'profile', 'email'];
        this.accessTokenExpiry = oauthConfig.accessTokenExpiry || 3600; // 1 hour in seconds
        this.refreshTokenExpiry = oauthConfig.refreshTokenExpiry || 86400 * 30; // 30 days in seconds
    }

    /**
     * Generate an authorization URL for OAuth2 flow
     * @param {string} state - State parameter for CSRF protection
     * @param {string} nonce - Nonce for OpenID Connect
     * @returns {string} Authorization URL
     */
    generateAuthorizationUrl(state, nonce) {
        try {
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: this.clientId,
                redirect_uri: this.redirectUri,
                scope: this.scopes.join(' '),
                state,
                nonce
            });

            const url = `${this.authorizationEndpoint}?${params.toString()}`;
            this.metrics?.oauth2AuthorizationUrlGenerated?.inc();
            return url;
        } catch (error) {
            logger.error('Failed to generate authorization URL:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Generate an authorization code
     * @param {string} userId - User ID
     * @param {string} clientId - Client ID
     * @returns {string} Authorization code
     */
    generateAuthorizationCode(userId, clientId) {
        try {
            const code = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 600000; // 10 minutes

            this.authCodes.set(code, {
                userId,
                clientId,
                expiresAt
            });

            this.metrics?.oauth2AuthorizationCodeGenerated?.inc();
            return code;
        } catch (error) {
            logger.error('Failed to generate authorization code:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Exchange authorization code for access token
     * @param {string} code - Authorization code
     * @param {string} clientId - Client ID
     * @param {string} clientSecret - Client secret
     * @returns {Promise<Object>} Access token and refresh token
     */
    async exchangeCodeForToken(code, clientId, clientSecret) {
        try {
            if (clientId !== this.clientId || clientSecret !== this.clientSecret) {
                throw new Error('Invalid client credentials');
            }

            const authCode = this.authCodes.get(code);
            if (!authCode) {
                throw new Error('Invalid authorization code');
            }

            if (Date.now() > authCode.expiresAt) {
                this.authCodes.delete(code);
                throw new Error('Authorization code expired');
            }

            // Generate access token
            const accessToken = this.generateAccessToken(authCode.userId, authCode.clientId);
            const refreshToken = this.generateRefreshToken(authCode.userId, authCode.clientId);

            // Clean up used authorization code
            this.authCodes.delete(code);

            this.metrics?.oauth2TokenExchangeSuccess?.inc();
            return {
                access_token: accessToken,
                refresh_token: refreshToken,
                token_type: 'Bearer',
                expires_in: this.accessTokenExpiry
            };
        } catch (error) {
            logger.error('Failed to exchange code for token:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Generate an access token
     * @param {string} userId - User ID
     * @param {string} clientId - Client ID
     * @param {number} [timeOffset=0] - Optional time offset in seconds
     * @returns {string} Access token
     */
    generateAccessToken(userId, clientId, timeOffset = 0) {
        try {
            const now = Math.floor(Date.now() / 1000) + timeOffset;
            const token = jwt.sign(
                {
                    sub: userId,
                    client_id: clientId,
                    type: 'access',
                    iat: now,
                    exp: now + this.accessTokenExpiry
                },
                this.clientSecret,
                { algorithm: 'HS256' }
            );

            this.accessTokens.set(token, {
                userId,
                clientId,
                expiresAt: (now + this.accessTokenExpiry) * 1000
            });

            this.metrics?.oauth2AccessTokenGenerated?.inc();
            return token;
        } catch (error) {
            logger.error('Failed to generate access token:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Generate a refresh token
     * @param {string} userId - User ID
     * @param {string} clientId - Client ID
     * @returns {string} Refresh token
     */
    generateRefreshToken(userId, clientId) {
        try {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + (this.refreshTokenExpiry * 1000);

            this.refreshTokens.set(token, {
                userId,
                clientId,
                expiresAt
            });

            this.metrics?.oauth2RefreshTokenGenerated?.inc();
            return token;
        } catch (error) {
            logger.error('Failed to generate refresh token:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Refresh an access token using a refresh token
     * @param {string} refreshToken - Refresh token
     * @returns {Promise<Object>} New access token and refresh token
     */
    async refreshAccessToken(refreshToken) {
        try {
            const tokenData = this.refreshTokens.get(refreshToken);
            if (!tokenData) {
                throw new Error('Invalid refresh token');
            }

            if (Date.now() > tokenData.expiresAt) {
                this.refreshTokens.delete(refreshToken);
                throw new Error('Refresh token expired');
            }

            // Generate new access token with a small time offset to ensure uniqueness
            const newAccessToken = this.generateAccessToken(tokenData.userId, tokenData.clientId, 1);
            const newRefreshToken = this.generateRefreshToken(tokenData.userId, tokenData.clientId);

            // Clean up old refresh token
            this.refreshTokens.delete(refreshToken);

            this.metrics?.oauth2TokenRefreshSuccess?.inc();
            return {
                access_token: newAccessToken,
                refresh_token: newRefreshToken,
                token_type: 'Bearer',
                expires_in: this.accessTokenExpiry
            };
        } catch (error) {
            logger.error('Failed to refresh access token:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Validate an access token
     * @param {string} token - Access token to validate
     * @returns {Promise<Object>} Decoded token data
     */
    async validateAccessToken(token) {
        try {
            const tokenData = this.accessTokens.get(token);
            if (!tokenData) {
                throw new Error('Invalid access token');
            }

            if (Date.now() > tokenData.expiresAt) {
                this.accessTokens.delete(token);
                throw new Error('Access token expired');
            }

            const decoded = jwt.verify(token, this.clientSecret);
            this.metrics?.oauth2TokenValidationSuccess?.inc();
            return decoded;
        } catch (error) {
            logger.error('Failed to validate access token:', error);
            this.metrics?.oauth2Error?.inc();
            throw error;
        }
    }

    /**
     * Clean up expired tokens
     */
    cleanupExpiredTokens() {
        const now = Date.now();

        // Clean up expired access tokens
        for (const [token, data] of this.accessTokens.entries()) {
            if (now > data.expiresAt) {
                this.accessTokens.delete(token);
            }
        }

        // Clean up expired refresh tokens
        for (const [token, data] of this.refreshTokens.entries()) {
            if (now > data.expiresAt) {
                this.refreshTokens.delete(token);
            }
        }

        // Clean up expired authorization codes
        for (const [code, data] of this.authCodes.entries()) {
            if (now > data.expiresAt) {
                this.authCodes.delete(code);
            }
        }

        this.metrics?.oauth2CleanupSuccess?.inc();
    }
}

module.exports = OAuth2Service; 