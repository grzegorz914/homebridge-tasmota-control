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
        if (disableAccessory) continue;

        const deviceName = device.name;
        const host = device.host;
        if (!deviceName || !host) {
          log.warn(`Device Name: ${deviceName ? 'OK' : deviceName}, host: ${host ? 'OK' : host}, in config wrong or missing.`);
          continue;
        }

        //config
        const url = `http://${host}/cm?cmnd=`;
        const auth = device.auth || false;
        const user = device.user || '';
        const passwd = device.passwd || '';
        const loadNameFromDevice = device.loadNameFromDevice || false;
        const remoteTemperatureSensorEnable = device.miElHvac?.remoteTemperatureSensor?.enable;
        const remoteTemperatureSensorRefreshInterval = (device.miElHvac?.remoteTemperatureSensor?.refreshInterval ?? 5) * 1000;
        const refreshInterval = (device.refreshInterval ?? 5) * 1000;

        //log config
        const logLevel = {
          devInfo: device.log?.deviceInfo,
          success: device.log?.success,
          info: device.log?.info,
          warn: device.log?.warn,
          error: device.log?.error,
          debug: device.log?.debug
        };

        if (logLevel.debug) log.info(`Device: ${host} ${deviceName}, debug: Did finish launching.`);
        const newConfig = {
          ...device,
          user: 'removed',
          passwd: 'removed'
        };
        if (logLevel.debug) log.info(`Device: ${host} ${deviceName}, Config: ${JSON.stringify(newConfig, null, 2)}.`);

        try {
          //create impulse generator
          const impulseGenerator = new ImpulseGenerator()
            .on('start', async () => {
              try {
                //get device info
                const deviceInfo = new DeviceInfo(url, auth, user, passwd, deviceName, loadNameFromDevice, logLevel.debug)
                  .on('debug', (msg) => log.info(`Device: ${host} ${deviceName}, debug: ${msg}`))
                  .on('warn', (msg) => log.warn(`Device: ${host} ${deviceName}, ${msg}`))
                  .on('error', (msg) => log.error(`Device: ${host} ${deviceName}, ${msg}`));

                const info = await deviceInfo.getInfo();
                if (!info.serialNumber) {
                  log.warn(`Device: ${host} ${deviceName}, serial not found.`);
                  return;
                }

                let i = 0;
                for (const type of info.deviceTypes) {
                  const serialNumber = i === 0 ? info.serialNumber : `${info.serialNumber}${i}`;

                  //check files exists, if not then create it
                  if (type === 0) {
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
                          const data = ['20', '23'][index];
                          writeFileSync(file, data);
                        }
                      });
                    } catch (error) {
                      if (logLevel.error) log.error(`Device: ${host} ${deviceName}, Prepare files error: ${error.message ?? error}`);
                      continue;
                    }
                  }

                  let deviceType;
                  switch (type) {
                    case 0: //mielhvac
                      deviceType = new MiElHvac(api, device, info, serialNumber, deviceInfo);
                      break;
                    case 1: //switches
                      deviceType = new Switches(api, device, info, serialNumber, deviceInfo);
                      break;
                    case 2: //lights
                      deviceType = new Lights(api, device, info, serialNumber, deviceInfo);
                      break;
                    case 3: //fans
                      deviceType = new Fans(api, device, info, serialNumber, deviceInfo);
                      break;
                    case 4: //sensors
                      deviceType = new Sensors(api, device, info, serialNumber, deviceInfo);
                      break;
                    default:
                      if (logLevel.warn) log.warn(`Device: ${host} ${deviceName}, unknown device: ${info.deviceTypes}.`);
                      continue;
                  }

                  deviceType.on('devInfo', (msg) => logLevel.devInfo && log.info(msg))
                    .on('success', (msg) => logLevel.success && log.success(`Device: ${host} ${deviceName}, ${msg}`))
                    .on('info', (msg) => log.info(`Device: ${host} ${deviceName}, ${msg}`))
                    .on('debug', (msg) => log.info(`Device: ${host} ${deviceName}, debug: ${msg}`))
                    .on('warn', (msg) => log.warn(`Device: ${host} ${deviceName}, ${msg}`))
                    .on('error', (msg) => log.error(`Device: ${host} ${deviceName}, ${msg}`));

                  const accessory = await deviceType.start();
                  if (accessory) {
                    api.publishExternalAccessories(PluginName, [accessory]);
                    if (logLevel.success) log.success(`Device: ${host} ${deviceName}, Published as external accessory.`);

                    //start impulse generator
                    const timers = [{ name: 'checkState', sampling: refreshInterval }];
                    if (remoteTemperatureSensorEnable) timers.push({ name: 'updateRemoteTemp', sampling: remoteTemperatureSensorRefreshInterval });
                    await deviceType.impulseGenerator.state(true, timers);

                    //stop impulse generator
                    await impulseGenerator.state(false);
                  }

                  i++;
                }
              } catch (error) {
                if (logLevel.error) log.error(`Device: ${host} ${deviceName}, Start impulse generator error: ${error.message ?? error}, trying again.`);
              }
            }).on('state', (state) => {
              if (logLevel.debug) log.info(`Device: ${host} ${deviceName}, Start impulse generator ${state ? 'started' : 'stopped'}.`);
            });

          //start impulse generator
          await impulseGenerator.state(true, [{ name: 'start', sampling: 120000 }]);
        } catch (error) {
          if (logLevel.error) log.error(`Device: ${host} ${deviceName}, Did finish launching error: ${error.message ?? error}.`);
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
