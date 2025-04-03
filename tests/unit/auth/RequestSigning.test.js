const crypto = require('crypto');
const RequestSigning = require('../../../src/auth/RequestSigning');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics');

describe('RequestSigning', () => {
    let requestSigning;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        mockConfig = {
            security: {
                requestSigning: {
                    algorithm: 'sha256',
                    keyLength: 32,
                    timestampTolerance: 5 * 60, // 5 minutes in seconds
                    requiredHeaders: ['content-type', 'x-request-id'],
                    key: 'test-key'
                }
            }
        };
        mockMetrics = {
            requestSigningSuccess: { inc: jest.fn() },
            requestSigningError: { inc: jest.fn() },
            requestVerificationSuccess: { inc: jest.fn() },
            requestVerificationError: { inc: jest.fn() }
        };
        requestSigning = new RequestSigning(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('signRequest', () => {
        it('should sign a request with all required components', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const signature = requestSigning.signRequest(request);
            
            expect(signature).toHaveProperty('signature');
            expect(signature).toHaveProperty('timestamp');
            expect(signature.signature).toMatch(/^[0-9a-f]{64}$/);
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle empty request body', () => {
            const request = {
                method: 'GET',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                }
            };

            const signature = requestSigning.signRequest(request);
            
            expect(signature).toHaveProperty('signature');
            expect(signature).toHaveProperty('timestamp');
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle complex request body', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: {
                    devices: [
                        { id: 'device1', type: 'sensor' },
                        { id: 'device2', type: 'actuator' }
                    ],
                    metadata: {
                        timestamp: Date.now(),
                        version: '1.0.0'
                    }
                }
            };

            const signature = requestSigning.signRequest(request);
            
            expect(signature).toHaveProperty('signature');
            expect(signature).toHaveProperty('timestamp');
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle missing required headers', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json'
                },
                body: { deviceId: 'test-device' }
            };

            expect(() => requestSigning.signRequest(request)).toThrow('Missing required header: x-request-id');
            expect(mockMetrics.requestSigningError.inc).toHaveBeenCalled();
        });

        it('should handle invalid request format', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices'
                // Missing headers and body
            };

            expect(() => requestSigning.signRequest(request)).toThrow('Invalid request format');
            expect(mockMetrics.requestSigningError.inc).toHaveBeenCalled();
        });
    });

    describe('verifyRequest', () => {
        it('should verify a valid signed request', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const signature = requestSigning.signRequest(request);
            const isValid = requestSigning.verifyRequest(request, signature);
            
            expect(isValid).toBe(true);
            expect(mockMetrics.requestVerificationSuccess.inc).toHaveBeenCalled();
        });

        it('should reject tampered request', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const signature = requestSigning.signRequest(request);
            request.body.deviceId = 'modified-device';
            
            const isValid = requestSigning.verifyRequest(request, signature);
            expect(isValid).toBe(false);
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject expired signature', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const signature = requestSigning.signRequest(request);
            signature.timestamp = Date.now() - (6 * 60 * 1000); // 6 minutes ago
            
            const isValid = requestSigning.verifyRequest(request, signature);
            expect(isValid).toBe(false);
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject request with missing signature', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const isValid = requestSigning.verifyRequest(request, {});
            expect(isValid).toBe(false);
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should handle verification errors gracefully', () => {
            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            const signature = requestSigning.signRequest(request);
            const originalAlgorithm = requestSigning.algorithm;
            requestSigning.algorithm = 'invalid-algorithm';
            
            const isValid = requestSigning.verifyRequest(request, signature);
            expect(isValid).toBe(false);
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
            
            requestSigning.algorithm = originalAlgorithm;
        });
    });

    describe('error handling', () => {
        it('should handle signing errors', () => {
            const originalCreateHmac = crypto.createHmac;
            crypto.createHmac = jest.fn(() => { throw new Error('Hmac creation failed'); });

            const request = {
                method: 'POST',
                path: '/api/v1/devices',
                headers: {
                    'content-type': 'application/json',
                    'x-request-id': '12345'
                },
                body: { deviceId: 'test-device' }
            };

            expect(() => requestSigning.signRequest(request)).toThrow();
            expect(mockMetrics.requestSigningError.inc).toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalled();

            crypto.createHmac = originalCreateHmac;
        });

        it('should handle missing configuration', () => {
            expect(() => new RequestSigning(null, mockMetrics)).toThrow('Configuration is required');
        });
    });
}); 