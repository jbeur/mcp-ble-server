const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class DisasterRecovery {
    constructor({ connectionPool, highAvailability, stateManager, config }) {
        if (!connectionPool) {
            throw new Error('Connection pool is required');
        }
        if (!highAvailability) {
            throw new Error('High availability is required');
        }
        if (!stateManager) {
            throw new Error('State manager is required');
        }

        this.connectionPool = connectionPool;
        this.highAvailability = highAvailability;
        this.stateManager = stateManager;
        this.config = {
            recoveryAttempts: 3,
            recoveryDelay: 1000,
            stateCheckInterval: 5000,
            ...config
        };
    }

    async saveSystemState() {
        try {
            const state = {
                poolSize: this.connectionPool.getPoolSize(),
                activeConnections: this.connectionPool.getActiveConnections(),
                status: await this.connectionPool.getStatus()
            };

            await this.stateManager.saveState(state);
            logger.info('System state saved successfully', { state });
            metrics.gauge('disaster_recovery.state_save', 1);
        } catch (error) {
            logger.error('Failed to save system state', { error: error.message });
            metrics.gauge('disaster_recovery.state_save', 0);
            throw error;
        }
    }

    async restoreSystemState() {
        try {
            const savedState = await this.stateManager.loadState();
            logger.info('Loaded saved state', { state: savedState });

            await this.highAvailability.stop();
            await this.connectionPool.restore(savedState);
            await this.highAvailability.start();

            logger.info('System state restored successfully');
            metrics.gauge('disaster_recovery.state_restore', 1);
        } catch (error) {
            logger.error('Failed to restore system state', { error: error.message });
            metrics.gauge('disaster_recovery.state_restore', 0);
            throw error;
        }
    }

    async initiateRecovery() {
        const startTime = Date.now();
        let attempts = 0;

        try {
            while (attempts < this.config.recoveryAttempts) {
                try {
                    logger.info(`Recovery attempt ${attempts + 1} of ${this.config.recoveryAttempts}`);
                    await this.restoreSystemState();
                    
                    const recoveryTime = Date.now() - startTime;
                    logger.info('Recovery completed successfully', { recoveryTime });
                    metrics.histogram('disaster_recovery.recovery_time', recoveryTime);
                    metrics.gauge('disaster_recovery.recovery_success', 1);
                    return;
                } catch (error) {
                    attempts++;
                    if (attempts < this.config.recoveryAttempts) {
                        logger.warn(`Recovery attempt failed, retrying in ${this.config.recoveryDelay}ms`, {
                            attempt: attempts,
                            error: error.message
                        });
                        await new Promise(resolve => setTimeout(resolve, this.config.recoveryDelay));
                    }
                }
            }

            throw new Error('Max recovery attempts reached');
        } catch (error) {
            logger.error('Recovery failed', { error: error.message });
            metrics.gauge('disaster_recovery.recovery_success', 0);
            throw error;
        }
    }

    async drainConnections() {
        try {
            logger.info('Starting connection drain');
            await this.connectionPool.drain();
            logger.info('Connections drained successfully');
            metrics.gauge('disaster_recovery.drain_success', 1);
        } catch (error) {
            logger.error('Failed to drain connections', { error: error.message });
            metrics.gauge('disaster_recovery.drain_success', 0);
            throw error;
        }
    }
}

module.exports = DisasterRecovery; 