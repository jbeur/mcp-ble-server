const jwt = require('jsonwebtoken');
const AuthService = require('../../../src/auth/AuthService');
const SessionEncryption = require('../../../src/mcp/security/SessionEncryption');

jest.mock('../../../src/utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

jest.mock('../../../src/utils/metrics', () => ({
    increment: jest.fn()
}));

const metrics = require('../../../src/utils/metrics');

describe('AuthService', () => {
    let authService;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        jest.useFakeTimers();
        mockConfig = {
            auth: {
                enabled: true,
                apiKeys: ['valid-api-key'],
                jwtSecret: 'test-secret-key',
                sessionDuration: 3600,
                sessionTimeout: 3600000,
                cleanupInterval: 300000
            }
        };
        mockMetrics = {
            authSessionCreationSuccess: { inc: jest.fn() },
            authSessionCreationError: { inc: jest.fn() },
            authSessionRemovalSuccess: { inc: jest.fn() },
            authSessionRemovalError: { inc: jest.fn() },
            authSessionCleanupSuccess: { inc: jest.fn() },
            authSessionCleanupError: { inc: jest.fn() },
            authValidationSuccess: { inc: jest.fn() },
            authValidationError: { inc: jest.fn() }
        };
        authService = new AuthService(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        authService.stopCleanup();
    });

    describe('validateApiKey', () => {
        it('should return true for valid API key', async () => {
            const result = await authService.validateApiKey('valid-api-key');
            expect(result.valid).toBe(true);
            expect(mockMetrics.authValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should throw error for invalid API key', async () => {
            await expect(authService.validateApiKey('invalid-key')).rejects.toThrow('Invalid API key');
            expect(mockMetrics.authValidationError.inc).toHaveBeenCalledWith({ code: 'INVALID_API_KEY' });
        });

        it('should return true when auth is disabled', async () => {
            mockConfig.auth.enabled = false;
            const result = await authService.validateApiKey('any-key');
            expect(result.valid).toBe(true);
        });

        it('should throw error for empty API key', async () => {
            await expect(authService.validateApiKey('')).rejects.toThrow('API key is required');
            expect(mockMetrics.authValidationError.inc).toHaveBeenCalledWith({ code: 'INVALID_API_KEY' });
        });

        it('should throw error for null API key', async () => {
            await expect(authService.validateApiKey(null)).rejects.toThrow('API key is required');
            expect(mockMetrics.authValidationError.inc).toHaveBeenCalledWith({ code: 'INVALID_API_KEY' });
        });

        it('should throw error for undefined API key', async () => {
            await expect(authService.validateApiKey(undefined)).rejects.toThrow('API key is required');
            expect(mockMetrics.authValidationError.inc).toHaveBeenCalledWith({ code: 'INVALID_API_KEY' });
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
            expect(decoded.apiKey).toBe(clientId);

            // Verify session is encrypted in storage
            const encryptedSession = authService.activeSessions.get(clientId);
            expect(encryptedSession).toHaveProperty('encrypted');
            expect(encryptedSession).toHaveProperty('iv');
            expect(encryptedSession).toHaveProperty('authTag');
        });

        it('should throw error for invalid client ID', () => {
            expect(() => authService.createSession(null)).toThrow('Client ID is required');
            expect(mockMetrics.authSessionCreationError.inc).toHaveBeenCalled();
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
            jest.advanceTimersByTime(mockConfig.auth.sessionDuration * 1000 + 1000);
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
            const tamperedPayload = Buffer.from(JSON.stringify({ apiKey: 'malicious-client' })).toString('base64');
            const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
            const result = authService.validateSession(tamperedToken);
            expect(result).toBe(false);
        });

        it('should update lastActivity on successful validation', () => {
            const clientId = 'test-client';
            const session = authService.createSession(clientId);
            
            const initialEncryptedSession = authService.activeSessions.get(clientId);
            const initialSession = authService.sessionEncryption.decryptSession(
                initialEncryptedSession,
                authService.encryptionKey
            );
            const initialActivity = initialSession.lastActivity;

            jest.advanceTimersByTime(1000);
            authService.validateSession(session.token);

            const updatedEncryptedSession = authService.activeSessions.get(clientId);
            const updatedSession = authService.sessionEncryption.decryptSession(
                updatedEncryptedSession,
                authService.encryptionKey
            );
            expect(updatedSession.lastActivity).toBeGreaterThan(initialActivity);
        });
    });

    describe('removeSession', () => {
        it('should remove session successfully', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);
            authService.removeSession(clientId);
            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(mockMetrics.authSessionRemovalSuccess.inc).toHaveBeenCalled();
        });

        it('should handle non-existent session removal gracefully', () => {
            authService.removeSession('non-existent');
            expect(mockMetrics.authSessionRemovalSuccess.inc).not.toHaveBeenCalled();
        });
    });

    describe('session cleanup', () => {
        it('should clean up expired sessions', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);

            // Advance time past session timeout
            jest.advanceTimersByTime(mockConfig.auth.sessionTimeout + 1000);

            // Trigger cleanup
            jest.advanceTimersByTime(mockConfig.auth.cleanupInterval);

            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(mockMetrics.authSessionCleanupSuccess.inc).toHaveBeenCalled();
        });

        it('should handle corrupted session data during cleanup', () => {
            const clientId = 'test-client';
            authService.createSession(clientId);

            // Corrupt the session data
            const encryptedSession = authService.activeSessions.get(clientId);
            encryptedSession.encrypted = 'corrupted-data';

            // Trigger cleanup
            jest.advanceTimersByTime(mockConfig.auth.cleanupInterval);

            expect(authService.activeSessions.has(clientId)).toBe(false);
            expect(mockMetrics.authSessionCleanupError.inc).toHaveBeenCalled();
        });

        it('should stop cleanup when service is stopped', () => {
            const cleanupSpy = jest.spyOn(authService, 'cleanup');
            authService.stopCleanup();

            jest.advanceTimersByTime(mockConfig.auth.cleanupInterval * 2);
            expect(cleanupSpy).not.toHaveBeenCalled();
        });
    });
}); 