terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0"
    }
  }
  backend "s3" {
    bucket         = "mcp-ble-server-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "mcp-ble-server-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_region" "current" {}

module "vpc" {
  source = "../modules/vpc"

  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "alb" {
  source = "../modules/alb"

  environment         = var.environment
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.public_subnet_ids
  ssl_certificate_arn = var.ssl_certificate_arn
}

module "rds" {
  source = "../modules/rds"

  environment            = var.environment
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  ec2_security_group_id = module.alb.security_group_id
  engine_version        = var.db_engine_version
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  db_name              = var.db_name
  db_username          = var.db_username
  db_password          = var.db_password
}

module "ec2" {
  source = "../modules/ec2"

  environment            = var.environment
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  instance_type         = "t3.small"  # Larger instance type for production
  key_name              = var.key_name
  target_group_arn      = module.alb.target_group_arn
  alb_security_group_id = module.alb.security_group_id
  min_size             = 2  # Higher minimum for production
  max_size             = 4  # Higher maximum for production
  desired_capacity     = 2  # Higher desired capacity for production
  aws_region           = data.aws_region.current.name
  db_host             = module.rds.db_endpoint
  db_port             = module.rds.db_port
  db_name             = module.rds.db_name
  db_username         = module.rds.db_username
  db_password         = var.db_password
  s3_access_policy_arn = module.s3.s3_access_policy_arn
  ami_id              = var.ami_id
}

module "cloudwatch" {
  source = "../modules/cloudwatch"

  environment    = var.environment
  asg_name      = var.asg_name
  sns_topic_arn = var.sns_topic_arn
}

module "s3" {
  source = "../modules/s3"

  environment = var.environment
}

module "security" {
  source = "../modules/security"

  environment = var.environment
} 