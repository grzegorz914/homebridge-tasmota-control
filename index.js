'use strict';
const fs = require('fs');
const path = require('path');
const TasmotaDevice = require('./src/tasmotadevice.js');
const CONSTANTS = require('./src/constants.json');

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log(`No configuration found for ${CONSTANTS.PluginName}.`);
      return;
    };
    this.accessories = [];

    //check if prefs directory exist
    const prefDir = path.join(api.user.storagePath(), 'tasmota');
    try {
      fs.mkdirSync(prefDir, { recursive: true });
    } catch (error) {
      log.error(`Prepare directory error: ${error.message ?? error}`);
      return;
    }

    api.on('didFinishLaunching', async () => {
      for (const device of config.devices) {
        if (!device.name || !device.host) {
          log.warn(`Device Name: ${device.name ? 'OK' : device.name}, host: ${device.host ? 'OK' : device.host}, in config wrong or missing.`);
          return;
        }

        //debug config
        const debug = device.enableDebugMode ? log.info(`Device: ${device.host} ${device.name}, did finish launching.`) : false;
        const config = {
          ...device,
          user: 'removed',
          passwd: 'removed'
        };
        const debug1 = device.enableDebugMode ? log.info(`Device: ${device.host} ${device.name}, Config: ${JSON.stringify(config, null, 2)}`) : false;

        //check files exists, if not then create it
        const postFix = device.host.split('.').join('');
        const defaultHeatingSetTemperatureFile = `${prefDir}/defaultHeatingSetTemperature_${postFix}`;
        const defaultCoolingSetTemperatureFile = `${prefDir}/defaultCoolingSetTemperature_${postFix}`;

        try {
          const files = [
            defaultHeatingSetTemperatureFile,
            defaultCoolingSetTemperatureFile
          ];

          files.forEach((file, index) => {
            if (!fs.existsSync(file)) {
              const data = ['20', '23'][index]
              fs.writeFileSync(file, data);
            }
          });
        } catch (error) {
          log.error(`Device: ${device.host} ${device.name}, prepare files error: ${error}`);
          return;
        }

        //tasmota device
        try {
          const miElHvac = device.miElHvac ?? {};
          const tasmotaDevice = new TasmotaDevice(api, device, miElHvac, defaultHeatingSetTemperatureFile, defaultCoolingSetTemperatureFile);
          tasmotaDevice.on('publishAccessory', (accessory) => {
            api.publishExternalAccessories(CONSTANTS.PluginName, [accessory]);
            log.success(`Device: ${device.host} ${device.name}, published as external accessory.`);
          })
            .on('devInfo', (devInfo) => {
              log.info(devInfo);
            })
            .on('success', (message) => {
              log.success(`Device: ${device.host} ${device.name}, ${message}`);
            })
            .on('message', (message) => {
              log.info(`Device: ${device.host} ${device.name}, ${message}`);
            })
            .on('debug', (debug) => {
              log.info(`Device: ${device.host} ${device.name}, debug: ${debug}`);
            })
            .on('warn', (warn) => {
              log.warn(`Device: ${device.host} ${device.name}: ${warn}`);
            })
            .on('error', async (error) => {
              log.error(`Device: ${device.host} ${device.name}, ${error}`);
            });

          await tasmotaDevice.start();
        } catch (error) {
          log.error(`Device: ${device.host} ${device.name}, did finish launch error: ${error}.`);
        }
      };
    });
  };

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  };
};

module.exports = (api) => {
  api.registerPlatform(CONSTANTS.PluginName, CONSTANTS.PlatformName, tasmotaPlatform, true);
};