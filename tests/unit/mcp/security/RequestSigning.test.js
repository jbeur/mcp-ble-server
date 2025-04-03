const crypto = require('crypto');
const RequestSigning = require('../../../../src/mcp/security/RequestSigning');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('RequestSigning', () => {
    let requestSigning;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        mockConfig = {
            security: {
                requestSigning: {
                    algorithm: 'sha256',
                    secret: 'test-secret-key',
                    timestampTolerance: 300, // 5 minutes
                    requiredHeaders: ['x-client-id', 'x-timestamp', 'x-signature']
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
        jest.restoreAllMocks();
    });

    describe('signRequest', () => {
        it('should sign a request with all required headers', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString()
                },
                body: { deviceId: '123' }
            };

            const signedRequest = requestSigning.signRequest(request);

            expect(signedRequest.headers).toHaveProperty('x-signature');
            expect(signedRequest.headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle empty request body', () => {
            const request = {
                method: 'GET',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString()
                }
            };

            const signedRequest = requestSigning.signRequest(request);

            expect(signedRequest.headers).toHaveProperty('x-signature');
            expect(signedRequest.headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle complex request body', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString()
                },
                body: {
                    devices: [
                        { id: '1', name: 'Device 1' },
                        { id: '2', name: 'Device 2' }
                    ],
                    metadata: {
                        type: 'batch',
                        priority: 'high'
                    }
                }
            };

            const signedRequest = requestSigning.signRequest(request);

            expect(signedRequest.headers).toHaveProperty('x-signature');
            expect(signedRequest.headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
            expect(mockMetrics.requestSigningSuccess.inc).toHaveBeenCalled();
        });

        it('should handle signing errors gracefully', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString()
                },
                body: { deviceId: '123' }
            };

            // Mock crypto.createHmac to throw an error
            jest.spyOn(crypto, 'createHmac').mockImplementation(() => {
                throw new Error('Crypto error');
            });

            expect(() => requestSigning.signRequest(request)).toThrow('Failed to sign request');
            expect(mockMetrics.requestSigningError.inc).toHaveBeenCalled();
        });
    });

    describe('verifyRequest', () => {
        it('should verify a valid signed request', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString()
                },
                body: { deviceId: '123' }
            };

            const signedRequest = requestSigning.signRequest(request);
            const isValid = requestSigning.verifyRequest(signedRequest);

            expect(isValid).toBe(true);
            expect(mockMetrics.requestVerificationSuccess.inc).toHaveBeenCalled();
        });

        it('should reject requests with missing required headers', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client'
                },
                body: { deviceId: '123' }
            };

            expect(() => requestSigning.verifyRequest(request)).toThrow('Missing required headers');
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject requests with invalid signature', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString(),
                    'x-signature': 'invalid-signature'
                },
                body: { deviceId: '123' }
            };

            expect(() => requestSigning.verifyRequest(request)).toThrow('Invalid signature');
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject requests with expired timestamp', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': (Date.now() - 3600000).toString() // 1 hour ago
                },
                body: { deviceId: '123' }
            };

            const signedRequest = requestSigning.signRequest(request);
            expect(() => requestSigning.verifyRequest(signedRequest)).toThrow('Request timestamp expired');
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should reject requests with future timestamp', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': (Date.now() + 3600000).toString() // 1 hour in future
                },
                body: { deviceId: '123' }
            };

            const signedRequest = requestSigning.signRequest(request);
            expect(() => requestSigning.verifyRequest(signedRequest)).toThrow('Request timestamp is in the future');
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });

        it('should handle verification errors gracefully', () => {
            const request = {
                method: 'POST',
                path: '/api/devices',
                headers: {
                    'x-client-id': 'test-client',
                    'x-timestamp': Date.now().toString(),
                    'x-signature': 'invalid-signature'
                },
                body: { deviceId: '123' }
            };

            // Mock crypto.createHmac to throw an error
            jest.spyOn(crypto, 'createHmac').mockImplementation(() => {
                throw new Error('Crypto error');
            });

            expect(() => requestSigning.verifyRequest(request)).toThrow('Failed to verify request');
            expect(mockMetrics.requestVerificationError.inc).toHaveBeenCalled();
        });
    });
}); 