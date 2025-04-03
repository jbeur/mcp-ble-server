const crypto = require('crypto');
const SessionEncryption = require('../../../src/auth/SessionEncryption');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics');

describe('SessionEncryption', () => {
    let sessionEncryption;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        mockConfig = {
            security: {
                encryptionKey: crypto.randomBytes(32).toString('hex'),
                algorithm: 'aes-256-gcm',
                ivLength: 12,
                authTagLength: 16
            }
        };
        mockMetrics = {
            sessionEncryptionSuccess: { inc: jest.fn() },
            sessionEncryptionError: { inc: jest.fn() },
            sessionDecryptionSuccess: { inc: jest.fn() },
            sessionDecryptionError: { inc: jest.fn() }
        };
        sessionEncryption = new SessionEncryption(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('encryptSession', () => {
        it('should encrypt session data successfully', () => {
            const sessionData = {
                clientId: 'test-client',
                token: 'test-token',
                lastActivity: Date.now()
            };

            const encryptedData = sessionEncryption.encryptSession(sessionData);

            expect(encryptedData).toHaveProperty('iv');
            expect(encryptedData).toHaveProperty('authTag');
            expect(encryptedData).toHaveProperty('encryptedData');
            expect(mockMetrics.sessionEncryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should handle empty session data', () => {
            const sessionData = {};
            const encryptedData = sessionEncryption.encryptSession(sessionData);

            expect(encryptedData).toHaveProperty('iv');
            expect(encryptedData).toHaveProperty('authTag');
            expect(encryptedData).toHaveProperty('encryptedData');
            expect(mockMetrics.sessionEncryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should handle complex session data', () => {
            const sessionData = {
                clientId: 'test-client',
                token: 'test-token',
                lastActivity: Date.now(),
                metadata: {
                    deviceInfo: {
                        type: 'mobile',
                        os: 'iOS'
                    },
                    permissions: ['read', 'write']
                }
            };

            const encryptedData = sessionEncryption.encryptSession(sessionData);

            expect(encryptedData).toHaveProperty('iv');
            expect(encryptedData).toHaveProperty('authTag');
            expect(encryptedData).toHaveProperty('encryptedData');
            expect(mockMetrics.sessionEncryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should handle encryption errors gracefully', () => {
            const sessionData = { clientId: 'test-client' };
            const invalidConfig = { security: {} };
            const invalidEncryption = new SessionEncryption(invalidConfig, mockMetrics);

            expect(() => invalidEncryption.encryptSession(sessionData)).toThrow();
            expect(mockMetrics.sessionEncryptionError.inc).toHaveBeenCalled();
        });
    });

    describe('decryptSession', () => {
        it('should decrypt session data successfully', () => {
            const sessionData = {
                clientId: 'test-client',
                token: 'test-token',
                lastActivity: Date.now()
            };

            const encryptedData = sessionEncryption.encryptSession(sessionData);
            const decryptedData = sessionEncryption.decryptSession(encryptedData);

            expect(decryptedData).toEqual(sessionData);
            expect(mockMetrics.sessionDecryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should handle empty encrypted data', () => {
            const sessionData = {};
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            const decryptedData = sessionEncryption.decryptSession(encryptedData);

            expect(decryptedData).toEqual(sessionData);
            expect(mockMetrics.sessionDecryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should handle complex encrypted data', () => {
            const sessionData = {
                clientId: 'test-client',
                token: 'test-token',
                lastActivity: Date.now(),
                metadata: {
                    deviceInfo: {
                        type: 'mobile',
                        os: 'iOS'
                    },
                    permissions: ['read', 'write']
                }
            };

            const encryptedData = sessionEncryption.encryptSession(sessionData);
            const decryptedData = sessionEncryption.decryptSession(encryptedData);

            expect(decryptedData).toEqual(sessionData);
            expect(mockMetrics.sessionDecryptionSuccess.inc).toHaveBeenCalled();
        });

        it('should reject tampered encrypted data', () => {
            const sessionData = { clientId: 'test-client' };
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            
            // Tamper with the encrypted data
            encryptedData.encryptedData = 'tampered-data';
            
            expect(() => sessionEncryption.decryptSession(encryptedData)).toThrow();
            expect(mockMetrics.sessionDecryptionError.inc).toHaveBeenCalled();
        });

        it('should reject data with missing IV', () => {
            const sessionData = { clientId: 'test-client' };
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            delete encryptedData.iv;

            expect(() => sessionEncryption.decryptSession(encryptedData)).toThrow();
            expect(mockMetrics.sessionDecryptionError.inc).toHaveBeenCalled();
        });

        it('should reject data with missing auth tag', () => {
            const sessionData = { clientId: 'test-client' };
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            delete encryptedData.authTag;

            expect(() => sessionEncryption.decryptSession(encryptedData)).toThrow();
            expect(mockMetrics.sessionDecryptionError.inc).toHaveBeenCalled();
        });

        it('should handle decryption errors gracefully', () => {
            const sessionData = { clientId: 'test-client' };
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            const invalidConfig = { security: {} };
            const invalidEncryption = new SessionEncryption(invalidConfig, mockMetrics);

            expect(() => invalidEncryption.decryptSession(encryptedData)).toThrow();
            expect(mockMetrics.sessionDecryptionError.inc).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should log errors during encryption', () => {
            const sessionData = { clientId: 'test-client' };
            const invalidConfig = { security: {} };
            const invalidEncryption = new SessionEncryption(invalidConfig, mockMetrics);

            expect(() => invalidEncryption.encryptSession(sessionData)).toThrow();
            expect(logger.error).toHaveBeenCalled();
        });

        it('should log errors during decryption', () => {
            const sessionData = { clientId: 'test-client' };
            const encryptedData = sessionEncryption.encryptSession(sessionData);
            const invalidConfig = { security: {} };
            const invalidEncryption = new SessionEncryption(invalidConfig, mockMetrics);

            expect(() => invalidEncryption.decryptSession(encryptedData)).toThrow();
            expect(logger.error).toHaveBeenCalled();
        });
    });
}); 