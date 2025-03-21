const BaseHandler = require('./BaseHandler');
const { BLEService } = require('../../ble/BLEService');
const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES } = require('../protocol/messages');

class ConnectionHandler extends BaseHandler {
    constructor(bleService) {
        super();
        this.bleService = bleService;
        this.activeConnections = new Map(); // Track active connections by clientId
    }

    async processMessage(clientId, message) {
        logger.debug(`Processing connection message from client ${clientId}`, { message });
        
        switch (message.type) {
            case MESSAGE_TYPES.CONNECT:
                return this.handleConnect(clientId, message);
            case MESSAGE_TYPES.DISCONNECT:
                return this.handleDisconnect(clientId, message);
            default:
                throw this.createError(ERROR_CODES.INVALID_MESSAGE_TYPE, `Unsupported message type: ${message.type}`);
        }
    }

    async handleConnect(clientId, message) {
        try {
            if (this.activeConnections.has(clientId)) {
                throw this.createError(ERROR_CODES.ALREADY_CONNECTED, 'Already connected to a device');
            }

            const { deviceId } = message.params;
            if (!deviceId) {
                throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Device ID is required');
            }

            logger.info(`Connecting to device ${deviceId} for client ${clientId}`);

            // Set up connection event handlers
            const connectionHandler = (device) => {
                this.sendToClient(clientId, {
                    type: MESSAGE_TYPES.CONNECTED,
                    params: {
                        deviceId: device.id,
                        name: device.name,
                        address: device.address
                    }
                });
            };

            const disconnectionHandler = (device) => {
                this.sendToClient(clientId, {
                    type: MESSAGE_TYPES.DISCONNECTED,
                    params: {
                        deviceId: device.id
                    }
                });
            };

            // Connect to the device
            await this.bleService.connect(deviceId);
            
            // Set up event listeners
            this.bleService.on('connected', connectionHandler);
            this.bleService.on('disconnected', disconnectionHandler);
            
            // Store connection info
            this.activeConnections.set(clientId, {
                deviceId,
                handlers: {
                    connection: connectionHandler,
                    disconnection: disconnectionHandler
                }
            });

            metrics.increment('connection.connect.success');

        } catch (error) {
            metrics.increment('connection.connect.error');
            throw error;
        }
    }

    async handleDisconnect(clientId) {
        try {
            const connectionInfo = this.activeConnections.get(clientId);
            if (!connectionInfo) {
                throw this.createError(ERROR_CODES.NOT_CONNECTED, 'Not connected to any device');
            }

            logger.info(`Disconnecting from device ${connectionInfo.deviceId} for client ${clientId}`);

            // Remove event listeners
            this.bleService.removeListener('connected', connectionInfo.handlers.connection);
            this.bleService.removeListener('disconnected', connectionInfo.handlers.disconnection);
            
            // Disconnect from the device
            await this.bleService.disconnect(connectionInfo.deviceId);
            
            // Clean up connection info
            this.activeConnections.delete(clientId);

            metrics.increment('connection.disconnect.success');

            // Send confirmation
            this.sendToClient(clientId, {
                type: MESSAGE_TYPES.DISCONNECTED,
                params: {
                    deviceId: connectionInfo.deviceId
                }
            });

        } catch (error) {
            metrics.increment('connection.disconnect.error');
            throw error;
        }
    }

    // Clean up when client disconnects
    async handleClientDisconnect(clientId) {
        try {
            if (this.activeConnections.has(clientId)) {
                await this.handleDisconnect(clientId);
            }
        } catch (error) {
            logger.error(`Error cleaning up connection for disconnected client ${clientId}`, { error });
        }
    }
}

module.exports = { ConnectionHandler }; 