const BaseHandler = require('./BaseHandler');
const { BLEService } = require('../../ble/BLEService');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES } = require('../protocol/messages');

class ScanHandler extends BaseHandler {
    constructor(bleService) {
        super();
        this.bleService = bleService;
        this.activeScans = new Map(); // Track active scans by clientId
    }

    async processMessage(clientId, message) {
        logger.debug(`Processing scan message from client ${clientId}`, { message });
        
        switch (message.type) {
            case MESSAGE_TYPES.START_SCAN:
                return this.handleStartScan(clientId, message);
            case MESSAGE_TYPES.STOP_SCAN:
                return this.handleStopScan(clientId, message);
            default:
                throw this.createError(ERROR_CODES.INVALID_MESSAGE_TYPE, `Unsupported message type: ${message.type}`);
        }
    }

    async handleStartScan(clientId, message) {
        try {
            if (this.activeScans.has(clientId)) {
                throw this.createError(ERROR_CODES.SCAN_ALREADY_ACTIVE, 'Scan already in progress for this client');
            }

            const scanOptions = message.params || {};
            logger.info(`Starting scan for client ${clientId}`, { scanOptions });

            // Set up device discovery handler for this client
            const discoveryHandler = (device) => {
                this.sendToClient(clientId, {
                    type: MESSAGE_TYPES.DEVICE_DISCOVERED,
                    params: {
                        id: device.id,
                        name: device.name,
                        address: device.address,
                        rssi: device.rssi,
                        manufacturerData: device.manufacturerData
                    }
                });
            };

            // Start scanning
            await this.bleService.startScan(scanOptions);
            this.bleService.on('deviceDiscovered', discoveryHandler);
            
            // Store scan info
            this.activeScans.set(clientId, {
                options: scanOptions,
                handler: discoveryHandler
            });

            metrics.increment('scan.start.success');
            
            // Send confirmation
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.SCAN_STARTED
            });

        } catch (error) {
            metrics.increment('scan.start.error');
            throw error;
        }
    }

    async handleStopScan(clientId) {
        try {
            const scanInfo = this.activeScans.get(clientId);
            if (!scanInfo) {
                throw this.createError(ERROR_CODES.NO_ACTIVE_SCAN, 'No active scan found for this client');
            }

            logger.info(`Stopping scan for client ${clientId}`);

            // Remove discovery handler and stop scan if no other clients are scanning
            this.bleService.removeListener('deviceDiscovered', scanInfo.handler);
            this.activeScans.delete(clientId);

            if (this.activeScans.size === 0) {
                await this.bleService.stopScan();
            }

            metrics.increment('scan.stop.success');

            // Send confirmation
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.SCAN_STOPPED
            });

        } catch (error) {
            metrics.increment('scan.stop.error');
            throw error;
        }
    }

    // Clean up when client disconnects
    async handleClientDisconnect(clientId) {
        try {
            if (this.activeScans.has(clientId)) {
                await this.handleStopScan(clientId);
            }
        } catch (error) {
            logger.error(`Error cleaning up scan for disconnected client ${clientId}`, { error });
        }
    }
}

module.exports = { ScanHandler }; 