#!/bin/bash
# =============================================================================
# Observatory Collector - Update Script
# =============================================================================
# Updates the collector from GitHub and restarts the service.
# Run from anywhere - it will find the repository automatically.
#
# Usage:
#   ./update.sh           # Update and restart
#   ./update.sh --check   # Check for updates without applying
# =============================================================================

set -e

# Configuration
INSTALL_DIR="/home/$USER/observatory-collector"
SERVICE_NAME="observatory-collector"

# Try to find the repo directory
find_repo() {
    # Check if we're in the repo
    if [ -f "$(pwd)/collector.py" ] && [ -f "$(pwd)/../package.json" ]; then
        echo "$(pwd)"
        return
    fi

    # Check common locations
    for dir in \
        "$HOME/observatory-dashboard/raspberry-pi" \
        "/home/$USER/observatory-dashboard/raspberry-pi" \
        "$(dirname "$0")"
    do
        if [ -f "$dir/collector.py" ] && [ -f "$dir/../package.json" ]; then
            echo "$dir"
            return
        fi
    done

    echo ""
}

REPO_PI_DIR=$(find_repo)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for repository
if [ -z "$REPO_PI_DIR" ]; then
    log_error "Could not find the observatory-dashboard repository."
    log_error "Please clone it first:"
    echo "  git clone https://github.com/xthestreams/observatory-dashboard.git"
    echo "  cd observatory-dashboard/raspberry-pi"
    echo "  ./install.sh"
    exit 1
fi

REPO_DIR="$(dirname "$REPO_PI_DIR")"

# Check for updates only
if [ "$1" = "--check" ]; then
    log_info "Checking for updates..."
    cd "$REPO_DIR"

    git fetch origin main

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" = "$REMOTE" ]; then
        echo -e "${GREEN}✓${NC} Already up to date."
    else
        COMMITS_BEHIND=$(git rev-list --count HEAD..origin/main)
        echo -e "${YELLOW}!${NC} $COMMITS_BEHIND commit(s) behind origin/main"
        echo
        echo "Recent changes:"
        git log --oneline HEAD..origin/main | head -10
        echo
        echo "Run without --check to update."
    fi
    exit 0
fi

echo "=============================================="
echo "  Observatory Collector - Update"
echo "=============================================="
echo

# Check if install exists
if [ ! -d "$INSTALL_DIR" ]; then
    log_error "Collector not installed at $INSTALL_DIR"
    log_error "Run ./install.sh first."
    exit 1
fi

# Step 1: Pull latest changes
log_info "Step 1: Pulling latest changes from GitHub..."
cd "$REPO_DIR"

# Stash any local changes (shouldn't be any but just in case)
git stash --quiet 2>/dev/null || true

# Pull latest
git pull origin main

log_info "Updated to: $(git log -1 --format='%h %s')"

# Step 2: Copy updated files
log_info "Step 2: Updating collector files..."
cp "$REPO_PI_DIR/collector.py" "$INSTALL_DIR/"
cp "$REPO_PI_DIR/requirements.txt" "$INSTALL_DIR/"

# Step 3: Update dependencies if requirements changed
log_info "Step 3: Checking Python dependencies..."
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt"

# Step 4: Reload and restart service
log_info "Step 4: Restarting service..."
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"

# Step 5: Verify
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    log_info "Service restarted successfully!"
    echo
    echo -e "${CYAN}Recent logs:${NC}"
    sudo journalctl -u "$SERVICE_NAME" -n 10 --no-pager
else
    log_error "Service failed to start!"
    echo
    echo "Check logs with:"
    echo "  sudo journalctl -u $SERVICE_NAME -n 50"
    exit 1
fi

echo
echo "=============================================="
echo "  Update Complete!"
echo "=============================================="
