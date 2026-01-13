#!/usr/bin/env python3
"""
Observatory Data Collector for Raspberry Pi

Collects data from:
- MQTT broker (Davis weather via weewx, LoRa sensors)
- Serial devices (AAG Cloudwatcher, Unihedron SQM)
- AllSky camera images

Pushes to remote Vercel/Supabase API

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

CONFIG = {
    "remote_api": os.getenv("REMOTE_API_URL", "https://your-site.vercel.app/api/ingest"),
    "api_key": os.getenv("API_KEY", ""),
    "mqtt_broker": os.getenv("MQTT_BROKER", "localhost"),
    "mqtt_port": int(os.getenv("MQTT_PORT", "1883")),
    "sqm_host": os.getenv("SQM_HOST", ""),
    "sqm_port": int(os.getenv("SQM_PORT", "10001")),
    "weatherlink_host": os.getenv("WEATHERLINK_HOST", ""),
    "weatherlink_interval": int(os.getenv("WEATHERLINK_INTERVAL", "30")),
    "cloudwatcher_host": os.getenv("CLOUDWATCHER_HOST", ""),
    "cloudwatcher_interval": int(os.getenv("CLOUDWATCHER_INTERVAL", "30")),
    "allsky_image_path": os.getenv("ALLSKY_IMAGE_PATH", "/home/pi/allsky/tmp/image.jpg"),
    "allsky_image_url": os.getenv("ALLSKY_IMAGE_URL", ""),  # Fallback URL if file not found
    "push_interval": int(os.getenv("PUSH_INTERVAL", "60")),
    "bom_satellite_enabled": os.getenv("BOM_SATELLITE_ENABLED", "true").lower() == "true",
    "bom_satellite_interval": int(os.getenv("BOM_SATELLITE_INTERVAL", "600")),
    "bom_radar_station": os.getenv("BOM_RADAR_STATION", ""),  # e.g., "71" for Sydney
    "log_level": os.getenv("LOG_LEVEL", "INFO"),
}

# Logging setup
logging.basicConfig(
    level=getattr(logging, CONFIG["log_level"]),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("observatory-collector")


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STORE
# ═══════════════════════════════════════════════════════════════════════════════

class ThreadSafeDataStore:
    """Thread-safe store for the latest sensor readings."""

    def __init__(self):
        self._data: Dict[str, Any] = {
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
        self._lock = threading.Lock()

    def update(self, **kwargs) -> None:
        with self._lock:
            self._data.update(kwargs)
            self._data["timestamp"] = datetime.utcnow().isoformat()

    def get_all(self) -> Dict[str, Any]:
        with self._lock:
            return self._data.copy()


# Global data store
data_store = ThreadSafeDataStore()


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
                data_store.update(**updates)

        elif "lora" in topic:
            sensor_id = payload.get("id", topic.split("/")[-1])
            current = data_store.get_all()
            lora_sensors = current.get("lora_sensors", {})
            lora_sensors[sensor_id] = {
                **payload,
                "last_update": datetime.utcnow().isoformat(),
            }
            data_store.update(lora_sensors=lora_sensors)

        elif "cloudwatcher" in topic or "aag" in topic:
            # AAG Cloudwatcher MQTT data
            # Format: clouds=sky_temp, temp=ambient_temp, rain=sensor_value,
            #         cloudsSafe/rainSafe/lightSafe/windSafe = "Safe"/"Unsafe"
            updates = {}

            # Sky and ambient temperature
            sky_temp = payload.get("clouds")  # "clouds" is actually sky temperature
            ambient_temp = payload.get("temp")

            if sky_temp is not None:
                updates["sky_temp"] = float(sky_temp)
            if ambient_temp is not None:
                updates["ambient_temp"] = float(ambient_temp)

            # Cloud condition from cloudsSafe or calculate from temps
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
                if rain_safe == "Safe":
                    updates["rain_condition"] = "Dry"
                else:
                    updates["rain_condition"] = "Rain"
            elif rain_val is not None:
                updates["rain_condition"] = classify_rain_condition(int(rain_val))

            # Light/day condition from lightmpsas (mag per square arcsec)
            light_safe = payload.get("lightSafe", "")
            light_mpsas = payload.get("lightmpsas")
            if light_safe:
                if light_safe == "Safe":
                    updates["day_condition"] = "Dark"
                else:
                    updates["day_condition"] = "Light"
            elif light_mpsas is not None:
                # Higher mpsas = darker sky
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
                if wind_safe == "Safe":
                    updates["wind_condition"] = "Calm"
                else:
                    updates["wind_condition"] = "Windy"
            elif wind_val is not None:
                updates["wind_condition"] = classify_wind_condition(float(wind_val))

            if updates:
                logger.info(f"Cloudwatcher MQTT: {updates}")
                data_store.update(**updates)

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
# SQM READER (Cloudwatcher data comes via MQTT)
# ═══════════════════════════════════════════════════════════════════════════════

def read_sqm():
    host = CONFIG["sqm_host"]
    port = CONFIG["sqm_port"]

    if not host:
        logger.warning("SQM host not configured, skipping")
        return

    logger.info(f"Starting SQM-LE reader on {host}:{port}")

    while True:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(10)
                sock.connect((host, port))
                logger.info(f"Connected to SQM-LE at {host}:{port}")

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
                                sky_quality=sqm_value,
                                sqm_temperature=sqm_temp,
                            )
                            logger.debug(f"SQM: {sqm_value} mag/arcsec², temp={sqm_temp}°C")

                    time.sleep(60)

        except (socket.error, ConnectionError) as e:
            logger.error(f"SQM connection error: {e}")
            time.sleep(60)
        except Exception as e:
            logger.error(f"SQM error: {e}")
            time.sleep(60)


# ═══════════════════════════════════════════════════════════════════════════════
# WEATHERLINK LIVE READER
# ═══════════════════════════════════════════════════════════════════════════════

def fahrenheit_to_celsius(f: float) -> float:
    """Convert Fahrenheit to Celsius."""
    return (f - 32) * 5 / 9


def inches_to_hpa(inches: float) -> float:
    """Convert inches of mercury to hectopascals."""
    return inches * 33.8639


def read_weatherlink():
    """Read weather data from WeatherLink Live local API."""
    host = CONFIG["weatherlink_host"]
    interval = CONFIG["weatherlink_interval"]

    if not host:
        logger.warning("WeatherLink host not configured, skipping")
        return

    url = f"http://{host}/v1/current_conditions"
    logger.info(f"Starting WeatherLink Live reader at {url}")

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
                logger.info(f"WeatherLink: {updates}")
                data_store.update(**updates)

        except requests.RequestException as e:
            logger.error(f"WeatherLink request error: {e}")
        except Exception as e:
            logger.error(f"WeatherLink error: {e}")

        time.sleep(interval)


# ═══════════════════════════════════════════════════════════════════════════════
# CLOUDWATCHER CGI READER
# ═══════════════════════════════════════════════════════════════════════════════

def read_cloudwatcher_cgi():
    """Read weather data from AAG Cloudwatcher CGI interface."""
    host = CONFIG["cloudwatcher_host"]
    interval = CONFIG["cloudwatcher_interval"]

    if not host:
        logger.warning("Cloudwatcher CGI host not configured, skipping")
        return

    url = f"http://{host}/cgi-bin/cgiLastData"
    logger.info(f"Starting Cloudwatcher CGI reader at {url}")

    while True:
        try:
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
                logger.info(f"Cloudwatcher CGI: {updates}")
                data_store.update(**updates)

        except requests.RequestException as e:
            logger.error(f"Cloudwatcher CGI request error: {e}")
        except Exception as e:
            logger.error(f"Cloudwatcher CGI error: {e}")

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
# Radar station codes: https://www.bom.gov.au/australia/radar/
# Range suffixes: 1=512km, 2=256km, 3=128km, 4=64km, I=doppler wind
# Common stations: 71=Sydney, 66=Brisbane, 02=Melbourne, 70=Perth, 64=Adelaide
BOM_RADAR_FTP = "ftp://ftp.bom.gov.au/anon/gen/radar"


def get_radar_products():
    """Build radar products list based on configured station."""
    station = CONFIG.get("bom_radar_station", "")
    if not station:
        return []

    # Return animated GIF loops for each range (these include background map)
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
    # Round down to nearest 10 minutes
    target = target.replace(minute=(target.minute // 10) * 10, second=0, microsecond=0)
    return target.strftime("%Y%m%d%H%M")


def fetch_bom_satellite(product: dict) -> Optional[bytes]:
    """Fetch a BOM satellite image via FTP with fallback timestamps using curl."""
    import subprocess

    # Try several timestamps going back up to 2 hours
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

    # Radar GIFs are pre-generated loops named simply as {code}.gif
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
    interval = CONFIG.get("bom_satellite_interval", 600)  # Default 10 minutes

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
            data = data_store.get_all()

            response = requests.post(
                f"{api_url}/data",
                json=data,
                headers=headers,
                timeout=30,
            )

            if response.ok:
                logger.info(f"Data pushed successfully at {datetime.now()}")
            else:
                logger.warning(f"Data push failed: {response.status_code} - {response.text}")

            # Push AllSky image (from file or URL)
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
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    logger.info("=" * 60)
    logger.info("Observatory Data Collector Starting")
    logger.info("=" * 60)
    logger.info(f"Remote API: {CONFIG['remote_api']}")
    logger.info(f"MQTT Broker: {CONFIG['mqtt_broker']}:{CONFIG['mqtt_port']}")
    logger.info(f"Push Interval: {CONFIG['push_interval']}s")

    mqtt_client = start_mqtt()

    # Cloudwatcher via MQTT + CGI fallback; SQM via TCP; WeatherLink via HTTP
    threads = [
        threading.Thread(target=read_sqm, daemon=True, name="sqm"),
        threading.Thread(target=read_weatherlink, daemon=True, name="weatherlink"),
        threading.Thread(target=read_cloudwatcher_cgi, daemon=True, name="cloudwatcher-cgi"),
        threading.Thread(target=push_data, daemon=True, name="pusher"),
        threading.Thread(target=push_bom_imagery, daemon=True, name="bom-imagery"),
    ]

    for t in threads:
        logger.info(f"Starting thread: {t.name}")
        t.start()

    try:
        while True:
            time.sleep(300)
            data = data_store.get_all()
            logger.info(
                f"Status: temp={data.get('temperature')}°C, "
                f"sqm={data.get('sky_quality')}, "
                f"cloud={data.get('cloud_condition')}"
            )
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        if mqtt_client:
            mqtt_client.loop_stop()
        sys.exit(0)


if __name__ == "__main__":
    main()
