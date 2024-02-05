'use strict';
const fs = require('fs');
const path = require('path');
const TasmotaDevice = require('./src/tasmotadevice.js');
const CONSTANS = require('./src/constans.json');

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log(`No configuration found for ${CONSTANS.PluginName}.`);
      return;
    };
    this.accessories = [];

    //check if prefs directory exist
    const prefDir = path.join(api.user.storagePath(), 'tasmota');
    if (!fs.existsSync(prefDir)) {
      fs.mkdirSync(prefDir);
    };

    api.on('didFinishLaunching', () => {
      for (const device of config.devices) {
        if (!device.name || !device.host) {
          log.warn(`Device Name: ${device.name ? 'OK' : device.name}, host: ${device.host ? 'OK' : device.host}, in config wrong or missing.`);
          return;
        }

        //debug config
        const debug = device.enableDebugMode ? log(`Device: ${device.host} ${device.name}, did finish launching.`) : false;
        const debug1 = device.enableDebugMode ? log(`Device: ${device.host} ${device.name}, Config: ${JSON.stringify(device, null, 2)}`) : false;

        //tasmota device
        const tasmotaDevice = new TasmotaDevice(api, device);
        tasmotaDevice.on('publishAccessory', (accessory) => {
          api.publishExternalAccessories(CONSTANS.PluginName, [accessory]);
          const debug = device.enableDebugMode ? log(`Device: ${device.host} ${device.name}, published as external accessory.`) : false;
        })
          .on('devInfo', (devInfo) => {
            log(devInfo);
          })
          .on('message', (message) => {
            log(`Device: ${device.host} ${device.name}, ${message}`);
          })
          .on('debug', (debug) => {
            log(`Device: ${device.host} ${device.name}, debug: ${debug}`);
          })
          .on('error', (error) => {
            log.error(`Device: ${device.host} ${device.name}, ${error}`);
          });
      };
    });
  };

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  };
};

module.exports = (api) => {
  api.registerPlatform(CONSTANS.PluginName, CONSTANS.PlatformName, tasmotaPlatform, true);
};