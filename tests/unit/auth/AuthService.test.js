const jwt = require('jsonwebtoken');
const AuthService = require('../../../src/auth/AuthService');
const SessionEncryption = require('../../../src/mcp/security/SessionEncryption');
const metrics = require('../../../src/utils/metrics');
const logger = require('../../../src/utils/logger');
const ThreatDetectionService = require('../../../src/security/ThreatDetectionService');

jest.mock('../../../src/utils/metrics', () => ({
    increment: jest.fn(),
    authSessionCreationSuccess: { inc: jest.fn() },
    authSessionCreationError: { inc: jest.fn() },
    authSessionRemovalSuccess: { inc: jest.fn() },
    authSessionRemovalError: { inc: jest.fn() },
    authSessionCleanupSuccess: { inc: jest.fn() },
    authSessionCleanupError: { inc: jest.fn() },
    authValidationSuccess: { inc: jest.fn() },
    authValidationError: { inc: jest.fn() },
    authFailures: { inc: jest.fn() },
    requestRate: { inc: jest.fn() },
    suspiciousPatterns: { inc: jest.fn() },
    threatDetectionErrors: { inc: jest.fn() }
}));

jest.mock('../../../src/utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

jest.mock('../../../src/auth/ApiKeyManager', () => {
    return jest.fn().mockImplementation(() => ({
        createKey: jest.fn().mockReturnValue('test-api-key'),
        validateKey: jest.fn().mockReturnValue(true),
        rotateKey: jest.fn().mockReturnValue('new-api-key'),
        removeKey: jest.fn(),
        startRotationInterval: jest.fn(),
        stopRotationInterval: jest.fn()
    }));
});

jest.mock('../../../src/security/ThreatDetectionService');

describe('AuthService', () => {
    let authService;
    let mockConfig;
    let originalSetInterval;
    let originalClearInterval;
    let cleanupInterval;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        
        // Save original timer functions
        originalSetInterval = global.setInterval;
        originalClearInterval = global.clearInterval;
        
        mockConfig = {
            auth: {
                jwtSecret: 'test-secret',
                sessionDuration: 3600,
                sessionTimeout: 7200,
                cleanupInterval: 300000,
                keyRotationInterval: 1000,
                maxKeyAge: 5000,
                sessionExpiry: 3600000
            },
            security: {
                tokenAuth: {
                    accessTokenSecret: 'test-access-secret',
                    refreshTokenSecret: 'test-refresh-secret',
                    accessTokenExpiry: '15m',
                    refreshTokenExpiry: '7d',
                    issuer: 'test-issuer',
                    algorithm: 'HS256'
                },
                oauth2: {
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                    redirectUri: 'http://localhost:3000/callback',
                    authorizationEndpoint: 'http://localhost:8080/oauth/authorize',
                    tokenEndpoint: 'http://localhost:8080/oauth/token',
                    scope: 'read write'
                }
            },
            threatDetection: {
                failedAuthThreshold: 3,
                requestRateThreshold: 50,
                suspiciousPatterns: ['sql_injection', 'xss_attempt']
            }
        };
        ThreatDetectionService.mockImplementation(() => ({
            analyze: jest.fn().mockReturnValue([])
        }));
        authService = new AuthService(mockConfig, metrics);
        cleanupInterval = authService.cleanupInterval;
    });

    afterEach(() => {
        if (authService && typeof authService.stopCleanup === 'function') {
            authService.stopCleanup();
        }
        jest.useRealTimers();
        // Restore original timer functions
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    });

    describe('validateApiKey', () => {
        it('should return true for valid API key', async () => {
            const result = await authService.validateApiKey('valid-api-key');
            expect(result.valid).toBe(true);
            expect(metrics.authValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should throw error for invalid API key', async () => {
            authService.apiKeyManager.validateKey.mockReturnValueOnce(false);
            await expect(authService.validateApiKey('invalid-key')).rejects.toThrow('Invalid API key');
            expect(metrics.authValidationError.inc).toHaveBeenCalled();
        });

        it('should return true when auth is disabled', async () => {
            mockConfig.auth.enabled = false;
            const result = await authService.validateApiKey('any-key');
            expect(result.valid).toBe(true);
        });

        it('should throw error for empty API key', async () => {
            await expect(authService.validateApiKey('')).rejects.toThrow('API key is required');
            expect(metrics.authValidationError.inc).toHaveBeenCalled();
        });

        it('should throw error for null API key', async () => {
            await expect(authService.validateApiKey(null)).rejects.toThrow('API key is required');
            expect(metrics.authValidationError.inc).toHaveBeenCalled();
        });

        it('should throw error for undefined API key', async () => {
            await expect(authService.validateApiKey(undefined)).rejects.toThrow('API key is required');
            expect(metrics.authValidationError.inc).toHaveBeenCalled();
        });
    });

    describe('createSession', () => {
        it('should create a valid session with JWT token and API key', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            
            expect(session).toBeTruthy();
            expect(typeof session.token).toBe('string');
            expect(session.apiKey).toBe('test-api-key');
            expect(metrics.authSessionCreationSuccess.inc).toHaveBeenCalled();
            
            const decoded = jwt.verify(session.token, mockConfig.auth.jwtSecret);
            expect(decoded.clientId).toBe(clientId);
            expect(decoded.apiKey).toBe('test-api-key');

            // Verify session is encrypted in storage
            const encryptedSession = authService.activeSessions.get(clientId);
            expect(encryptedSession).toHaveProperty('encrypted');
            expect(encryptedSession).toHaveProperty('iv');
            expect(encryptedSession).toHaveProperty('authTag');
        });

        it('should throw error for invalid client ID', () => {
            expect(() => authService.createSession(null)).toThrow('Client ID is required');
            expect(metrics.authSessionCreationError.inc).toHaveBeenCalled();
        });

        it('should include expiration time in JWT token', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            const decoded = jwt.verify(session.token, mockConfig.auth.jwtSecret);
            expect(decoded.exp).toBeTruthy();
        });

        it('should store encrypted session in activeSessions', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            expect(authService.activeSessions.has(clientId)).toBe(true);
            
            const encryptedSession = authService.activeSessions.get(clientId);
            expect(encryptedSession).toHaveProperty('encrypted');
            expect(encryptedSession).toHaveProperty('iv');
            expect(encryptedSession).toHaveProperty('authTag');

            // Verify the session can be decrypted
            const decryptedSession = authService.sessionEncryption.decryptSession(
                encryptedSession,
                authService.encryptionKey
            );
            expect(decryptedSession).toEqual({
                token: session.token,
                apiKey: 'test-api-key',
                createdAt: expect.any(Number),
                lastActivity: expect.any(Number)
            });
        });
    });

    describe('validateSession', () => {
        it('should return true for valid session', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            const result = authService.validateSession(session.token);
            expect(result).toBe(true);

            // Verify session data is re-encrypted after validation
            const encryptedSession = authService.activeSessions.get(clientId);
            expect(encryptedSession).toHaveProperty('encrypted');
            expect(encryptedSession).toHaveProperty('iv');
            expect(encryptedSession).toHaveProperty('authTag');
        });

        it('should return false for expired session', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            
            // Advance time past session duration
            const advanceTime = (mockConfig.auth.sessionDuration + 1) * 1000;
            jest.advanceTimersByTime(advanceTime);
            
            const result = authService.validateSession(session.token);
            expect(result).toBe(false);
        });

        it('should return false for invalid token', () => {
            const result = authService.validateSession('invalid-token');
            expect(result).toBe(false);
        });

        it('should return false for tampered token', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            const [header, payload, signature] = session.token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({ 
                apiKey: 'malicious-key',
                clientId: 'malicious-client'
            })).toString('base64');
            const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
            const result = authService.validateSession(tamperedToken);
            expect(result).toBe(false);
        });

        it('should return false for invalid API key', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            
            // Mock API key validation to fail
            authService.apiKeyManager.validateKey.mockReturnValueOnce(false);
            
            const result = authService.validateSession(session.token);
            expect(result).toBe(false);
        });
    });

    describe('removeSession', () => {
        it('should remove session successfully', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            authService.removeSession(clientId);
            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(metrics.authSessionRemovalSuccess.inc).toHaveBeenCalled();
        });

        it('should handle non-existent session removal gracefully', () => {
            authService.removeSession('non-existent');
            expect(metrics.authSessionRemovalSuccess.inc).not.toHaveBeenCalled();
        });
    });

    describe('session cleanup', () => {
        it('should clean up expired sessions', () => {
            const clientId = 'test-client';
            const session = {
                clientId,
                expiresAt: Date.now() - 1000 // Already expired
            };
            authService.activeSessions.set(clientId, session);

            // Trigger cleanup
            jest.advanceTimersByTime(mockConfig.auth.cleanupInterval);

            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(metrics.authSessionCleanupSuccess.inc).toHaveBeenCalled();
        });

        it('should handle corrupted session data during cleanup', () => {
            const clientId = 'test-client';
            const invalidSession = {
                clientId,
                expiresAt: 'invalid-date'
            };
            authService.activeSessions.set(clientId, invalidSession);

            // Trigger cleanup
            jest.advanceTimersByTime(mockConfig.auth.cleanupInterval);

            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(metrics.authSessionCleanupError.inc).toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith('Error during session cleanup', expect.any(Error));
        });

        it('should stop cleanup when service is stopped', () => {
            expect(cleanupInterval).toBeDefined();
            authService.stopCleanup();
            expect(authService.cleanupInterval).toBeNull();
        });
    });

    describe('API key management', () => {
        it('should start API key rotation interval on initialization', () => {
            const startRotationSpy = jest.spyOn(authService.apiKeyManager, 'startRotationInterval');
            const newAuthService = new AuthService(mockConfig, metrics);
            expect(startRotationSpy).toHaveBeenCalled();
            newAuthService.stopCleanup();
        });

        it('should stop API key rotation interval on cleanup stop', () => {
            const stopRotationSpy = jest.spyOn(authService.apiKeyManager, 'stopRotationInterval');
            authService.stopCleanup();
            expect(stopRotationSpy).toHaveBeenCalled();
        });

        it('should remove API key when session is removed', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            const removeKeySpy = jest.spyOn(authService.apiKeyManager, 'removeKey');
            
            authService.removeSession(clientId);
            expect(removeKeySpy).toHaveBeenCalledWith(clientId);
        });
    });

    describe('authenticate', () => {
        it('should check for threats during authentication', async () => {
            const credentials = {
                clientId: 'test-client',
                apiKey: 'test-key'
            };

            // Mock validateApiKey to throw an error
            authService.validateApiKey = jest.fn().mockImplementation(() => {
                throw new Error('Invalid API key');
            });

            await expect(authService.authenticate(credentials))
                .rejects.toThrow('Invalid API key');

            expect(authService.threatDetection.analyze).toHaveBeenCalledWith({
                type: 'auth_attempt',
                credentials: expect.objectContaining({
                    clientId: credentials.clientId,
                    timestamp: expect.any(Number)
                })
            });
        });

        it('should track failed authentication attempts', async () => {
            const credentials = {
                clientId: 'test-client',
                apiKey: 'invalid-key'
            };

            // Mock validateApiKey to throw an error
            authService.validateApiKey = jest.fn().mockImplementation(() => {
                throw new Error('Invalid API key');
            });

            await expect(authService.authenticate(credentials))
                .rejects.toThrow('Invalid API key');

            expect(authService.threatDetection.analyze).toHaveBeenCalledWith({
                type: 'auth_failure',
                count: 1,
                source: credentials.clientId
            });
        });

        it('should block authentication on high severity threats', async () => {
            const credentials = {
                clientId: 'test-client',
                apiKey: 'test-key'
            };

            authService.threatDetection.analyze.mockReturnValueOnce([
                { severity: 'high', message: 'Suspicious activity detected' }
            ]);

            await expect(authService.authenticate(credentials))
                .rejects.toThrow('Authentication blocked due to security threat');

            expect(logger.warn).toHaveBeenCalledWith('Authentication threats detected', {
                threats: expect.arrayContaining([
                    expect.objectContaining({
                        severity: 'high',
                        message: 'Suspicious activity detected'
                    })
                ])
            });
        });

        it('should accumulate failed attempts count', async () => {
            const credentials = {
                clientId: 'test-client',
                apiKey: 'invalid-key'
            };

            // Mock validateApiKey to throw an error
            authService.validateApiKey = jest.fn().mockImplementation(() => {
                throw new Error('Invalid API key');
            });

            // First attempt
            await expect(authService.authenticate(credentials))
                .rejects.toThrow('Invalid API key');

            expect(authService.threatDetection.analyze).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'auth_failure',
                    count: 1
                })
            );

            // Second attempt
            await expect(authService.authenticate(credentials))
                .rejects.toThrow('Invalid API key');

            expect(authService.threatDetection.analyze).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'auth_failure',
                    count: 2
                })
            );
        });
    });
}); 