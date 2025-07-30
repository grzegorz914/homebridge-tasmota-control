import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import DeviceInfo from './src/deviceinfo.js';
import MiElHvac from './src/mielhvac.js';
import Switches from './src/switches.js';
import Lights from './src/lights.js';
import Fans from './src/fans.js';
import Sensors from './src/sensors.js';
import ImpulseGenerator from './src/impulsegenerator.js';
import { PluginName, PlatformName } from './src/constants.js';
import CustomCharacteristics from './src/customcharacteristics.js';

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log(`No configuration found for ${PluginName}.`);
      return;
    }
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
        const url = `http://${host}/cm?cmnd=`;
        const auth = device.auth || false;
        const user = device.user || '';
        const passwd = device.passwd || '';
        const loadNameFromDevice = device.loadNameFromDevice || false;
        const refreshInterval = device.refreshInterval * 1000 || 5000;
        const enableDebugMode = device.enableDebugMode || false;
        const disableLogDeviceInfo = device.disableLogDeviceInfo || false;
        const disableLogInfo = device.disableLogInfo || false;
        const disableLogSuccess = device.disableLogSuccess || false;
        const disableLogWarn = device.disableLogWarn || false;
        const disableLogError = device.disableLogError || false;
        const debug = !enableDebugMode ? false : log.info(`Device: ${host} ${deviceName}, debug: Did finish launching.`);
        const newConfig = {
          ...device,
          user: 'removed',
          passwd: 'removed'
        };
        const debug1 = !enableDebugMode ? false : log.info(`Device: ${host} ${deviceName}, Config: ${JSON.stringify(newConfig, null, 2)}.`);

        try {
          //get device info
          const deviceInfo = new DeviceInfo(url, auth, user, passwd, deviceName, loadNameFromDevice, enableDebugMode, refreshInterval)
            .on('debug', (debug) => {
              const emitLog = !enableDebugMode ? false : log.info(`Device: ${host} ${deviceName}, debug: ${debug}.`);
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

          const info = await deviceInfo.getInfo();
          if (!info.serialNumber) {
            log.warn(`Device: ${host} ${deviceName}, serial not found.`);
            return;
          }

          let i = 0;
          for (const type of info.deviceTypes) {
            const serialNumber = i === 0 ? info.serialNumber : `${info.serialNumber}${i}`;

            let deviceType;
            switch (type) {
              case 0: //mielhvac
                //check files exists, if not then create it
                try {
                  const postFix = device.host.split('.').join('');
                  info.defaultHeatingSetTemperatureFile = `${prefDir}/defaultHeatingSetTemperature_${postFix}`;
                  info.defaultCoolingSetTemperatureFile = `${prefDir}/defaultCoolingSetTemperature_${postFix}`;
                  const files = [
                    info.defaultHeatingSetTemperatureFile,
                    info.defaultCoolingSetTemperatureFile
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

                deviceType = new MiElHvac(api, device, info, serialNumber, refreshInterval);
                break;
              case 1: //switches
                deviceType = new Switches(api, device, info, serialNumber, refreshInterval);
                break;
              case 2: //lights
                deviceType = new Lights(api, device, info, serialNumber, refreshInterval);
                break;
              case 3: //fans
                deviceType = new Fans(api, device, info, serialNumber, refreshInterval);
                break;
              case 4: //sensors
                deviceType = new Sensors(api, device, info, serialNumber, refreshInterval);
                break;
              default:
                const emitLog = disableLogWarn ? false : log.warn(`Device: ${host} ${deviceName}, unknown device: ${info.deviceTypes}.`);
                return;
            }

            deviceType.on('publishAccessory', (accessory) => {
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
                const startDone = await deviceType.start();
                const stopImpulseGenerator = startDone ? await impulseGenerator.stop() : false;

                //start impulse generator 
                const startImpulseGenerator = stopImpulseGenerator ? await deviceType.startImpulseGenerator() : false
              } catch (error) {
                const emitLog = disableLogError ? false : log.error(`Device: ${host} ${deviceName}, ${error}, trying again.`);
              }
            }).on('state', (state) => {
              const emitLog = !enableDebugMode ? false : state ? log.info(`Device: ${host} ${deviceName}, Start impulse generator started.`) : log.info(`Device: ${host} ${deviceName}, Start impulse generator stopped.`);
            });

            //start impulse generator
            await impulseGenerator.start([{ name: 'start', sampling: 45000 }]);
            i++;
          }
        } catch (error) {
          const emitLog = disableLogError ? false : log.error(`Device: ${host} ${deviceName}, Did finish launching error: ${error}.`);
        }
      }
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}

export default (api) => {
  CustomCharacteristics(api);
  api.registerPlatform(PluginName, PlatformName, tasmotaPlatform);
}