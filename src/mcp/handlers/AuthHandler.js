const BaseHandler = require('./BaseHandler');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES } = require('../protocol/messages');

class AuthHandler extends BaseHandler {
    constructor(authService) {
        super();
        this.authService = authService;
    }

    async handleAuthenticate(clientId, message) {
        try {
            const { apiKey } = message.params;
            if (!apiKey) {
                throw this.createError(ERROR_CODES.INVALID_PARAMS, 'API key is required');
            }

            // Check rate limiting
            if (this.authService.isRateLimited(clientId)) {
                throw this.createError(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded');
            }

            // Validate API key
            const isValid = await this.authService.validateApiKey(apiKey);
            if (!isValid) {
                throw this.createError(ERROR_CODES.INVALID_API_KEY, 'Invalid API key');
            }

            // Create session
            const token = await this.authService.createSession(clientId, apiKey);

            // Send authentication success response
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.AUTHENTICATED,
                params: {
                    token,
                    expiresIn: '24h'
                }
            });

            metrics.increment('auth.authenticate.success');
        } catch (error) {
            metrics.increment('auth.authenticate.error');
            throw error;
        }
    }

    async handleValidateSession(clientId, message) {
        try {
            const { token } = message.params;
            if (!token) {
                throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Token is required');
            }

            const isValid = await this.authService.validateSession(clientId, token);

            // Send validation response
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.SESSION_VALID,
                params: {
                    valid: isValid
                }
            });

            metrics.increment('auth.session.validate.success');
        } catch (error) {
            metrics.increment('auth.session.validate.error');
            throw error;
        }
    }

    async handleLogout(clientId) {
        try {
            // Remove session
            this.authService.activeSessions.delete(clientId);
            this.authService.rateLimiter.delete(clientId);

            // Send logout confirmation
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.LOGGED_OUT
            });

            metrics.increment('auth.logout.success');
        } catch (error) {
            metrics.increment('auth.logout.error');
            throw error;
        }
    }
}

module.exports = AuthHandler; 