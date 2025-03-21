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