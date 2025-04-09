variable "environment" {
  description = "The environment (staging or production)"
  type        = string
}

variable "aws_region" {
  description = "The AWS region to deploy to"
  type        = string
}

variable "vpc_cidr" {
  description = "The CIDR block for the VPC"
  type        = string
}

variable "key_name" {
  description = "The name of the key pair to use for EC2 instances"
  type        = string
}

variable "db_engine_version" {
  description = "The version of the database engine"
  type        = string
}

variable "db_instance_class" {
  description = "The instance class of the RDS instance"
  type        = string
}

variable "db_allocated_storage" {
  description = "The amount of storage to allocate for the RDS instance"
  type        = number
}

variable "db_name" {
  description = "The name of the database"
  type        = string
}

variable "db_username" {
  description = "The username for the database"
  type        = string
}

variable "db_password" {
  description = "The password for the database"
  type        = string
  sensitive   = true
}

variable "ssl_certificate_arn" {
  description = "The ARN of the SSL certificate to use for the ALB"
  type        = string
}

locals {
  environment = var.environment
} 