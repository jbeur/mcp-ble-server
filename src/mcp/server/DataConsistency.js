const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class DataConsistency {
    constructor({ connectionPool, stateManager, transactionLog, config }) {
        if (!connectionPool) {
            throw new Error('Connection pool is required');
        }
        if (!stateManager) {
            throw new Error('State manager is required');
        }
        if (!transactionLog) {
            throw new Error('Transaction log is required');
        }

        this.connectionPool = connectionPool;
        this.stateManager = stateManager;
        this.transactionLog = transactionLog;
        this.config = {
            checkpointInterval: 5000,
            maxTransactionRetries: 3,
            transactionTimeout: 10000,
            ...config
        };

        this.activeTransactions = new Map();
        this.checkpointTimer = null;
    }

    async beginTransaction() {
        try {
            const transactionId = await this.connectionPool.beginTransaction();
            const startTime = Date.now();

            this.activeTransactions.set(transactionId, {
                startTime,
                status: 'started'
            });

            await this.transactionLog.append({
                id: transactionId,
                status: 'started',
                timestamp: startTime
            });

            metrics.gauge('data_consistency.active_transactions', this.activeTransactions.size);
            logger.info('Transaction started', { transactionId });

            return transactionId;
        } catch (error) {
            logger.error('Failed to start transaction', { error: error.message });
            metrics.gauge('data_consistency.transaction_errors', 1);
            throw error;
        }
    }

    async commitTransaction(transactionId) {
        try {
            await this.connectionPool.commitTransaction(transactionId);
            await this.transactionLog.markCommitted(transactionId);

            const transaction = this.activeTransactions.get(transactionId);
            if (transaction) {
                const duration = Date.now() - transaction.startTime;
                metrics.histogram('data_consistency.transaction_duration', duration);
                this.activeTransactions.delete(transactionId);
                logger.info('Transaction committed', { transactionId, duration });
            }
        } catch (error) {
            logger.error('Failed to commit transaction', { transactionId, error: error.message });
            metrics.gauge('data_consistency.transaction_errors', 1);
            throw error;
        }
    }

    async rollbackTransaction(transactionId) {
        try {
            await this.connectionPool.rollbackTransaction(transactionId);
            await this.transactionLog.markRolledBack(transactionId);

            if (this.activeTransactions.has(transactionId)) {
                this.activeTransactions.delete(transactionId);
            }

            metrics.gauge('data_consistency.transaction_rollbacks', 1);
            logger.info('Transaction rolled back', { transactionId });
        } catch (error) {
            logger.error('Failed to rollback transaction', { transactionId, error: error.message });
            metrics.gauge('data_consistency.transaction_errors', 1);
            throw error;
        }
    }

    async recoverTransactions() {
        try {
            const uncommittedTransactions = await this.transactionLog.getUncommitted();
            logger.info('Found uncommitted transactions', { count: uncommittedTransactions.length });

            for (const transaction of uncommittedTransactions) {
                try {
                    await this.connectionPool.rollbackTransaction(transaction.id);
                    await this.transactionLog.markRolledBack(transaction.id);
                    metrics.gauge('data_consistency.transaction_rollbacks', 1);
                } catch (error) {
                    logger.error('Failed to rollback transaction during recovery', {
                        transactionId: transaction.id,
                        error: error.message
                    });
                    metrics.gauge('data_consistency.transaction_errors', 1);
                }
            }

            metrics.gauge('data_consistency.recovery_success', 1);
            logger.info('Transaction recovery completed', { recoveredCount: uncommittedTransactions.length });
        } catch (error) {
            logger.error('Failed to recover transactions', { error: error.message });
            metrics.gauge('data_consistency.recovery_success', 0);
            throw error;
        }
    }

    async createCheckpoint() {
        try {
            const state = {
                poolSize: this.connectionPool.getPoolSize(),
                activeConnections: this.connectionPool.getActiveConnections(),
                status: await this.connectionPool.getStatus(),
                activeTransactions: Array.from(this.activeTransactions.entries())
            };

            await this.stateManager.saveState(state);
            metrics.gauge('data_consistency.checkpoint_success', 1);
            logger.info('Checkpoint created successfully', { state });
        } catch (error) {
            logger.error('Failed to create checkpoint', { error: error.message });
            metrics.gauge('data_consistency.checkpoint_success', 0);
            throw error;
        }
    }

    startCheckpointing() {
        if (this.checkpointTimer) {
            clearInterval(this.checkpointTimer);
        }
        this.checkpointTimer = setInterval(() => this.createCheckpoint(), this.config.checkpointInterval);
    }

    stopCheckpointing() {
        if (this.checkpointTimer) {
            clearInterval(this.checkpointTimer);
            this.checkpointTimer = null;
        }
    }
}

module.exports = DataConsistency; 