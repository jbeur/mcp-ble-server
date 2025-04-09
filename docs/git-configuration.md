# Git Configuration Guide

## Overview
This guide describes the Git configuration and workflow setup for the MCP BLE Server project. These configurations ensure consistent code quality, maintainable history, and efficient collaboration.

## Setup Process

### 1. Initial Configuration
Run the setup script to configure Git settings:
```bash
./scripts/setup-git-config.sh
```

### 2. Team Configuration
1. Update `.github/CODEOWNERS` with your team assignments:
   - `@project-maintainers`: Core project maintainers
   - `@ble-team-maintainers`: BLE functionality team
   - `@protocol-team-maintainers`: MCP protocol team
   - `@core-team-maintainers`: Core utilities team
   - `@qa-team-maintainers`: QA team
   - `@docs-team-maintainers`: Documentation team
   - `@devops-team-maintainers`: DevOps team

### 3. GitHub Repository Settings
Configure these settings in the GitHub repository:

1. Branch Protection Rules (main branch):
   - Require pull request reviews
   - Dismiss stale pull request approvals
   - Require status checks to pass
   - Require branches to be up to date
   - Include administrators in restrictions
   - Require linear history
   - Require signed commits

2. Required Status Checks:
   - CI tests
   - Linting
   - Security scans
   - Build verification

3. Required Reviews:
   - Minimum number of reviewers: 2
   - Require review from Code Owners
   - Restrict who can dismiss reviews

### 4. Commit Standards
All commits must follow these standards:

1. Format:
   ```
   <type>(<scope>): <subject>
   
   <body>
   
   <footer>
   ```

2. Types:
   - `feat`: New feature
   - `fix`: Bug fix
   - `refactor`: Code refactoring
   - `style`: Formatting changes
   - `docs`: Documentation changes
   - `test`: Test changes
   - `chore`: Maintenance tasks
   - `perf`: Performance improvements
   - `security`: Security improvements

3. Guidelines:
   - Use imperative mood in subject
   - Capitalize first letter
   - No period at end
   - Limit subject to 50 characters
   - Wrap body at 72 characters
   - Use body to explain what and why
   - Reference issues in footer

### 5. Pull Request Process
1. Create branch from main
2. Make changes following commit standards
3. Push changes and create PR using template
4. Ensure all checks pass
5. Request reviews from appropriate teams
6. Address review comments
7. Squash and merge when approved

### 6. Pre-commit Hooks
The following checks run before each commit:
1. ESLint validation
2. Unit tests
3. Type checking
4. Format verification

### 7. Git Configuration Details
```ini
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
```

## Workflow Guidelines

### 1. Branch Management
- Create feature branches from main
- Use descriptive branch names
- Delete branches after merging
- Keep branches up to date with main

### 2. Code Review
- Review within 24 hours
- Check for:
  - Code quality
  - Test coverage
  - Documentation
  - Security implications
  - Performance impact

### 3. Merge Strategy
- Squash and merge to main
- Write clear, descriptive merge commits
- Ensure linear history
- Delete branch after merge

### 4. Release Process
1. Create release branch
2. Update version numbers
3. Generate changelog
4. Create release tag
5. Deploy to production
6. Monitor deployment

## Troubleshooting

### Common Issues
1. Pre-commit hooks failing
   - Ensure ESLint is installed
   - Run tests locally
   - Check code formatting

2. Pull request checks failing
   - Review CI/CD logs
   - Update branch from main
   - Verify all tests pass locally

3. Merge conflicts
   - Rebase from main
   - Resolve conflicts locally
   - Push updated branch

## Support
Contact the DevOps team for:
- Git configuration issues
- Workflow questions
- Permission problems
- CI/CD pipeline issues 