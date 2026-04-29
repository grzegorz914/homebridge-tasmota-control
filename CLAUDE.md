# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
```

There are no build, lint, or test scripts defined. The project runs directly as ESM (`"type": "module"`).

To test locally with Homebridge:
```bash
npm link                          # Link the plugin globally
homebridge -D                     # Run Homebridge in debug mode
```

## Architecture

This is a Homebridge platform plugin (`homebridge-tasmota-control`) that bridges Tasmota-flashed ESP devices to Apple HomeKit via HTTP polling.

### Entry Point & Platform Lifecycle

[index.js](index.js) is the sole entry point. It exports a factory function that registers the `TasmotaPlatform` class. On `didFinishLaunching`, it calls `setupDevice()` for each configured device in parallel (`Promise.allSettled`).

Each device goes through a two-phase startup:
1. **Startup impulse generator** — retries `startDevice()` every 120 s until the device responds with a valid MAC address (used as serial number).
2. **Device impulse generator** — once connected, polls `checkState()` on a configurable interval (default 5 s) to keep HomeKit characteristics current.

### Device Type Detection

[src/deviceinfo.js](src/deviceinfo.js) queries `Status 0` (Tasmota's full status command) and auto-detects which device types are present by inspecting the JSON keys:
- `StatusSNS.MiElHVAC` → type `0` (HVAC)
- `StatusSTS` keys matching `LightKeys` → type `2` (lights)
- `StatusSTS.FanSpeed` → type `3` (fans)
- No match above → type `1` (switches/outlets, fallback)
- `StatusSNS` keys matching `SensorKeys` → type `4` (sensors, additive)

A single device host can expose multiple types (e.g., a switch with an attached sensor).

### Device Type Classes

Each type maps to a class in [src/](src/):

| Type | Class | File |
|------|-------|------|
| 0 | `MiElHvac` | [src/mielhvac.js](src/mielhvac.js) |
| 1 | `Switches` | [src/switches.js](src/switches.js) |
| 2 | `Lights` | [src/lights.js](src/lights.js) |
| 3 | `Fans` | [src/fans.js](src/fans.js) |
| 4 | `Sensors` | [src/sensors.js](src/sensors.js) |

All classes follow the same pattern:
- Extend `EventEmitter`
- Constructor receives `(api, config, info, serialNumber, deviceInfo)` — shares the axios client from `deviceInfo` rather than creating a new one
- Expose a `start()` method that calls `checkState()` → `deviceInfo()` → `prepareAccessory()` and returns a Homebridge `Accessory`
- Expose a `this.impulseGenerator` (`ImpulseGenerator`) that fires `checkState` on an interval

### ImpulseGenerator

[src/impulsegenerator.js](src/impulsegenerator.js) is a thin `EventEmitter` wrapper around `setInterval`. Call `state(true, [{name, sampling}])` to start timers that emit named events; call `state(false)` to clear them. All device classes use a `handleWithLock()` guard to prevent concurrent `checkState` calls.

### Tasmota API

All communication uses plain HTTP GET to `http://<host>/cm?cmnd=<command>`. Commands are URL-encoded strings defined in [src/constants.js](src/constants.js) under `ApiCommands` and `MiElHVAC`. The axios client is created once in `DeviceInfo` and shared across all device classes for the same host.

### Custom Characteristics

[src/customcharacteristics.js](src/customcharacteristics.js) defines power-metering characteristics (Power, Voltage, Current, Energy, etc.) and a `PowerAndEnergy` service, registered at plugin load time before the platform is registered.

### Accessories

All accessories are published as **external accessories** via `api.publishExternalAccessories()`. This means each device must be manually paired in the Home app separately from the Homebridge bridge. Serial number = device MAC address; for multi-type devices the index is appended (`MAC0`, `MAC1`, …).

### Configuration

Config is validated by [config.schema.json](config.schema.json). Key per-device options: `host`, `auth`/`user`/`passwd`, `refreshInterval` (seconds), `disableAccessory`, `loadNameFromDevice`, `relaysDisplayType` (0=Outlet, 1=Switch), `sensorsNamePrefix`, `relaysNamePrefix`, and a `log` object with per-level boolean flags (`deviceInfo`, `success`, `info`, `warn`, `error`, `debug`).

MiEl HVAC has additional config under `miElHvac`: mode mappings (`heatDryFanMode`, `coolDryFanMode`, `autoDryFanMode`), `presets`, `buttons`, `sensors`, `frostProtect`, `remoteTemperatureSensor`, and display extras.

Persistent state (HVAC default set temperatures) is stored as plain text files in `<homebridge-storage>/tasmota/`.
