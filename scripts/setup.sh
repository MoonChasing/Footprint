#!/bin/bash
# ============================================
# TimeTrack Extension - One-Click Setup
# ============================================
# Run this on a NEW machine to set up from source.
# Clones (or uses local), builds, and installs.
#
# Usage:
#   curl -sSL <url>/setup.sh | bash
#   OR
#   ./scripts/setup.sh
# ============================================

set -e

echo "🚀 TimeTrack Extension - Setup"
echo "================================"
echo ""

# Detect if we're in the project directory
if [ -f "package.json" ] && grep -q '"name": "timetrack"' package.json 2>/dev/null; then
    PROJECT_DIR="$(pwd)"
    echo "📂 Using current directory: $PROJECT_DIR"
else
    echo "❌ Please run this script from the project root directory"
    echo "   (the directory containing package.json)"
    exit 1
fi

echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org/ (v18+)"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js v18+ required, found $(node -v)"
    exit 1
fi
echo "  ✓ Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "  ✓ npm $(npm -v)"

if ! command -v code &>/dev/null; then
    echo "⚠️  'code' CLI not found. Extension will be built but not auto-installed."
    echo "    To fix: VSCode → Cmd+Shift+P → 'Shell Command: Install code command'"
    SKIP_INSTALL=1
fi

echo ""

# Install, build, package
echo "Installing dependencies..."
npm install
echo ""

echo "Building..."
npm run build:prod
echo ""

echo "Packaging .vsix..."
npx @vscode/vsce package --allow-missing-repository
echo ""

VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)

if [ -z "$VSIX_FILE" ]; then
    echo "❌ Packaging failed"
    exit 1
fi

# Install
if [ -z "$SKIP_INSTALL" ]; then
    echo "Installing extension..."
    code --install-extension "$VSIX_FILE" --force
    echo ""
    echo "================================"
    echo "✅ TimeTrack installed successfully!"
    echo "   Reload VSCode to start tracking."
    echo ""
    echo "   Data will be stored at: ~/.timetrack/data.db"
    echo "================================"
else
    echo "================================"
    echo "📦 Built: $VSIX_FILE"
    echo ""
    echo "To install manually:"
    echo "  code --install-extension $VSIX_FILE"
    echo "  OR"
    echo "  VSCode → Extensions → ⋯ → Install from VSIX..."
    echo "================================"
fi
