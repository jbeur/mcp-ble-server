variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for RDS"
  type        = list(string)
}

variable "ec2_security_group_id" {
  description = "Security group ID of EC2 instances"
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "13.7"
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "mcp_ble_server"
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "mcp_ble_server"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
} 