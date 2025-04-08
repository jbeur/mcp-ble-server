output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "List of public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "List of private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "alb_dns_name" {
  description = "DNS name of the ALB"
  value       = module.alb.alb_dns_name
}

output "db_endpoint" {
  description = "The endpoint of the RDS instance"
  value       = module.rds.db_endpoint
}

output "db_port" {
  description = "The port of the RDS instance"
  value       = module.rds.db_port
}

output "db_name" {
  description = "The name of the database"
  value       = module.rds.db_name
}

output "db_username" {
  description = "The master username for the database"
  value       = module.rds.db_username
} 