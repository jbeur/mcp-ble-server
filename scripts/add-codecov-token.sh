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

echo "Adding Codecov token to environments for $OWNER/$REPO"

# Read Codecov token
read -p "Enter your Codecov token: " CODECOV_TOKEN

# Add to staging environment
echo "Adding to staging environment..."
echo -n "$CODECOV_TOKEN" | gh secret set CODECOV_TOKEN --env staging

# Add to production environment
echo "Adding to production environment..."
echo -n "$CODECOV_TOKEN" | gh secret set CODECOV_TOKEN --env production

echo "Codecov token added successfully to both environments!" 