# Allsky SFTP Upload Setup Guide

This guide explains how to configure secure SFTP uploads from your Allsky camera to the observatory collector Pi.

## Overview

Instead of the collector pulling images from the Allsky camera via HTTP, we configure Allsky to push images directly to the collector using SFTP. This approach:

- **Is more secure**: Uses SSH encryption and key-based authentication
- **Is more reliable**: Push-based delivery ensures images arrive even during network instability
- **Reduces latency**: Images are available immediately after capture
- **Supports all Allsky outputs**: Images, videos, keograms, startrails, and timelapse

## Architecture

```
┌─────────────────┐      SFTP (port 22)      ┌──────────────────┐
│   Allsky Pi     │ ────────────────────────▶│   Collector Pi   │
│                 │   (encrypted, key-auth)  │                  │
│ - Camera        │                          │ - Receives files │
│ - Processing    │                          │ - Pushes to API  │
│ - Uploads       │                          │ - Dashboard      │
└─────────────────┘                          └──────────────────┘
```

## Security Features

1. **Dedicated upload user** - Cannot log in or run commands
2. **Chroot jail** - Restricted to upload directory only
3. **SSH key authentication** - No passwords, no brute force attacks
4. **No shell access** - ForceCommand limits to SFTP only
5. **No port forwarding** - Prevents tunneling attacks

---

## Setup Instructions

### Step 1: Configure the Collector Pi (Manual Setup)

SSH into your collector Pi and run the following commands:

```bash
# Create the dedicated user with no shell and home in /var/lib/allsky-uploads
sudo useradd -r -s /usr/sbin/nologin -d /var/lib/allsky-uploads -m allsky-upload

# Create upload directories
sudo mkdir -p /var/lib/allsky-uploads/{images,videos,keograms,startrails,allsky}
sudo chown -R allsky-upload:allsky-upload /var/lib/allsky-uploads
sudo chmod 755 /var/lib/allsky-uploads

# Create .ssh directory for the user
sudo mkdir -p /var/lib/allsky-uploads/.ssh
sudo chmod 700 /var/lib/allsky-uploads/.ssh
sudo touch /var/lib/allsky-uploads/.ssh/authorized_keys
sudo chmod 600 /var/lib/allsky-uploads/.ssh/authorized_keys
sudo chown -R allsky-upload:allsky-upload /var/lib/allsky-uploads/.ssh

# Set correct ownership for chroot (root must own the chroot root)
sudo chown root:root /var/lib/allsky-uploads
sudo chmod 755 /var/lib/allsky-uploads

# Ensure subdirectories are writable by the user
sudo chown allsky-upload:allsky-upload /var/lib/allsky-uploads/{images,videos,keograms,startrails,allsky}
sudo chmod 755 /var/lib/allsky-uploads/{images,videos,keograms,startrails,allsky}
```

### Step 2: Configure SSH for SFTP-only Access

Add the following to the **end** of `/etc/ssh/sshd_config`:

```bash
sudo nano /etc/ssh/sshd_config
```

Add at the bottom:

```
# Allsky SFTP Upload Configuration
Match User allsky-upload
    ChrootDirectory /var/lib/allsky-uploads
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    PasswordAuthentication no
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

### Step 3: Generate SSH Keys on Allsky Pi

SSH into your Allsky Pi and generate a dedicated key pair:

```bash
# Generate a new SSH key pair (no passphrase for automated uploads)
ssh-keygen -t ed25519 -f ~/.ssh/allsky_upload -N '' -C 'allsky-upload'

# View the public key (you'll need this)
cat ~/.ssh/allsky_upload.pub
```

### Step 4: Add Public Key to Collector

Copy the public key to the collector's authorized_keys:

```bash
# Option A: If you can SSH from Allsky to collector as your regular user
cat ~/.ssh/allsky_upload.pub | ssh YOUR_USER@COLLECTOR_IP \
    'sudo tee -a /var/lib/allsky-uploads/.ssh/authorized_keys'

# Option B: Manually copy the key
# 1. Copy the output of: cat ~/.ssh/allsky_upload.pub
# 2. SSH to collector as your regular user
# 3. Run: sudo nano /var/lib/allsky-uploads/.ssh/authorized_keys
# 4. Paste the key and save

# Ensure correct ownership after adding the key
ssh YOUR_USER@COLLECTOR_IP 'sudo chown allsky-upload:allsky-upload /var/lib/allsky-uploads/.ssh/authorized_keys'
```

### Step 5: Test the SFTP Connection

From your Allsky Pi, test the connection:

```bash
# Test SFTP connection
sftp -i ~/.ssh/allsky_upload allsky-upload@COLLECTOR_IP

