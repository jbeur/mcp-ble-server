data "aws_region" "current" {}

module "vpc" {
  source = "../modules/vpc"

  environment = local.environment
  vpc_cidr    = var.vpc_cidr
}

module "alb" {
  source = "../modules/alb"

  environment         = local.environment
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.public_subnet_ids
  ssl_certificate_arn = var.ssl_certificate_arn
}

module "rds" {
  source = "../modules/rds"

  environment         = local.environment
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  engine_version     = var.db_engine_version
  instance_class     = var.db_instance_class
  allocated_storage  = var.db_allocated_storage
  db_name           = var.db_name
  db_username       = var.db_username
  db_password       = var.db_password
  ec2_security_group_id = module.ec2.security_group_id
}

module "cloudwatch" {
  source = "../modules/cloudwatch"

  environment   = local.environment
  asg_name     = module.ec2.asg_name
  sns_topic_arn = aws_sns_topic.alerts.arn
}

resource "aws_sns_topic" "alerts" {
  name = "mcp-ble-server-${local.environment}-alerts"
}

module "s3" {
  source = "../modules/s3"

  environment = local.environment
}

module "ec2" {
  source = "../modules/ec2"

  environment            = local.environment
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  instance_type         = "t3.micro"
  key_name              = var.key_name
  target_group_arn      = module.alb.target_group_arn
  alb_security_group_id = module.alb.security_group_id
  min_size             = 1
  max_size             = 2
  desired_capacity     = 1
  aws_region           = data.aws_region.current.name
  db_host             = module.rds.db_endpoint
  db_port             = module.rds.db_port
  db_name             = module.rds.db_name
  db_username         = module.rds.db_username
  db_password         = var.db_password
  s3_access_policy_arn = module.s3.s3_access_policy_arn
  ami_id              = "ami-0f844a9675b22ea32"  # Amazon Linux 2 AMI in us-east-1
} 