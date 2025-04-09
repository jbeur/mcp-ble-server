resource "aws_db_subnet_group" "main" {
  name       = "${var.environment}-mcp-ble-server-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "${var.environment}-mcp-ble-server-db-subnet-group"
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.environment}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.ec2_security_group_id]
  }

  tags = {
    Name        = "${var.environment}-rds-sg"
    Environment = var.environment
  }
}

resource "aws_db_instance" "main" {
  identifier           = "${var.environment}-mcp-ble-server-db"
  engine              = "postgres"
  engine_version      = "15.12"
  instance_class      = var.instance_class
  allocated_storage   = var.allocated_storage
  storage_type        = "gp2"
  db_name             = var.db_name
  username            = var.db_username
  password            = var.db_password
  port                = 5432

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.environment}-mcp-ble-server-db-final-snapshot"

  tags = {
    Name        = "${var.environment}-mcp-ble-server-db"
    Environment = var.environment
  }
} 