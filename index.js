'use strict';
import fs from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';
import TasmotaDevice from './src/tasmotadevice.js';
import ImpulseGenerator from './src/impulsegenerator.js';
import { PluginName, PlatformName } from './src/constants.js';

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log(`No configuration found for ${PluginName}.`);
      return;
    };
    this.accessories = [];

    //check if prefs directory exist
    const prefDir = join(api.user.storagePath(), 'tasmota');
    try {
      mkdirSync(prefDir, { recursive: true });
    } catch (error) {
      log.error(`Prepare directory error: ${error.message ?? error}`);
      return;
    }

    api.on('didFinishLaunching', async () => {
      for (const device of config.devices) {
        const deviceName = device.name;
        const host = device.host;

        if (!deviceName || !host) {
          log.warn(`Device Name: ${deviceName ? 'OK' : deviceName}, host: ${host ? 'OK' : host}, in config wrong or missing.`);
          return;
        }

        //debug config
        const enableDebugMode = device.enableDebugMode || false;
        const debug = enableDebugMode ? log.info(`Device: ${host} ${deviceName}, did finish launching.`) : false;
        const config = {
          ...device,
          user: 'removed',
          passwd: 'removed'
        };
        const debug1 = enableDebugMode ? log.info(`Device: ${host} ${deviceName}, Config: ${JSON.stringify(config, null, 2)}`) : false;

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
          log.error(`Device: ${host} ${deviceName}, Prepare files error: ${error}`);
          return;
        }

        //tasmota device
        try {
          const miElHvac = device.miElHvac ?? {};
          const tasmotaDevice = new TasmotaDevice(api, device, miElHvac, defaultHeatingSetTemperatureFile, defaultCoolingSetTemperatureFile);
          tasmotaDevice.on('publishAccessory', (accessory) => {
            api.publishExternalAccessories(PluginName, [accessory]);
            log.success(`Device: ${host} ${deviceName}, Published as external accessory.`);
          })
            .on('devInfo', (devInfo) => {
              log.info(devInfo);
            })
            .on('success', (message) => {
              log.success(`Device: ${host} ${deviceName}, ${message}`);
            })
            .on('message', (message) => {
              log.info(`Device: ${host} ${deviceName}, ${message}`);
            })
            .on('debug', (debug) => {
              log.info(`Device: ${host} ${deviceName}, debug: ${debug}`);
            })
            .on('warn', (warn) => {
              log.warn(`Device: ${host} ${deviceName}: ${warn}`);
            })
            .on('error', async (error) => {
              log.error(`Device: ${host} ${deviceName}, ${error}`);
            });

          //create impulse generator
          const impulseGenerator = new ImpulseGenerator();
          impulseGenerator.on('start', async () => {
            try {
              await tasmotaDevice.start();
              impulseGenerator.stop();
            } catch (error) {
              log.error(`Device: ${host} ${deviceName}, ${error}, trying again.`);
            };
          }).on('state', (state) => {
            const debug = enableDebugMode ? state ? log.info(`Device: ${host} ${deviceName}, Start impulse generator started.`) : log.info(`Device: ${host} ${deviceName}, Start impulse generator stopped.`) : false;
          });

          //start impulse generator
          impulseGenerator.start([{ name: 'start', sampling: 45000 }]);
        } catch (error) {
          log.error(`Device: ${host} ${deviceName}, Did finish launch error: ${error}.`);
        }
      };
    });
  };

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  };
};

export default (api) => {
  api.registerPlatform(PluginName, PlatformName, tasmotaPlatform, true);
};