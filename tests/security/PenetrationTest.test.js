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
      const invalidApiKey = 'invalid-key';
            
      // Try multiple failed attempts
      for (let i = 0; i < authService.maxFailedAttempts; i++) {
        try {
          await authService.authenticate(clientId, invalidApiKey);
          fail('Should have failed authentication');
        } catch (error) {
          expect(error.message).toBe('Invalid API key');
        }
      }
            
      // Next attempt should be blocked
      try {
        await authService.authenticate(clientId, invalidApiKey);
        fail('Should have been blocked');
      } catch (error) {
        expect(error.message).toBe('Invalid API key');
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
    beforeEach(async () => {
      // Reset rate limiter before each test
      if (authService.rateLimiter) {
        authService.rateLimiter.stop();
      }
      // Create new API key manager
      authService.apiKeyManager = new ApiKeyManager();
      // Configure rate limiter with lower limits
      authService.rateLimiter = new RateLimiter({
        windowMs: 100, // 100ms
        maxRequests: 1 // 1 request per 100ms
      });
    });

    it('should prevent request flooding', async () => {
      const clientId = 'test-client';
      const maxRequests = 100;
            
      // Create a valid API key for the client
      const validApiKey = await authService.apiKeyManager.createKey(clientId);
            
      // Send many requests quickly
      try {
        for (let i = 0; i < maxRequests + 1; i++) {
          await authService.authenticate(clientId, validApiKey);
        }
        fail('Rate limit should have been exceeded');
      } catch (error) {
        expect(error.message).toBe('Rate limit exceeded');
      }
    });

    it('should enforce rate limits per client', async () => {
      const clientId1 = 'test-client-1';
      const clientId2 = 'test-client-2';
      const maxRequests = 100;
            
      // Create valid API keys for both clients
      const validApiKey1 = await authService.apiKeyManager.createKey(clientId1);
      const validApiKey2 = await authService.apiKeyManager.createKey(clientId2);
            
      // Exceed rate limit for first client
      try {
        for (let i = 0; i < maxRequests + 1; i++) {
          await authService.authenticate(clientId1, validApiKey1);
        }
        fail('Rate limit should have been exceeded');
      } catch (error) {
        expect(error.message).toBe('Rate limit exceeded');
      }
            
      // Second client should still be able to authenticate
      try {
        await authService.authenticate(clientId2, validApiKey2);
      } catch (error) {
        fail('Second client should not be rate limited');
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

  describe('Session Management Attacks', () => {
    it('should prevent session fixation attacks', async () => {
      const clientId = 'test-client';
      const apiKey = await authService.apiKeyManager.createKey(clientId);
            
      // Create initial session
      const initialSession = await authService.createSession(clientId);
            
      // Attempt to authenticate with the same session ID
      try {
        await authService.authenticate(clientId, apiKey, { sessionId: initialSession });
        fail('Should have prevented session fixation');
      } catch (error) {
        expect(error.message).toBe('Invalid session');
      }
    });

    it('should enforce session expiration', async () => {
      const clientId = 'test-client';
            
      // Create session with short expiration
      const session = await authService.createSession(clientId, { expiresIn: 1000 });
            
      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 1500));
            
      try {
        await authService.validateSession(session);
        fail('Should have detected expired session');
      } catch (error) {
        expect(error.message).toBe('Session expired');
      }
    });
  });

  describe('API Key Attacks', () => {
    it('should prevent API key brute force', async () => {
      const clientId = 'test-client';
            
      // Try multiple invalid API keys
      for (let i = 0; i < authService.maxFailedAttempts; i++) {
        try {
          await authService.validateApiKey(clientId, `invalid-key-${i}`);
          fail('Should have failed validation');
        } catch (error) {
          expect(error.message).toBe('Invalid API key');
        }
      }
            
      // Next attempt should be blocked
      try {
        await authService.validateApiKey(clientId, 'another-invalid-key');
        fail('Should have been blocked');
      } catch (error) {
        expect(error.message).toBe('Invalid API key');
      }
    });

    it('should enforce API key rotation', async () => {
      const clientId = 'test-client';
      const oldKey = await authService.apiKeyManager.createKey(clientId);
            
      // Rotate key
      const newKey = await authService.apiKeyManager.rotateKey(clientId);
            
      // Old key should be invalid
      try {
        await authService.validateApiKey(clientId, oldKey);
        fail('Should have rejected old key');
      } catch (error) {
        expect(error.message).toBe('Invalid API key');
      }
            
      // New key should work
      expect(await authService.validateApiKey(clientId, newKey)).toBe(true);
    });
  });

  describe('Message Signing Attacks', () => {
    it('should prevent message tampering', async () => {
      const message = 'test-message';
      const signedMessage = await authService.signMessage(message);
            
      // Tamper with message by modifying the signature
      const [signature, timestamp] = signedMessage.split('.');
      const tamperedSignature = signature.replace(/[a-f]/g, '0');
      const tamperedMessage = `${tamperedSignature}.${timestamp}`;
            
      try {
        await authService.verifyMessage(message, tamperedMessage);
        fail('Should have detected tampering');
      } catch (error) {
        expect(error.message).toBe('Invalid message signature');
      }
    });

    it('should prevent replay attacks', async () => {
      const message = 'test message';
      const signature = await authService.signMessage(message);
            
      // First attempt should succeed
      await authService.verifyMessage(message, signature);
            
      // Wait for message to expire
      await new Promise(resolve => setTimeout(resolve, 1000));
            
      // Second attempt should fail
      try {
        await authService.verifyMessage(message, signature);
        fail('Message should have expired');
      } catch (error) {
        expect(error.message).toBe('Message expired');
      }
    });
  });

  describe('Threat Detection Integration', () => {
    it('should detect and block suspicious IPs', async () => {
      const ip = '192.168.1.1';
      await threatDetectionService.blockIp(ip, 'Suspicious activity');
            
      try {
        await authService.authenticate('test-client', 'test-key', { ip });
        fail('Access should have been denied');
      } catch (error) {
        expect(error.message).toBe('Invalid API key');
      }
    });

    it('should detect and block suspicious patterns', async () => {
      const clientId = 'test-client';
      await threatDetectionService.analyzeThreat({
        clientId,
        type: 'suspicious_pattern',
        severity: 'high'
      });
            
      try {
        await authService.authenticate(clientId, 'test-key');
        fail('Access should have been denied');
      } catch (error) {
        expect(error.message).toBe('Invalid API key');
      }
    });
  });

  describe('Resource Exhaustion Attacks', () => {
    it('should prevent memory exhaustion', async () => {
      const clientId = 'test-client';
      const largeData = 'A'.repeat(1024 * 1024 * 10); // 10MB
            
      try {
        await authService.processLargeData(clientId, largeData);
        fail('Should have prevented memory exhaustion');
      } catch (error) {
        expect(error.message).toBe('Request too large');
      }
    });

    it('should prevent connection exhaustion', async () => {
      const maxConnections = 10;
      const connections = [];
            
      // Create maximum connections
      for (let i = 0; i < maxConnections; i++) {
        const clientId = `client-${i}`;
        const connection = await authService.createConnection(clientId);
        connections.push(connection);
      }
            
      // Next connection should be rejected
      try {
        await authService.createConnection('new-client');
        fail('Connection limit should have been reached');
      } catch (error) {
        expect(error.message).toBe('Connection limit should have been reached');
      }
            
      // Clean up
      await Promise.all(connections.map(c => c.close()));
    });
  });
}); 