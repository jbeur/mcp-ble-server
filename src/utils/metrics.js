const { Registry, Counter, Gauge, Histogram } = require('prom-client');

const registry = new Registry();

// MCP Server Metrics
const metrics = {
  // Server status (1 = running, 0 = stopped)
  mcpServerStatus: new Gauge({
    name: 'mcp_server_status',
    help: 'Current status of the MCP server',
    labelNames: ['status']
  }),

  // Connection metrics
  mcpConnections: new Gauge({
    name: 'mcp_active_connections',
    help: 'Number of active MCP connections'
  }),

  mcpConnectionsRejected: new Counter({
    name: 'mcp_connections_rejected_total',
    help: 'Total number of rejected MCP connections'
  }),

  // Message metrics
  mcpMessagesReceived: new Counter({
    name: 'mcp_messages_received_total',
    help: 'Total number of MCP messages received',
    labelNames: ['type']
  }),

  mcpMessagesSent: new Counter({
    name: 'mcp_messages_sent_total',
    help: 'Total number of MCP messages sent',
    labelNames: ['type']
  }),

  // Error metrics
  mcpErrors: new Counter({
    name: 'mcp_errors_total',
    help: 'Total number of MCP errors',
    labelNames: ['type']
  }),

  // Latency metrics
  mcpMessageLatency: new Histogram({
    name: 'mcp_message_latency_seconds',
    help: 'Latency of MCP message processing',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
  }),

  // Authentication metrics
  authSuccess: new Counter({
    name: 'mcp_auth_success_total',
    help: 'Total number of successful authentications'
  }),

  authError: new Counter({
    name: 'mcp_auth_error_total',
    help: 'Total number of authentication errors',
    labelNames: ['code']
  }),

  // API key validation metrics
  apiKeyValidation: new Counter({
    name: 'mcp_api_key_validation_total',
    help: 'Total number of API key validations',
    labelNames: ['result']
  }),

  // Rate limiting metrics
  rateLimitExceeded: new Counter({
    name: 'mcp_rate_limit_exceeded_total',
    help: 'Total number of rate limit exceeded events',
    labelNames: ['key']
  }),

  // Session cleanup metrics
  authCleanupSuccess: new Counter({
    name: 'mcp_auth_cleanup_success_total',
    help: 'Total number of successful session cleanups'
  }),

  authCleanupError: new Counter({
    name: 'mcp_auth_cleanup_error_total',
    help: 'Total number of session cleanup errors',
    labelNames: ['code']
  }),

  // Session management metrics
  authSessionCreationSuccess: new Counter({
    name: 'mcp_auth_session_creation_success_total',
    help: 'Total number of successful session creations'
  }),

  authSessionCreationError: new Counter({
    name: 'mcp_auth_session_creation_error_total',
    help: 'Total number of session creation errors'
  }),

  authSessionRemovalSuccess: new Counter({
    name: 'mcp_auth_session_removal_success_total',
    help: 'Total number of successful session removals'
  }),

  authSessionRemovalError: new Counter({
    name: 'mcp_auth_session_removal_error_total',
    help: 'Total number of session removal errors'
  }),

  // Rate limit check metrics
  authRateLimitCheckSuccess: new Counter({
    name: 'mcp_auth_rate_limit_check_success_total',
    help: 'Total number of successful rate limit checks'
  }),

  authRateLimitExceeded: new Counter({
    name: 'mcp_auth_rate_limit_exceeded_total',
    help: 'Total number of rate limit exceeded events'
  }),

  // Batch metrics
  mcpBatchesProcessed: new Counter({
    name: 'mcp_batches_processed_total',
    help: 'Total number of message batches processed'
  }),

  mcpCompressedBatches: new Counter({
    name: 'mcp_compressed_batches_total',
    help: 'Total number of compressed batches'
  }),

  mcpBytesSaved: new Counter({
    name: 'mcp_bytes_saved_total',
    help: 'Total number of bytes saved through compression'
  }),

  mcpBytesSavedTotal: new Gauge({
    name: 'mcp_bytes_saved_current',
    help: 'Current total bytes saved through compression'
  }),

  mcpCompressionRatio: new Gauge({
    name: 'mcp_compression_ratio',
    help: 'Current compression ratio'
  }),

  // Batch size metrics
  mcpAverageBatchSize: new Gauge({
    name: 'mcp_average_batch_size',
    help: 'Average size of message batches'
  }),

  mcpMaxBatchSize: new Gauge({
    name: 'mcp_max_batch_size',
    help: 'Maximum size of message batches'
  }),

  mcpMinBatchSize: new Gauge({
    name: 'mcp_min_batch_size',
    help: 'Minimum size of message batches'
  }),

  // Latency metrics
  mcpAverageLatency: new Gauge({
    name: 'mcp_average_latency',
    help: 'Average message processing latency'
  }),

  mcpMaxLatency: new Gauge({
    name: 'mcp_max_latency',
    help: 'Maximum message processing latency'
  }),

  mcpMinLatency: new Gauge({
    name: 'mcp_min_latency',
    help: 'Minimum message processing latency'
  }),

  // Priority metrics
  mcpPriorityDistribution: new Gauge({
    name: 'mcp_priority_distribution',
    help: 'Distribution of message priorities',
    labelNames: ['priority']
  }),

  // Connection metrics
  mcpActiveConnections: new Gauge({
    name: 'mcp_active_connections',
    help: 'Number of active WebSocket connections'
  }),

  mcpConnectionErrors: new Counter({
    name: 'mcp_connection_errors_total',
    help: 'Total number of connection errors',
    labelNames: ['type']
  }),

  // Authentication metrics
  mcpAuthAttempts: new Counter({
    name: 'mcp_auth_attempts_total',
    help: 'Total number of authentication attempts',
    labelNames: ['status']
  }),

  mcpAuthErrors: new Counter({
    name: 'mcp_auth_errors_total',
    help: 'Total number of authentication errors',
    labelNames: ['type']
  })
};

// Register all metrics
Object.values(metrics).forEach(metric => {
  registry.registerMetric(metric);
});

// Add default metrics (CPU, memory, etc.)
prometheus.collectDefaultMetrics({ register });

module.exports = {
  registry,
  metrics
}; 