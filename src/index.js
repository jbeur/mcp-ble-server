const winston = require('winston');
const path = require('path');
const ConfigLoader = require('./config/configLoader');
const BLEService = require('./ble/bleService');
const AuthService = require('./auth/AuthService');
const WebSocketServer = require('./websocket/WebSocketServer');
const HandlerFactory = require('./mcp/handlers/HandlerFactory');
const { metrics } = require('./metrics/metrics');
const { cloudwatchMetrics } = require('./metrics/cloudwatch');

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
    .catch(error => {
      logger.error('Error cleaning up expired sessions', { error });
      metrics.incrementCounter('session_cleanup_errors');
    });
}, SESSION_CLEANUP_INTERVAL);

// Set up metrics collection interval
const METRICS_COLLECTION_INTERVAL = 60 * 1000; // 1 minute
setInterval(async () => {
  try {
    // Collect BLE connection metrics
    const bleConnections = bleService.getActiveConnections();
    metrics.setGauge('active_ble_connections', bleConnections);
    await cloudwatchMetrics.emitBLEConnections(bleConnections);

    // Collect WebSocket connection metrics
    const wsConnections = wsServer.getActiveConnections();
    metrics.setGauge('active_websocket_connections', wsConnections);
    await cloudwatchMetrics.emitWebSocketConnections(wsConnections);

    // Calculate and emit error rate
    const totalRequests = metrics.getCounter('total_requests') || 1;
    const errorCount = metrics.getCounter('error_count') || 0;
    const errorRate = (errorCount / totalRequests) * 100;
    await cloudwatchMetrics.emitErrorRate(errorRate);

    // Emit all other metrics
    await cloudwatchMetrics.emitAllMetrics();

    // Reset counters for next interval
    metrics.reset();
  } catch (error) {
    logger.error('Error collecting metrics:', error);
  }
}, METRICS_COLLECTION_INTERVAL);

// Main server initialization
async function initializeServer() {
  try {
    logger.info('Starting MCP BLE Server...');
        
    // Initialize BLE service
    await bleService.initialize();
        
    // Start WebSocket server
    await wsServer.start();
        
    logger.info('MCP BLE Server initialized successfully');
    metrics.incrementCounter('server_startups');
  } catch (error) {
    logger.error('Failed to initialize server:', error);
    metrics.incrementCounter('server_startup_errors');
    throw error; // Propagate error instead of exiting
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  logger.error('Uncaught Exception:', error);
  metrics.incrementCounter('uncaught_exceptions');
  try {
    await gracefulShutdown();
  } catch (shutdownError) {
    logger.error('Error during graceful shutdown:', shutdownError);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  metrics.incrementCounter('unhandled_rejections');
  try {
    await gracefulShutdown();
  } catch (shutdownError) {
    logger.error('Error during graceful shutdown:', shutdownError);
  }
});

// Handle process termination
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal. Shutting down...');
  try {
    await gracefulShutdown();
  } catch (error) {
    logger.error('Error during server shutdown:', error);
    metrics.incrementCounter('shutdown_errors');
  }
});

// Graceful shutdown function
async function gracefulShutdown() {
  try {
    await bleService.cleanup();
    await wsServer.stop();
    logger.info('Server shutdown complete');
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    throw error;
  }
}

// Start the server
initializeServer().catch(error => {
  logger.error('Fatal error during server initialization:', error);
  gracefulShutdown().catch(shutdownError => {
    logger.error('Fatal error during shutdown:', shutdownError);
  });
}); 