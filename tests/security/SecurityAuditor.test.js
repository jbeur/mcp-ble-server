const SecurityAuditor = require('../../src/security/SecurityAuditor');
const VulnerabilityScanner = require('../../src/security/VulnerabilityScanner');
const AuthService = require('../../src/auth/AuthService');
const RateLimiter = require('../../src/auth/RateLimiter');
const ThreatDetectionService = require('../../src/security/ThreatDetectionService');

// Mock dependencies
jest.mock('../../src/security/VulnerabilityScanner');
jest.mock('../../src/auth/AuthService');
jest.mock('../../src/auth/RateLimiter');
jest.mock('../../src/security/ThreatDetectionService');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/metrics');

describe('SecurityAuditor', () => {
    let securityAuditor;
    let mockDevice;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create mock device
        mockDevice = {
            id: 'test-device-001',
            name: 'Test Device',
            address: '00:11:22:33:44:55',
            rssi: -60
        };

        // Mock service configurations
        AuthService.prototype.config = {
            auth: {
                sessionDuration: null,
                jwtSecret: null,
                keyRotationInterval: null
            }
        };

        RateLimiter.prototype.config = {
            enabled: false,
            maxRequests: 1500
        };

        ThreatDetectionService.prototype.config = {
            enabled: false,
            ipBlocking: { enabled: false },
            patternDetection: { enabled: false }
        };

        // Reset vulnerability scanner mock
        VulnerabilityScanner.prototype.scanDevice.mockReset();
        VulnerabilityScanner.prototype.scanDevice.mockResolvedValue([]);

        // Initialize SecurityAuditor with test config
        securityAuditor = new SecurityAuditor({
            auditInterval: 1000,
            maxConcurrentAudits: 2,
            securityThreshold: 7.0
        });
    });

    describe('Constructor', () => {
        test('should initialize with default config when no config provided', () => {
            const defaultAuditor = new SecurityAuditor();
            expect(defaultAuditor.config.auditInterval).toBe(3600000);
            expect(defaultAuditor.config.maxConcurrentAudits).toBe(3);
            expect(defaultAuditor.config.securityThreshold).toBe(7.0);
        });

        test('should initialize with provided config', () => {
            expect(securityAuditor.config.auditInterval).toBe(1000);
            expect(securityAuditor.config.maxConcurrentAudits).toBe(2);
            expect(securityAuditor.config.securityThreshold).toBe(7.0);
        });

        test('should initialize required services', () => {
            expect(securityAuditor.vulnerabilityScanner).toBeDefined();
            expect(securityAuditor.authService).toBeDefined();
            expect(securityAuditor.rateLimiter).toBeDefined();
            expect(securityAuditor.threatDetection).toBeDefined();
        });
    });

    describe('startAudit', () => {
        test('should successfully start and complete an audit', async () => {
            // Mock vulnerability scanner response
            VulnerabilityScanner.prototype.scanDevice.mockResolvedValue([{
                name: 'Weak Authentication',
                severity: 7.5,
                description: 'Authentication mechanism is weak'
            }]);

            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            expect(results).toBeDefined();
            expect(results.vulnerabilities).toHaveLength(1);
            expect(results.overallScore).toBeLessThan(10);
            expect(results.recommendations).toBeDefined();
        });

        test('should enforce maximum concurrent audits', async () => {
            // Start max number of audits
            const audit1 = securityAuditor.startAudit('device-1', mockDevice);
            const audit2 = securityAuditor.startAudit('device-2', mockDevice);

            // Try to start one more audit
            await expect(async () => {
                await securityAuditor.startAudit('device-3', mockDevice);
            }).rejects.toThrow('Maximum concurrent audits reached');

            // Clean up pending promises
            await Promise.all([audit1, audit2]);
        });

        test('should prevent duplicate audits for same device', async () => {
            // Start first audit
            const audit1 = securityAuditor.startAudit(mockDevice.id, mockDevice);

            // Try to start another audit for same device
            await expect(async () => {
                await securityAuditor.startAudit(mockDevice.id, mockDevice);
            }).rejects.toThrow('Device audit already in progress');

            // Clean up pending promise
            await audit1;
        });

        test('should handle errors during audit', async () => {
            // Mock vulnerability scanner to throw error
            VulnerabilityScanner.prototype.scanDevice.mockRejectedValue(
                new Error('Scan failed')
            );

            await expect(async () => {
                await securityAuditor.startAudit(mockDevice.id, mockDevice);
            }).rejects.toThrow('Scan failed');
        });
    });

    describe('Security Checks', () => {
        test('should identify authentication issues', async () => {
            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            expect(results.authIssues).toHaveLength(3);
            expect(results.authIssues.some(issue => issue.type === 'SESSION')).toBe(true);
            expect(results.authIssues.some(issue => issue.type === 'TOKEN')).toBe(true);
            expect(results.authIssues.some(issue => issue.type === 'API_KEY')).toBe(true);
        });

        test('should identify rate limiting issues', async () => {
            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            expect(results.rateLimitIssues).toHaveLength(2);
            expect(results.rateLimitIssues.some(issue => 
                issue.name === 'Rate Limiting Disabled'
            )).toBe(true);
            expect(results.rateLimitIssues.some(issue => 
                issue.name === 'High Rate Limit'
            )).toBe(true);
        });

        test('should identify threat detection issues', async () => {
            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            expect(results.threatDetectionIssues).toHaveLength(3);
            expect(results.threatDetectionIssues.some(issue => 
                issue.name === 'Threat Detection Disabled'
            )).toBe(true);
            expect(results.threatDetectionIssues.some(issue => 
                issue.name === 'IP Blocking Disabled'
            )).toBe(true);
            expect(results.threatDetectionIssues.some(issue => 
                issue.name === 'Pattern Detection Disabled'
            )).toBe(true);
        });
    });

    describe('Results Management', () => {
        test('should store and retrieve audit results', async () => {
            await securityAuditor.startAudit(mockDevice.id, mockDevice);
            const results = securityAuditor.getAuditResults(mockDevice.id);

            expect(results).toBeDefined();
            expect(results.deviceInfo.name).toBe(mockDevice.name);
            expect(results.deviceInfo.address).toBe(mockDevice.address);
        });

        test('should return null for non-existent audit results', () => {
            const results = securityAuditor.getAuditResults('non-existent-device');
            expect(results).toBeNull();
        });

        test('should clear audit results', async () => {
            await securityAuditor.startAudit(mockDevice.id, mockDevice);
            securityAuditor.clearAuditResults(mockDevice.id);
            
            const results = securityAuditor.getAuditResults(mockDevice.id);
            expect(results).toBeNull();
        });
    });

    describe('Audit Management', () => {
        test('should track active audits', async () => {
            const auditPromise = securityAuditor.startAudit(mockDevice.id, mockDevice);
            
            let activeAudits = securityAuditor.getActiveAudits();
            expect(activeAudits.size).toBe(1);
            expect(activeAudits.get(mockDevice.id)).toBeDefined();
            
            await auditPromise;
            
            activeAudits = securityAuditor.getActiveAudits();
            expect(activeAudits.size).toBe(0);
        });

        test('should stop all active audits', async () => {
            const audit1 = securityAuditor.startAudit('device-1', mockDevice);
            const audit2 = securityAuditor.startAudit('device-2', { ...mockDevice, id: 'device-2' });

            securityAuditor.stopAllAudits();

            const activeAudits = securityAuditor.getActiveAudits();
            expect(activeAudits.size).toBe(0);

            // Clean up pending promises
            await Promise.all([audit1, audit2]);
        });
    });

    describe('Recommendations', () => {
        test('should generate prioritized recommendations', async () => {
            // Mock severe vulnerability
            VulnerabilityScanner.prototype.scanDevice.mockResolvedValue([{
                name: 'Weak Authentication',
                severity: 9.0,
                description: 'Critical authentication vulnerability'
            }]);

            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            expect(results.recommendations).toBeDefined();
            expect(results.recommendations.length).toBeGreaterThan(0);
            expect(results.recommendations[0].priority).toBe(1); // High priority
            expect(results.recommendations[0].recommendation).toContain('authentication');
        });

        test('should sort recommendations by priority', async () => {
            // Mock multiple vulnerabilities with different severities
            VulnerabilityScanner.prototype.scanDevice.mockResolvedValue([
                { name: 'Low Risk Issue', severity: 3.0 },
                { name: 'Critical Issue', severity: 9.0 },
                { name: 'Medium Risk Issue', severity: 6.0 }
            ]);

            // Reset auth service config to have no issues
            AuthService.prototype.config = {
                auth: {
                    sessionDuration: 3600,
                    jwtSecret: 'secure-secret',
                    keyRotationInterval: 86400
                }
            };

            // Reset rate limiter config to have no issues
            RateLimiter.prototype.config = {
                enabled: true,
                maxRequests: 100
            };

            // Reset threat detection config to have no issues
            ThreatDetectionService.prototype.config = {
                enabled: true,
                ipBlocking: { enabled: true },
                patternDetection: { enabled: true }
            };

            const results = await securityAuditor.startAudit(mockDevice.id, mockDevice);

            // Verify that recommendations are sorted by priority (1 is highest)
            const priorities = results.recommendations.map(r => r.priority);
            expect(priorities).toEqual([1, 2, 3]); // Should be sorted from highest to lowest priority
        });
    });
}); 