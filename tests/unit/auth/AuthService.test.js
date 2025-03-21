const jwt = require('jsonwebtoken');
const AuthService = require('../../../src/auth/AuthService');

jest.mock('../../../src/utils/metrics');
jest.mock('../../../src/utils/logger');

describe('AuthService', () => {
    let authService;
    let mockMetrics;
    let mockConfig;

    beforeEach(() => {
        jest.useFakeTimers();
        mockMetrics = {
            authError: { inc: jest.fn() },
            authSuccess: { inc: jest.fn() },
            rateLimitExceeded: { inc: jest.fn() },
            authSessionCreationSuccess: { inc: jest.fn() },
            authSessionCreationError: { inc: jest.fn() },
            authSessionRemovalSuccess: { inc: jest.fn() },
            authSessionRemovalError: { inc: jest.fn() },
            authCleanupSuccess: { inc: jest.fn() },
            authRateLimitExceeded: { inc: jest.fn() },
            authRateLimitCheckSuccess: { inc: jest.fn() }
        };
        mockConfig = {
            auth: {
                enabled: true,
                apiKeys: ['valid-api-key'],
                jwtSecret: 'test-secret',
                sessionDuration: 3600,
                rateLimit: {
                    maxRequests: 10,
                    windowMs: 60000
                }
            }
        };
        authService = new AuthService(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        authService.stop();
    });

    describe('validateApiKey', () => {
        it('should return true for valid API key', () => {
            const result = authService.validateApiKey('valid-api-key');
            expect(result.valid).toBe(true);
            expect(mockMetrics.authSuccess.inc).toHaveBeenCalled();
        });

        it('should throw error for invalid API key', () => {
            expect(() => authService.validateApiKey('invalid-key')).toThrow('Invalid API key');
            expect(mockMetrics.authError.inc).toHaveBeenCalledWith({ code: 'INVALID_API_KEY' });
        });

        it('should return true when auth is disabled', () => {
            authService = new AuthService({ auth: { enabled: false }}, mockMetrics);
            const result = authService.validateApiKey('any-key');
            expect(result.valid).toBe(true);
        });
    });

    describe('createSession', () => {
        it('should create a valid session with JWT token', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            
            expect(session).toBeTruthy();
            expect(typeof session.token).toBe('string');
            expect(mockMetrics.authSessionCreationSuccess.inc).toHaveBeenCalled();
            
            const decoded = jwt.verify(session.token, mockConfig.auth.jwtSecret);
            expect(decoded.clientId).toBe(clientId);
        });

        it('should throw error for invalid client ID', () => {
            expect(() => authService.createSession(null)).toThrow();
            expect(mockMetrics.authSessionCreationError.inc).toHaveBeenCalled();
        });
    });

    describe('isAuthenticated', () => {
        it('should return true for valid session', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            const result = authService.isAuthenticated(clientId);
            expect(result).toBe(true);
        });

        it('should return false for expired session', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            jest.advanceTimersByTime(mockConfig.auth.sessionDuration * 1000 + 1000);
            const result = authService.isAuthenticated(clientId);
            expect(result).toBe(false);
        });

        it('should return false for non-existent session', () => {
            const result = authService.isAuthenticated('non-existent');
            expect(result).toBe(false);
        });
    });

    describe('cleanup', () => {
        it('should remove expired sessions', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            jest.advanceTimersByTime(mockConfig.auth.sessionDuration * 1000 + 1000);
            
            authService.cleanup();
            expect(mockMetrics.authCleanupSuccess.inc).toHaveBeenCalled();
            expect(authService.isAuthenticated(clientId)).toBe(false);
        });
    });

    describe('isRateLimited', () => {
        it('should return false for first request', () => {
            const result = authService.isRateLimited('test-client');
            expect(result).toBe(false);
            expect(mockMetrics.authRateLimitCheckSuccess.inc).toHaveBeenCalled();
        });

        it('should return true when rate limit is exceeded', () => {
            for (let i = 0; i < mockConfig.auth.rateLimit.maxRequests + 1; i++) {
                authService.isRateLimited('test-client');
            }
            const result = authService.isRateLimited('test-client');
            expect(result).toBe(true);
            expect(mockMetrics.authRateLimitExceeded.inc).toHaveBeenCalled();
        });

        it('should reset rate limit after window expires', () => {
            for (let i = 0; i < mockConfig.auth.rateLimit.maxRequests; i++) {
                authService.isRateLimited('test-client');
            }
            
            jest.advanceTimersByTime(mockConfig.auth.rateLimit.windowMs + 1000);
            
            const result = authService.isRateLimited('test-client');
            expect(result).toBe(false);
            expect(mockMetrics.authRateLimitCheckSuccess.inc).toHaveBeenCalled();
        });
    });
}); 