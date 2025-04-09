#!/bin/bash

echo "Setting up Git configurations for MCP BLE Server..."

# Create necessary directories
mkdir -p .github/hooks

# Copy configuration files
echo "Copying configuration files..."

# 1. CODEOWNERS
cat > .github/CODEOWNERS << 'EOL'
# These owners will be the default owners for everything in
# the repo. Unless a later match takes precedence,
# these users will be requested for review when someone 
# opens a pull request.
*       @project-maintainers

# BLE core functionality
/src/ble/           @ble-team-maintainers

# MCP protocol implementation
/src/mcp/           @protocol-team-maintainers

# Configuration and utilities
/src/config/        @core-team-maintainers
/src/utils/         @core-team-maintainers

# Test files
/tests/             @qa-team-maintainers

# Documentation
/docs/              @docs-team-maintainers

# CI/CD and deployment
/.github/           @devops-team-maintainers
/config/           @devops-team-maintainers
EOL

# 2. Git commit message template
cat > .gitmessage << 'EOL'
# <type>(<scope>): <subject>
# |<----  Using a Maximum Of 50 Characters  ---->|

# Explain why this change is being made
# |<----   Try To Limit Each Line to a Maximum Of 72 Characters   ---->|

# Provide links or keys to any relevant tickets, articles or other resources
# Example: Fixes #23

# --- COMMIT END ---
# Type can be
#    feat     (new feature)
#    fix      (bug fix)
#    refactor (refactoring production code)
#    style    (formatting, missing semi colons, etc; no code change)
#    docs     (changes to documentation)
#    test     (adding or refactoring tests; no production code change)
#    chore    (updating grunt tasks etc; no production code change)
#    perf     (performance improvements)
#    security (security improvements)
# --------------------
# Remember to
#   - Capitalize the subject line
#   - Use the imperative mood in the subject line
#   - Do not end the subject line with a period
#   - Separate subject from body with a blank line
#   - Use the body to explain what and why vs. how
#   - Can use multiple lines with "-" for bullet points in body
# --------------------
EOL

# 3. Pre-commit hook
cat > .github/hooks/pre-commit << 'EOL'
#!/bin/sh

# Redirect output to stderr
exec 1>&2

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep ".jsx\{0,1\}$")

if [[ "$STAGED_FILES" = "" ]]; then
  exit 0
fi

PASS=true

echo "\nValidating Javascript:\n"

# Check for eslint
which eslint &> /dev/null
if [[ "$?" == 1 ]]; then
  echo "\t\033[41mPlease install ESlint\033[0m"
  exit 1
fi

for FILE in $STAGED_FILES
do
  eslint "$FILE"

  if [[ "$?" == 0 ]]; then
    echo "\t\033[32mESLint Passed: $FILE\033[0m"
  else
    echo "\t\033[41mESLint Failed: $FILE\033[0m"
    PASS=false
  fi
done

echo "\nJavascript validation completed!\n"

if ! $PASS; then
  echo "\033[41mCOMMIT FAILED:\033[0m Your commit contains files that should pass ESLint but do not. Please fix the ESLint errors and try again.\n"
  exit 1
else
  echo "\033[42mCOMMIT SUCCEEDED\033[0m\n"
fi

# Run tests
echo "Running tests..."
npm test

if [[ "$?" == 1 ]]; then
  echo "\033[41mCOMMIT FAILED:\033[0m Tests must pass before commit!\n"
  exit 1
fi

exit 0
EOL

# Make pre-commit hook executable
chmod +x .github/hooks/pre-commit

# 4. Git configuration
cat > .gitconfig << 'EOL'
[core]
    hooksPath = .github/hooks

[commit]
    template = .gitmessage

[pull]
    rebase = true

[branch]
    autosetuprebase = always

[push]
    default = current

[merge]
    ff = only

[rebase]
    autosquash = true
    autostash = true

[status]
    showUntrackedFiles = all

[diff]
    algorithm = histogram

[fetch]
    prune = true
EOL

# Apply Git configurations
echo "Applying Git configurations..."
git config --local include.path ../.gitconfig
git config --local core.hooksPath .github/hooks
git config --local commit.template .gitmessage

echo "Configuration complete! Please review and update team assignments in .github/CODEOWNERS"
echo "Next steps:"
echo "1. Review and customize team assignments in .github/CODEOWNERS"
echo "2. Configure branch protection rules in GitHub repository settings"
echo "3. Enable required status checks for the main branch"
echo "4. Set up required reviews for pull requests"
echo "5. Enable linear history requirement"
echo "6. Share the commit message guidelines with the team" 