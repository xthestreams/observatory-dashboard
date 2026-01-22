"""
Raspberry Pi Collector Integration Examples
Multi-Client Support for Announcements, Roof Status, and Camera Updates

Add these functions to raspberry-pi/collector.py
"""

import requests
import json
import time
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# ANNOUNCEMENTS (Message of the Day, Planned Outages, Maintenance)
# ═══════════════════════════════════════════════════════════════════════════════

def publish_announcement(
    client_slug: str,
    title: str,
    content: str,
    announcement_type: str = "info",
    priority: int = 0,
    is_motd: bool = False,
    expires_hours: int = None,
) -> bool:
    """
    Publish an announcement to a client dashboard.

    Args:
        client_slug: Client identifier (e.g., "springbrook")
        title: Announcement title
        content: HTML content (safe to use <p>, <strong>, <a>, etc.)
        announcement_type: "info", "warning", "outage", "maintenance", "alert"
        priority: Display priority (higher = more prominent)
        is_motd: Set as Message of the Day (only one per client)
        expires_hours: Hours until announcement expires (None = no expiration)

    Returns:
        True if successful, False otherwise
    """
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if not api_key:
        logger.warning("No API key configured, skipping announcement")
        return False

    payload = {
        "title": title,
        "content": content,
        "type": announcement_type,
        "priority": priority,
        "is_motd": is_motd,
        "created_by": "pi-collector",
    }

    if expires_hours:
        expires_at = (datetime.utcnow() + timedelta(hours=expires_hours)).isoformat()
        payload["expires_at"] = expires_at

    try:
        response = requests.post(
            f"{api_url}/clients/{client_slug}/announcements",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )

        if response.ok:
            logger.info(f"Announcement published to {client_slug}: {title}")
            return True
        else:
            logger.warning(
                f"Failed to publish announcement: {response.status_code} - {response.text}"
            )
            return False

    except Exception as e:
        logger.error(f"Error publishing announcement: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# EXAMPLES: Common Announcements
# ═══════════════════════════════════════════════════════════════════════════════

def announce_startup(client_slug: str):
    """Announce that the observatory is online."""
    publish_announcement(
        client_slug=client_slug,
        title="Observatory Online",
        content="<p>Observatory is online and monitoring conditions.</p>",
        announcement_type="info",
        priority=1,
        expires_hours=24,
    )


def announce_planned_maintenance(
    client_slug: str, start_time: str, duration_hours: int, details: str
):
    """Announce scheduled maintenance."""
    publish_announcement(
        client_slug=client_slug,
        title=f"Planned Maintenance - {start_time}",
        content=f"""
        <p><strong>Scheduled maintenance:</strong></p>
        <p>{details}</p>
        <p>Expected duration: {duration_hours} hours</p>
        <p>Observatory will be offline during this time.</p>
        """,
        announcement_type="maintenance",
        priority=2,
        is_motd=True,
        expires_hours=duration_hours + 1,
    )


def announce_power_outage(client_slug: str, duration_estimate: int = None):
    """Announce a power outage."""
    duration_text = (
        f"Estimated duration: {duration_estimate} minutes."
        if duration_estimate
        else "Duration unknown."
    )

    publish_announcement(
        client_slug=client_slug,
        title="⚠️ Power Outage",
        content=f"""
        <p><strong>Power outage detected!</strong></p>
        <p>{duration_text}</p>
        <p>Observatory is on battery backup. Normal operations will resume when power is restored.</p>
        """,
        announcement_type="alert",
        priority=3,
        is_motd=True,
    )


def announce_poor_conditions(client_slug: str, reason: str):
    """Announce poor observing conditions."""
    publish_announcement(
        client_slug=client_slug,
        title="⛅ Poor Observing Conditions",
        content=f"""
        <p><strong>Current conditions are unfavorable for observations.</strong></p>
        <p>Reason: {reason}</p>
        <p>Check the dashboard for current weather details.</p>
        """,
        announcement_type="warning",
        priority=1,
        expires_hours=4,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ROOF STATUS TRACKING
# ═══════════════════════════════════════════════════════════════════════════════

def update_roof_status(
    client_slug: str,
    state: str,
    position: int = None,
    error_message: str = None,
    is_operational: bool = True,
) -> bool:
    """
    Update roof open/closed status for a client.

    Args:
        client_slug: Client identifier (e.g., "springbrook")
        state: "open", "closed", "opening", "closing", or "unknown"
        position: Percentage open (0-100), or None if unavailable
        error_message: If an error occurred during operation
        is_operational: Whether roof can be commanded

    Returns:
        True if successful, False otherwise
    """
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if not api_key:
        logger.warning("No API key configured, skipping roof status update")
        return False

    payload = {
        "state": state,
        "is_operational": is_operational,
    }

    if position is not None:
        payload["position"] = position

    if error_message:
        payload["error_message"] = error_message

    try:
        response = requests.put(
            f"{api_url}/clients/{client_slug}/roof",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )

        if response.ok:
            logger.debug(f"Roof status updated for {client_slug}: {state}")
            return True
        else:
            logger.warning(
                f"Failed to update roof status: {response.status_code} - {response.text}"
            )
            return False

    except Exception as e:
        logger.error(f"Error updating roof status: {e}")
        return False


def send_roof_command(client_slug: str, command: str, issued_by: str = "system") -> bool:
    """
    Send a command to open/close/stop the roof.

    Args:
        client_slug: Client identifier
        command: "open", "close", or "stop"
        issued_by: Who issued the command (for audit log)

    Returns:
        True if command was accepted
    """
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if command not in ["open", "close", "stop"]:
        logger.error(f"Invalid roof command: {command}")
        return False

    if not api_key:
        logger.warning("No API key configured, skipping roof command")
        return False

    payload = {
        "command": command,
        "issued_by": issued_by,
    }

    try:
        response = requests.post(
            f"{api_url}/clients/{client_slug}/roof/command",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )

        if response.ok:
            logger.info(f"Roof command sent: {command}")
            return True
        else:
            logger.warning(
                f"Failed to send roof command: {response.status_code} - {response.text}"
            )
            return False

    except Exception as e:
        logger.error(f"Error sending roof command: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# ROOF STATUS MONITORING (GPIO-based example)
# ═══════════════════════════════════════════════════════════════════════════════

import RPi.GPIO as GPIO

# Configure GPIO pins
ROOF_OPEN_PIN = 17  # Limit switch for roof open
ROOF_CLOSED_PIN = 27  # Limit switch for roof closed
ROOF_MOVING_PIN = 22  # Status pin indicating roof is moving

GPIO.setmode(GPIO.BCM)
GPIO.setup(ROOF_OPEN_PIN, GPIO.IN)
GPIO.setup(ROOF_CLOSED_PIN, GPIO.IN)
GPIO.setup(ROOF_MOVING_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)


def read_roof_state() -> tuple[str, int | None]:
    """
    Read current roof state from GPIO pins.

    Returns:
        (state, position) where:
        - state: "open", "closed", "opening", "closing", or "unknown"
        - position: 0-100 percent, or None if unavailable
    """
    open_switch = GPIO.input(ROOF_OPEN_PIN)
    closed_switch = GPIO.input(ROOF_CLOSED_PIN)
    moving = not GPIO.input(ROOF_MOVING_PIN)  # Low = moving

    if moving:
        # Roof is in motion, determine direction from previous state
        # In production, track last state to determine if opening or closing
        if open_switch and not closed_switch:
            return "closing", 99
        elif closed_switch and not open_switch:
            return "opening", 1
        else:
            return "unknown", 50  # Indeterminate state

    if open_switch and not closed_switch:
        return "open", 100
    elif closed_switch and not open_switch:
        return "closed", 0
    else:
        return "unknown", None


def roof_monitor_thread(client_slug: str, interval: int = 10):
    """
    Monitor roof status continuously and push updates.

    Args:
        client_slug: Client to report status for
        interval: Seconds between checks
    """
    logger.info(f"Starting roof monitor for {client_slug}")
    last_state = None

    while True:
        try:
            state, position = read_roof_state()

            # Only push if state changed
            if state != last_state:
                update_roof_status(
                    client_slug=client_slug,
                    state=state,
                    position=position,
                    is_operational=True,
                )
                last_state = state

        except Exception as e:
            logger.error(f"Error reading roof state: {e}")
            update_roof_status(
                client_slug=client_slug,
                state="unknown",
                error_message=str(e),
                is_operational=False,
            )

        time.sleep(interval)


# ─────────────────────────────────────────────────────────────────────────────
# Startup code
# ─────────────────────────────────────────────────────────────────────────────

# Start roof monitoring in background thread
import threading

client_slug = os.getenv("CLIENT_SLUG", "springbrook")
if os.getenv("ROOF_MONITORING_ENABLED", "false").lower() == "true":
    roof_thread = threading.Thread(
        target=roof_monitor_thread,
        args=(client_slug, int(os.getenv("ROOF_CHECK_INTERVAL", "10"))),
        daemon=True,
    )
    roof_thread.start()
    logger.info("Roof monitoring started")


# ═══════════════════════════════════════════════════════════════════════════════
# INTEGRATION WITH MAIN PUSH LOOP
# ═══════════════════════════════════════════════════════════════════════════════

def check_and_announce_conditions(client_slug: str, current_conditions: dict):
    """
    Check conditions and auto-publish announcements if needed.

    Called from main push loop with current weather data.
    """
    # Example: Announce if conditions become unfavorable
    cloud_condition = current_conditions.get("cloud_condition", "Unknown")
    wind_speed = current_conditions.get("wind_speed", 0)

    if cloud_condition == "VeryCloudy":
        announce_poor_conditions(client_slug, "Heavy cloud cover detected")

    if wind_speed and wind_speed > 20:
        announce_poor_conditions(client_slug, f"High winds: {wind_speed} km/h")


# ═══════════════════════════════════════════════════════════════════════════════
# EXAMPLE: Using in main collector loop
# ═══════════════════════════════════════════════════════════════════════════════

"""
In your main push_data() function:

def push_data():
    while True:
        # Existing data collection...
        combined_data = data_store.get_combined()
        
        # NEW: Check conditions and announce issues
        check_and_announce_conditions("springbrook", combined_data)
        
        # Push to Vercel
        requests.post(f"{api_url}/ingest/data", json=combined_data, ...)
        
        time.sleep(push_interval)
"""

# ═══════════════════════════════════════════════════════════════════════════════
# CRON-LIKE EXAMPLES (if running on systemd with timers)
# ═══════════════════════════════════════════════════════════════════════════════

def daily_status_announcement():
    """
    Example: Run daily (via systemd timer or cron) to post status.
    """
    import socket

    hostname = socket.gethostname()
    uptime_seconds = int(open("/proc/uptime").read().split()[0])
    uptime_hours = uptime_seconds / 3600

    publish_announcement(
        "springbrook",
        "Daily Status Report",
        f"""
        <p><strong>Observatory Status - {datetime.now().strftime('%Y-%m-%d')}</strong></p>
        <ul>
            <li>System: {hostname}</li>
            <li>Uptime: {uptime_hours:.1f} hours</li>
            <li>Status: Operational</li>
        </ul>
        """,
        announcement_type="info",
        priority=0,
        expires_hours=24,
    )


def weekly_maintenance_check():
    """
    Example: Run weekly to announce if maintenance is scheduled.
    """
    # In production, check a database or calendar service
    # For now, just an example
    from datetime import datetime, timedelta

    next_maintenance = datetime(2026, 1, 25, 9, 0)  # Example date
    days_until = (next_maintenance - datetime.now()).days

    if 0 <= days_until <= 3:  # Announce if within 3 days
        publish_announcement(
            "springbrook",
            "Maintenance Reminder",
            f"""
            <p>Scheduled maintenance in {days_until} days.</p>
            <p>Date/Time: {next_maintenance.strftime('%Y-%m-%d %H:%M')}</p>
            """,
            announcement_type="maintenance",
            priority=2,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# ENVIRONMENT VARIABLES
# Add to .env on Pi
# ═══════════════════════════════════════════════════════════════════════════════

"""
# Client configuration
CLIENT_SLUG=springbrook

# Roof monitoring
ROOF_MONITORING_ENABLED=true
ROOF_CHECK_INTERVAL=10  # seconds

# Optional: Send roof status via MQTT instead of HTTP
ROOF_MQTT_TOPIC=roof/status  # If using MQTT topic instead
"""
