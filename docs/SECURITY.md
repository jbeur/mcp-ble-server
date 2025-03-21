# Security Guidelines

## Overview
This document outlines security best practices, guidelines, and procedures for the MCP BLE Server project. It covers security considerations for development, deployment, and maintenance.

## Security Best Practices

### 1. Code Security

#### Input Validation
```javascript
// Validate device parameters
function validateDevice(device) {
  if (!device || typeof device !== 'object') {
    throw new BLEError('Invalid device object');
  }

  if (device.address && !isValidMacAddress(device.address)) {
    throw new BLEError('Invalid MAC address format');
  }

  if (device.services && !Array.isArray(device.services)) {
    throw new BLEError('Services must be an array');
  }
}

// Validate MAC address format
function isValidMacAddress(address) {
  return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(address);
}
```

#### Error Handling
```javascript
// Secure error handling
try {
  await connectToDevice(device);
} catch (error) {
  // Log error without sensitive information
  logger.error('Connection failed', {
    deviceId: device.id,
    errorCode: error.code
  });
  
  // Throw sanitized error
  throw new BLEError('Connection failed');
}
```

#### Resource Management
```javascript
// Secure resource cleanup
class BLEService {
  constructor() {
    this.resources = new Set();
  }

  cleanup() {
    for (const resource of this.resources) {
      try {
        resource.dispose();
      } catch (error) {
        logger.error('Resource cleanup failed', {
          resourceId: resource.id,
          error: error.message
        });
      }
    }
    this.resources.clear();
  }
}
```

### 2. Configuration Security

#### Secure Configuration Loading
```javascript
const fs = require('fs');
const yaml = require('js-yaml');

function loadConfig(path) {
  try {
    // Validate file permissions
    const stats = fs.statSync(path);
    if (stats.mode & 0o777 !== 0o600) {
      throw new Error('Insecure file permissions');
    }

    // Load and validate configuration
    const config = yaml.load(fs.readFileSync(path, 'utf8'));
    validateConfig(config);
    return config;
  } catch (error) {
    throw new Error(`Configuration error: ${error.message}`);
  }
}
```

#### Environment Variables
```javascript
// Use environment variables for sensitive data
const config = {
  apiKey: process.env.BLE_API_KEY,
  secret: process.env.BLE_SECRET,
  // ... other config
};

// Validate required environment variables
function validateEnv() {
  const required = ['BLE_API_KEY', 'BLE_SECRET'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}
```

### 3. Network Security

#### HTTPS Configuration
```javascript
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem'),
  minVersion: 'TLSv1.2',
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256'
  ].join(':'),
  honorCipherOrder: true
};

https.createServer(options, app).listen(443);
```

#### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use(limiter);
```

## Vulnerability Reporting

### 1. Reporting Process
1. Email security@example.com
2. Include detailed description
3. Provide steps to reproduce
4. Add system information
5. Wait for response

### 2. Security Advisory Template
```markdown
## Security Advisory

### Title
[Brief description of the vulnerability]

### Description
[Detailed description of the vulnerability]

### Impact
[Description of potential impact]

### Affected Versions
- Version 1.0.0
- Version 1.1.0

### Fix
[Description of the fix]

### Timeline
- Reported: [Date]
- Fixed: [Date]
- Released: [Date]

### Credits
[Credit to reporter if applicable]
```

## Access Control

### 1. Device Access Control
```javascript
class BLEService {
  constructor() {
    this.authorizedDevices = new Set();
  }

  authorizeDevice(deviceId, token) {
    if (!this.validateToken(token)) {
      throw new BLEError('Invalid authorization token');
    }
    this.authorizedDevices.add(deviceId);
  }

  isDeviceAuthorized(deviceId) {
    return this.authorizedDevices.has(deviceId);
  }
}
```

### 2. API Access Control
```javascript
const jwt = require('jsonwebtoken');

function validateToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = validateToken(token);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

## Data Protection

### 1. Data Encryption
```javascript
const crypto = require('crypto');

function encryptData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decryptData(encryptedData, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encryptedData.iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

### 2. Secure Storage
```javascript
const secureStore = require('secure-store');

class SecureStorage {
  constructor() {
    this.store = new secureStore();
  }

  async saveCredentials(deviceId, credentials) {
    const key = `device:${deviceId}`;
    await this.store.set(key, JSON.stringify(credentials));
  }

  async getCredentials(deviceId) {
    const key = `device:${deviceId}`;
    const data = await this.store.get(key);
    return data ? JSON.parse(data) : null;
  }
}
```

## Security Monitoring

### 1. Logging
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/security.log',
      level: 'info'
    })
  ]
});

// Log security events
function logSecurityEvent(event) {
  logger.info('Security event', {
    event: event.type,
    timestamp: new Date(),
    details: event.details
  });
}
```

### 2. Monitoring
```javascript
const prometheus = require('prom-client');

// Security metrics
const securityMetrics = {
  failedAuthAttempts: new prometheus.Counter({
    name: 'ble_security_failed_auth_attempts_total',
    help: 'Total number of failed authentication attempts'
  }),
  
  activeConnections: new prometheus.Gauge({
    name: 'ble_security_active_connections',
    help: 'Number of active secure connections'
  })
};

// Update metrics
function updateSecurityMetrics(event) {
  switch (event.type) {
    case 'auth_failure':
      securityMetrics.failedAuthAttempts.inc();
      break;
    case 'connection':
      securityMetrics.activeConnections.inc();
      break;
    case 'disconnection':
      securityMetrics.activeConnections.dec();
      break;
  }
}
```

## Security Checklist

### 1. Development
- [ ] Input validation
- [ ] Error handling
- [ ] Resource cleanup
- [ ] Secure configuration
- [ ] Environment variables
- [ ] HTTPS/TLS
- [ ] Rate limiting
- [ ] Access control
- [ ] Data encryption
- [ ] Secure storage

### 2. Deployment
- [ ] Secure file permissions
- [ ] Network security
- [ ] SSL/TLS configuration
- [ ] Firewall rules
- [ ] Monitoring setup
- [ ] Backup strategy
- [ ] Incident response plan

### 3. Maintenance
- [ ] Regular updates
- [ ] Security patches
- [ ] Dependency updates
- [ ] Log rotation
- [ ] Access review
- [ ] Security audit
- [ ] Penetration testing

## Incident Response

### 1. Response Plan
1. Identify the incident
2. Assess the impact
3. Contain the incident
4. Investigate the cause
5. Fix the issue
6. Document the incident
7. Review and improve

### 2. Communication Plan
1. Internal notification
2. External communication
3. Status updates
4. Resolution announcement
5. Post-mortem report

## Resources

### Security Tools
- [OWASP ZAP](https://www.zaproxy.org/)
- [SonarQube](https://www.sonarqube.org/)
- [Snyk](https://snyk.io/)

### Security Standards
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [NIST Guidelines](https://www.nist.gov/cyberframework)

### Security Documentation
- [Node.js Security Checklist](https://nodejs.org/en/docs/guides/security-checklist/)
- [npm Security Best Practices](https://docs.npmjs.com/security)
- [Bluetooth Security](https://www.bluetooth.com/security/) 