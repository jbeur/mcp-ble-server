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

echo "Checking secrets for $OWNER/$REPO"

# List of required secrets
REQUIRED_SECRETS=(
    "AWS_ACCESS_KEY_ID"
    "AWS_SECRET_ACCESS_KEY"
    "AWS_ROLE_ARN"
    "DB_PASSWORD"
    "SLACK_WEBHOOK_URL"
    "CODECOV_TOKEN"
)

# Check repository secrets
echo -e "\nRepository Secrets:"
for secret in "${REQUIRED_SECRETS[@]}"; do
    if gh secret list | grep -q "^$secret"; then
        echo "✓ $secret exists"
    else
        echo "✗ $secret missing"
    fi
done

# Check environment secrets
ENVIRONMENTS=("staging" "production")
for env in "${ENVIRONMENTS[@]}"; do
    echo -e "\n$env Environment Secrets:"
    for secret in "${REQUIRED_SECRETS[@]}"; do
        if gh secret list --env "$env" | grep -q "^$secret"; then
            echo "✓ $secret exists"
        else
            echo "✗ $secret missing"
        fi
    done
done 