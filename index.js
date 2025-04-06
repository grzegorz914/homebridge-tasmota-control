import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
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
      log.error(`Prepare directory error: ${error}.`);
      return;
    }

    api.on('didFinishLaunching', async () => {
      for (const device of config.devices) {

        //check accessory is enabled
        const disableAccessory = device.disableAccessory || false;
        if (disableAccessory) {
          continue;
        }

        const deviceName = device.name;
        const host = device.host;
        if (!deviceName || !host) {
          log.warn(`Device Name: ${deviceName ? 'OK' : deviceName}, host: ${host ? 'OK' : host}, in config wrong or missing.`);
          return;
        }

        //log config
        const enableDebugMode = device.enableDebugMode || false;
        const disableLogDeviceInfo = device.disableLogDeviceInfo || false;
        const disableLogInfo = device.disableLogInfo || false;
        const disableLogSuccess = device.disableLogSuccess || false;
        const disableLogWarn = device.disableLogWarn || false;
        const disableLogError = device.disableLogError || false;
        const debug = enableDebugMode ? log.info(`Device: ${host} ${deviceName}, debug: Did finish launching.`) : false;
        const config = {
          ...device,
          user: 'removed',
          passwd: 'removed'
        };
        const debug1 = !enableDebugMode ? false : log.info(`Device: ${host} ${deviceName}, Config: ${JSON.stringify(config, null, 2)}.`);

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
            if (!existsSync(file)) {
              const data = ['20', '23'][index]
              writeFileSync(file, data);
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
            const emitLog = disableLogSuccess ? false : log.success(`Device: ${host} ${deviceName}, Published as external accessory.`);
          })
            .on('devInfo', (devInfo) => {
              const emitLog = disableLogDeviceInfo ? false : log.info(devInfo);
            })
            .on('success', (success) => {
              const emitLog = disableLogSuccess ? false : log.success(`Device: ${host} ${deviceName}, ${success}.`);
            })
            .on('info', (info) => {
              const emitLog = disableLogInfo ? false : log.info(`Device: ${host} ${deviceName}, ${info}.`);
            })
            .on('debug', (debug) => {
              const emitLog = !enableDebugMode ? false : log.info(`Device: ${host} ${deviceName}, debug: ${debug}.`);
            })
            .on('warn', (warn) => {
              const emitLog = disableLogWarn ? false : log.warn(`Device: ${host} ${deviceName}, ${warn}.`);
            })
            .on('error', (error) => {
              const emitLog = disableLogError ? false : log.error(`Device: ${host} ${deviceName}, ${error}.`);
            });

          //create impulse generator
          const impulseGenerator = new ImpulseGenerator();
          impulseGenerator.on('start', async () => {
            try {
              const startDone = await tasmotaDevice.start();
              const stopImpulseGenerator = startDone ? await impulseGenerator.stop() : false;

              //start impulse generator 
              const startImpulseGenerator = startDone ? await tasmotaDevice.startImpulseGenerator() : false
            } catch (error) {
              const emitLog = disableLogError ? false : log.error(`Device: ${host} ${deviceName}, ${error}, trying again.`);
            };
          }).on('state', (state) => {
            const emitLog = !enableDebugMode ? false : state ? log.info(`Device: ${host} ${deviceName}, Start impulse generator started.`) : log.info(`Device: ${host} ${deviceName}, Start impulse generator stopped.`);
          });

          //start impulse generator
          await impulseGenerator.start([{ name: 'start', sampling: 45000 }]);
        } catch (error) {
          const emitLog = disableLogError ? false : log.error(`Device: ${host} ${deviceName}, Did finish launching error: ${error}.`);
        }
      };
    });
  };

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  };
};

export default (api) => {
  api.registerPlatform(PluginName, PlatformName, tasmotaPlatform);
};