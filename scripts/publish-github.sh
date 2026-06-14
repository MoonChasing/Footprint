#!/bin/bash
# ============================================
# TimeTrack Extension - Publish to GitHub
# ============================================
# Run this script to initialize git, create a GitHub repo,
# and push all code.
#
# Prerequisites:
#   - gh CLI installed (brew install gh)
#   - gh auth login (already authenticated)
# ============================================

set -e

cd "$(dirname "$0")/.."

echo "🚀 Publishing TimeTrack to GitHub"
echo "================================"
echo ""

# Step 1: Initialize git
if [ ! -d ".git" ]; then
    echo "1/5 Initializing git repository..."
    git init
    echo "    ✓ Git initialized"
else
    echo "1/5 Git already initialized ✓"
fi
echo ""

# Step 2: Stage all files
echo "2/5 Staging files..."
git add -A
echo "    ✓ Files staged"
echo ""

# Step 3: Initial commit
echo "3/5 Creating initial commit..."
git commit -m "feat: initial implementation of TimeTrack VSCode extension

- Track time spent in each file with 30s heartbeat
- Idle detection (configurable, default 2min)
- Line change counting (lines added/deleted per file)
- Multi-window support via SQLite WAL mode
- Multi-environment support (Local/SSH/WSL/Dev Container)
- Each record includes machine_name, remote_type, remote_host
- Status bar showing today's total time
- Webview report panel with Chart.js visualizations
- Data stored at ~/.timetrack/data.db
- Export data as JSON for cross-environment aggregation"
echo "    ✓ Committed"
echo ""

# Step 4: Create GitHub repository
echo "4/5 Creating GitHub repository..."
gh repo create Footprint --public --description "VSCode extension to track time spent in files across local, SSH, WSL, and Dev Container environments" --source . --push
echo "    ✓ Repository created and pushed"
echo ""

# Step 5: Done
echo "================================"
echo "✅ Published to GitHub!"
echo ""
REPO_URL=$(gh repo view --json url -q '.url' 2>/dev/null || echo "https://github.com/$(gh api user -q .login)/Footprint")
echo "🔗 $REPO_URL"
echo "================================"
