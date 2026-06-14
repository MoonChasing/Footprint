#!/bin/bash
# ============================================
# TimeTrack Extension - Remote Install Script
# ============================================
# Usage: ./scripts/install-remote.sh user@host [vsix_file]
#
# Copies the .vsix to a remote machine and installs it.
# Also handles installing on the current machine.
#
# Examples:
#   ./scripts/install-remote.sh                  # Install locally
#   ./scripts/install-remote.sh user@server      # Install via SSH
#   ./scripts/install-remote.sh user@server my.vsix
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Find the .vsix file
VSIX_FILE="${2:-$(ls -t *.vsix 2>/dev/null | head -1)}"

if [ -z "$VSIX_FILE" ] || [ ! -f "$VSIX_FILE" ]; then
    echo "❌ No .vsix file found. Run ./scripts/package.sh first."
    exit 1
fi

REMOTE_HOST="$1"

if [ -z "$REMOTE_HOST" ]; then
    # Local install
    echo "📦 Installing $VSIX_FILE locally..."
    code --install-extension "$VSIX_FILE" --force
    echo "✓ Installed! Reload VSCode to activate."
else
    # Remote install via SSH
    echo "📦 Installing $VSIX_FILE on $REMOTE_HOST..."
    echo ""

    REMOTE_TMP="/tmp/timetrack-extension.vsix"

    echo "1/3 Copying .vsix to remote..."
    scp "$VSIX_FILE" "$REMOTE_HOST:$REMOTE_TMP"
    echo "    ✓ Copied"

    echo "2/3 Installing on remote..."
    ssh "$REMOTE_HOST" "code --install-extension $REMOTE_TMP --force 2>/dev/null || \
                         code-server --install-extension $REMOTE_TMP --force 2>/dev/null || \
                         echo '⚠️  Could not find code/code-server CLI. Manual install needed: copy $REMOTE_TMP and use Extensions > Install from VSIX'"
    echo "    ✓ Installed"

    echo "3/3 Cleaning up..."
    ssh "$REMOTE_HOST" "rm -f $REMOTE_TMP"
    echo "    ✓ Done"

    echo ""
    echo "================================"
    echo "✅ Extension installed on $REMOTE_HOST"
    echo "   Reload VSCode window to activate."
    echo "================================"
fi
