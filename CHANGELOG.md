# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - (30.11.2024)

## Changes

- move from commonJS to esm module
- moved constants.json to constants.js
- cleanup

## [1.0.0] - (04.11.2024)

## Changes

- compatibility with [Tasmota](https://github.com/grzegorz914/homebridge-tasmota-control/tree/main/firmware) build from 04.11.2024
- removed buttonsSensors config properties for MiElHVAC
- added buttons array in config.json for MiElHVAC
- added sensors array in config.json for MiElHVAC
- added remote temperature sensor state to sensors for MiElHVAC
- added operation stage to sensors for MiElHVAC
- added fan stage to sensors for MiElHVAC
- added mode stage to sensors for MiElHVAC
- config.schema update
- redme update
- cleanup

## [0.20.0] - (03.11.2024)

## Changes

- added remote temperature sensor to use as a external sensor for MiElHVAC
- config.schema update
- cleanup

## [0.19.0] - (28.10.2024)

## Changes

- added remote temperature sensor state
- config.schema update
- cleanup

## [0.18.1] - (24.10.2024)

## Changes

- added compresor frequency properties for MiElHVAC
- fix config schema validation in upcomming Config UI X update
- config.schema update
- cleanup

## [0.18.0] - (16.10.2024)

## Changes

- added frost protect function for MiElHVAC
- config.schema update
- redme update
- cleanup

## [0.17.0] - (14.10.2024)

## Changes

- compatibility with tasmota firmware build 14.10.2024
- add AUTO function to vane horizontal
- config.schema update
- redme update
- cleanup

## [0.16.0] - (10.10.2024)

## Changes

- add prohibit functions (power, mode, temperature, all)
- config.schema update
- redme update
- cleanup

## [0.15.0] - (06.10.2024)

## Changes

- add buttons, sensors and presets to Mitsubishi AC device (MiElHVAC)
- config.schema update
- redme update
- cleanup

## [0.14.0] - (05.10.2024)

## Changes

- add categories for accessory to homekit (required remove and add accessory again, only one time)
- fix [#17](https://github.com/grzegorz914/homebridge-tasmota-control/issues/17)
- redme update
- cleanup

## [0.13.0] - (04.10.2024)

## Changes

- add room and outdoor temperature sensors services for MiElHVAC
- config.schema update
- redme update
- cleanup

## [0.12.0] - (04.10.2024)

## Changes

- add full support to control Mitsubishi AC devices, (MiElHVAC)
- cleanup
- config.schema update
- redme update

## [0.11.0] - (22.09.2024)

## Changes

- stability and performance improvements
- logging refactor
- cleanup

## [0.10.36] - (14.08.2024)

## Changes

- hide passwords by typing and display in Config UI
- remove return duplicate promises from whole code
- bump dependencies
- config schema updated
- cleanup

## [0.10.0] - (04.02.2024)

## Changes

- add support for PIR Motion Sensors
- cleanup

## [0.9.0] - (04.02.2024)

## Changes

- add support for Light - On/Off, Brightness, Color Temperature, Hue, Saturation
- add possibility to disable/enable name prefix for relays, ligts, sensors
- config schema updated
- cleanup

## [0.8.0] - (03.02.2024)

## Changes

- add support for Ambient Light and Carbon Dioxyde Sensors
- cleanup

## [0.7.0] - (03.02.2024)

## Changes

- add support for DS18x20 sensors
- cleanup

## [0.6.0] - (03.02.2024)

## Changes

- add support for Tasmota Sensors (Temperature, Humidity, DewPoint)
- bump dependencies
- cleanup

## [0.5.0] - (01.02.2024)

## Changes

- add support for Tasmota FW. <= 12.1.1, thanks @xrayone912, [#5](https://github.com/grzegorz914/homebridge-tasmota-control/issues/5)
- bump dependencies
- cleanup

## [0.4.13] - (31.12.2022)

## Changes

- bump dependencies

## [0.4.12] - (06.12.2022)

## Changes

- update dependencies

## [0.4.11] - (02.11.2022)

## Changes

- update dependencies

## [0.4.10] - (25.08.2022)

## Changes

- added possibility to display log device info on every restart
- config schema updated

## [0.4.7] - (23.08.2022)

## Changes

- added display channel name instead device name

## [0.4.6] - (12.08.2022)

## Changes

- finally fixed report wrong device state [#4](https://github.com/grzegorz914/homebridge-tasmota-control/issues/4)

## [0.4.5] - (10.08.2022)

## Changes

- fix report wrong device state [#4](https://github.com/grzegorz914/homebridge-tasmota-control/issues/4)
- code and logs refactor
- add additional check configured host in config
- update config schema

## [0.4.4] - (23.07.2022)

## Changes

- refactor information service

## [0.4.2] - (25.04.2022)

## Changes

- update dependencies

## [0.4.1] - (08.04.2022)

## Changes

- update dependencies

## [0.4.0] - (25.02.2022)

## Added

- automatically check channels count

## Changes

- removed channelsCount properties from config.json

## [0.3.47] - (18.01.2022)

## Changes

- update dependencies

## [0.3.46] - (17.01.2022)

## Changes

- update dependencies

## [0.3.45] - (29.12.2021)

## Changs

- prepare directory and files synchronously

## [0.3.44] - (28.12.2021)

## Changs

- update node minimum requirements

## [0.3.43] - (28.12.2021)

## Changs

- code cleanup

## [0.3.42] - (26.12.2021)

## Changs

- code cleanup

## [0.3.41] - (25.12.2021)

## Changs

- catch error if happened on set state

## [0.3.39] - (25.12.2021)

## Changs

- update config.schema

## [0.3.38] - (24.12.2021)

## Changs

- initial release
