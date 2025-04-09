#!/bin/bash

echo "Verifying CI/CD status checks configuration..."

# Check if required files exist
echo "Checking required files..."
if [ ! -f ".github/workflows/ci-cd.yml" ]; then
    echo "❌ Error: CI/CD workflow file not found"
    exit 1
fi

if [ ! -f ".github/CODEOWNERS" ]; then
    echo "❌ Error: CODEOWNERS file not found"
    exit 1
fi

# Verify workflow file contains required jobs
echo "Verifying workflow jobs..."
REQUIRED_JOBS=("test" "lint" "security" "build" "deploy")
for job in "${REQUIRED_JOBS[@]}"; do
    if ! grep -q "name: $job" .github/workflows/ci-cd.yml; then
        echo "❌ Error: Required job '$job' not found in workflow"
        exit 1
    fi
done

# Verify status checks in workflow
echo "Verifying status checks..."
REQUIRED_CHECKS=("npm test" "npm run lint" "npm audit" "npm run build")
for check in "${REQUIRED_CHECKS[@]}"; do
    if ! grep -q "$check" .github/workflows/ci-cd.yml; then
        echo "❌ Error: Required check '$check' not found in workflow"
        exit 1
    fi
done

# Verify CODEOWNERS configuration
echo "Verifying CODEOWNERS configuration..."
REQUIRED_TEAMS=("@project-maintainers" "@ble-team-maintainers" "@protocol-team-maintainers" 
                "@core-team-maintainers" "@qa-team-maintainers" "@docs-team-maintainers" 
                "@devops-team-maintainers")
for team in "${REQUIRED_TEAMS[@]}"; do
    if ! grep -q "$team" .github/CODEOWNERS; then
        echo "❌ Error: Required team '$team' not found in CODEOWNERS"
        exit 1
    fi
done

echo "✅ All required status checks and configurations verified successfully!"
echo ""
echo "Next steps:"
echo "1. Go to your GitHub repository"
echo "2. Navigate to Settings > Branches"
echo "3. Under 'Branch protection rules', click 'Add rule'"
echo "4. Configure the following settings:"
echo "   - Branch name pattern: main"
echo "   - Check 'Require a pull request before merging'"
echo "   - Check 'Require approvals' and set to 2"
echo "   - Check 'Dismiss stale pull request approvals when new commits are pushed'"
echo "   - Check 'Require status checks to pass before merging'"
echo "   - Select all status checks from the list below:"
echo "     - test"
echo "     - lint"
echo "     - security"
echo "     - build"
echo "   - Check 'Require branches to be up to date before merging'"
echo "   - Check 'Include administrators'"
echo "   - Check 'Require linear history'"
echo "   - Check 'Require signed commits'"
echo "5. Click 'Create' to save the rules" 