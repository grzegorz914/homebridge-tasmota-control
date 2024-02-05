<p align="center">
  <a href="https://github.com/grzegorz914/homebridge-tasmota-control"><img src="https://raw.githubusercontent.com/grzegorz914/homebridge-tasmota-control/main/graphics/homebridge-tasmota-control.png" width="640"></a>
</p>

<span align="center">

# Homebridge Tasmota Control

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://badgen.net/npm/dt/homebridge-tasmota-control?color=purple)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![npm](https://badgen.net/npm/v/homebridge-tasmota-control?color=purple)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![npm](https://img.shields.io/npm/v/homebridge-tasmota-control/beta.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-tasmota-control)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/grzegorz914/homebridge-tasmota-control.svg)](https://github.com/grzegorz914/homebridge-tasmota-control/pulls)
[![GitHub issues](https://img.shields.io/github/issues/grzegorz914/homebridge-tasmota-control.svg)](https://github.com/grzegorz914/homebridge-tasmota-control/issues)

Homebridge plugin for Tasmota flashed devices.

</span>

## Package Requirements

| Package | Installation | Role | Required |
| --- | --- | --- | --- |
| [Homebridge](https://github.com/homebridge/homebridge) | [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) | HomeKit Bridge | Required |
| [Config UI X](https://github.com/homebridge/homebridge-config-ui-x) | [Config UI X Wiki](https://github.com/homebridge/homebridge-config-ui-x/wiki) | Homebridge Web User Interface | Recommended |
| [Tasmota Control](https://www.npmjs.com/package/homebridge-tasmota-control) | [Plug-In Wiki](https://github.com/grzegorz914/homebridge-tasmota-control/wiki) | Homebridge Plug-In | Required |

## About The Plugin

* Plugin work with Tasmota v6.0.0 and abowe.
* Supported relay devices:
  * Light - `Power ON/OFF`, `Dimmer`, `Color Temperature`, `Hue`, `Saturation`
  * Outlet - `Power ON/OFF`
  * Switch - `Power ON/OFF`
* Supported Sensors:
  * Temperature - `Temperature`, `Dew Point`, `Reference`, `Obj`, `Amb`
  * Humidity
  * Carbon Dioxyde
  * Ambient Light
  * Motion

### Configuration

* Run this plugin as a [Child Bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) (Highly Recommended), this prevent crash Homebridge if plugin crashes.
* Install and use [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x/wiki) to configure this plugin (Highly Recommended).
* The `sample-config.json` can be used as an alternative, make a backup copy before making any changes.

<p align="center">
  <a href="https://github.com/grzegorz914/homebridge-tasmota-control"><img src="https://raw.githubusercontent.com/grzegorz914/homebridge-tasmota-control/master/graphics/ustawienia.png" width="840"></a>
</p>

| Key | Description |
| --- | --- |
| `name` | Here set the accessory *Name* to be displayed in *Homebridge/HomeKit*. |
| `host` | Here set the *Hsostname or Address IP* of the Device.|
| `auth` | If enabled, authorizatins credentials will be used for login. |
| `user` | Here set the authorization *Username*. |
| `passwd` | Here set the authorization *Password*. |
| `relaysNamePrefix` | Here enable/disable the accessory name as a prefix for relays name. |
| `relaysDisplayType` | Here select characteristic display type for relays which are exposed in the HomeKit app. |
| `lightsNamePrefix` | Here enable/disable the accessory name as a prefix for lights name. |
| `sensorsNamePrefix` | Here enable/disable the accessory name as a prefix for sensors name. |
| `loadNameFromDevice` | If enabled, the accessory name will be loaded direct from device. |
| `refreshInterval` | Here set the data refresh time in (sec). |
| `enableDebugMode` | This enable debug log in homebridge console. |
| `disableLogInfo` | This disable log info, all values and state will not be displayed in Homebridge log console. |
| `disableLogDeviceInfo` | If enabled, add ability to disable log device info by every connections device to the network. |
