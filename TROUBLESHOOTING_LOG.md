# Troubleshooting Log

This file documents issues encountered with the observatory dashboard and their resolutions.

---

## 2026-01-21: Collector Data Outage (12+ hours)

### Symptoms
- Dashboard stuck on "Loading telemetry..." (Safari browser cache issue) or showing stale data
- All instrument readings showing as `null` in API responses
- Last successful data push: 2026-01-20 22:16 UTC
- Collector logs showed all instruments timing out on HTTP connections:
  ```
  HTTPConnectionPool(host='192.168.10.124', port=80): Max retries exceeded
  Connection to 192.168.10.124 timed out. (connect timeout=10)
  ```
- ICMP ping to instruments worked, but HTTP connections failed
- DNS resolution for `telemetry.srof.com.au` failed on the Pi

### Root Cause
1. **Local DNS server issue**: The Pi's primary DNS server (192.168.1.4) stopped resolving external domains
2. **Network/switch issue**: HTTP connections to instruments on 192.168.10.x subnet were timing out, even though ICMP ping worked

### Resolution
1. Rebooted the Raspberry Pi collector (`sudo reboot`)
2. After reboot, DNS still wasn't resolving - forced Google DNS:
   ```bash
   echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf
   ```
3. Restarted the collector service:
   ```bash
   sudo systemctl restart observatory-collector
   ```
4. All instruments came back online immediately after DNS was fixed

### Diagnostic Commands Used
```bash
# Check last data timestamps
curl -s "https://telemetry.srof.com.au/api/instruments" | python3 -c "
import sys, json
for inst in json.load(sys.stdin).get('instruments', []):
    print(f\"{inst.get('code')}: {inst.get('last_reading_at')}\")"

# Check collector logs
ssh observatory-pi "sudo journalctl -u observatory-collector -n 50 --no-pager"

# Test DNS resolution
ssh observatory-pi "getent hosts telemetry.srof.com.au"

# Test instrument connectivity
ssh observatory-pi "ping -c 1 192.168.10.124"
ssh observatory-pi "curl -v --connect-timeout 5 http://192.168.10.124/v1/current_conditions"

# Check DNS config
ssh observatory-pi "cat /etc/resolv.conf"

# Force Google DNS (temporary fix)
ssh observatory-pi "echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf"
```

### Prevention
- Consider adding 8.8.8.8 as a fallback DNS server in the Pi's network config
- Monitor the local DNS server (192.168.1.4) for issues
- The collector could potentially cache the IP address for telemetry.srof.com.au as a fallback

### Timeline
- 22:00 UTC Jan 20: Instruments started timing out (HTTP failures despite ping working)
- 22:16 UTC Jan 20: Last successful data push to API
- 10:47 UTC Jan 21: Issue discovered and Pi rebooted
- 10:51 UTC Jan 21: DNS fixed, collector restarted, data flowing again

---

## Template for Future Issues

### YYYY-MM-DD: [Brief Description]

### Symptoms
-

### Root Cause
-

### Resolution
1.

### Diagnostic Commands Used
```bash

```

### Prevention
-
