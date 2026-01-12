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
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import paho.mqtt.client as mqtt
import requests
import serial
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
    "cloudwatcher_port": os.getenv("CLOUDWATCHER_PORT", "/dev/ttyUSB0"),
    "cloudwatcher_baud": int(os.getenv("CLOUDWATCHER_BAUD", "9600")),
    "sqm_port": os.getenv("SQM_PORT", "/dev/ttyUSB1"),
    "sqm_baud": int(os.getenv("SQM_BAUD", "115200")),
    "allsky_image_path": os.getenv("ALLSKY_IMAGE_PATH", "/home/pi/allsky/tmp/image.jpg"),
    "push_interval": int(os.getenv("PUSH_INTERVAL", "60")),
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


def read_cloudwatcher():
    port = CONFIG["cloudwatcher_port"]
    baud = CONFIG["cloudwatcher_baud"]

    if not Path(port).exists():
        logger.warning(f"Cloudwatcher port {port} not found, skipping")
        return

    logger.info(f"Starting Cloudwatcher reader on {port}")

    while True:
        try:
            with serial.Serial(port, baud, timeout=3) as ser:
                while True:
                    ser.write(b"A!")
                    time.sleep(0.5)
                    response = ser.readline().decode("ascii", errors="ignore").strip()

                    if response.startswith("!1"):
                        parts = response.split()
                        if len(parts) >= 5:
                            sky_temp = float(parts[1])
                            ambient_temp = float(parts[2])
                            rain_sensor = int(parts[3])
                            light_sensor = int(parts[4])

                            current = data_store.get_all()
                            wind_speed = current.get("wind_speed")

                            data_store.update(
                                sky_temp=sky_temp,
                                ambient_temp=ambient_temp,
                                cloud_condition=classify_cloud_condition(sky_temp, ambient_temp),
                                rain_condition=classify_rain_condition(rain_sensor),
                                day_condition=classify_day_condition(light_sensor),
                                wind_condition=classify_wind_condition(wind_speed),
                            )
                            logger.debug(f"Cloudwatcher: sky={sky_temp}°C, ambient={ambient_temp}°C")

                    time.sleep(30)

        except serial.SerialException as e:
            logger.error(f"Cloudwatcher serial error: {e}")
            time.sleep(60)
        except Exception as e:
            logger.error(f"Cloudwatcher error: {e}")
            time.sleep(60)


# ═══════════════════════════════════════════════════════════════════════════════
# SQM READER
# ═══════════════════════════════════════════════════════════════════════════════

def read_sqm():
    port = CONFIG["sqm_port"]
    baud = CONFIG["sqm_baud"]

    if not Path(port).exists():
        logger.warning(f"SQM port {port} not found, skipping")
        return

    logger.info(f"Starting SQM reader on {port}")

    while True:
        try:
            with serial.Serial(port, baud, timeout=3) as ser:
                while True:
                    ser.write(b"rx")
                    time.sleep(0.5)
                    response = ser.readline().decode("ascii", errors="ignore").strip()

                    if response.startswith("r,"):
                        parts = response.split(",")
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

        except serial.SerialException as e:
            logger.error(f"SQM serial error: {e}")
            time.sleep(60)
        except Exception as e:
            logger.error(f"SQM error: {e}")
            time.sleep(60)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA PUSHER
# ═══════════════════════════════════════════════════════════════════════════════

def push_data():
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]
    image_path = Path(CONFIG["allsky_image_path"])

    if not api_key:
        logger.error("No API key configured, data push disabled")
        return

    logger.info(f"Starting data pusher, interval={CONFIG['push_interval']}s")

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

            # Push AllSky image
            if image_path.exists():
                mtime = image_path.stat().st_mtime
                age = time.time() - mtime

                if age < 300:
                    with open(image_path, "rb") as f:
                        files = {"image": ("allsky.jpg", f, "image/jpeg")}
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
                else:
                    logger.debug(f"AllSky image too old ({age:.0f}s), skipping")

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

    threads = [
        threading.Thread(target=read_cloudwatcher, daemon=True, name="cloudwatcher"),
        threading.Thread(target=read_sqm, daemon=True, name="sqm"),
        threading.Thread(target=push_data, daemon=True, name="pusher"),
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
