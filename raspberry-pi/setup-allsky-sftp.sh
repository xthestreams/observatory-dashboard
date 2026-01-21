#!/bin/bash
#
# Setup script for secure Allsky SFTP uploads to the collector
#
# This script configures the collector Pi to receive images via SFTP from
# an Allsky camera system. It creates a restricted user that can only upload
# files to a specific directory.
#
# Security features:
# - Dedicated user with no shell access
# - Chroot jail restricts access to upload directory only
# - SSH key authentication (no passwords)
# - User cannot execute commands or forward ports
#
# Usage:
#   sudo ./setup-allsky-sftp.sh
#
# After running this script, you'll need to:
# 1. Copy the generated public key to your Allsky Pi
# 2. Configure Allsky to use SFTP with key authentication
#

set -e

# Configuration
UPLOAD_USER="allsky-upload"
UPLOAD_DIR="/var/lib/allsky-uploads"
IMAGES_DIR="${UPLOAD_DIR}/images"
VIDEOS_DIR="${UPLOAD_DIR}/videos"
KEYLOGS_DIR="${UPLOAD_DIR}/keograms"
STARTRAILS_DIR="${UPLOAD_DIR}/startrails"

echo "=========================================="
echo "Allsky SFTP Upload Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

# Check if user already exists
if id "$UPLOAD_USER" &>/dev/null; then
    echo "User '$UPLOAD_USER' already exists."
    read -p "Do you want to reconfigure? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting without changes."
        exit 0
    fi
else
    echo "Creating user '$UPLOAD_USER'..."
    # Create user with no password, no shell, no home directory
    useradd --system --shell /usr/sbin/nologin --no-create-home "$UPLOAD_USER"
fi

echo "Creating upload directories..."

# Create the chroot directory structure
# For chroot to work, the root directory must be owned by root
mkdir -p "$UPLOAD_DIR"
chown root:root "$UPLOAD_DIR"
chmod 755 "$UPLOAD_DIR"

# Create subdirectories for different file types
for dir in "$IMAGES_DIR" "$VIDEOS_DIR" "$KEYLOGS_DIR" "$STARTRAILS_DIR"; do
    mkdir -p "$dir"
    chown "$UPLOAD_USER":"$UPLOAD_USER" "$dir"
    chmod 755 "$dir"
done

# Create .ssh directory for the upload user (inside chroot)
SSH_DIR="${UPLOAD_DIR}/.ssh"
mkdir -p "$SSH_DIR"
chown "$UPLOAD_USER":"$UPLOAD_USER" "$SSH_DIR"
chmod 700 "$SSH_DIR"

# Create authorized_keys file
AUTH_KEYS="${SSH_DIR}/authorized_keys"
touch "$AUTH_KEYS"
chown "$UPLOAD_USER":"$UPLOAD_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

echo "Configuring SSH for SFTP-only access..."

# Check if the Match block already exists
SSHD_CONFIG="/etc/ssh/sshd_config"
if grep -q "Match User $UPLOAD_USER" "$SSHD_CONFIG"; then
    echo "SSH config for '$UPLOAD_USER' already exists, skipping..."
else
    # Add SFTP-only configuration for the upload user
    cat >> "$SSHD_CONFIG" << EOF

# Allsky SFTP upload user - restricted access
# Added by setup-allsky-sftp.sh on $(date +%Y-%m-%d)
Match User $UPLOAD_USER
    ChrootDirectory $UPLOAD_DIR
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
    AllowAgentForwarding no
    PasswordAuthentication no
EOF
    echo "Added SSH configuration for '$UPLOAD_USER'"
fi

# Test SSH config
echo "Testing SSH configuration..."
if sshd -t; then
    echo "SSH configuration is valid."
else
    echo "ERROR: SSH configuration is invalid!"
    echo "Please check $SSHD_CONFIG and fix any errors."
    exit 1
fi

# Restart SSH to apply changes
echo "Restarting SSH service..."
systemctl restart sshd

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Upload directories created:"
echo "  - Images:     $IMAGES_DIR"
echo "  - Videos:     $VIDEOS_DIR"
echo "  - Keograms:   $KEYLOGS_DIR"
echo "  - Startrails: $STARTRAILS_DIR"
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. On your ALLSKY Pi, generate an SSH key pair:"
echo "   ssh-keygen -t ed25519 -f ~/.ssh/allsky_upload -N '' -C 'allsky-upload'"
echo ""
echo "2. Copy the public key to this collector:"
echo "   cat ~/.ssh/allsky_upload.pub | ssh $(whoami)@$(hostname -I | awk '{print $1}') \\"
echo "       'sudo tee -a $AUTH_KEYS'"
echo ""
echo "3. Test the connection from your Allsky Pi:"
echo "   sftp -i ~/.ssh/allsky_upload ${UPLOAD_USER}@$(hostname -I | awk '{print $1}')"
echo ""
echo "4. Configure Allsky to use SFTP (see ALLSKY_SFTP_SETUP.md for details)"
echo ""
echo "5. Update the collector's .env file:"
echo "   ALLSKY_IMAGE_PATH=$IMAGES_DIR/image.jpg"
echo ""
