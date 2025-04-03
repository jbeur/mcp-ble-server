const crypto = require('crypto');
const MessageSecurity = require('../../../../src/mcp/security/MessageSecurity');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('MessageSecurity', () => {
    let messageSecurity;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        mockConfig = {
            security: {
                signingKey: crypto.randomBytes(32).toString('hex'),
                algorithm: 'sha256',
                signatureExpiration: 3600 // 1 hour
            }
        };
        mockMetrics = {
            messageSigningSuccess: { inc: jest.fn() },
            messageSigningError: { inc: jest.fn() },
            messageVerificationSuccess: { inc: jest.fn() },
            messageVerificationError: { inc: jest.fn() }
        };
        messageSecurity = new MessageSecurity(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('signMessage', () => {
        it('should sign a message successfully', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now()
            };

            const signedMessage = messageSecurity.signMessage(message);

            expect(signedMessage).toHaveProperty('signature');
            expect(signedMessage).toHaveProperty('timestamp');
            expect(signedMessage).toHaveProperty('type');
            expect(signedMessage).toHaveProperty('payload');
            expect(mockMetrics.messageSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle empty message', () => {
            const message = {};
            const signedMessage = messageSecurity.signMessage(message);

            expect(signedMessage).toHaveProperty('signature');
            expect(signedMessage).toHaveProperty('timestamp');
            expect(mockMetrics.messageSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle complex message', () => {
            const message = {
                type: 'complex',
                payload: {
                    nested: {
                        data: 'test',
                        array: [1, 2, 3],
                        object: { key: 'value' }
                    }
                },
                metadata: {
                    source: 'test',
                    priority: 'high'
                }
            };

            const signedMessage = messageSecurity.signMessage(message);

            expect(signedMessage).toHaveProperty('signature');
            expect(signedMessage).toHaveProperty('timestamp');
            expect(signedMessage).toHaveProperty('type');
            expect(signedMessage).toHaveProperty('payload');
            expect(signedMessage).toHaveProperty('metadata');
            expect(mockMetrics.messageSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle signing errors gracefully', () => {
            const message = { type: 'test' };
            const invalidConfig = { security: {} };
            const invalidSecurity = new MessageSecurity(invalidConfig, mockMetrics);

            expect(() => invalidSecurity.signMessage(message)).toThrow();
            expect(mockMetrics.messageSigningError.inc).toHaveBeenCalled();
        });
    });

    describe('verifySignature', () => {
        it('should verify a valid signature', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now()
            };

            const signedMessage = messageSecurity.signMessage(message);
            const isValid = messageSecurity.verifySignature(signedMessage);

            expect(isValid).toBe(true);
            expect(mockMetrics.messageVerificationSuccess.inc).toHaveBeenCalled();
        });

        it('should reject tampered message', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now()
            };

            const signedMessage = messageSecurity.signMessage(message);
            signedMessage.payload.data = 'tampered data';

            const isValid = messageSecurity.verifySignature(signedMessage);

            expect(isValid).toBe(false);
            expect(mockMetrics.messageVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject expired signature', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now() - 7200000 // 2 hours ago
            };

            const signedMessage = messageSecurity.signMessage(message);
            const isValid = messageSecurity.verifySignature(signedMessage);

            expect(isValid).toBe(false);
            expect(mockMetrics.messageVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject message with missing signature', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now()
            };

            const isValid = messageSecurity.verifySignature(message);

            expect(isValid).toBe(false);
            expect(mockMetrics.messageVerificationError.inc).toHaveBeenCalled();
        });

        it('should handle verification errors gracefully', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now(),
                signature: 'invalid'
            };

            const isValid = messageSecurity.verifySignature(message);

            expect(isValid).toBe(false);
            expect(mockMetrics.messageVerificationError.inc).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should log errors during signing', () => {
            const message = { type: 'test' };
            const invalidConfig = { security: {} };
            const invalidSecurity = new MessageSecurity(invalidConfig, mockMetrics);

            expect(() => invalidSecurity.signMessage(message)).toThrow();
            expect(logger.error).toHaveBeenCalled();
        });

        it('should log errors during verification', () => {
            const message = {
                type: 'test',
                payload: { data: 'test data' },
                timestamp: Date.now(),
                signature: 'invalid'
            };

            messageSecurity.verifySignature(message);
            expect(logger.error).toHaveBeenCalled();
        });
    });
}); 