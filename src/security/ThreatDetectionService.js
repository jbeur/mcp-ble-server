const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const crypto = require('crypto');

class ThreatDetectionService {
  constructor(config = {}) {
    this.logger = logger;
    this.metrics = metrics;
    this.threats = new Map();
    this.blockedClients = new Map();
    this.blockedIps = new Map();
    this.maxAuthFailures = config.maxAuthFailures || 5;
  }

  async analyzeThreat(data) {
    try {
      if (!data.clientId || !data.type) {
        throw new Error('Invalid threat data');
      }

      const threat = {
        id: crypto.randomBytes(16).toString('hex'),
        type: data.type,
        clientId: data.clientId,
        severity: data.severity || 'medium',
        timestamp: Date.now(),
        details: data.details || {}
      };

      if (!this.threats.has(data.clientId)) {
        this.threats.set(data.clientId, []);
      }
      this.threats.get(data.clientId).push(threat);

      // Check for brute force attempts
      if (data.type === 'authentication_failure') {
        const clientThreats = this.threats.get(data.clientId) || [];
        const authFailures = clientThreats.filter(t => t.type === 'authentication_failure');
        if (authFailures.length >= this.maxAuthFailures) {
          await this.blockClient(data.clientId, 'Too many authentication failures');
        }
      }

      // Block client for high severity threats
      if (data.severity === 'high') {
        await this.blockClient(data.clientId, 'High severity threat detected');
      }

      this.metrics.increment('security.threat.analysis.success');
      return threat;
    } catch (error) {
      this.logger.error('Threat analysis error:', error);
      this.metrics.increment('security.threat.analysis.error');
      throw error;
    }
  }

  // Alias for backward compatibility
  async analyze(data) {
    return this.analyzeThreat(data);
  }

  async getThreats(clientId) {
    try {
      const threats = this.threats.get(clientId) || [];
      this.metrics.increment('security.threat.retrieval.success');
      return threats;
    } catch (error) {
      this.metrics.increment('security.threat.retrieval.error');
      this.logger.error('Failed to get threats:', error);
      throw error;
    }
  }

  async getThreatsForClient(clientId) {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      const clientThreats = this.threats.get(clientId) || [];
      this.metrics.increment('security.threat.retrieval.success');
      return clientThreats;
    } catch (error) {
      this.logger.error('Error retrieving threats for client:', error);
      this.metrics.increment('security.threat.retrieval.error');
      throw error;
    }
  }

  async isClientBlocked(clientId) {
    try {
      const isBlocked = this.blockedClients.has(clientId);
      this.metrics.increment('security.block.check.success');
      return isBlocked;
    } catch (error) {
      this.metrics.increment('security.block.check.error');
      this.logger.error('Failed to check client block status:', error);
      throw error;
    }
  }

  async getBlockReason(clientId) {
    try {
      const blockData = this.blockedClients.get(clientId);
      if (!blockData) {
        return null;
      }
      this.metrics.increment('security.block.reason.retrieval.success');
      return blockData.reason;
    } catch (error) {
      this.metrics.increment('security.block.reason.retrieval.error');
      this.logger.error('Failed to get block reason:', error);
      throw error;
    }
  }

  async blockClient(clientId, reason) {
    try {
      this.blockedClients.set(clientId, {
        timestamp: Date.now(),
        reason: reason
      });
      this.metrics.increment('security.block.success');
    } catch (error) {
      this.metrics.increment('security.block.error');
      this.logger.error('Failed to block client:', error);
      throw error;
    }
  }

  async unblockClient(clientId) {
    try {
      this.blockedClients.delete(clientId);
      this.metrics.increment('security.unblock.success');
    } catch (error) {
      this.metrics.increment('security.unblock.error');
      this.logger.error('Failed to unblock client:', error);
      throw error;
    }
  }

  /**
     * Checks if a client has any high severity threats
     * @param {string} clientId - Client identifier
     * @returns {Promise<boolean>} True if client has high severity threats
     */
  async hasHighSeverityThreats(clientId) {
    try {
      if (!clientId) {
        throw new Error('Client ID is required');
      }

      const threats = this.threats.get(clientId) || [];
      const highSeverityThreats = threats.filter(t => t.severity === 'high');

      if (highSeverityThreats.length > 0) {
        throw new Error('Access denied');
      }

      this.metrics.increment('security.threat.check.success');
      return false;
    } catch (error) {
      this.metrics.increment('security.threat.check.error');
      this.logger.error('Failed to check high severity threats:', error);
      throw error;
    }
  }

  /**
     * Checks if an IP address is blocked
     * @param {string} ip - IP address to check
     * @returns {Promise<boolean>} True if IP is blocked
     */
  async isIpBlocked(ip) {
    try {
      if (!ip) {
        throw new Error('IP address is required');
      }

      const isBlocked = this.blockedIps.has(ip);
      if (isBlocked) {
        throw new Error('Access denied');
      }

      this.metrics.increment('security.ip.check.success');
      return false;
    } catch (error) {
      this.metrics.increment('security.ip.check.error');
      this.logger.error('Failed to check IP block status:', error);
      throw error;
    }
  }

  /**
     * Blocks an IP address
     * @param {string} ip - IP address to block
     * @param {string} reason - Reason for blocking
     * @returns {Promise<void>}
     */
  async blockIp(ip, reason) {
    try {
      if (!ip) {
        throw new Error('IP address is required');
      }

      this.blockedIps.set(ip, {
        timestamp: Date.now(),
        reason: reason || 'Suspicious activity'
      });

      this.metrics.increment('security.ip.block.success');
    } catch (error) {
      this.metrics.increment('security.ip.block.error');
      this.logger.error('Failed to block IP:', error);
      throw error;
    }
  }

  /**
     * Unblocks an IP address
     * @param {string} ip - IP address to unblock
     * @returns {Promise<void>}
     */
  async unblockIp(ip) {
    try {
      if (!ip) {
        throw new Error('IP address is required');
      }

      this.blockedIps.delete(ip);
      this.metrics.increment('security.ip.unblock.success');
    } catch (error) {
      this.metrics.increment('security.ip.unblock.error');
      this.logger.error('Failed to unblock IP:', error);
      throw error;
    }
  }

  async cleanup() {
    try {
      this.threats.clear();
      this.blockedClients.clear();
      this.blockedIps.clear();
      this.logger.info('ThreatDetectionService cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup ThreatDetectionService:', error);
      throw error;
    }
  }

  async stop() {
    try {
      await this.cleanup();
      this.logger.info('ThreatDetectionService stopped');
    } catch (error) {
      this.logger.error('Failed to stop ThreatDetectionService:', error);
      throw error;
    }
  }
}

module.exports = ThreatDetectionService; 