# You should see:
# Connected to COLLECTOR_IP.
# sftp>

# Try listing and uploading:
sftp> ls
sftp> cd images
sftp> put /tmp/test.txt
sftp> ls
sftp> rm test.txt
sftp> quit
```

If it works, you'll be in a restricted environment with only the upload directories visible.

### Step 6: Configure lftp for SSH Key Authentication

Allsky uses `lftp` for SFTP uploads. Unlike the `sftp` command, lftp doesn't automatically use SSH keys from `~/.ssh/`. You must configure it explicitly.

**Create the lftp configuration file:**

```bash
mkdir -p ~/.lftp
nano ~/.lftp/rc
```

Add this line:
```
set sftp:connect-program "ssh -a -x -i ~/.ssh/allsky_upload"
```

**Test lftp with the key:**

```bash
lftp -e "ls; quit" sftp://allsky-upload@COLLECTOR_IP
```

You should see the upload directories (images, videos, etc.) without being prompted for a password.

### Step 7: Configure Allsky Uploads

Edit your Allsky configuration to use SFTP:

#### Option A: Using Allsky Web UI

1. Go to Allsky Web Interface → Settings
2. Navigate to the "Uploads" section
3. Configure:
   - **Protocol**: `sftp`
   - **Server**: `COLLECTOR_IP` (e.g., `192.168.1.81`)
   - **Username**: `allsky-upload`
   - **Remote Directory**: `/images` (the chroot makes this relative)
   - **Password**: Leave empty (key-based auth via lftp config)

#### Option B: Using ftp-settings.sh

Edit the Allsky FTP/upload settings file:

```bash
# On Allsky Pi
nano ~/allsky/config/ftp-settings.sh
```

Set these values:

```bash
# Protocol: scp, sftp, or s3
PROTOCOL="sftp"

# Server address (collector Pi IP)
REMOTE_HOST="192.168.1.81"

# Username
REMOTE_USER="allsky-upload"

# SSH private key path
SSH_KEY_FILE="/home/pi/.ssh/allsky_upload"

# Remote directory (relative to chroot)
IMAGE_DIR="/images"

# For videos/keograms/startrails, use their respective directories:
# VIDEO_DIR="/videos"
# KEOGRAM_DIR="/keograms"
# STARTRAILS_DIR="/startrails"
```

#### Option C: Using Allsky configuration file

Edit `~/allsky/config/config.sh`:

```bash
# Upload settings
UPLOAD_PROTOCOL="sftp"
UPLOAD_SERVER="192.168.1.81"
UPLOAD_USER="allsky-upload"
UPLOAD_SSH_KEY="/home/pi/.ssh/allsky_upload"
UPLOAD_IMAGE_DIR="/images"
```

### Step 8: Update Collector Configuration

Update the collector's `.env` to read from the SFTP upload directory:

```bash
# On collector Pi, edit .env
nano ~/observatory-collector/.env
```

Change the Allsky image path:

```bash
# Before (HTTP fallback):
# ALLSKY_IMAGE_PATH=/home/pi/allsky/tmp/image.jpg
# ALLSKY_IMAGE_URL=http://192.168.10.200/current/tmp/image.jpg

