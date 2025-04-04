const { expect } = require('chai');
const AuthService = require('../../src/auth/AuthService');
const OAuth2Service = require('../../src/auth/OAuth2Service');
const TokenAuthentication = require('../../src/auth/TokenAuthentication');
const ThreatDetectionService = require('../../src/security/ThreatDetectionService');
const config = require('../../config/config');

describe('Security Penetration Tests', () => {
    let authService;
    let oauth2Service;
    let tokenAuth;
    let threatDetection;

    beforeEach(() => {
        authService = new AuthService(config);
        oauth2Service = new OAuth2Service(config);
        tokenAuth = new TokenAuthentication(config);
        threatDetection = new ThreatDetectionService(config);
    });

    describe('Authentication Attacks', () => {
        it('should prevent brute force attacks', async () => {
            const clientId = 'test-client';
            const maxAttempts = 5;
            
            // Simulate multiple failed login attempts
            for (let i = 0; i < maxAttempts + 1; i++) {
                try {
                    await authService.authenticate(clientId, 'wrong-password');
                } catch (error) {
                    expect(error.message).to.include('Authentication failed');
                }
            }

            // Verify account is locked
            const isBlocked = await threatDetection.isBlocked(clientId);
            expect(isBlocked).to.be.true;
        });

        it('should prevent session hijacking', async () => {
            const clientId = 'test-client';
            const session = await authService.createSession(clientId);
            
            // Attempt to use a modified session token
            const modifiedToken = session.token + 'tampered';
            const isValid = await authService.validateSession(modifiedToken);
            expect(isValid).to.be.false;
        });

        it('should prevent token replay attacks', async () => {
            const clientId = 'test-client';
            const session = await authService.createSession(clientId);
            
            // Store the token
            const originalToken = session.token;
            
            // Invalidate the session
            await authService.removeSession(session.token);
            
            // Attempt to reuse the token
            const isValid = await authService.validateSession(originalToken);
            expect(isValid).to.be.false;
        });
    });

    describe('OAuth2 Attacks', () => {
        it('should prevent CSRF attacks', async () => {
            const clientId = 'test-client';
            const state = 'valid-state';
            
            // Generate authorization URL
            const authUrl = await oauth2Service.generateAuthorizationUrl(clientId, state);
            
            // Attempt to use a different state
            const modifiedUrl = authUrl.replace(state, 'malicious-state');
            const isValid = await oauth2Service.validateAuthorizationRequest(modifiedUrl);
            expect(isValid).to.be.false;
        });

        it('should prevent authorization code reuse', async () => {
            const clientId = 'test-client';
            const authCode = 'valid-code';
            
            // Use the authorization code once
            await oauth2Service.createOAuth2Session(clientId, authCode);
            
            // Attempt to reuse the code
            try {
                await oauth2Service.createOAuth2Session(clientId, authCode);
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Invalid or expired authorization code');
            }
        });
    });

    describe('Token Attacks', () => {
        it('should prevent token tampering', async () => {
            const clientId = 'test-client';
            const token = await tokenAuth.generateToken(clientId);
            
            // Modify the token
            const modifiedToken = token.replace('a', 'b');
            const isValid = await tokenAuth.validateToken(modifiedToken);
            expect(isValid).to.be.false;
        });

        it('should prevent token forgery', async () => {
            // Attempt to create a token with invalid signature
            const forgedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LWNsaWVudCIsImlhdCI6MTYxNjE2MjQwMH0.invalid-signature';
            const isValid = await tokenAuth.validateToken(forgedToken);
            expect(isValid).to.be.false;
        });
    });

    describe('Rate Limiting Attacks', () => {
        it('should prevent request flooding', async () => {
            const clientId = 'test-client';
            const maxRequests = 100;
            
            // Simulate rapid requests
            const requests = Array(maxRequests + 1).fill().map(() => 
                authService.validateApiKey(clientId, 'valid-key')
            );
            
            const results = await Promise.allSettled(requests);
            const rejected = results.filter(r => r.status === 'rejected');
            expect(rejected.length).to.be.greaterThan(0);
        });

        it('should enforce rate limits per client', async () => {
            const client1 = 'client-1';
            const client2 = 'client-2';
            const maxRequests = 50;
            
            // Simulate requests from two different clients
            const requests1 = Array(maxRequests + 1).fill().map(() => 
                authService.validateApiKey(client1, 'valid-key')
            );
            const requests2 = Array(maxRequests + 1).fill().map(() => 
                authService.validateApiKey(client2, 'valid-key')
            );
            
            const results1 = await Promise.allSettled(requests1);
            const results2 = await Promise.allSettled(requests2);
            
            // Both clients should be rate limited independently
            expect(results1.filter(r => r.status === 'rejected').length).to.be.greaterThan(0);
            expect(results2.filter(r => r.status === 'rejected').length).to.be.greaterThan(0);
        });
    });

    describe('Threat Detection', () => {
        it('should detect suspicious patterns', async () => {
            const clientId = 'test-client';
            
            // Simulate suspicious behavior
            await threatDetection.analyzeThreat({
                type: 'authentication',
                clientId,
                severity: 'high',
                details: { pattern: 'suspicious' }
            });
            
            const threats = await threatDetection.getThreats(clientId);
            expect(threats).to.have.lengthOf(1);
            expect(threats[0].severity).to.equal('high');
        });

        it('should block high severity threats', async () => {
            const clientId = 'test-client';
            
            // Create a high severity threat
            await threatDetection.analyzeThreat({
                type: 'authentication',
                clientId,
                severity: 'high',
                details: { pattern: 'malicious' }
            });
            
            // Attempt authentication
            try {
                await authService.authenticate(clientId, 'valid-password');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Access denied');
            }
        });
    });
}); 