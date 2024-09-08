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
    if (!fs.existsSync(prefDir)) {
      fs.mkdirSync(prefDir);
    };

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

        //tasmota device
        const tasmotaDevice = new TasmotaDevice(api, device);
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
            log.error(`Device: ${device.host} ${device.name}, ${error}, trying again in 15s.`);

            //start data refresh
            tasmotaDevice.impulseGenerator.stop();
            await new Promise(resolve => setTimeout(resolve, 15000));
            tasmotaDevice.start();
          });
        await new Promise(resolve => setTimeout(resolve, 750));
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