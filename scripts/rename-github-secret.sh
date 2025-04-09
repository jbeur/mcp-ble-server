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

# Check command line arguments
if [ $# -lt 3 ]; then
    echo "Usage: $0 <old_secret_name> <new_secret_name> <environment>"
    echo "Example: $0 OLD_DB_PASSWORD DB_PASSWORD staging"
    exit 1
fi

OLD_SECRET=$1
NEW_SECRET=$2
ENVIRONMENT=$3

echo "Renaming secret from $OLD_SECRET to $NEW_SECRET in $ENVIRONMENT environment..."

# Check if old secret exists
if ! gh secret list --env "$ENVIRONMENT" | grep -q "^$OLD_SECRET"; then
    echo "Error: Secret $OLD_SECRET does not exist in $ENVIRONMENT environment"
    exit 1
fi

# Check if new secret already exists
if gh secret list --env "$ENVIRONMENT" | grep -q "^$NEW_SECRET"; then
    echo "Error: Secret $NEW_SECRET already exists in $ENVIRONMENT environment"
    exit 1
fi

# Get the value of the old secret
echo "Getting value of $OLD_SECRET..."
OLD_VALUE=$(gh secret list --env "$ENVIRONMENT" | grep "^$OLD_SECRET" | cut -f2)

# Create new secret with the same value
echo "Creating new secret $NEW_SECRET..."
echo -n "$OLD_VALUE" | gh secret set "$NEW_SECRET" --env "$ENVIRONMENT"

# Verify new secret was created
if gh secret list --env "$ENVIRONMENT" | grep -q "^$NEW_SECRET"; then
    echo "New secret $NEW_SECRET created successfully"
    
    # Delete old secret
    echo "Deleting old secret $OLD_SECRET..."
    gh secret delete "$OLD_SECRET" --env "$ENVIRONMENT"
    
    echo "Secret renamed successfully!"
else
    echo "Error: Failed to create new secret"
    exit 1
fi
