const prometheus = require('prom-client');

// Create a Registry
const register = new prometheus.Registry();

// MCP Server Metrics
const metrics = {
  // Server status (1 = running, 0 = stopped)
  mcpServerStatus: new prometheus.Gauge({
    name: 'mcp_server_status',
    help: 'Current status of the MCP server',
    labelNames: ['status']
  }),

  // Connection metrics
  mcpConnections: new prometheus.Gauge({
    name: 'mcp_active_connections',
    help: 'Number of active MCP connections'
  }),

  mcpConnectionsRejected: new prometheus.Counter({
    name: 'mcp_connections_rejected_total',
    help: 'Total number of rejected MCP connections'
  }),

  // Message metrics
  mcpMessagesReceived: new prometheus.Counter({
    name: 'mcp_messages_received_total',
    help: 'Total number of MCP messages received'
  }),

  mcpMessagesSent: new prometheus.Counter({
    name: 'mcp_messages_sent_total',
    help: 'Total number of MCP messages sent'
  }),

  // Error metrics
  mcpErrors: new prometheus.Counter({
    name: 'mcp_errors_total',
    help: 'Total number of MCP errors',
    labelNames: ['type']
  }),

  // Latency metrics
  mcpMessageLatency: new prometheus.Histogram({
    name: 'mcp_message_latency_seconds',
    help: 'Latency of MCP message processing',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
  }),

  // Authentication metrics
  authSuccess: new prometheus.Counter({
    name: 'mcp_auth_success_total',
    help: 'Total number of successful authentications'
  }),

  authError: new prometheus.Counter({
    name: 'mcp_auth_error_total',
    help: 'Total number of authentication errors',
    labelNames: ['code']
  }),

  // API key validation metrics
  apiKeyValidation: new prometheus.Counter({
    name: 'mcp_api_key_validation_total',
    help: 'Total number of API key validations',
    labelNames: ['result']
  }),

  // Rate limiting metrics
  rateLimitExceeded: new prometheus.Counter({
    name: 'mcp_rate_limit_exceeded_total',
    help: 'Total number of rate limit exceeded events',
    labelNames: ['key']
  }),

  // Session cleanup metrics
  authCleanupSuccess: new prometheus.Counter({
    name: 'mcp_auth_cleanup_success_total',
    help: 'Total number of successful session cleanups'
  }),

  authCleanupError: new prometheus.Counter({
    name: 'mcp_auth_cleanup_error_total',
    help: 'Total number of session cleanup errors',
    labelNames: ['code']
  }),

  // Session management metrics
  authSessionCreationSuccess: new prometheus.Counter({
    name: 'mcp_auth_session_creation_success_total',
    help: 'Total number of successful session creations'
  }),

  authSessionCreationError: new prometheus.Counter({
    name: 'mcp_auth_session_creation_error_total',
    help: 'Total number of session creation errors'
  }),

  authSessionRemovalSuccess: new prometheus.Counter({
    name: 'mcp_auth_session_removal_success_total',
    help: 'Total number of successful session removals'
  }),

  authSessionRemovalError: new prometheus.Counter({
    name: 'mcp_auth_session_removal_error_total',
    help: 'Total number of session removal errors'
  }),

  // Rate limit check metrics
  authRateLimitCheckSuccess: new prometheus.Counter({
    name: 'mcp_auth_rate_limit_check_success_total',
    help: 'Total number of successful rate limit checks'
  }),

  authRateLimitExceeded: new prometheus.Counter({
    name: 'mcp_auth_rate_limit_exceeded_total',
    help: 'Total number of rate limit exceeded events'
  })
};

// Register all metrics
Object.values(metrics).forEach(metric => {
  register.registerMetric(metric);
});

// Add default metrics (CPU, memory, etc.)
prometheus.collectDefaultMetrics({ register });

module.exports = {
  metrics,
  register
}; 