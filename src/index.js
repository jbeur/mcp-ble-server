const winston = require('winston');
const path = require('path');
const ConfigLoader = require('./config/configLoader');
const BLEService = require('./ble/bleService');

// Initialize configuration loader
const configLoader = new ConfigLoader();

// Load configuration
const config = configLoader.loadConfig(path.join(__dirname, '../config/mcp_ble_config.yaml'));

// Configure logger
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: config.logging.file,
            maxsize: config.logging.max_size,
            maxFiles: config.logging.backup_count
        }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Initialize BLE service
const bleService = new BLEService(config);

// Main server initialization
async function initializeServer() {
    try {
        logger.info('Starting MCP BLE Server...');
        
        // Initialize BLE service
        await bleService.initialize();
        
        logger.info('MCP BLE Server initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize server:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal. Shutting down gracefully...');
    try {
        // Stop configuration file watching
        configLoader.stopWatching();
        
        // Disconnect all BLE devices
        const connectedDevices = bleService.getConnectedDevices();
        for (const device of connectedDevices) {
            await bleService.disconnectDevice(device.id);
        }
        
        logger.info('Server shutdown completed successfully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during server shutdown:', error);
        process.exit(1);
    }
});

// Start the server
initializeServer(); 