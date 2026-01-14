#!/bin/bash
# =============================================================================
# Observatory Collector - Raspberry Pi Installer
# =============================================================================
# This script installs the Observatory Data Collector on a Raspberry Pi.
# Run from the raspberry-pi directory of the cloned repository.
#
# Usage:
#   ./install.sh              # Interactive install
#   ./install.sh --uninstall  # Remove the collector
# =============================================================================

set -e

# Configuration
INSTALL_DIR="/home/$USER/observatory-collector"
SERVICE_NAME="observatory-collector"
REPO_PI_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root (we don't want that for most operations)
check_not_root() {
    if [ "$EUID" -eq 0 ]; then
        log_error "Please run this script as a normal user, not root."
        log_error "The script will use sudo when needed."
        exit 1
    fi
}

# Uninstall function
uninstall() {
    log_info "Uninstalling Observatory Collector..."

    # Stop and disable service
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stopping service..."
        sudo systemctl stop "$SERVICE_NAME"
    fi

    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Disabling service..."
        sudo systemctl disable "$SERVICE_NAME"
    fi

    # Remove service file
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        log_info "Removing service file..."
        sudo rm "/etc/systemd/system/$SERVICE_NAME.service"
        sudo systemctl daemon-reload
    fi

    # Ask about removing install directory
    if [ -d "$INSTALL_DIR" ]; then
        read -p "Remove $INSTALL_DIR? This will delete your .env config! [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$INSTALL_DIR"
            log_info "Removed $INSTALL_DIR"
        else
            log_info "Kept $INSTALL_DIR (contains your config)"
        fi
    fi

    log_info "Uninstall complete."
    exit 0
}

# Check for uninstall flag
if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
    uninstall
fi

check_not_root

echo "=============================================="
echo "  Observatory Collector - Raspberry Pi Setup"
echo "=============================================="
echo

# Check we're in the right directory
if [ ! -f "$REPO_PI_DIR/collector.py" ]; then
    log_error "collector.py not found in $REPO_PI_DIR"
    log_error "Please run this script from the raspberry-pi directory."
    exit 1
fi

# Step 1: Install system dependencies
log_info "Step 1: Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv curl

# Step 2: Create installation directory
log_info "Step 2: Setting up installation directory..."
mkdir -p "$INSTALL_DIR"

# Step 3: Copy files
log_info "Step 3: Copying collector files..."
cp "$REPO_PI_DIR/collector.py" "$INSTALL_DIR/"
cp "$REPO_PI_DIR/requirements.txt" "$INSTALL_DIR/"

# Step 4: Create/update virtual environment
log_info "Step 4: Setting up Python virtual environment..."
if [ ! -d "$INSTALL_DIR/venv" ]; then
    python3 -m venv "$INSTALL_DIR/venv"
fi
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

# Step 5: Handle .env configuration
log_info "Step 5: Configuring environment..."
if [ -f "$INSTALL_DIR/.env" ]; then
    log_info "Existing .env found - keeping your configuration."
    log_warn "Review $INSTALL_DIR/.env to check for new options."
else
    cp "$REPO_PI_DIR/.env.example" "$INSTALL_DIR/.env"
    log_warn "Created $INSTALL_DIR/.env from template."
    log_warn "You MUST edit this file with your settings!"
    echo
    echo "Required settings to configure:"
    echo "  - REMOTE_API_URL: Your Vercel dashboard URL"
    echo "  - API_KEY: Must match INGEST_API_KEY in Vercel"
    echo "  - SQM_1_HOST, DAVIS_1_HOST, etc: Your instrument IPs"
    echo
fi

# Step 6: Create systemd service
log_info "Step 6: Creating systemd service..."
sudo tee "/etc/systemd/system/$SERVICE_NAME.service" > /dev/null << EOF
[Unit]
Description=Observatory Data Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/collector.py
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

# Step 7: Enable and start service (if .env is configured)
log_info "Step 7: Enabling service..."
sudo systemctl enable "$SERVICE_NAME"

# Check if .env has been configured
if grep -q "your-secret-key-here" "$INSTALL_DIR/.env" 2>/dev/null; then
    log_warn "Service enabled but NOT started - .env needs configuration first!"
    echo
    echo "Next steps:"
    echo "  1. Edit your configuration:"
    echo "     nano $INSTALL_DIR/.env"
    echo
    echo "  2. Start the service:"
    echo "     sudo systemctl start $SERVICE_NAME"
    echo
    echo "  3. Check the logs:"
    echo "     sudo journalctl -u $SERVICE_NAME -f"
else
    log_info "Starting service..."
    sudo systemctl start "$SERVICE_NAME"
    sleep 2

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_info "Service is running!"
    else
        log_error "Service failed to start. Check logs:"
        log_error "  sudo journalctl -u $SERVICE_NAME -n 50"
    fi
fi

echo
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo
echo "Useful commands:"
echo "  View logs:      sudo journalctl -u $SERVICE_NAME -f"
echo "  Restart:        sudo systemctl restart $SERVICE_NAME"
echo "  Stop:           sudo systemctl stop $SERVICE_NAME"
echo "  Status:         sudo systemctl status $SERVICE_NAME"
echo "  Edit config:    nano $INSTALL_DIR/.env"
echo
echo "To update the collector later:"
echo "  cd $(dirname "$REPO_PI_DIR") && git pull"
echo "  cd raspberry-pi && ./install.sh"
echo
