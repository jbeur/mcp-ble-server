resource "aws_cloudwatch_log_group" "main" {
  name              = "/ec2/${var.environment}-mcp-ble-server"
  retention_in_days = 30
}

# System Metrics
resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  alarm_name          = "${var.environment}-mcp-ble-server-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period             = "300"
  statistic          = "Average"
  threshold          = "80"
  alarm_description  = "This metric monitors EC2 CPU utilization"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

resource "aws_cloudwatch_metric_alarm" "memory_utilization" {
  alarm_name          = "${var.environment}-mcp-ble-server-memory-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MemoryUtilization"
  namespace           = "System/Linux"
  period             = "300"
  statistic          = "Average"
  threshold          = "80"
  alarm_description  = "This metric monitors EC2 memory utilization"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

# BLE Connection Metrics
resource "aws_cloudwatch_metric_alarm" "ble_connections" {
  alarm_name          = "${var.environment}-mcp-ble-server-ble-connections"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "ActiveBLEConnections"
  namespace           = "Custom/MCP-BLE"
  period             = "300"
  statistic          = "Sum"
  threshold          = "1"
  alarm_description  = "This metric monitors active BLE connections"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

# WebSocket Connection Metrics
resource "aws_cloudwatch_metric_alarm" "websocket_connections" {
  alarm_name          = "${var.environment}-mcp-ble-server-websocket-connections"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "ActiveWebSocketConnections"
  namespace           = "Custom/MCP-BLE"
  period             = "300"
  statistic          = "Sum"
  threshold          = "1"
  alarm_description  = "This metric monitors active WebSocket connections"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

# API Latency Metrics
resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${var.environment}-mcp-ble-server-api-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "APILatency"
  namespace           = "Custom/MCP-BLE"
  period             = "300"
  statistic          = "Average"
  threshold          = "1000"
  alarm_description  = "This metric monitors API response latency in milliseconds"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

# Error Rate Metrics
resource "aws_cloudwatch_metric_alarm" "error_rate" {
  alarm_name          = "${var.environment}-mcp-ble-server-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "ErrorRate"
  namespace           = "Custom/MCP-BLE"
  period             = "300"
  statistic          = "Average"
  threshold          = "5"
  alarm_description  = "This metric monitors the error rate percentage"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
}

# Custom Application Metrics
resource "aws_cloudwatch_metric_alarm" "message_queue_size" {
  alarm_name          = "${var.environment}-mcp-ble-server-message-queue-size"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MessageQueueSize"
  namespace           = "Custom/MCP-BLE"
  period             = "300"
  statistic          = "Maximum"
  threshold          = "1000"
  alarm_description  = "This metric monitors the message queue size"
  alarm_actions      = [var.sns_topic_arn]

  dimensions = {
    AutoScalingGroupName = var.asg_name
  }
} 