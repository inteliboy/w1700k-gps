# luci-app-w1700k-gps

A LuCI app and small helper services for the GPS receiver built into the
**Gemtek W1700K** (Quantum Fiber W1700k) Wi-Fi 7 router. The receiver is an Airoha AG3352 on
`/dev/ttyS2` (921600 8N1, NMEA once a second). The package is an OpenWrt **package feed**: add it to your
buildroot or SDK and build `luci-app-w1700k-gps`.

It adds **Services → GPS** to LuCI with two tabs (Status, Settings), plus optional background services.

## Features

| | |
|---|---|
| Live status | fix, position, altitude, speed, DOP, satellites per constellation, sky plot, SNR bars, last NMEA sentences, receiver firmware string, OpenStreetMap view (tiles are loaded by *your browser*, the router needs no internet for it) |
| Fix history | RAM-only charts (satellites, signal, HDOP) sampled once a minute, time to first fix, time to regain a lost fix |
| Sky coverage | RAM-only heat map of which parts of the sky the receiver hears (15° × 10° cells) and a blocked-direction finder |
| Antenna check | plain-language hints from the live reading and the sky map (too few satellites, weak signal, nothing overhead, one side dead, high HDOP) |
| Router clock | set the system clock from GPS (button, or opt-in automatic correction when more than 5 s off) |
| Last known position | manual or saved from a good fix, shown on the map while there is no fix |
| Satellite prediction (EPO) | opt-in: downloads MediaTek EPO orbit data and gives it to the receiver for faster fixes after a cold start (see below) |
| Sharing (all opt-in) | raw **NMEA over TCP**, the **gpsd JSON protocol** (TPV/SKY, no gpsd needed), **MQTT** with **Home Assistant discovery**, and a **stratum 1 SNTP server** |

### What it does not do

* **No PPS.** There is no PPS signal on this board (no `/dev/pps*`), so time comes from NMEA text only. The
  Status page shows the measured offset and jitter; expect roughly a tenth of a second. Fine for logs and home
  devices, not for precise timing.
