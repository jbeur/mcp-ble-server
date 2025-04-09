#!/bin/bash

# Exit on error
set -e

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI (gh) is not installed. Please install it first."
    echo "Visit: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "Please authenticate with GitHub first:"
    echo "gh auth login"
    exit 1
fi

# Get repository name
REPO=$(gh repo view --json name -q .name)
OWNER=$(gh repo view --json owner -q .owner.login)

echo "Setting up secrets for $OWNER/$REPO"

# Function to set a secret
set_secret() {
    local name=$1
    local value=$2
    
    echo "Setting $name..."
    echo -n "$value" | gh secret set "$name" --repo "$OWNER/$REPO"
}

# Read values from user
read -p "Enter AWS Access Key ID: " AWS_ACCESS_KEY_ID
read -p "Enter AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
read -p "Enter AWS Role ARN: " AWS_ROLE_ARN
read -p "Enter Database Password: " DB_PASSWORD
read -p "Enter Slack Webhook URL: " SLACK_WEBHOOK_URL
read -p "Enter Codecov Token: " CODECOV_TOKEN

# Set secrets
set_secret "AWS_ACCESS_KEY_ID" "$AWS_ACCESS_KEY_ID"
set_secret "AWS_SECRET_ACCESS_KEY" "$AWS_SECRET_ACCESS_KEY"
set_secret "AWS_ROLE_ARN" "$AWS_ROLE_ARN"
set_secret "DB_PASSWORD" "$DB_PASSWORD"
set_secret "SLACK_WEBHOOK_URL" "$SLACK_WEBHOOK_URL"
set_secret "CODECOV_TOKEN" "$CODECOV_TOKEN"

echo "All secrets have been set successfully!" 