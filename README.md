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
| [Config UI X](https://github.com/oznu/homebridge-config-ui-x/wiki) | [Config UI X Wiki](https://github.com/oznu/homebridge-config-ui-x/wiki) | Homebridge Web User Interface | Recommended |
| [Tasmota Control](https://www.npmjs.com/package/homebridge-tasmota-control) | [Plug-In Wiki](https://github.com/grzegorz914/homebridge-tasmota-control/wiki) | Homebridge Plug-In | Required |

### Configuration
* Run this plugin as a [Child Bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) (Highly Recommended), this prevent crash Homebridge if plugin crashes.
* Install and use [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x/wiki) to configure this plugin (Highly Recommended). 
* The `sample-config.json` can be edited and used as an alternative. 
* Be sure to always make a backup copy of your config.json file before making any changes to it.

<p align="left">
  <a href="https://github.com/grzegorz914/homebridge-tasmota-control"><img src="https://raw.githubusercontent.com/grzegorz914/homebridge-tasmota-control/master/graphics/ustawienia.png" width="840"></a>
</p>

| Key | Description | 
| --- | --- |
| `name` | Here set the accessory *Name* to be displayed in *Homebridge/HomeKit*. |
| `host` | Here set the *Hsostname or Address IP* of the Device.|
| `auth` | If enabled, authorizatins credentials will be used for login. |
| `user` | Here set the authorization *Username*. |
| `passwd` | Here set the authorization *Password*. |
| `enableDebugMode` | This enable deep log in homebridge console. |
| `disableLogInfo` | This disable log info, all values and state will not be displayed in Homebridge log console. |
| `disableLogDeviceInfo` | If enabled, add ability to disable log device info by every connections device to the network. |
