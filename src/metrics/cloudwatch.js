const AWS = require('aws-sdk');
const { metrics } = require('./metrics');

class CloudWatchMetrics {
  constructor() {
    this.cloudwatch = new AWS.CloudWatch();
    this.namespace = 'Custom/MCP-BLE';
    this.dimensions = [
      {
        Name: 'Environment',
        Value: process.env.NODE_ENV || 'development'
      }
    ];
  }

  /**
     * Emit BLE connection metrics to CloudWatch
     * @param {number} activeConnections - Number of active BLE connections
     */
  async emitBLEConnections(activeConnections) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'ActiveBLEConnections',
            Value: activeConnections,
            Unit: 'Count',
            Dimensions: this.dimensions,
            Timestamp: new Date()
          }
        ]
      }).promise();
    } catch (error) {
      console.error('Error emitting BLE connection metrics:', error);
    }
  }

  /**
     * Emit WebSocket connection metrics to CloudWatch
     * @param {number} activeConnections - Number of active WebSocket connections
     */
  async emitWebSocketConnections(activeConnections) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'ActiveWebSocketConnections',
            Value: activeConnections,
            Unit: 'Count',
            Dimensions: this.dimensions,
            Timestamp: new Date()
          }
        ]
      }).promise();
    } catch (error) {
      console.error('Error emitting WebSocket connection metrics:', error);
    }
  }

  /**
     * Emit API latency metrics to CloudWatch
     * @param {number} latency - API response latency in milliseconds
     */
  async emitAPILatency(latency) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'APILatency',
            Value: latency,
            Unit: 'Milliseconds',
            Dimensions: this.dimensions,
            Timestamp: new Date()
          }
        ]
      }).promise();
    } catch (error) {
      console.error('Error emitting API latency metrics:', error);
    }
  }

  /**
     * Emit error rate metrics to CloudWatch
     * @param {number} errorRate - Error rate as a percentage
     */
  async emitErrorRate(errorRate) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'ErrorRate',
            Value: errorRate,
            Unit: 'Percent',
            Dimensions: this.dimensions,
            Timestamp: new Date()
          }
        ]
      }).promise();
    } catch (error) {
      console.error('Error emitting error rate metrics:', error);
    }
  }

  /**
     * Emit message queue size metrics to CloudWatch
     * @param {number} queueSize - Current size of the message queue
     */
  async emitMessageQueueSize(queueSize) {
    try {
      await this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: 'MessageQueueSize',
            Value: queueSize,
            Unit: 'Count',
            Dimensions: this.dimensions,
            Timestamp: new Date()
          }
        ]
      }).promise();
    } catch (error) {
      console.error('Error emitting message queue size metrics:', error);
    }
  }

  /**
     * Emit all metrics to CloudWatch
     */
  async emitAllMetrics() {
    const allMetrics = metrics.getAllMetrics();
        
    // Emit counter metrics
    for (const [name, value] of Object.entries(allMetrics.counters)) {
      try {
        await this.cloudwatch.putMetricData({
          Namespace: this.namespace,
          MetricData: [
            {
              MetricName: name,
              Value: value,
              Unit: 'Count',
              Dimensions: this.dimensions,
              Timestamp: new Date()
            }
          ]
        }).promise();
      } catch (error) {
        console.error(`Error emitting counter metric ${name}:`, error);
      }
    }

    // Emit gauge metrics
    for (const [name, value] of Object.entries(allMetrics.gauges)) {
      try {
        await this.cloudwatch.putMetricData({
          Namespace: this.namespace,
          MetricData: [
            {
              MetricName: name,
              Value: value,
              Unit: 'Count',
              Dimensions: this.dimensions,
              Timestamp: new Date()
            }
          ]
        }).promise();
      } catch (error) {
        console.error(`Error emitting gauge metric ${name}:`, error);
      }
    }
  }
}

// Export a singleton instance
const cloudwatchMetrics = new CloudWatchMetrics();
module.exports = { cloudwatchMetrics }; 