# After (SFTP upload directory):
ALLSKY_IMAGE_PATH=/var/lib/allsky-uploads/images/image.jpg
ALLSKY_IMAGE_URL=
```

Restart the collector:

```bash
sudo systemctl restart observatory-collector
```

### Step 9: Test End-to-End

1. **Trigger an Allsky upload** (or wait for the next automatic one)
2. **Check the collector logs**:
   ```bash
   sudo journalctl -u observatory-collector -f | grep -i allsky
   ```
3. **Verify on the dashboard** that the AllSky image is updating

---

## Troubleshooting

### SFTP Connection Refused

```
ssh: connect to host X.X.X.X port 22: Connection refused
```

- Ensure SSH is running on the collector: `sudo systemctl status sshd`
- Check firewall: `sudo ufw status` (port 22 should be allowed)

### Permission Denied (publickey)

```
Permission denied (publickey).
```

**Most common cause**: The user's home directory doesn't match where the authorized_keys file is stored.

1. **Verify the user's home directory**:
   ```bash
   getent passwd allsky-upload
   # Should show: allsky-upload:x:...:...:/var/lib/allsky-uploads:/usr/sbin/nologin
   ```

2. **If home directory is wrong (e.g., /home/allsky-upload), fix it**:
   ```bash
   sudo usermod -d /var/lib/allsky-uploads allsky-upload
   ```

3. **Verify the public key was added correctly**:
   ```bash
   sudo cat /var/lib/allsky-uploads/.ssh/authorized_keys
   ```

4. **Check key permissions**:
   ```bash
   sudo ls -la /var/lib/allsky-uploads/.ssh/
   # Should show:
   # drwx------ allsky-upload allsky-upload .ssh
   # -rw------- allsky-upload allsky-upload authorized_keys
   ```

5. **Ensure you're using the correct private key**:
   ```bash
   sftp -i ~/.ssh/allsky_upload allsky-upload@COLLECTOR_IP
   ```

### Upload Works but Collector Doesn't See Files

- Check the file path in collector's `.env`:
  ```bash
  grep ALLSKY ~/observatory-collector/.env
  ```
- Verify files are being uploaded:
  ```bash
  ls -la /var/lib/allsky-uploads/images/
  ```
- Check collector logs for errors:
  ```bash
  sudo journalctl -u observatory-collector | grep -i allsky
  ```

### Allsky Upload Errors

Run Allsky's upload test:

```bash
cd ~/allsky
./scripts/testUpload.sh --server
```

Check Allsky logs:

```bash
tail -f ~/allsky/log/allsky.log | grep -i upload
```

### Verbose SFTP Debugging

For more detailed connection debugging:

```bash
sftp -vvv -i ~/.ssh/allsky_upload allsky-upload@COLLECTOR_IP
```

---

## File Naming Conventions

Allsky uploads files with specific names. Configure your collector to look for:

| File Type | Default Name | Collector Setting |
|-----------|--------------|-------------------|
| Current image | `image.jpg` | `ALLSKY_IMAGE_PATH` |
| Timelapse | `allsky-YYYYMMDD.mp4` | N/A (stored only) |
| Keogram | `keogram-YYYYMMDD.jpg` | N/A (stored only) |
| Startrails | `startrails-YYYYMMDD.jpg` | N/A (stored only) |

---

## Security Considerations

### What the allsky-upload user CAN do:
- Upload files via SFTP to the designated directories
- Overwrite existing files in those directories
- List files in the upload directories

### What the allsky-upload user CANNOT do:
- Log in interactively (no shell)
- Execute commands on the collector
- Access files outside the chroot jail
- Forward ports or create tunnels
- Use password authentication (keys only)

### Rotating SSH Keys

To rotate the SSH key (recommended annually):

1. Generate a new key on Allsky Pi:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/allsky_upload_new -N ''
   ```

2. Add the new public key to collector:
   ```bash
   cat ~/.ssh/allsky_upload_new.pub | ssh user@collector \
       'sudo tee -a /var/lib/allsky-uploads/.ssh/authorized_keys'
   ```

3. Update Allsky config to use the new key

4. Test uploads work with new key

5. Remove the old key from collector's authorized_keys

---

## Quick Reference

| Item | Value |
|------|-------|
| Collector user | `allsky-upload` |
| User home directory | `/var/lib/allsky-uploads` |
| Upload directory (chroot root) | `/var/lib/allsky-uploads/` |
| Images subdirectory | `/var/lib/allsky-uploads/images/` |
| SSH key (Allsky side) | `~/.ssh/allsky_upload` |
| lftp config (Allsky side) | `~/.lftp/rc` |
| Authorized keys (Collector) | `/var/lib/allsky-uploads/.ssh/authorized_keys` |
| SSH config | `/etc/ssh/sshd_config` |

---

## Complete Setup Checklist

- [ ] Created `allsky-upload` user with home `/var/lib/allsky-uploads`
- [ ] Created upload directories (images, videos, keograms, startrails, allsky)
- [ ] Set correct ownership: root owns chroot root, user owns subdirectories
- [ ] Created `.ssh/authorized_keys` with correct permissions (700/600)
- [ ] Added SSH config for SFTP-only access
- [ ] Restarted sshd
- [ ] Generated SSH key on Allsky Pi
- [ ] Added public key to collector's authorized_keys
- [ ] Tested SFTP connection from Allsky Pi (`sftp -i`)
- [ ] Created `~/.lftp/rc` with SSH key configuration
- [ ] Tested lftp connection from Allsky Pi
- [ ] Configured Allsky upload settings
- [ ] Updated collector `.env` with new image path
- [ ] Verified end-to-end uploads working
