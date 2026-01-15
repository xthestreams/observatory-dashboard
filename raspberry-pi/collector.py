#!/usr/bin/env python3
"""
Observatory Data Collector for Raspberry Pi

Collects data from:
- MQTT broker (Davis weather via weewx, LoRa sensors)
- Serial devices (AAG Cloudwatcher, Unihedron SQM)
- AllSky camera images

Pushes to remote Vercel/Supabase API

Multi-instrument support:
- Each data source can be configured with its own instrument_code
- Data is tagged with instrument_code for server-side aggregation
- Unknown instrument_codes are auto-registered on the server

Setup:
    pip install -r requirements.txt
    cp .env.example .env
    # Edit .env with your settings
    python3 collector.py
"""

import os
import sys
import json
import time
import threading
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

import socket

import paho.mqtt.client as mqtt
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

def get_device_configs(device_type: str, max_slots: int = 3) -> list:
    """
    Get configured devices for a given type.
    Returns list of dicts with host, port/interval, and slot number.
    Only returns slots where host is configured (non-empty).
    """
    devices = []
    for slot in range(1, max_slots + 1):
        host = os.getenv(f"{device_type}_{slot}_HOST", "")
        if host:  # Only include if host is configured
            device = {"host": host, "slot": slot}
            # Add port for SQM
            if device_type == "SQM":
                device["port"] = int(os.getenv(f"{device_type}_{slot}_PORT", "10001"))
            # Add interval for Davis and Cloudwatcher
            if device_type in ("DAVIS", "CLOUDWATCHER"):
                device["interval"] = int(os.getenv(f"{device_type}_{slot}_INTERVAL", "30"))
            devices.append(device)
    return devices


CONFIG = {
    "remote_api": os.getenv("REMOTE_API_URL", "https://your-site.vercel.app/api/ingest"),
    "api_key": os.getenv("API_KEY", ""),
    "mqtt_broker": os.getenv("MQTT_BROKER", "localhost"),
    "mqtt_port": int(os.getenv("MQTT_PORT", "1883")),
    "allsky_image_path": os.getenv("ALLSKY_IMAGE_PATH", "/home/pi/allsky/tmp/image.jpg"),
    "allsky_image_url": os.getenv("ALLSKY_IMAGE_URL", ""),  # Fallback URL if file not found
    "push_interval": int(os.getenv("PUSH_INTERVAL", "60")),
    "bom_satellite_enabled": os.getenv("BOM_SATELLITE_ENABLED", "true").lower() == "true",
    "bom_satellite_interval": int(os.getenv("BOM_SATELLITE_INTERVAL", "600")),
    "bom_radar_station": os.getenv("BOM_RADAR_STATION", ""),  # e.g., "71" for Sydney
    "log_level": os.getenv("LOG_LEVEL", "INFO"),
    # Multi-device configurations (up to 3 of each type)
    "sqm_devices": get_device_configs("SQM"),
    "davis_devices": get_device_configs("DAVIS"),
    "cloudwatcher_devices": get_device_configs("CLOUDWATCHER"),
    # Legacy single-device codes for MQTT sources
    "instrument_code_mqtt_weather": os.getenv("INSTRUMENT_CODE_MQTT_WEATHER", "wx-mqtt"),
    "instrument_code_allsky": os.getenv("INSTRUMENT_CODE_ALLSKY", "allsky-main"),
}

