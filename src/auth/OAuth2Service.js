const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class OAuth2Service {
    constructor(config = {}) {
        this.config = config;
        this.logger = logger;
        this.metrics = metrics;
        this.authorizationCodes = new Map();
        this.activeSessions = new Map();
        this.csrfTokens = new Map();
        this.usedAuthCodes = new Set();
    }

    generateAuthorizationUrl(clientId, state) {
        try {
            if (!clientId) {
                throw new Error('Client ID is required');
            }

            // Generate CSRF token
            const csrfToken = crypto.randomBytes(32).toString('hex');
            this.csrfTokens.set(csrfToken, {
                clientId,
                createdAt: Date.now(),
                expiresAt: Date.now() + 600000 // 10 minutes
            });

            const params = new URLSearchParams({
                client_id: clientId,
                response_type: 'code',
                state: state || csrfToken,
                redirect_uri: process.env.OAUTH2_REDIRECT_URI
            });

            this.metrics.increment('oauth2.url.generation.success');
            return `${process.env.OAUTH2_REDIRECT_URI}?${params.toString()}`;
        } catch (error) {
            this.metrics.increment('oauth2.url.generation.error');
            this.logger.error('Authorization URL generation error:', error.message || 'Unknown error');
            throw error;
        }
    }

    async createAuthorizationCode(clientId, redirectUri, scope, state) {
        try {
            if (!clientId || !redirectUri) {
                throw new Error('Missing required parameters');
            }

            // Validate CSRF token
            const csrfData = this.csrfTokens.get(state);
            if (!csrfData || csrfData.clientId !== clientId || Date.now() > csrfData.expiresAt) {
                this.metrics.increment('oauth2.csrf.validation.error');
                throw new Error('Invalid CSRF token');
            }

            const code = crypto.randomBytes(32).toString('hex');
            const codeData = {
                clientId,
                redirectUri,
                scope,
                createdAt: Date.now(),
                expiresAt: Date.now() + 600000 // 10 minutes
            };

            this.authorizationCodes.set(code, codeData);
            this.metrics.increment('oauth2.code.generation.success');
            
            // Clean up used CSRF token
            this.csrfTokens.delete(state);
            
            return code;
        } catch (error) {
            this.metrics.increment('oauth2.code.generation.error');
            this.logger.error('Authorization code generation error:', error.message || 'Unknown error');
            throw error;
        }
    }

    async createOAuth2Session(code, clientId, redirectUri) {
        try {
            if (!code || !clientId || !redirectUri) {
                throw new Error('Missing required parameters');
            }

            // Check if code has been used
            if (this.usedAuthCodes.has(code)) {
                this.metrics.increment('oauth2.validation.error');
                throw new Error('Authorization code has already been used');
            }

            const codeData = this.authorizationCodes.get(code);
            if (!codeData) {
                this.metrics.increment('oauth2.validation.error');
                throw new Error('Invalid authorization code');
            }

            if (codeData.clientId !== clientId) {
                this.metrics.increment('oauth2.validation.error');
                throw new Error('Client ID mismatch');
            }

            if (codeData.redirectUri !== redirectUri) {
                this.metrics.increment('oauth2.validation.error');
                throw new Error('Redirect URI mismatch');
            }

            if (Date.now() > codeData.expiresAt) {
                this.metrics.increment('oauth2.validation.error');
                throw new Error('Authorization code expired');
            }

            // Mark code as used
            this.usedAuthCodes.add(code);
            this.authorizationCodes.delete(code);

            // Create session
            const token = jwt.sign({ clientId }, process.env.JWT_SECRET, { expiresIn: '1h' });
            const session = {
                token,
                clientId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                expiresAt: Date.now() + 3600000 // 1 hour
            };

            this.activeSessions.set(clientId, session);
            this.metrics.increment('oauth2.session.creation.success');
            
            return session;
        } catch (error) {
            this.metrics.increment('oauth2.session.creation.error');
            this.logger.error('OAuth2 session creation error:', error.message || 'Unknown error');
            throw error;
        }
    }

    async stop() {
        try {
            this.authorizationCodes.clear();
            this.activeSessions.clear();
            this.csrfTokens.clear();
            this.usedAuthCodes.clear();
            this.logger.info('OAuth2Service stopped');
        } catch (error) {
            this.logger.error('Error stopping OAuth2Service:', error.message || 'Unknown error');
        }
    }

    async cleanup() {
        try {
            await this.stop();
            this.logger.info('OAuth2Service cleanup completed');
        } catch (error) {
            this.logger.error('Error cleaning up OAuth2Service:', error.message || 'Unknown error');
        }
    }
}

module.exports = OAuth2Service; 