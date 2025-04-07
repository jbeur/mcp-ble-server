const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const VulnerabilityScanner = require('./VulnerabilityScanner');
const AuthService = require('../auth/AuthService');
const RateLimiter = require('../auth/RateLimiter');
const ThreatDetectionService = require('./ThreatDetectionService');

class SecurityAuditor {
    constructor(config = {}) {
        this.config = {
            auditInterval: config.auditInterval || 3600000, // Default: 1 hour
            maxConcurrentAudits: config.maxConcurrentAudits || 3,
            securityThreshold: config.securityThreshold || 7.0, // CVSS score threshold
            ...config
        };

        this.activeAudits = new Map();
        this.auditResults = new Map();
        this.metrics = metrics;
        this.logger = logger;

        // Initialize required services
        this.vulnerabilityScanner = new VulnerabilityScanner(config);
        this.authService = new AuthService(config);
        this.rateLimiter = new RateLimiter(config);
        this.threatDetection = new ThreatDetectionService(config);
    }

    /**
     * Start a security audit for a BLE device
     * @param {string} deviceId - The BLE device identifier
     * @param {Object} device - The BLE device object
     * @returns {Promise<Object>} Audit results
     */
    async startAudit(deviceId, device) {
        try {
            if (this.activeAudits.size >= this.config.maxConcurrentAudits) {
                throw new Error('Maximum concurrent audits reached');
            }

            if (this.activeAudits.has(deviceId)) {
                throw new Error('Device audit already in progress');
            }

            this.activeAudits.set(deviceId, {
                startTime: Date.now(),
                status: 'in_progress'
            });

            const auditResults = await this._performAudit(deviceId, device);
            
            this.auditResults.set(deviceId, {
                timestamp: Date.now(),
                results: auditResults,
                deviceInfo: {
                    name: device.name,
                    address: device.address,
                    rssi: device.rssi
                }
            });

            this.activeAudits.get(deviceId).status = 'completed';
            this.metrics.increment('security.audit.complete');
            
            return auditResults;
        } catch (error) {
            if (this.activeAudits.has(deviceId)) {
                this.activeAudits.get(deviceId).status = 'error';
            }
            this.metrics.increment('security.audit.error');
            this.logger.error('Security audit failed:', error);
            throw error;
        }
    }

    /**
     * Perform security audit on a device
     * @private
     * @param {string} deviceId - The device ID
     * @param {Object} device - The device object
     * @returns {Promise<Object>} Audit results
     */
    async _performAudit(deviceId, device) {
        const results = {
            vulnerabilities: [],
            authIssues: [],
            rateLimitIssues: [],
            threatDetectionIssues: [],
            overallScore: 10.0, // Start with perfect score
            recommendations: []
        };

        try {
            // Check for vulnerabilities
            const vulnerabilities = await this.vulnerabilityScanner.scanDevice(deviceId, device);
            results.vulnerabilities = vulnerabilities;

            // Check authentication security
            await this._checkAuthSecurity(results);

            // Check rate limiting
            await this._checkRateLimiting(results);

            // Check threat detection
            await this._checkThreatDetection(results);

            // Calculate overall security score
            this._calculateSecurityScore(results);

            // Generate recommendations
            this._generateRecommendations(results);

            return results;
        } catch (error) {
            this.logger.error('Error during security audit:', error);
            throw error;
        }
    }

    /**
     * Check authentication security
     * @private
     * @param {Object} results - Audit results object
     */
    async _checkAuthSecurity(results) {
        try {
            // Check session management
            if (!this.authService.config.auth.sessionDuration) {
                results.authIssues.push({
                    type: 'SESSION',
                    name: 'No Session Timeout',
                    severity: 7.5,
                    description: 'Session timeout not configured'
                });
            }

            // Check token security
            if (!this.authService.config.auth.jwtSecret) {
                results.authIssues.push({
                    type: 'TOKEN',
                    name: 'Weak Token Security',
                    severity: 8.0,
                    description: 'JWT secret not configured'
                });
            }

            // Check API key rotation
            if (!this.authService.config.auth.keyRotationInterval) {
                results.authIssues.push({
                    type: 'API_KEY',
                    name: 'No Key Rotation',
                    severity: 7.0,
                    description: 'API key rotation not configured'
                });
            }
        } catch (error) {
            this.logger.error('Error checking auth security:', error);
            throw error;
        }
    }

    /**
     * Check rate limiting configuration
     * @private
     * @param {Object} results - Audit results object
     */
    async _checkRateLimiting(results) {
        try {
            // Check rate limit configuration
            if (!this.rateLimiter.config.enabled) {
                results.rateLimitIssues.push({
                    type: 'RATE_LIMIT',
                    name: 'Rate Limiting Disabled',
                    severity: 8.0,
                    description: 'Rate limiting is not enabled'
                });
            }

            // Check rate limit thresholds
            if (this.rateLimiter.config.maxRequests > 1000) {
                results.rateLimitIssues.push({
                    type: 'RATE_LIMIT',
                    name: 'High Rate Limit',
                    severity: 6.5,
                    description: 'Rate limit threshold is too high'
                });
            }
        } catch (error) {
            this.logger.error('Error checking rate limiting:', error);
            throw error;
        }
    }