# Logging setup
logging.basicConfig(
    level=getattr(logging, CONFIG["log_level"]),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("observatory-collector")


# ═══════════════════════════════════════════════════════════════════════════════
# INSTRUMENT HEALTH TRACKER
# ═══════════════════════════════════════════════════════════════════════════════

class InstrumentHealthTracker:
    """
    Tracks success/failure rate for each instrument over a sliding window.

    Health status thresholds:
    - HEALTHY: < 20% failure rate (default, not explicitly sent)
    - DEGRADED: 20-80% failure rate
    - OFFLINE: > 80% failure rate

    Requires MIN_READINGS before reporting degraded/offline status.
    This prevents false alarms on startup or after restart.
    """

    WINDOW_SIZE = 10  # Track last 10 readings
    MIN_READINGS = 3  # Need at least 3 readings before reporting problems
    DEGRADED_THRESHOLD = 0.2  # 20% failures = degraded
    OFFLINE_THRESHOLD = 0.8   # 80% failures = offline

    def __init__(self):
        self._history: Dict[str, list] = {}  # code -> list of booleans (True=success)
        self._lock = threading.Lock()

    def record_success(self, instrument_code: str) -> None:
        """Record a successful reading for an instrument."""
        with self._lock:
            if instrument_code not in self._history:
                self._history[instrument_code] = []
            self._history[instrument_code].append(True)
            # Keep only last WINDOW_SIZE readings
            self._history[instrument_code] = self._history[instrument_code][-self.WINDOW_SIZE:]

    def record_failure(self, instrument_code: str) -> None:
        """Record a failed reading for an instrument."""
        with self._lock:
            if instrument_code not in self._history:
                self._history[instrument_code] = []
            self._history[instrument_code].append(False)
            # Keep only last WINDOW_SIZE readings
            self._history[instrument_code] = self._history[instrument_code][-self.WINDOW_SIZE:]

    def get_status(self, instrument_code: str) -> str:
        """
        Get health status for an instrument.
        Returns: "HEALTHY", "DEGRADED", or "OFFLINE"

        Requires MIN_READINGS before reporting problems - this gives
        instruments time to establish a pattern after startup.
        """
        with self._lock:
            history = self._history.get(instrument_code, [])

            # Not enough data yet - assume healthy (grace period)
            if len(history) < self.MIN_READINGS:
                return "HEALTHY"

            failure_count = sum(1 for success in history if not success)
            failure_rate = failure_count / len(history)

            if failure_rate >= self.OFFLINE_THRESHOLD:
                return "OFFLINE"
            elif failure_rate >= self.DEGRADED_THRESHOLD:
                return "DEGRADED"
            else:
                return "HEALTHY"

    def get_all_statuses(self) -> Dict[str, str]:
        """Get health status for all tracked instruments."""
        with self._lock:
            return {code: self.get_status(code) for code in self._history.keys()}

    def get_failure_rate(self, instrument_code: str) -> float:
        """Get failure rate for an instrument (0.0 to 1.0)."""
        with self._lock:
            history = self._history.get(instrument_code, [])
            if not history:
                return 0.0
            failure_count = sum(1 for success in history if not success)
            return failure_count / len(history)


# Global health tracker
health_tracker = InstrumentHealthTracker()


# ═══════════════════════════════════════════════════════════════════════════════
# MULTI-INSTRUMENT DATA STORE
# ═══════════════════════════════════════════════════════════════════════════════

class MultiInstrumentDataStore:
    """Thread-safe store for multiple instrument readings."""

    def __init__(self):
        self._instruments: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def update(self, instrument_code: str, **kwargs) -> None:
        """Update readings for a specific instrument."""
        with self._lock:
            if instrument_code not in self._instruments:
                self._instruments[instrument_code] = {}
            self._instruments[instrument_code].update(kwargs)
            self._instruments[instrument_code]["timestamp"] = datetime.utcnow().isoformat()

    def get(self, instrument_code: str) -> Dict[str, Any]:
        """Get readings for a specific instrument."""
        with self._lock:
            return self._instruments.get(instrument_code, {}).copy()

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Get all instrument readings."""
        with self._lock:
            return {k: v.copy() for k, v in self._instruments.items()}

    def get_combined(self) -> Dict[str, Any]:
        """Get combined readings from all instruments (legacy format)."""
        with self._lock:
            combined = {
                "timestamp": None,
                "temperature": None,
                "humidity": None,
                "pressure": None,
                "dewpoint": None,
                "wind_speed": None,
                "wind_gust": None,
                "wind_direction": None,
                "rain_rate": None,
                "cloud_condition": "Unknown",
                "rain_condition": "Unknown",
                "wind_condition": "Unknown",
                "day_condition": "Unknown",
                "sky_temp": None,
                "ambient_temp": None,
                "sky_quality": None,
                "sqm_temperature": None,
                "lora_sensors": {},
            }

            # Merge all instrument data (later values overwrite earlier)
            for instrument_data in self._instruments.values():
                for key, value in instrument_data.items():
                    if key == "lora_sensors" and isinstance(value, dict):
                        combined["lora_sensors"].update(value)
                    elif value is not None and key in combined:
                        combined[key] = value

            return combined


# Global data store
data_store = MultiInstrumentDataStore()


# ═══════════════════════════════════════════════════════════════════════════════
# MQTT HANDLER (Davis via weewx, LoRa sensors)
# ═══════════════════════════════════════════════════════════════════════════════

def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("Connected to MQTT broker")
        client.subscribe("weather/#")
        client.subscribe("weewx/#")
        client.subscribe("lora/#")
        client.subscribe("cloudwatcher/#")
        client.subscribe("aag/#")
    else:
        logger.error(f"MQTT connection failed with code {rc}")


def on_mqtt_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        logger.debug(f"MQTT: {topic} -> {payload}")

        if "weewx" in topic or "weather" in topic:
            instrument_code = CONFIG["instrument_code_mqtt_weather"]
            updates = {}
            field_map = {
                "outTemp": "temperature",
                "outHumidity": "humidity",
                "barometer": "pressure",
                "dewpoint": "dewpoint",
                "windSpeed": "wind_speed",
                "windGust": "wind_gust",
                "windDir": "wind_direction",
                "rainRate": "rain_rate",
            }

            for mqtt_field, our_field in field_map.items():
                if mqtt_field in payload:
                    value = payload[mqtt_field]
                    # Convert F to C if needed
                    if "Temp" in mqtt_field or mqtt_field == "dewpoint":
                        if value is not None and value > 50:
                            value = (value - 32) * 5 / 9
                    updates[our_field] = value

            if updates:
                data_store.update(instrument_code, **updates)

        elif "lora" in topic:
            # LoRa sensors are stored under the MQTT weather instrument
            sensor_id = payload.get("id", topic.split("/")[-1])
            current = data_store.get(CONFIG["instrument_code_mqtt_weather"])
            lora_sensors = current.get("lora_sensors", {})
            lora_sensors[sensor_id] = {
                **payload,
                "last_update": datetime.utcnow().isoformat(),
            }
            data_store.update(CONFIG["instrument_code_mqtt_weather"], lora_sensors=lora_sensors)

        elif "cloudwatcher" in topic or "aag" in topic:
            instrument_code = CONFIG["instrument_code_cloudwatcher"]
            updates = {}

            # Sky and ambient temperature
            sky_temp = payload.get("clouds")
            ambient_temp = payload.get("temp")

            if sky_temp is not None:
                updates["sky_temp"] = float(sky_temp)
            if ambient_temp is not None:
                updates["ambient_temp"] = float(ambient_temp)

            # Cloud condition
            clouds_safe = payload.get("cloudsSafe", "")
            if clouds_safe:
                if clouds_safe == "Safe":
                    updates["cloud_condition"] = "Clear"
                else:
                    updates["cloud_condition"] = "Cloudy"
            elif sky_temp is not None and ambient_temp is not None:
                updates["cloud_condition"] = classify_cloud_condition(float(sky_temp), float(ambient_temp))

            # Rain condition
            rain_safe = payload.get("rainSafe", "")
            rain_val = payload.get("rain")
            if rain_safe:
                updates["rain_condition"] = "Dry" if rain_safe == "Safe" else "Rain"
            elif rain_val is not None:
                updates["rain_condition"] = classify_rain_condition(int(rain_val))

            # Light/day condition
            light_safe = payload.get("lightSafe", "")
            light_mpsas = payload.get("lightmpsas")
            if light_safe:
                updates["day_condition"] = "Dark" if light_safe == "Safe" else "Light"
            elif light_mpsas is not None:
                if light_mpsas > 18:
                    updates["day_condition"] = "Dark"
                elif light_mpsas > 10:
                    updates["day_condition"] = "Light"
                else:
                    updates["day_condition"] = "VeryLight"

            # Wind condition
            wind_safe = payload.get("windSafe", "")
            wind_val = payload.get("wind")
            if wind_safe:
                updates["wind_condition"] = "Calm" if wind_safe == "Safe" else "Windy"
            elif wind_val is not None:
                updates["wind_condition"] = classify_wind_condition(float(wind_val))

            if updates:
                logger.info(f"Cloudwatcher MQTT [{instrument_code}]: {updates}")
                data_store.update(instrument_code, **updates)

    except json.JSONDecodeError:
        logger.warning(f"Invalid JSON on topic {msg.topic}")
    except Exception as e:
        logger.error(f"MQTT message handling error: {e}")


def start_mqtt() -> Optional[mqtt.Client]:
    try:
        client = mqtt.Client()
        client.on_connect = on_mqtt_connect
        client.on_message = on_mqtt_message
        client.connect(CONFIG["mqtt_broker"], CONFIG["mqtt_port"], 60)
        client.loop_start()
        logger.info(f"MQTT client started, connecting to {CONFIG['mqtt_broker']}")
        return client
    except Exception as e:
        logger.error(f"Failed to start MQTT client: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# CLOUDWATCHER READER
# ═══════════════════════════════════════════════════════════════════════════════

def classify_cloud_condition(sky_temp: float, ambient_temp: float) -> str:
    delta = sky_temp - ambient_temp
    if delta < -25:
        return "Clear"
    elif delta < -15:
        return "Cloudy"
    else:
        return "VeryCloudy"


def classify_wind_condition(wind_speed: Optional[float]) -> str:
    if wind_speed is None:
        return "Unknown"
    if wind_speed < 10:
        return "Calm"
    elif wind_speed < 30:
        return "Windy"
    else:
        return "VeryWindy"


def classify_rain_condition(rain_sensor: int) -> str:
    if rain_sensor > 2500:
        return "Dry"
    elif rain_sensor > 1500:
        return "Wet"
    else:
        return "Rain"


def classify_day_condition(light_sensor: int) -> str:
    if light_sensor < 10:
        return "Dark"
    elif light_sensor < 1000:
        return "Light"
    else:
        return "VeryLight"


# ═══════════════════════════════════════════════════════════════════════════════
# SQM READER (Multi-device support)
# ═══════════════════════════════════════════════════════════════════════════════

def get_sqm_serial(sock) -> Optional[str]:
    """
    Query SQM unit information to get serial number.
    Command 'ix' returns unit info including serial number.
    Response format: i,00000002,00000003,00000001,00000413
    The 5th field (index 4) is the serial number.
    """
    try:
        sock.sendall(b"ix")
        time.sleep(0.5)

        response = b""
        while not response.endswith(b"\n"):
            chunk = sock.recv(256)
            if not chunk:
                return None
            response += chunk

        response_str = response.decode("ascii", errors="ignore").strip()

        if response_str.startswith("i,"):
            parts = response_str.split(",")
            if len(parts) >= 5:
                serial = parts[4].strip().lstrip("0") or "0"
                return serial
    except Exception as e:
        logger.warning(f"Failed to get SQM serial: {e}")

    return None


def read_sqm_device(device_config: dict):
    """Read from a single SQM-LE device."""
    host = device_config["host"]
    port = device_config["port"]
    slot = device_config["slot"]

    # Initial instrument code based on IP (will be updated with serial if available)
    instrument_code = f"sqm-{host.replace('.', '-')}"
    serial_obtained = False

    logger.info(f"Starting SQM-LE reader slot {slot} on {host}:{port}")

    while True:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(10)
                sock.connect((host, port))
                logger.info(f"Connected to SQM-LE at {host}:{port}")

                # Try to get serial number on first successful connection
                if not serial_obtained:
                    serial = get_sqm_serial(sock)
                    if serial:
                        instrument_code = f"sqm-{serial}"
                        serial_obtained = True
                        logger.info(f"SQM at {host} identified as serial {serial}, code: {instrument_code}")
                    else:
                        logger.info(f"SQM at {host} using IP-based code: {instrument_code}")

                while True:
                    sock.sendall(b"rx")
                    time.sleep(0.5)

                    response = b""
                    while not response.endswith(b"\n"):
                        chunk = sock.recv(256)
                        if not chunk:
                            raise ConnectionError("Connection closed")
                        response += chunk

                    response_str = response.decode("ascii", errors="ignore").strip()

                    if response_str.startswith("r,"):
                        parts = response_str.split(",")
                        if len(parts) >= 2:
                            mag_str = parts[1].strip()
                            sqm_value = float(mag_str.replace("m", "").strip())

                            sqm_temp = None
                            if len(parts) >= 5:
                                temp_str = parts[4].strip()
                                if temp_str.endswith("C"):
                                    sqm_temp = float(temp_str.replace("C", "").strip())

                            data_store.update(
                                instrument_code,
                                sky_quality=sqm_value,
                                sqm_temperature=sqm_temp,
                            )
                            health_tracker.record_success(instrument_code)
                            logger.debug(f"SQM [{instrument_code}]: {sqm_value} mag/arcsec², temp={sqm_temp}°C")
                    else:
                        # Invalid response format
                        health_tracker.record_failure(instrument_code)
                        logger.warning(f"SQM [{instrument_code}]: invalid response: {response_str[:50]}")

                    time.sleep(60)

        except (socket.error, ConnectionError) as e:
            logger.error(f"SQM {host} connection error: {e}")
            health_tracker.record_failure(instrument_code)
            time.sleep(60)
        except Exception as e:
            logger.error(f"SQM {host} error: {e}")
            health_tracker.record_failure(instrument_code)
            time.sleep(60)


# ═══════════════════════════════════════════════════════════════════════════════
# WEATHERLINK LIVE READER (Multi-device support)
# ═══════════════════════════════════════════════════════════════════════════════

def fahrenheit_to_celsius(f: float) -> float:
    """Convert Fahrenheit to Celsius."""
    return (f - 32) * 5 / 9


def inches_to_hpa(inches: float) -> float:
    """Convert inches of mercury to hectopascals."""
    return inches * 33.8639


def get_weatherlink_lsid(host: str) -> Optional[str]:
    """
    Query WeatherLink Live to get Logical Sensor ID (lsid).
    The lsid uniquely identifies each sensor suite.
    """
    try:
        url = f"http://{host}/v1/current_conditions"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        conditions = data.get("data", {}).get("conditions", [])
        for condition in conditions:
            # Type 1 = ISS (the main outdoor sensor)
            if condition.get("data_structure_type") == 1:
                lsid = condition.get("lsid")
                if lsid:
                    return str(lsid)
        return None
    except Exception as e:
        logger.warning(f"Failed to get WeatherLink lsid from {host}: {e}")
        return None


def read_weatherlink_device(device_config: dict):
    """Read weather data from a single WeatherLink Live device."""
    host = device_config["host"]
    interval = device_config["interval"]
    slot = device_config["slot"]

    # Initial instrument code based on IP (will be updated with lsid if available)
    instrument_code = f"davis-{host.replace('.', '-')}"
    lsid_obtained = False

    url = f"http://{host}/v1/current_conditions"
    logger.info(f"Starting WeatherLink Live reader slot {slot} at {url}")

    while True:
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()

            if data.get("error"):
                logger.warning(f"WeatherLink API error: {data['error']}")
                time.sleep(interval)
                continue

            conditions = data.get("data", {}).get("conditions", [])

            # Try to get lsid on first successful response
            if not lsid_obtained:
                for condition in conditions:
                    if condition.get("data_structure_type") == 1:
                        lsid = condition.get("lsid")
                        if lsid:
                            instrument_code = f"davis-{lsid}"
                            lsid_obtained = True
                            logger.info(f"WeatherLink at {host} identified as lsid {lsid}, code: {instrument_code}")
                            break
                if not lsid_obtained:
                    logger.info(f"WeatherLink at {host} using IP-based code: {instrument_code}")
                    lsid_obtained = True  # Don't keep trying

            updates = {}

            for condition in conditions:
                data_type = condition.get("data_structure_type")

                # Type 1 = ISS (Integrated Sensor Suite) - outdoor sensors
                if data_type == 1:
                    if condition.get("temp") is not None:
                        updates["temperature"] = round(fahrenheit_to_celsius(condition["temp"]), 1)
                    if condition.get("hum") is not None:
                        updates["humidity"] = condition["hum"]
                    if condition.get("dew_point") is not None:
                        updates["dewpoint"] = round(fahrenheit_to_celsius(condition["dew_point"]), 1)
                    if condition.get("wind_speed_last") is not None:
                        # Convert mph to km/h
                        updates["wind_speed"] = round(condition["wind_speed_last"] * 1.60934, 1)
                    if condition.get("wind_dir_last") is not None:
                        updates["wind_direction"] = condition["wind_dir_last"]
                    if condition.get("wind_speed_hi_last_10_min") is not None:
                        updates["wind_gust"] = round(condition["wind_speed_hi_last_10_min"] * 1.60934, 1)
                    if condition.get("rain_rate_last") is not None:
                        # rain_rate_last is in counts/hour, convert to mm/hr (0.2mm per count for metric)
                        updates["rain_rate"] = round(condition["rain_rate_last"] * 0.2, 2)

                # Type 3 = Barometer
                elif data_type == 3:
                    if condition.get("bar_sea_level") is not None:
                        updates["pressure"] = round(inches_to_hpa(condition["bar_sea_level"]), 1)

            if updates:
                logger.info(f"WeatherLink [{instrument_code}]: {updates}")
                data_store.update(instrument_code, **updates)
                health_tracker.record_success(instrument_code)
            else:
                # No data in response
                health_tracker.record_failure(instrument_code)
                logger.warning(f"WeatherLink [{instrument_code}]: no data in response")

        except requests.RequestException as e:
            logger.error(f"WeatherLink {host} request error: {e}")
            health_tracker.record_failure(instrument_code)
        except Exception as e:
            logger.error(f"WeatherLink {host} error: {e}")
            health_tracker.record_failure(instrument_code)

        time.sleep(interval)


# ═══════════════════════════════════════════════════════════════════════════════
# CLOUDWATCHER CGI READER (Multi-device support)
# ═══════════════════════════════════════════════════════════════════════════════

def get_cloudwatcher_serial(host: str) -> Optional[str]:
    """
    Query Cloudwatcher debug endpoint to get serial number.
    The /cgi-bin/cgiDebugData endpoint returns device info including serial.
    """
    try:
        url = f"http://{host}/cgi-bin/cgiDebugData"
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        # Parse key=value format
        for line in response.text.strip().split("\n"):
            if "=" in line:
                key, value = line.split("=", 1)
                key = key.strip().lower()
                value = value.strip()
                # Look for "serial num" or similar keys
                if "serial" in key:
                    return value
        return None
    except Exception as e:
        logger.warning(f"Failed to get Cloudwatcher serial from {host}: {e}")
        return None


def read_cloudwatcher_device(device_config: dict):
    """Read weather data from a single AAG Cloudwatcher CGI interface."""
    host = device_config["host"]
    interval = device_config["interval"]
    slot = device_config["slot"]

    # Initial instrument code based on IP (will be updated with serial if available)
    instrument_code = f"cw-{host.replace('.', '-')}"
    serial_obtained = False

    url = f"http://{host}/cgi-bin/cgiLastData"
    logger.info(f"Starting Cloudwatcher CGI reader slot {slot} at {url}")

    while True:
        try:
            # Try to get serial number on first run
            if not serial_obtained:
                serial = get_cloudwatcher_serial(host)
                if serial:
                    instrument_code = f"cw-{serial}"
                    logger.info(f"Cloudwatcher at {host} identified as serial {serial}, code: {instrument_code}")
                else:
                    logger.info(f"Cloudwatcher at {host} using IP-based code: {instrument_code}")
                serial_obtained = True

            response = requests.get(url, timeout=10)
            response.raise_for_status()

            # Parse key=value format
            data = {}
            for line in response.text.strip().split("\n"):
                if "=" in line:
                    key, value = line.split("=", 1)
                    data[key.strip()] = value.strip()

            updates = {}

            # Sky and ambient temperature
            if "clouds" in data:
                updates["sky_temp"] = float(data["clouds"])
            if "temp" in data:
                updates["ambient_temp"] = float(data["temp"])

            # Cloud condition (cloudsSafe: 1=safe/clear, 0=unsafe/cloudy)
            if "cloudsSafe" in data:
                updates["cloud_condition"] = "Clear" if data["cloudsSafe"] == "1" else "Cloudy"
            elif "clouds" in data and "temp" in data:
                updates["cloud_condition"] = classify_cloud_condition(
                    float(data["clouds"]), float(data["temp"])
                )

            # Rain condition (rainSafe: 1=dry, 0=rain)
            if "rainSafe" in data:
                updates["rain_condition"] = "Dry" if data["rainSafe"] == "1" else "Rain"
            elif "rain" in data:
                updates["rain_condition"] = classify_rain_condition(int(float(data["rain"])))

            # Light/day condition (lightSafe: 1=dark, 0=light)
            if "lightSafe" in data:
                updates["day_condition"] = "Dark" if data["lightSafe"] == "1" else "Light"
            elif "lightmpsas" in data:
                mpsas = float(data["lightmpsas"])
                if mpsas > 18:
                    updates["day_condition"] = "Dark"
                elif mpsas > 10:
                    updates["day_condition"] = "Light"
                else:
                    updates["day_condition"] = "VeryLight"

            # Wind condition (windSafe: 1=calm, 0=windy)
            if "windSafe" in data:
                updates["wind_condition"] = "Calm" if data["windSafe"] == "1" else "Windy"
            elif "wind" in data:
                updates["wind_condition"] = classify_wind_condition(float(data["wind"]))

            if updates:
                logger.info(f"Cloudwatcher CGI [{instrument_code}]: {updates}")
                data_store.update(instrument_code, **updates)
                health_tracker.record_success(instrument_code)
            else:
                # No data parsed from response
                health_tracker.record_failure(instrument_code)
                logger.warning(f"Cloudwatcher [{instrument_code}]: no data in response")

        except requests.RequestException as e:
            logger.error(f"Cloudwatcher {host} CGI request error: {e}")
            health_tracker.record_failure(instrument_code)
        except Exception as e:
            logger.error(f"Cloudwatcher {host} CGI error: {e}")
            health_tracker.record_failure(instrument_code)

        time.sleep(interval)


# ═══════════════════════════════════════════════════════════════════════════════
# BOM SATELLITE IMAGE FETCHER
# ═══════════════════════════════════════════════════════════════════════════════

# BOM Satellite Products to fetch (from /anon/gen/gms/)
BOM_SATELLITE_PRODUCTS = [
    {"id": "IDE00135", "prefix": "IDE00135", "suffix": ".jpg"},       # Australia True Color
    {"id": "IDE00135-RADAR", "prefix": "IDE00135.radar", "suffix": ".jpg"},  # Radar Composite
    {"id": "IDE00005", "prefix": "IDE00005", "suffix": ".gif"},       # Visible B&W
    {"id": "IDE00006", "prefix": "IDE00006", "suffix": ".gif"},       # Infrared B&W
    {"id": "IDE00153", "prefix": "IDE00153", "suffix": ".jpg"},       # Hemisphere Full Disk
]

BOM_SATELLITE_FTP = "ftp://ftp.bom.gov.au/anon/gen/gms"

# BOM Radar Products (from /anon/gen/radar/)
BOM_RADAR_FTP = "ftp://ftp.bom.gov.au/anon/gen/radar"


def get_radar_products():
    """Build radar products list based on configured station."""
    station = CONFIG.get("bom_radar_station", "")
    if not station:
        return []

    return [
        {"id": f"IDR{station}4", "code": f"IDR{station}4", "name": f"Radar {station} 64km"},
        {"id": f"IDR{station}3", "code": f"IDR{station}3", "name": f"Radar {station} 128km"},
        {"id": f"IDR{station}2", "code": f"IDR{station}2", "name": f"Radar {station} 256km"},
        {"id": f"IDR{station}1", "code": f"IDR{station}1", "name": f"Radar {station} 512km"},
    ]


def get_bom_timestamp(minutes_ago: int = 30) -> str:
    """Generate BOM timestamp string (YYYYMMDDHHmm) rounded to 10 minutes."""
    now = datetime.utcnow()
    target = now - timedelta(minutes=minutes_ago)
    target = target.replace(minute=(target.minute // 10) * 10, second=0, microsecond=0)
    return target.strftime("%Y%m%d%H%M")


def fetch_bom_satellite(product: dict) -> Optional[bytes]:
    """Fetch a BOM satellite image via FTP with fallback timestamps using curl."""
    import subprocess

    for minutes_ago in range(30, 150, 10):
        timestamp = get_bom_timestamp(minutes_ago)
        url = f"{BOM_SATELLITE_FTP}/{product['prefix']}.{timestamp}{product['suffix']}"

        try:
            result = subprocess.run(
                ["curl", "-s", "--connect-timeout", "10", "-o", "-", url],
                capture_output=True,
                timeout=30
            )
            if result.returncode == 0 and len(result.stdout) > 1000:
                logger.debug(f"BOM {product['id']}: fetched from {timestamp}")
                return result.stdout
        except Exception:
            continue

    logger.warning(f"BOM {product['id']}: no image available")
    return None


def fetch_bom_radar(product: dict) -> Optional[bytes]:
    """Fetch a BOM radar animated GIF loop via FTP using curl."""
    import subprocess

    url = f"{BOM_RADAR_FTP}/{product['code']}.gif"

    try:
        result = subprocess.run(
            ["curl", "-s", "--connect-timeout", "10", "-o", "-", url],
            capture_output=True,
            timeout=30
        )
        if result.returncode == 0 and len(result.stdout) > 1000:
            logger.debug(f"BOM {product['id']}: fetched radar loop")
            return result.stdout
    except Exception as e:
        logger.warning(f"BOM {product['id']}: fetch error - {e}")

    logger.warning(f"BOM {product['id']}: no radar image available")
    return None


def push_bom_imagery():
    """Fetch BOM satellite and radar images and push to remote API."""
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]
    interval = CONFIG.get("bom_satellite_interval", 600)

    if not api_key:
        logger.warning("No API key, BOM imagery push disabled")
        return

    if not CONFIG.get("bom_satellite_enabled", True):
        logger.info("BOM imagery fetching disabled")
        return

    radar_products = get_radar_products()
    logger.info(f"Starting BOM imagery fetcher, interval={interval}s")
    logger.info(f"  Satellite products: {len(BOM_SATELLITE_PRODUCTS)}")
    logger.info(f"  Radar products: {len(radar_products)} (station: {CONFIG.get('bom_radar_station', 'none')})")

    while True:
        # Fetch satellite images
        for product in BOM_SATELLITE_PRODUCTS:
            try:
                image_data = fetch_bom_satellite(product)

                if image_data:
                    files = {
                        "image": (f"{product['id']}.jpg", image_data, "image/jpeg")
                    }
                    response = requests.post(
                        f"{api_url}/satellite",
                        files=files,
                        data={"product_id": product["id"]},
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=60,
                    )

                    if response.ok:
                        logger.info(f"BOM {product['id']}: pushed successfully")
                    else:
                        logger.warning(f"BOM {product['id']}: push failed {response.status_code}")

            except Exception as e:
                logger.error(f"BOM {product['id']}: error - {e}")

            time.sleep(2)

        # Fetch radar images
        for product in radar_products:
            try:
                image_data = fetch_bom_radar(product)

                if image_data:
                    files = {
                        "image": (f"{product['id']}.gif", image_data, "image/gif")
                    }
                    response = requests.post(
                        f"{api_url}/satellite",
                        files=files,
                        data={"product_id": product["id"]},
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=60,
                    )

                    if response.ok:
                        logger.info(f"BOM {product['id']}: pushed successfully")
                    else:
                        logger.warning(f"BOM {product['id']}: push failed {response.status_code}")

            except Exception as e:
                logger.error(f"BOM {product['id']}: error - {e}")

            time.sleep(2)

        time.sleep(interval)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PUSHER
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_allsky_image() -> Optional[bytes]:
    """
    Fetch AllSky image from local file path or URL fallback.
    Returns image bytes or None if not available.
    """
    image_path = Path(CONFIG["allsky_image_path"]) if CONFIG["allsky_image_path"] else None
    image_url = CONFIG["allsky_image_url"]

    # Try local file first
    if image_path and image_path.exists():
        mtime = image_path.stat().st_mtime
        age = time.time() - mtime

        if age < 300:  # Image less than 5 minutes old
            try:
                with open(image_path, "rb") as f:
                    logger.debug(f"AllSky: loaded from file (age: {age:.0f}s)")
                    return f.read()
            except Exception as e:
                logger.warning(f"AllSky file read error: {e}")
        else:
            logger.debug(f"AllSky file too old ({age:.0f}s)")

    # Fallback to URL if configured
    if image_url:
        try:
            response = requests.get(image_url, timeout=30)
            if response.ok and len(response.content) > 1000:
                logger.debug(f"AllSky: loaded from URL")
                return response.content
            else:
                logger.warning(f"AllSky URL returned invalid response: {response.status_code}")
        except requests.RequestException as e:
            logger.warning(f"AllSky URL fetch error: {e}")

    return None


def push_data():
    """Push data for all instruments."""
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if not api_key:
        logger.error("No API key configured, data push disabled")
        return

    logger.info(f"Starting data pusher, interval={CONFIG['push_interval']}s")
    if CONFIG["allsky_image_path"]:
        logger.info(f"AllSky file path: {CONFIG['allsky_image_path']}")
    if CONFIG["allsky_image_url"]:
        logger.info(f"AllSky URL fallback: {CONFIG['allsky_image_url']}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    while True:
        try:
            # Push data for each instrument separately
            all_data = data_store.get_all()

            for instrument_code, data in all_data.items():
                if not data.get("timestamp"):
                    continue  # Skip instruments with no data

                # Add instrument_code to payload
                payload = {
                    "instrument_code": instrument_code,
                    **{k: v for k, v in data.items() if k != "timestamp"}
                }

                response = requests.post(
                    f"{api_url}/data",
                    json=payload,
                    headers=headers,
                    timeout=30,
                )

                if response.ok:
                    logger.info(f"Pushed {instrument_code} data at {datetime.now()}")
                else:
                    logger.warning(f"Push failed for {instrument_code}: {response.status_code} - {response.text}")

            # Push AllSky image
            image_data = fetch_allsky_image()
            if image_data:
                files = {"image": ("allsky.jpg", image_data, "image/jpeg")}
                img_response = requests.post(
                    f"{api_url}/image",
                    files=files,
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=60,
                )
                if img_response.ok:
                    logger.debug("AllSky image pushed")
                else:
                    logger.warning(f"Image push failed: {img_response.status_code}")

        except requests.RequestException as e:
            logger.error(f"Push error: {e}")
        except Exception as e:
            logger.error(f"Unexpected push error: {e}")

        time.sleep(CONFIG["push_interval"])


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG PUSHER - Tell server what instruments are expected
# ═══════════════════════════════════════════════════════════════════════════════

def get_collector_id() -> str:
    """Generate a unique collector ID based on hostname."""
    import socket
    hostname = socket.gethostname()
    return f"pi-{hostname}"


def build_expected_instruments() -> list:
    """
    Build list of expected instruments that have actually reported data.
    Only includes instruments from data_store (i.e., instruments that have
    successfully connected and sent readings). This avoids registering
    duplicate IP-based codes when we already have the serial-based code.
    """
    instruments = []

    # Get current instrument codes from data_store
    # These are only instruments that have successfully sent data
    all_data = data_store.get_all()
    known_codes = set(all_data.keys())

    # Only register instruments that have reported data
    for code in known_codes:
        # Infer type from code prefix
        if code.startswith("sqm-"):
            inst_type = "sqm"
        elif code.startswith("davis-"):
            inst_type = "weather_station"
        elif code.startswith("cw-"):
            inst_type = "cloudwatcher"
        else:
            inst_type = "unknown"

        instruments.append({
            "code": code,
            "type": inst_type,
            "host": "auto-detected",
            "slot": 0,
        })

    return instruments


def push_config():
    """
    Push instrument configuration to the server.
    This tells the server which instruments are expected to report data.
    Runs on startup and periodically to keep the server in sync.
    """
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if not api_key:
        logger.warning("No API key, config push disabled")
        return

    collector_id = get_collector_id()
    config_interval = 3600  # Push config every hour
    initial_delay = 15  # Wait for instruments to be discovered

    logger.info(f"Starting config pusher, collector_id={collector_id}")
    logger.info(f"Waiting {initial_delay}s for instrument discovery...")
    time.sleep(initial_delay)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    while True:
        try:
            instruments = build_expected_instruments()
            logger.info(f"Config push: {len(instruments)} instruments to register")

            payload = {
                "collector_id": collector_id,
                "instruments": instruments,
                "timestamp": datetime.utcnow().isoformat(),
            }

            response = requests.post(
                f"{api_url}/config",
                json=payload,
                headers=headers,
                timeout=30,
            )

            if response.ok:
                result = response.json()
                logger.info(f"Config pushed: {result.get('instruments_registered', 0)} instruments registered")
            else:
                logger.warning(f"Config push failed: {response.status_code} - {response.text}")

        except requests.RequestException as e:
            logger.error(f"Config push error: {e}")
        except Exception as e:
            logger.error(f"Unexpected config push error: {e}")

        time.sleep(config_interval)


# ═══════════════════════════════════════════════════════════════════════════════
# HEARTBEAT - Lightweight periodic ping to indicate collector is alive
# ═══════════════════════════════════════════════════════════════════════════════

# Track collector start time for uptime calculation
COLLECTOR_START_TIME = time.time()
COLLECTOR_VERSION = "2.0.0"


def push_heartbeat():
    """
    Send periodic heartbeat to the server with instrument health statuses.

    The heartbeat includes:
    - List of instruments the collector is monitoring
    - Health status for each instrument (HEALTHY, DEGRADED, OFFLINE)
    - Collector version and uptime

    The server uses this as the source of truth for instrument health.
    It no longer computes health from staleness - it trusts the collector.
    """
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]

    if not api_key:
        logger.warning("No API key, heartbeat disabled")
        return

    heartbeat_interval = 60  # Send heartbeat every minute
    initial_delay = 10  # Brief wait for instruments to be discovered

    logger.info(f"Starting heartbeat, interval={heartbeat_interval}s")
    time.sleep(initial_delay)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Build base URL - remove /ingest suffix to get to /heartbeat
    base_url = api_url.replace("/ingest", "")

    while True:
        try:
            # Get list of instruments that have reported data
            all_data = data_store.get_all()
            active_instruments = [
                code for code, data in all_data.items()
                if data.get("timestamp")
            ]

            # Get health status for each instrument from the health tracker
            instrument_health = {}
            for code in active_instruments:
                status = health_tracker.get_status(code)
                instrument_health[code] = {
                    "status": status,
                    "failure_rate": health_tracker.get_failure_rate(code),
                }

            uptime_seconds = int(time.time() - COLLECTOR_START_TIME)

            payload = {
                "instruments": active_instruments,
                "instrument_health": instrument_health,
                "collector_version": COLLECTOR_VERSION,
                "uptime_seconds": uptime_seconds,
            }

            response = requests.post(
                f"{base_url}/heartbeat",
                json=payload,
                headers=headers,
                timeout=10,  # Short timeout for heartbeat
            )

            if response.ok:
                # Log health summary
                degraded = [c for c, h in instrument_health.items() if h["status"] == "DEGRADED"]
                offline = [c for c, h in instrument_health.items() if h["status"] == "OFFLINE"]
                healthy = len(active_instruments) - len(degraded) - len(offline)
                logger.debug(f"Heartbeat sent: {healthy} healthy, {len(degraded)} degraded, {len(offline)} offline")
            else:
                logger.warning(f"Heartbeat failed: {response.status_code}")

        except requests.RequestException as e:
            logger.debug(f"Heartbeat error: {e}")  # Debug level - don't spam logs
        except Exception as e:
            logger.error(f"Unexpected heartbeat error: {e}")

        time.sleep(heartbeat_interval)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    logger.info("=" * 60)
    logger.info("Observatory Data Collector Starting (Multi-Instrument)")
    logger.info("=" * 60)
    logger.info(f"Remote API: {CONFIG['remote_api']}")
    logger.info(f"MQTT Broker: {CONFIG['mqtt_broker']}:{CONFIG['mqtt_port']}")
    logger.info(f"Push Interval: {CONFIG['push_interval']}s")

    # Log configured devices
    logger.info("Configured Devices:")
    sqm_devices = CONFIG["sqm_devices"]
    davis_devices = CONFIG["davis_devices"]
    cloudwatcher_devices = CONFIG["cloudwatcher_devices"]

    logger.info(f"  SQM devices: {len(sqm_devices)}")
    for d in sqm_devices:
        logger.info(f"    Slot {d['slot']}: {d['host']}:{d['port']}")

    logger.info(f"  Davis devices: {len(davis_devices)}")
    for d in davis_devices:
        logger.info(f"    Slot {d['slot']}: {d['host']} (interval: {d['interval']}s)")

    logger.info(f"  Cloudwatcher devices: {len(cloudwatcher_devices)}")
    for d in cloudwatcher_devices:
        logger.info(f"    Slot {d['slot']}: {d['host']} (interval: {d['interval']}s)")

    mqtt_client = start_mqtt()

    threads = []

    # Create threads for each configured SQM device
    for device in sqm_devices:
        t = threading.Thread(
            target=read_sqm_device,
            args=(device,),
            daemon=True,
            name=f"sqm-{device['slot']}"
        )
        threads.append(t)

    # Create threads for each configured Davis device
    for device in davis_devices:
        t = threading.Thread(
            target=read_weatherlink_device,
            args=(device,),
            daemon=True,
            name=f"davis-{device['slot']}"
        )
        threads.append(t)

    # Create threads for each configured Cloudwatcher device
    for device in cloudwatcher_devices:
        t = threading.Thread(
            target=read_cloudwatcher_device,
            args=(device,),
            daemon=True,
            name=f"cloudwatcher-{device['slot']}"
        )
        threads.append(t)

    # Add data pusher, config pusher, heartbeat, and BOM imagery threads
    threads.append(threading.Thread(target=push_data, daemon=True, name="pusher"))
    threads.append(threading.Thread(target=push_config, daemon=True, name="config-pusher"))
    threads.append(threading.Thread(target=push_heartbeat, daemon=True, name="heartbeat"))
    threads.append(threading.Thread(target=push_bom_imagery, daemon=True, name="bom-imagery"))

    for t in threads:
        logger.info(f"Starting thread: {t.name}")
        t.start()

    try:
        while True:
            time.sleep(300)
            all_data = data_store.get_all()
            logger.info(f"Status: {len(all_data)} instruments active")
            for code, data in all_data.items():
                logger.info(f"  {code}: {list(data.keys())}")
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        if mqtt_client:
            mqtt_client.loop_stop()
        sys.exit(0)


if __name__ == "__main__":
    main()
