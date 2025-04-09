module.exports = {
  security: {
    tokenAuth: {
      accessTokenSecret: 'test-access-token-secret',
      refreshTokenSecret: 'test-refresh-token-secret',
      accessTokenExpiry: '15m',
      refreshTokenExpiry: '7d',
      issuer: 'mcp-ble-server-test',
      algorithm: 'HS256'
    },
    oauth2: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      authorizationEndpoint: 'http://localhost:8080/oauth/authorize',
      tokenEndpoint: 'http://localhost:8080/oauth/token',
      scope: 'read write'
    },
    rateLimiting: {
      maxRequests: 100,
      windowMs: 60000, // 1 minute
      maxRequestsPerClient: 50
    },
    threatDetection: {
      maxFailedAttempts: 5,
      blockDuration: 300000, // 5 minutes
      highSeverityThreshold: 0.8,
      mediumSeverityThreshold: 0.5
    }
  },
  logging: {
    level: 'error',
    format: 'json'
  }
}; 