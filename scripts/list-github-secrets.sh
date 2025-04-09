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

echo "Listing secrets for $OWNER/$REPO"

# List staging environment secrets
echo -e "\nStaging Environment Secrets:"
gh secret list --env staging

# List production environment secrets
echo -e "\nProduction Environment Secrets:"
gh secret list --env production 