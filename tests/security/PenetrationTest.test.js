const path = require('path');
const dotenv = require('dotenv');
const AuthService = require('../../src/auth/AuthService');
const OAuth2Service = require('../../src/auth/OAuth2Service');
const TokenAuthentication = require('../../src/auth/TokenAuthentication');
const ThreatDetectionService = require('../../src/security/ThreatDetectionService');
const metrics = require('../../src/utils/metrics');
const RateLimiter = require('../../src/auth/RateLimiter');
const ApiKeyManager = require('../../src/auth/ApiKeyManager');
const logger = require('../../src/utils/logger');

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../config/test.env') });

let authService;
let oauth2Service;
let tokenAuth;
let threatDetectionService;

// Helper function for test failures
function fail(message) {
    throw new Error(message || 'Test failed');
}

describe('Security Penetration Tests', () => {
    beforeAll(async () => {
        // Initialize services with test configuration
        const config = {
            security: {
                tokenAuth: {
                    accessTokenSecret: process.env.TOKEN_AUTH_ACCESS_SECRET,
                    refreshTokenSecret: process.env.TOKEN_AUTH_REFRESH_SECRET,
                    algorithm: process.env.TOKEN_AUTH_ALGORITHM,
                    issuer: process.env.TOKEN_AUTH_ISSUER
                }
            },
            auth: {
                jwtSecret: process.env.JWT_SECRET,
                sessionDuration: parseInt(process.env.SESSION_DURATION),
                maxFailedAttempts: 5,
                lockoutDuration: 15 * 60 * 1000 // 15 minutes
            },
            oauth2: {
                clientId: process.env.OAUTH2_CLIENT_ID,
                clientSecret: process.env.OAUTH2_CLIENT_SECRET,
                redirectUri: process.env.OAUTH2_REDIRECT_URI
            },
            rateLimiting: {
                windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS),
                maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
            }
        };

        tokenAuth = new TokenAuthentication(config, metrics);
        authService = new AuthService(config, metrics, tokenAuth);
        oauth2Service = new OAuth2Service(config, metrics);
        threatDetectionService = new ThreatDetectionService(config, metrics);

        // Start services
        await Promise.all([
            authService.start && authService.start(),
            oauth2Service.start && oauth2Service.start(),
            threatDetectionService.start && threatDetectionService.start()
        ]);
    });

    afterEach(async () => {
        // Clean up after each test
        if (authService && authService.cleanup) await authService.cleanup();
        if (oauth2Service && oauth2Service.cleanup) await oauth2Service.cleanup();
        if (tokenAuth && tokenAuth.cleanup) await tokenAuth.cleanup();
        if (threatDetectionService && threatDetectionService.cleanup) await threatDetectionService.cleanup();
    });

    afterAll(async () => {
        // Stop all services
        if (authService && authService.stop) await authService.stop();
        if (oauth2Service && oauth2Service.stop) await oauth2Service.stop();
        if (tokenAuth && tokenAuth.stop) await tokenAuth.stop();
        if (threatDetectionService && threatDetectionService.stop) await threatDetectionService.stop();
    });

    describe('Authentication Attacks', () => {
        it('should prevent brute force attacks', async () => {
            const clientId = 'test-client';
            const apiKey = 'test-key';
            
            // Create API key
            await authService.apiKeyManager.createKey(clientId);
            
            // Attempt multiple failed logins
            for (let i = 0; i < 5; i++) {
                try {
                    await authService.authenticate(clientId, 'wrong-password');
                } catch (error) {
                    expect(error.message).toBe('Access denied');
                }
            }
            
            // Next attempt should be blocked
            try {
                await authService.authenticate(clientId, 'wrong-password');
                fail('Should have been blocked');
            } catch (error) {
                expect(error.message).toBe('Access denied');
            }
        });

        it('should prevent session hijacking', async () => {
            const clientId = 'test-client';
            const sessionId = await authService.createSession(clientId);
            
            // Modify session ID
            const modifiedSessionId = sessionId.slice(0, -1) + 'x';
            
            try {
                await authService.validateSession(modifiedSessionId);
                fail('Should have detected session hijacking');
            } catch (error) {
                expect(error.message).toBe('Session not found');
            }
        });

        it('should prevent token replay attacks', async () => {
            const clientId = 'test-client';
            const sessionId = await authService.createSession(clientId);
            
            // First use should succeed
            expect(await authService.validateSession(sessionId)).toBe(true);
            
            // Remove session to simulate expiration/invalidation
            authService.activeSessions.delete(sessionId);
            
            try {
                await authService.validateSession(sessionId);
                fail('Should have detected replayed session');
            } catch (error) {
                expect(error.message).toBe('Session not found');
            }
        });
    });

    describe('OAuth2 Attacks', () => {
        it('should prevent CSRF attacks', async () => {
            const clientId = 'test-client';
            
            // Generate authorization URL with valid state
            const authUrl = await oauth2Service.generateAuthorizationUrl(clientId);
            const validState = authUrl.split('state=')[1].split('&')[0];
            
            // Attempt to use a different state
            try {
                await oauth2Service.createAuthorizationCode(clientId, 'http://localhost:3000/callback', 'read', 'malicious-state');
                fail('Should have detected CSRF attack');
            } catch (error) {
                expect(error.message).toBe('Invalid CSRF token');
            }
        });

        it('should prevent authorization code reuse', async () => {
            const clientId = 'test-client';
            
            // Generate authorization URL with valid state
            const authUrl = await oauth2Service.generateAuthorizationUrl(clientId);
            const validState = authUrl.split('state=')[1].split('&')[0];
            
            // Create authorization code with valid state
            const code = await oauth2Service.createAuthorizationCode(clientId, 'http://localhost:3000/callback', 'read', validState);

            // First use should succeed
            await oauth2Service.createOAuth2Session(code, clientId, 'http://localhost:3000/callback');

            // Second use should fail
            try {
                await oauth2Service.createOAuth2Session(code, clientId, 'http://localhost:3000/callback');
                fail('Should have prevented code reuse');
            } catch (error) {
                expect(error.message).toBe('Authorization code has already been used');
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
            expect(isValid).toBe(false);
        });

        it('should prevent token forgery', async () => {
            // Attempt to create a token with invalid signature
            const forgedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LWNsaWVudCIsImlhdCI6MTYxNjE2MjQwMH0.invalid-signature';
            const isValid = await tokenAuth.validateToken(forgedToken);
            expect(isValid).toBe(false);
        });
    });

    describe('Rate Limiting Attacks', () => {
        beforeEach(() => {
            // Reset rate limiter before each test
            if (authService.rateLimiter) {
                authService.rateLimiter.stop();
            }
            // Create new API key manager
            authService.apiKeyManager = new ApiKeyManager();
        });

        it('should prevent request flooding', async () => {
            const clientId = 'test-client';
            
            // Create and validate API key
            const key = await authService.apiKeyManager.createKey(clientId);
            expect(await authService.apiKeyManager.validateKey(clientId, key)).toBe(true);
            
            // Configure rate limiter with lower limits
            authService.rateLimiter = new RateLimiter({
                windowMs: 100, // 100ms
                maxRequests: 1 // 1 request per 100ms
            });
            
            // First request should succeed
            await authService.authenticate(clientId, key);

            // Second request should fail with rate limit
            try {
                await authService.authenticate(clientId, key);
                fail('Should have been rate limited');
            } catch (error) {
                expect(error.message).toBe('Rate limit exceeded');
            }
        });

        it('should enforce rate limits per client', async () => {
            const clientId1 = 'test-client-1';
            const clientId2 = 'test-client-2';
            
            // Create and validate API keys
            const key1 = await authService.apiKeyManager.createKey(clientId1);
            const key2 = await authService.apiKeyManager.createKey(clientId2);
            expect(await authService.apiKeyManager.validateKey(clientId1, key1)).toBe(true);
            expect(await authService.apiKeyManager.validateKey(clientId2, key2)).toBe(true);
            
            // Configure rate limiter with lower limits
            authService.rateLimiter = new RateLimiter({
                windowMs: 100, // 100ms
                maxRequests: 1 // 1 request per 100ms
            });
            
            // Both clients should succeed with their first request
            const result1 = await authService.authenticate(clientId1, key1);
            const result2 = await authService.authenticate(clientId2, key2);

            expect(result1).toBeTruthy();
            expect(result2).toBeTruthy();

            // Second requests should fail for both clients
            try {
                await authService.authenticate(clientId1, key1);
                fail('Should have been rate limited');
            } catch (error) {
                expect(error.message).toBe('Rate limit exceeded');
            }

            try {
                await authService.authenticate(clientId2, key2);
                fail('Should have been rate limited');
            } catch (error) {
                expect(error.message).toBe('Rate limit exceeded');
            }
        });
    });

    describe('Threat Detection', () => {
        it('should detect suspicious patterns', async () => {
            const clientId = 'test-client';
            const threat = {
                type: 'suspicious_pattern',
                clientId,
                severity: 'medium',
                details: { pattern: 'unusual_access_pattern' }
            };

            await threatDetectionService.analyzeThreat(threat);
            const threats = await threatDetectionService.getThreatsForClient(clientId);
            expect(threats.length).toBeGreaterThan(0);
            expect(threats[0].type).toBe('suspicious_pattern');
        });

        it('should block high severity threats', async () => {
            const clientId = 'test-client';
            const threat = {
                type: 'malicious_activity',
                clientId,
                severity: 'high',
                details: { activity: 'potential_attack' }
            };

            await threatDetectionService.analyzeThreat(threat);
            const isBlocked = await threatDetectionService.isClientBlocked(clientId);
            expect(isBlocked).toBe(true);
        });
    });
}); 