#!/bin/bash
# ============================================
# TimeTrack Extension - Build & Package Script
# ============================================
# Usage: ./scripts/package.sh
#
# This script builds and packages the extension into a .vsix file
# that can be installed on any machine with the same OS/architecture.
#
# Prerequisites:
#   - Node.js >= 18
#   - npm
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "📦 TimeTrack Extension Packager"
echo "================================"
echo ""

# Step 1: Install dependencies
echo "1/4 Installing dependencies..."
npm install --production=false
echo "    ✓ Dependencies installed"
echo ""

# Step 2: Build extension and webview
echo "2/4 Building extension..."
npm run build:prod
echo "    ✓ Build complete"
echo ""

# Step 3: Package as .vsix
echo "3/4 Packaging .vsix..."
npx @vscode/vsce package --allow-missing-repository
echo "    ✓ Package created"
echo ""

# Step 4: Show result
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX_FILE" ]; then
    echo "4/4 Done!"
    echo ""
    echo "================================"
    echo "📁 Output: $PROJECT_DIR/$VSIX_FILE"
    echo "📏 Size: $(du -h "$VSIX_FILE" | cut -f1)"
    echo ""
    echo "To install on another machine:"
    echo "  code --install-extension $VSIX_FILE"
    echo ""
    echo "Or in VSCode:"
    echo "  Extensions → ⋯ → Install from VSIX..."
    echo "================================"
else
    echo "❌ Error: No .vsix file generated"
    exit 1
fi
