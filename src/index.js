const winston = require('winston');
const path = require('path');
const ConfigLoader = require('./config/configLoader');
const BLEService = require('./ble/bleService');
const AuthService = require('./auth/AuthService');
const WebSocketServer = require('./websocket/WebSocketServer');
const HandlerFactory = require('./mcp/handlers/HandlerFactory');

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

// Initialize services
const bleService = new BLEService(config);
const authService = new AuthService(config);

// Initialize WebSocket server with handler factory
const handlerFactory = new HandlerFactory(bleService, authService);
const wsServer = new WebSocketServer(config, handlerFactory);

// Set up session cleanup interval
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
    authService.cleanupExpiredSessions()
        .catch(error => logger.error('Error cleaning up expired sessions', { error }));
}, SESSION_CLEANUP_INTERVAL);

// Main server initialization
async function initializeServer() {
    try {
        logger.info('Starting MCP BLE Server...');
        
        // Initialize BLE service
        await bleService.initialize();
        
        // Start WebSocket server
        await wsServer.start();
        
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

// Handle process termination
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal. Shutting down...');
    try {
        await bleService.cleanup();
        await wsServer.stop();
        logger.info('Server shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('Error during server shutdown:', error);
        process.exit(1);
    }
});

// Start the server
initializeServer(); 