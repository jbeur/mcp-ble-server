#!/bin/bash

# Exit on error
set -e

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

# Initialize Terraform
terraform init

# Validate Terraform configuration
terraform validate

# Create a plan
terraform plan -out=tfplan

# Apply the plan
terraform apply tfplan

# Get the ALB DNS name
ALB_DNS=$(terraform output -raw alb_dns_name)

# Update Route53 record
if [ -n "$ALB_DNS" ]; then
  aws route53 change-resource-record-sets \
    --hosted-zone-id $HOSTED_ZONE_ID \
    --change-batch '{
      "Changes": [{
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "'$DOMAIN_NAME'",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "'$ALB_ZONE_ID'",
            "DNSName": "'$ALB_DNS'",
            "EvaluateTargetHealth": false
          }
        }
      }]
    }'
fi

# Clean up
rm -f tfplan 