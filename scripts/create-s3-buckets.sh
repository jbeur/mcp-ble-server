#!/bin/bash

# Exit on error
set -e

# Bucket names
BUCKETS=(
    "staging-mcp-ble-server-assets"
    "staging-mcp-ble-server-backup"
    "production-mcp-ble-server-assets"
    "production-mcp-ble-server-backup"
)

# AWS region
REGION="us-east-1"

# Create each bucket
for BUCKET in "${BUCKETS[@]}"; do
    echo "Creating bucket: $BUCKET"
    
    # Create bucket (special handling for us-east-1)
    if [ "$REGION" == "us-east-1" ]; then
        aws s3api create-bucket \
            --bucket $BUCKET \
            --region $REGION
    else
        aws s3api create-bucket \
            --bucket $BUCKET \
            --region $REGION \
            --create-bucket-configuration LocationConstraint=$REGION
    fi

    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket $BUCKET \
        --versioning-configuration Status=Enabled

    # Set lifecycle rules for backup buckets
    if [[ $BUCKET == *"backup"* ]]; then
        aws s3api put-bucket-lifecycle-configuration \
            --bucket $BUCKET \
            --lifecycle-configuration '{
                "Rules": [
                    {
                        "ID": "DeleteOldBackups",
                        "Status": "Enabled",
                        "Prefix": "",
                        "Expiration": {
                            "Days": 30
                        }
                    }
                ]
            }'
    fi

    # Set bucket policy
    aws s3api put-bucket-policy \
        --bucket $BUCKET \
        --policy "{
            \"Version\": \"2012-10-17\",
            \"Statement\": [
                {
                    \"Sid\": \"AllowSSLRequestsOnly\",
                    \"Effect\": \"Deny\",
                    \"Principal\": \"*\",
                    \"Action\": \"s3:*\",
                    \"Resource\": [
                        \"arn:aws:s3:::$BUCKET\",
                        \"arn:aws:s3:::$BUCKET/*\"
                    ],
                    \"Condition\": {
                        \"Bool\": {
                            \"aws:SecureTransport\": \"false\"
                        }
                    }
                }
            ]
        }"
done

echo "All buckets created successfully!" 