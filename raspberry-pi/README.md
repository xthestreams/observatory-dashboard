# Observatory Data Collector - Raspberry Pi

This collector runs on a Raspberry Pi and gathers data from observatory instruments, pushing it to your Vercel-hosted dashboard.

## Supported Instruments

| Type | Protocol | Devices Supported |
|------|----------|-------------------|
| **SQM-LE** | TCP/IP | Up to 3 Unihedron Sky Quality Meters |
| **Davis WeatherLink Live** | HTTP API | Up to 3 weather stations |
| **AAG Cloudwatcher** | HTTP CGI / MQTT | Up to 3 cloud sensors |
| **AllSky Camera** | Local file or HTTP | 1 camera |

## Quick Start

### 1. Clone the Repository

```bash
cd ~
git clone https://github.com/xthestreams/observatory-dashboard.git
cd observatory-dashboard/raspberry-pi
```

### 2. Run the Installer

```bash
./install.sh
```

The installer will:
- Install Python dependencies
- Create a virtual environment
- Set up the systemd service
- Create a configuration template

### 3. Configure Your Instruments

Edit the configuration file:

```bash
nano ~/observatory-collector/.env
```

**Required settings:**

```bash
# Your Vercel dashboard URL
REMOTE_API_URL=https://your-site.vercel.app/api/ingest

# API key (must match INGEST_API_KEY in Vercel)
API_KEY=your-secret-key-here

# Your instruments (example)
SQM_1_HOST=192.168.1.101
DAVIS_1_HOST=192.168.1.102
CLOUDWATCHER_1_HOST=192.168.1.100
```

See `.env.example` for all available options.

### 4. Start the Collector

```bash
sudo systemctl start observatory-collector
```

### 5. Verify It's Working

```bash
# Check service status
sudo systemctl status observatory-collector

# View live logs
sudo journalctl -u observatory-collector -f
```

You should see output like:
```
Observatory Data Collector Starting (Multi-Instrument)
SQM at 192.168.1.101 identified as serial 5028, code: sqm-5028
WeatherLink at 192.168.1.102 identified as lsid 763610, code: davis-763610
Config pushed: 3 instruments registered
```

## Updating the Collector

When new versions are released:

```bash
cd ~/observatory-dashboard
git pull
cd raspberry-pi
./install.sh
```

The installer preserves your `.env` configuration.

## Configuration Reference

### Instrument Configuration

Each instrument type supports up to 3 devices. Leave the HOST empty to disable a slot.

**SQM-LE Sky Quality Meters:**
```bash
SQM_1_HOST=192.168.1.101    # IP address
SQM_1_PORT=10001            # Default port (optional)
```

**Davis WeatherLink Live:**
```bash
DAVIS_1_HOST=192.168.1.102  # IP address
DAVIS_1_INTERVAL=30         # Polling interval in seconds
```

**AAG Cloudwatcher:**
```bash
CLOUDWATCHER_1_HOST=192.168.1.100
CLOUDWATCHER_1_INTERVAL=30
```

### AllSky Camera

The collector checks for a local image file first, then falls back to a URL:

```bash
# Local file (e.g., from AllSky software)
ALLSKY_IMAGE_PATH=/home/pi/allsky/tmp/image.jpg

# URL fallback (optional)
ALLSKY_IMAGE_URL=http://192.168.1.50/current/image.jpg
```

### BOM Satellite/Radar Imagery (Australia)

Australian users can fetch Bureau of Meteorology imagery:

```bash
BOM_SATELLITE_ENABLED=true
BOM_SATELLITE_INTERVAL=600  # 10 minutes

# Radar station code (see bom.gov.au/australia/radar/)
# 71=Sydney, 66=Brisbane, 02=Melbourne, 70=Perth, 64=Adelaide
BOM_RADAR_STATION=71
```

### MQTT Support

The collector can receive data via MQTT for instruments that publish to a broker:

```bash
MQTT_BROKER=localhost
MQTT_PORT=1883
```

Supported topics:
- `weewx/#` - Davis weather data via weewx
- `cloudwatcher/#` or `aag/#` - Cloudwatcher data
- `lora/#` - LoRa sensors

## Troubleshooting

### Service won't start

Check the logs:
```bash
sudo journalctl -u observatory-collector -n 100
```

Common issues:
- **Invalid API key**: Check `API_KEY` matches your Vercel `INGEST_API_KEY`
- **Network unreachable**: Ensure the Pi can reach your instruments and the internet
- **Python errors**: Try running manually: `~/observatory-collector/venv/bin/python ~/observatory-collector/collector.py`

### Instruments showing offline on dashboard

1. Check the collector logs for connection errors
2. Verify instrument IP addresses are correct
3. Ensure instruments are on the same network as the Pi
4. Check firewall settings on the Pi

### Data not updating

```bash
# Check if the service is running
sudo systemctl status observatory-collector

# Restart if needed
sudo systemctl restart observatory-collector
```

## Service Management

```bash
# Start/stop/restart
sudo systemctl start observatory-collector
sudo systemctl stop observatory-collector
sudo systemctl restart observatory-collector

# Enable/disable auto-start on boot
sudo systemctl enable observatory-collector
sudo systemctl disable observatory-collector

# View status
sudo systemctl status observatory-collector

# View logs (live)
sudo journalctl -u observatory-collector -f

# View recent logs
sudo journalctl -u observatory-collector -n 100
```

## Uninstalling

```bash
cd ~/observatory-dashboard/raspberry-pi
./install.sh --uninstall
```

## File Locations

| File | Location |
|------|----------|
| Collector script | `~/observatory-collector/collector.py` |
| Configuration | `~/observatory-collector/.env` |
| Virtual environment | `~/observatory-collector/venv/` |
| Service file | `/etc/systemd/system/observatory-collector.service` |
| Logs | `journalctl -u observatory-collector` |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Raspberry Pi                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              collector.py                        │    │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────────────┐   │    │
│  │  │ SQM     │ │ Davis   │ │ Cloudwatcher     │   │    │
│  │  │ Reader  │ │ Reader  │ │ Reader           │   │    │
│  │  └────┬────┘ └────┬────┘ └────────┬─────────┘   │    │
│  │       │           │               │              │    │
│  │       └───────────┼───────────────┘              │    │
│  │                   ▼                              │    │
│  │           ┌───────────────┐                      │    │
│  │           │  Data Store   │                      │    │
│  │           └───────┬───────┘                      │    │
│  │                   │                              │    │
│  │           ┌───────┴───────┐                      │    │
│  │           ▼               ▼                      │    │
│  │    ┌──────────┐   ┌──────────────┐              │    │
│  │    │  Pusher  │   │ Config Push  │              │    │
│  │    └────┬─────┘   └──────┬───────┘              │    │
│  └─────────┼────────────────┼───────────────────────┘    │
│            │                │                            │
└────────────┼────────────────┼────────────────────────────┘
             │                │
             ▼                ▼
      ┌──────────────────────────────┐
      │     Vercel / Supabase        │
      │  /api/ingest/data            │
      │  /api/ingest/config          │
      └──────────────────────────────┘
```

## Contributing

Issues and pull requests welcome at:
https://github.com/xthestreams/observatory-dashboard
