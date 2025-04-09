output "db_endpoint" {
  description = "The endpoint of the RDS instance"
  value       = aws_db_instance.main.endpoint
}

output "db_port" {
  description = "The port of the RDS instance"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "The name of the database"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "The master username for the database"
  value       = aws_db_instance.main.username
}

output "security_group_id" {
  description = "The security group ID of the RDS instance"
  value       = aws_security_group.rds.id
} 