    /**
     * Check threat detection configuration
     * @private
     * @param {Object} results - Audit results object
     */
    async _checkThreatDetection(results) {
        try {
            // Check if threat detection is enabled
            if (!this.threatDetection.config.enabled) {
                results.threatDetectionIssues.push({
                    type: 'THREAT_DETECTION',
                    name: 'Threat Detection Disabled',
                    severity: 8.5,
                    description: 'Threat detection is not enabled'
                });
            }

            // Check IP blocking configuration
            if (!this.threatDetection.config.ipBlocking?.enabled) {
                results.threatDetectionIssues.push({
                    type: 'THREAT_DETECTION',
                    name: 'IP Blocking Disabled',
                    severity: 7.5,
                    description: 'IP blocking is not enabled'
                });
            }

            // Check pattern detection
            if (!this.threatDetection.config.patternDetection?.enabled) {
                results.threatDetectionIssues.push({
                    type: 'THREAT_DETECTION',
                    name: 'Pattern Detection Disabled',
                    severity: 7.0,
                    description: 'Pattern detection is not enabled'
                });
            }
        } catch (error) {
            this.logger.error('Error checking threat detection:', error);
            throw error;
        }
    }

    /**
     * Calculate overall security score
     * @private
     * @param {Object} results - Audit results object
     */
    _calculateSecurityScore(results) {
        let totalSeverity = 0;
        let issueCount = 0;

        // Calculate from vulnerabilities
        results.vulnerabilities.forEach(vuln => {
            totalSeverity += vuln.severity;
            issueCount++;
        });

        // Calculate from auth issues
        results.authIssues.forEach(issue => {
            totalSeverity += issue.severity;
            issueCount++;
        });

        // Calculate from rate limit issues
        results.rateLimitIssues.forEach(issue => {
            totalSeverity += issue.severity;
            issueCount++;
        });

        // Calculate from threat detection issues
        results.threatDetectionIssues.forEach(issue => {
            totalSeverity += issue.severity;
            issueCount++;
        });

        // Calculate average severity and convert to score
        if (issueCount > 0) {
            const averageSeverity = totalSeverity / issueCount;
            results.overallScore = Math.max(0, 10 - averageSeverity);
        }
    }

    /**
     * Generate security recommendations
     * @private
     * @param {Object} results - Audit results object
     */
    _generateRecommendations(results) {
        // Add recommendations based on vulnerabilities
        results.vulnerabilities.forEach(vuln => {
            results.recommendations.push({
                priority: this._getSeverityPriority(vuln.severity),
                issue: vuln.name,
                recommendation: this._getRecommendation(vuln)
            });
        });

        // Add recommendations based on auth issues
        results.authIssues.forEach(issue => {
            results.recommendations.push({
                priority: this._getSeverityPriority(issue.severity),
                issue: issue.name,
                recommendation: this._getRecommendation(issue)
            });
        });

        // Add recommendations based on rate limit issues
        results.rateLimitIssues.forEach(issue => {
            results.recommendations.push({
                priority: this._getSeverityPriority(issue.severity),
                issue: issue.name,
                recommendation: this._getRecommendation(issue)
            });
        });

        // Add recommendations based on threat detection issues
        results.threatDetectionIssues.forEach(issue => {
            results.recommendations.push({
                priority: this._getSeverityPriority(issue.severity),
                issue: issue.name,
                recommendation: this._getRecommendation(issue)
            });
        });

        // Sort recommendations by priority (ascending order - 1 is highest priority)
        results.recommendations.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Get severity priority level
     * @private
     * @param {number} severity - CVSS severity score
     * @returns {number} Priority level (1-3)
     */
    _getSeverityPriority(severity) {
        if (severity >= 8.0) return 1; // High priority
        if (severity >= 6.0) return 2; // Medium priority
        return 3; // Low priority
    }

    /**
     * Get recommendation for an issue
     * @private
     * @param {Object} issue - Security issue object
     * @returns {string} Recommendation
     */
    _getRecommendation(issue) {
        const recommendations = {
            'Weak Authentication': 'Implement strong authentication mechanisms using industry-standard protocols',
            'Legacy Pairing': 'Update to secure pairing mechanism with MITM protection',
            'Weak Encryption': 'Implement AES-CCM encryption with appropriate key size',
            'Insufficient Key Size': 'Increase encryption key size to at least 128 bits',
            'No Session Timeout': 'Configure session timeout with appropriate duration',
            'Weak Token Security': 'Configure secure JWT secret and implement token rotation',
            'No Key Rotation': 'Enable API key rotation with appropriate interval',
            'Rate Limiting Disabled': 'Enable rate limiting with appropriate thresholds',
            'High Rate Limit': 'Reduce rate limit threshold to prevent abuse',
            'Threat Detection Disabled': 'Enable threat detection system',
            'IP Blocking Disabled': 'Enable IP blocking for suspicious activities',
            'Pattern Detection Disabled': 'Enable pattern detection for threat identification'
        };

        return recommendations[issue.name] || 'Review and address the security issue according to best practices';
    }

    /**
     * Get audit results for a device
     * @param {string} deviceId - The device ID
     * @returns {Object|null} Audit results or null if not found
     */
    getAuditResults(deviceId) {
        return this.auditResults.get(deviceId) || null;
    }

    /**
     * Get all active audits
     * @returns {Map} Map of active audits
     */
    getActiveAudits() {
        return new Map(
            Array.from(this.activeAudits.entries())
                .filter(([_, audit]) => audit.status === 'in_progress')
        );
    }

    /**
     * Clear audit results for a device
     * @param {string} deviceId - The device ID
     */
    clearAuditResults(deviceId) {
        this.auditResults.delete(deviceId);
    }

    /**
     * Stop all active audits
     */
    stopAllAudits() {
        for (const [deviceId, audit] of this.activeAudits.entries()) {
            if (audit.status === 'in_progress') {
                audit.status = 'stopped';
            }
        }
        this.metrics.increment('security.audit.stop.all');
    }
}

module.exports = SecurityAuditor; 