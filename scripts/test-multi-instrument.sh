#!/bin/bash
# Test script to simulate multiple instruments sending data
# Usage: ./scripts/test-multi-instrument.sh [API_KEY]

API_URL="${API_URL:-http://localhost:3000/api/ingest/data}"
API_KEY="${1:-${INGEST_API_KEY:-test-key}}"

echo "Testing multi-instrument support"
echo "API URL: $API_URL"
echo "================================"

# Function to send data
send_data() {
    local name=$1
    local payload=$2
    echo -n "Sending $name... "
    response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "$payload")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        echo "OK"
    else
        echo "FAILED (HTTP $http_code)"
        echo "  Response: $body"
    fi
}

# SQM instruments
echo ""
echo "=== SQM Meters ==="
send_data "sqm-01" '{
    "instrument_code": "sqm-01",
    "sky_quality": 21.45,
    "sqm_temperature": 15.2
}'

send_data "sqm-02" '{
    "instrument_code": "sqm-02",
    "sky_quality": 21.32,
    "sqm_temperature": 14.8
}'

send_data "sqm-03 (outlier)" '{
    "instrument_code": "sqm-03",
    "sky_quality": 18.50,
    "sqm_temperature": 16.1
}'

# Weather stations
echo ""
echo "=== Weather Stations ==="
send_data "weatherlink-01" '{
    "instrument_code": "weatherlink-01",
    "temperature": 18.5,
    "humidity": 65,
    "pressure": 1013.2,
    "dewpoint": 12.1,
    "wind_speed": 8.5,
    "wind_gust": 15.2,
    "wind_direction": 225
}'

send_data "weatherlink-02" '{
    "instrument_code": "weatherlink-02",
    "temperature": 18.2,
    "humidity": 67,
    "pressure": 1013.4,
    "dewpoint": 12.3,
    "wind_speed": 9.1,
    "wind_gust": 14.8,
    "wind_direction": 220
}'

# Cloudwatchers
echo ""
echo "=== Cloudwatchers ==="
send_data "cloudwatcher-01" '{
    "instrument_code": "cloudwatcher-01",
    "sky_temp": -25.5,
    "ambient_temp": 18.5,
    "cloud_condition": "Clear",
    "rain_condition": "Dry",
    "wind_condition": "Calm",
    "day_condition": "Dark"
}'

send_data "cloudwatcher-02" '{
    "instrument_code": "cloudwatcher-02",
    "sky_temp": -24.8,
    "ambient_temp": 18.3,
    "cloud_condition": "Clear",
    "rain_condition": "Dry",
    "wind_condition": "Calm",
    "day_condition": "Dark"
}'

echo ""
echo "================================"
echo "Done! Check http://localhost:3000"
echo ""
echo "You should see:"
echo "  - Badge showing '2 SQMs' on the Sky Quality panel"
echo "  - Click any stat to see individual instrument readings"
echo "  - 'All/Avg' toggle on the SQM graph (if 2+ SQMs)"