* **No position hint to the receiver.** No documented receiver command for it was found, and this app never
  sends unverified commands. The only things it ever writes to the chip are a `$PAIR020` version query and,
  if you enable it, `$PAIR471` EPO records (volatile aiding data, nothing is stored in the chip's flash).
* Indoors a router usually has **no fix**. Everything that needs a fix (position, clock, time server) waits for one.

## Build

You need an OpenWrt buildroot or SDK that already builds the LuCI feed, for the W1700K target.

```sh
# in your buildroot / SDK
echo 'src-git w1700kgps https://github.com/inteliboy/w1700k-gps.git' >> feeds.conf
./scripts/feeds update w1700kgps
./scripts/feeds install -a -p w1700kgps
make menuconfig          # LuCI -> Applications -> luci-app-w1700k-gps  (<M> for a package, <*> for the image)
make package/feeds/w1700kgps/luci-app-w1700k-gps/compile V=s
```

Use `src-link` instead of `src-git` to build from a local clone. The result is a `noarch` package
(`luci-app-w1700k-gps-<version>.apk`, or `.ipk` on opkg based trees) under `bin/packages/*/`.
On the device: `apk add --allow-untrusted luci-app-w1700k-gps-*.apk` (or `opkg install`).

Dependencies: `luci-base ucode ucode-mod-fs ucode-mod-uci ucode-mod-socket ucode-mod-math coreutils-stty curl`.
`coreutils-stty` is needed because the serial port must be configured at 921600 baud and BusyBox `stty` is not
always built with it. `curl` is only used by the EPO downloader.

The package contains only scripts, so it can be built on any host.

## Settings

Everything is in `/etc/config/w1700k_gps` (root-only, mode 0600) and the **Settings** tab.

| Section | Option | Default | Meaning |
|---|---|---|---|
| `epo` | `enabled`, `host`, `vendor`, `project`, `device_id` | off | satellite prediction, see below |
| `clock` | `auto` | 0 | correct a clock that is >5 s off when there is a fix |
| `position` | `auto`, `lat`, `lon` | 0 | remember the last good fix (writes flash at most once an hour) |
| `serve` | `bind`, `nmea_enabled`, `nmea_port`, `gpsd_enabled`, `gpsd_port` | off, 10110, 2947 | TCP servers; `bind` empty = the LAN address of the router |
| `ntp` | `enabled`, `port` | off, 123 | SNTP server on the same address; pick another port if the router's own NTP server uses 123 |
| `mqtt` | `enabled`, `host`, `port`, `user`, `pass`, `base`, `discovery`, `prefix`, `interval` | off | publish to `<base>/state` (retained JSON), availability on `<base>/availability`, Home Assistant discovery under `<prefix>` |

### Satellite prediction (EPO) credentials

The EPO service wants a vendor name, a project token and a device ID. **This repository ships none of them and
nothing is pre-filled**; the EPO service stays idle until you enter vendor and project in the Settings tab
(everything else works without it). The device ID is generated randomly at install. Use of the EPO service is
subject to its operator's terms.

Where to find the vendor and project values of your device, from the original (stock) firmware:

* The stock firmware **image** ships them blank (`/etc/default/anld/anld.conf`). On a running stock device the
  Axon platform manager keeps the real values in its persistent settings, `/etc/config/axon_platform_manager`
  (JSON, properties `axon.gps.anld.config.epoVendor`, `epoProject`, `epoDeviceId`).
* **They can be read from a raw MTD flash backup of the original firmware.** That file lives on the big
  writable `system` partition (the ~312 MiB one, `mtd9.bin` in a typical `mtd0.bin`...`mtd9.bin` dump taken from
  the stock device, for example `Y:lash_backup\mtd9.bin`). The flash is a log-structured filesystem, so the
  settings file shows up as plain text, usually several times (older copies of the same file). The small
  partitions (`mtd0`-`mtd2` bootloader, U-Boot environment and device data, and the Wi-Fi calibration partition)
  do not contain them.

  ```sh
  # Linux / WSL / Git Bash
  strings -a mtd9.bin | grep -A1 -E 'epoVendor|epoProject' | head -20
  ```
  ```python
  # anywhere with Python 3
  d = open('mtd9.bin', 'rb').read()
  for key in (b'epoVendor', b'epoProject'):
      i = d.find(key)
      print(key.decode(), d[i:i + 80])
  ```

  The vendor is a short word and the project a 43 character token (letters, digits, `-` and `_`) right after
  its key name. Compressed flash nodes put a few binary bytes between the key and the value; ignore those.
  The same file also holds `epoDeviceId`, which is unique to the original device. You do **not** need it:
  this package generates its own random device ID.
* They are specific to your device family's firmware; do not publish them.

Verified by finding both values in the raw `mtd9` dump of one stock device. Nobody has confirmed here that the
EPO server keeps accepting them, or that other firmware versions store them in the same place.

## Security notes

* All sharing features are **off by default** and listen on the LAN address only. None of them has
  authentication or encryption, and the position of your router is sent to everyone who connects. Do not
  expose the ports to the internet.
* NMEA and gpsd clients are listen-only: nothing a client sends reaches the receiver. gpsd understands only
  `?WATCH`, `?POLL`, `?VERSION` and `?DEVICES`.
* MQTT is plain MQTT 3.1.1 without TLS. The password is stored in `/etc/config/w1700k_gps` (mode 0600).
* The LuCI ACL lets the app run exactly the helper commands it needs (`status`, `info`, `history`, `sky`,
  `serve-status`, `settime`, `mqtt-import`, EPO `status`).

## How it fits together

```
/dev/ttyS2 ──► w1700k-gps-serve (only when sharing is on) ──► /tmp/w1700k-gps.burst ─┐
     │             │  NMEA TCP · gpsd · MQTT · SNTP · time quality                     │
     │             └─ steps aside while /tmp/w1700k-gps.lock exists                    ▼
     └──────────► w1700k-gps (LuCI helper: status, info, settime, sample, history, sky)
                  w1700k-gps-epo (satellite prediction, takes the same lock when it writes)
                  w1700k-gps-hist (init service: `sample` once a minute → RAM history and sky map)
```

Only one thing reads the serial port at a time. Without the serve service the helpers read the port
themselves for about 2 s per call, under the lock directory `/tmp/w1700k-gps.lock`.

## Helper commands (root)

```
/usr/libexec/w1700k-gps status|info|settime|sample|history|sky|serve-status|mqtt-import
/usr/libexec/w1700k-gps-epo status
/usr/libexec/w1700k-gps-serve run|ntp          # started by /etc/init.d/w1700k-gps-serve
```

All print one JSON object and exit 0; failures are `{"ok":false,"error":"..."}`.

## Status of testing

Developed and tested on a W1700K running a recent OpenWrt snapshot (ucode 2026.10). The sharing services
were tested against the real receiver (no fix indoors) and against a simulated receiver with a fix, a fake
MQTT broker and a minimal SNTP client. The LuCI pages have not been looked at in every browser, and the Home
Assistant entities have not been confirmed against a real Home Assistant instance. Reports are welcome.

## License

Apache-2.0, see `LICENSE`.
