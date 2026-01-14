#!/usr/bin/env python3
"""
Observatory Configurator - Web-based configuration tool for the Raspberry Pi collector.

Run with: python app.py
Access at: http://localhost:8080 or http://raspberrypi.local:8080
"""

import os
from functools import wraps

from flask import Flask, render_template, request, jsonify, redirect, url_for, Response

from utils import (
    load_env,
    save_env,
    mask_api_key,
    get_service_status,
    control_service,
    get_logs,
    test_api_connection,
    test_sqm_connection,
    test_weatherlink_connection,
    test_cloudwatcher_connection,
    test_allsky_image,
    BOM_RADAR_STATIONS,
    DEFAULTS,
)

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Optional password protection
CONFIGURATOR_PASSWORD = os.environ.get("CONFIGURATOR_PASSWORD", "")


def check_auth(password):
    """Check if password matches."""
    return password == CONFIGURATOR_PASSWORD


def authenticate():
    """Send 401 response for basic auth."""
    return Response(
        "Authentication required",
        401,
        {"WWW-Authenticate": 'Basic realm="Observatory Configurator"'},
    )


def requires_auth(f):
    """Decorator for password-protected routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not CONFIGURATOR_PASSWORD:
            return f(*args, **kwargs)

        auth = request.authorization
        if not auth or not check_auth(auth.password):
            return authenticate()
        return f(*args, **kwargs)

    return decorated


# =============================================================================
# PAGE ROUTES
# =============================================================================


@app.route("/")
@requires_auth
def index():
    """Redirect to wizard if not configured, otherwise status."""
    config = load_env()
    if not config.get("API_KEY") or config.get("REMOTE_API_URL") == DEFAULTS["REMOTE_API_URL"]:
        return redirect(url_for("wizard"))
    return redirect(url_for("status"))


@app.route("/wizard")
@requires_auth
def wizard():
    """Setup wizard page."""
    config = load_env()
    return render_template(
        "wizard.html",
        config=config,
        masked_key=mask_api_key(config.get("API_KEY", "")),
        radar_stations=BOM_RADAR_STATIONS,
    )


@app.route("/status")
@requires_auth
def status():
    """Status dashboard page."""
    config = load_env()
    service = get_service_status()
    return render_template(
        "status.html",
        config=config,
        service=service,
        masked_key=mask_api_key(config.get("API_KEY", "")),
    )


@app.route("/config")
@requires_auth
def config_page():
    """Full configuration editor page."""
    config = load_env()
    return render_template(
        "config.html",
        config=config,
        masked_key=mask_api_key(config.get("API_KEY", "")),
        radar_stations=BOM_RADAR_STATIONS,
        defaults=DEFAULTS,
    )


@app.route("/logs")
@requires_auth
def logs_page():
    """Log viewer page."""
    return render_template("logs.html")


# =============================================================================
# API ROUTES
# =============================================================================


@app.route("/api/status")
@requires_auth
def api_status():
    """Get current service status and configuration."""
    config = load_env()
    service = get_service_status()

    # Build multi-device status info
    sqm_devices = []
    davis_devices = []
    cloudwatcher_devices = []

    for i in range(1, 4):
        sqm_host = config.get(f"SQM_{i}_HOST", "")
        if sqm_host:
            sqm_devices.append({
                "slot": i,
                "host": sqm_host,
                "port": config.get(f"SQM_{i}_PORT", "10001"),
            })

        davis_host = config.get(f"DAVIS_{i}_HOST", "")
        if davis_host:
            davis_devices.append({
                "slot": i,
                "host": davis_host,
                "interval": config.get(f"DAVIS_{i}_INTERVAL", "30"),
            })

        cw_host = config.get(f"CLOUDWATCHER_{i}_HOST", "")
        if cw_host:
            cloudwatcher_devices.append({
                "slot": i,
                "host": cw_host,
                "interval": config.get(f"CLOUDWATCHER_{i}_INTERVAL", "30"),
            })

    return jsonify({
        "service": service,
        "config": {
            "api_url": config.get("REMOTE_API_URL", ""),
            "api_key_set": bool(config.get("API_KEY")),
            "sqm_devices": sqm_devices,
            "davis_devices": davis_devices,
            "cloudwatcher_devices": cloudwatcher_devices,
            "allsky_enabled": bool(config.get("ALLSKY_IMAGE_PATH") or config.get("ALLSKY_IMAGE_URL")),
            "bom_enabled": config.get("BOM_SATELLITE_ENABLED", "").lower() == "true",
            "push_interval": config.get("PUSH_INTERVAL", "60"),
        },
    })


@app.route("/api/config", methods=["GET"])
@requires_auth
def api_get_config():
    """Get current configuration (with masked API key)."""
    config = load_env()
    # Mask sensitive values
    safe_config = config.copy()
    safe_config["API_KEY"] = mask_api_key(config.get("API_KEY", ""))
    return jsonify(safe_config)


@app.route("/api/config", methods=["POST"])
@requires_auth
def api_save_config():
    """Save configuration."""
    try:
        data = request.get_json()

        # Load existing config to preserve API key if not changed
        existing = load_env()

        # If API key looks masked, keep the existing one
        if data.get("API_KEY", "").startswith("****"):
            data["API_KEY"] = existing.get("API_KEY", "")

        # Merge with existing config
        new_config = existing.copy()
        new_config.update(data)

        if save_env(new_config):
            return jsonify({"success": True, "message": "Configuration saved"})
        else:
            return jsonify({"success": False, "message": "Failed to save configuration"}), 500

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/api/test/api", methods=["POST"])
@requires_auth
def api_test_api():
    """Test Vercel API connection."""
    data = request.get_json()
    url = data.get("url", "")
    api_key = data.get("api_key", "")

    # If key is masked, use existing
    if api_key.startswith("****"):
        config = load_env()
        api_key = config.get("API_KEY", "")

    success, message, result = test_api_connection(url, api_key)
    return jsonify({
        "success": success,
        "message": message,
        "data": result,
    })


@app.route("/api/test/sqm", methods=["POST"])
@requires_auth
def api_test_sqm():
    """Test SQM-LE connection."""
    data = request.get_json()
    host = data.get("host", "")
    port = int(data.get("port", 10001))

    success, message, result = test_sqm_connection(host, port)
    return jsonify({
        "success": success,
        "message": message,
        "data": result,
    })


@app.route("/api/test/weatherlink", methods=["POST"])
@requires_auth
def api_test_weatherlink():
    """Test WeatherLink Live connection."""
    data = request.get_json()
    host = data.get("host", "")

    success, message, result = test_weatherlink_connection(host)
    return jsonify({
        "success": success,
        "message": message,
        "data": result,
    })


@app.route("/api/test/cloudwatcher", methods=["POST"])
@requires_auth
def api_test_cloudwatcher():
    """Test Cloudwatcher connection."""
    data = request.get_json()
    host = data.get("host", "")

    success, message, result = test_cloudwatcher_connection(host)
    return jsonify({
        "success": success,
        "message": message,
        "data": result,
    })


@app.route("/api/test/allsky", methods=["POST"])
@requires_auth
def api_test_allsky():
    """Test AllSky image availability."""
    data = request.get_json()
    path = data.get("path", "")
    url = data.get("url", "")

    success, message, result = test_allsky_image(path, url)
    return jsonify({
        "success": success,
        "message": message,
        "source": result,
    })


@app.route("/api/service/<action>", methods=["POST"])
@requires_auth
def api_service_control(action):
    """Control the collector service (start/stop/restart)."""
    if action not in ("start", "stop", "restart"):
        return jsonify({"success": False, "message": "Invalid action"}), 400

    success, message = control_service(action)
    return jsonify({
        "success": success,
        "message": message,
    })


@app.route("/api/logs")
@requires_auth
def api_logs():
    """Get recent log entries."""
    lines = request.args.get("lines", 100, type=int)
    level = request.args.get("level", "ALL")

    log_entries = get_logs(lines, level)
    return jsonify({
        "logs": log_entries,
        "count": len(log_entries),
    })


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("Observatory Configurator")
    print("=" * 60)
    print("Access at: http://localhost:8080")
    print("         or http://raspberrypi.local:8080")
    if CONFIGURATOR_PASSWORD:
        print("Password protection: ENABLED")
    else:
        print("Password protection: DISABLED")
        print("  Set CONFIGURATOR_PASSWORD env var to enable")
    print("=" * 60)

    app.run(host="0.0.0.0", port=8080, debug=False)
