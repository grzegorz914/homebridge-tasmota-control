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

class TasmotaPlatform {
  constructor(log, config, api) {
    if (!config || !Array.isArray(config.devices)) {
      log.warn(`No configuration found for ${PluginName}`);
      return;
    }

    this.accessories = [];
    this.deviceImpulseGenerators = new Map();

    const prefDir = join(api.user.storagePath(), 'tasmota');
    try {
      mkdirSync(prefDir, { recursive: true });
    } catch (error) {
      log.error(`Prepare directory error: ${error.message ?? error}`);
      return;
    }

    api.on('didFinishLaunching', () => {
      // Each device is set up independently — a failure in one does not
      // block the others. Promise.allSettled runs all in parallel.
      Promise.allSettled(
        config.devices.map(device =>
          this.setupDevice(device, prefDir, log, api)
        )
      ).then(results => {
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            log.error(`Device[${i}] setup error: ${result.reason?.message ?? result.reason}`);
          }
        });
      });
    });
  }

  // ── Per-device setup ──────────────────────────────────────────────────────

  async setupDevice(device, prefDir, log, api) {
    const disableAccessory = device.disableAccessory ?? false;
    if (disableAccessory) return;

    const deviceName = device.name;
    const host = device.host;

    if (!deviceName || !host) {
      const reason = !deviceName ? 'name missing' : 'host missing';
      log.warn(`Device ${deviceName ?? '(unnamed)'}: ${reason} — will not be published in the Home app`);
      return;
    }

    const url = `http://${host}/cm?cmnd=`;
    const auth = device.auth ?? false;
    const user = device.user ?? '';
    const passwd = device.passwd ?? '';
    const loadNameFromDevice = device.loadNameFromDevice ?? false;
    const remoteTemperatureSensorEnable = device.miElHvac?.remoteTemperatureSensor?.enable ?? false;
    const remoteTemperatureSensorRefreshInterval = (device.miElHvac?.remoteTemperatureSensor?.refreshInterval ?? 5) * 1000;
    const refreshInterval = (device.refreshInterval ?? 5) * 1000;

    const logLevel = {
      devInfo: device.log?.deviceInfo ?? false,
      success: device.log?.success ?? false,
      info: device.log?.info ?? false,
      warn: device.log?.warn ?? false,
      error: device.log?.error ?? false,
      debug: device.log?.debug ?? false,
    };

    if (logLevel.debug) {
      log.info(`${host} ${deviceName}, debug: did finish launching`);
      const safeConfig = { ...device, user: 'removed', passwd: 'removed' };
      log.info(`${host} ${deviceName}, config: ${JSON.stringify(safeConfig, null, 2)}`);
    }

    // The startup impulse generator retries the full connect+discover cycle
    // every 120 s until it succeeds, then hands off to the device impulse
    // generators and stops itself.
    const impulseGenerator = new ImpulseGenerator()
      .on('start', async () => {
        try {
          await this.startDevice(
            device, host, deviceName, url, auth, user, passwd,
            loadNameFromDevice, remoteTemperatureSensorEnable,
            remoteTemperatureSensorRefreshInterval, refreshInterval,
            prefDir, logLevel, log, api, impulseGenerator
          );
        } catch (error) {
          if (logLevel.error) log.error(`${host} ${deviceName}, Start impulse generator error, ${error.message ?? error}, trying again.`);
        }
      })
      .on('state', (state) => {
        if (logLevel.debug) log.info(`${host} ${deviceName}, Start impulse generator ${state ? 'started' : 'stopped'}.`);
      });

    await impulseGenerator.state(true, [{ name: 'start', sampling: 120_000 }]);
  }

  // ── Connect, discover and register accessories for one device ─────────────

  async startDevice(device, host, deviceName, url, auth, user, passwd, loadNameFromDevice, remoteTemperatureSensorEnable, remoteTemperatureSensorRefreshInterval, refreshInterval, prefDir, logLevel, log, api, impulseGenerator) {
    const deviceInfo = new DeviceInfo(url, auth, user, passwd, deviceName, loadNameFromDevice, logLevel.debug)
      .on('debug', (msg) => log.info(`${host} ${deviceName}, debug: ${msg}`))
      .on('warn', (msg) => log.warn(`${host} ${deviceName}, ${msg}`))
      .on('error', (msg) => log.error(`${host} ${deviceName}, ${msg}`));

    const info = await deviceInfo.getInfo();

    if (!info.serialNumber) {
      if (logLevel.warn) log.warn(`${host} ${deviceName}, serial not found — will retry.`);
      return;
    }

    // Stop the startup generator — device info resolved successfully
    await impulseGenerator.state(false);

    // Clean up any previously registered impulse generators for this host
    if (this.deviceImpulseGenerators.has(host)) {
      for (const gen of this.deviceImpulseGenerators.get(host)) {
        await gen.state(false);
      }
    }

    const activeGenerators = [];
    this.deviceImpulseGenerators.set(host, activeGenerators);

    // Register each device type discovered on this host
    for (const [index, type] of info.deviceTypes.entries()) {
      await this.registerDevice({
        device, host, deviceName, type, index, info, deviceInfo,
        remoteTemperatureSensorEnable, remoteTemperatureSensorRefreshInterval,
        refreshInterval, prefDir, logLevel, log, api, activeGenerators,
      });
    }
  }

  // ── Register a single device type as a Homebridge accessory ──────────────

  async registerDevice({ device, host, deviceName, type, index, info, deviceInfo, remoteTemperatureSensorEnable, remoteTemperatureSensorRefreshInterval, refreshInterval, prefDir, logLevel, log, api, activeGenerators }) {
    const serialNumber = index === 0 ? info.serialNumber : `${info.serialNumber}${index}`;

    // Prepare temperature files only for MiEl HVAC type
    if (type === 0) {
      try {
        const postFix = host.split('.').join('');
        info.defaultHeatingSetTemperatureFile = `${prefDir}/defaultHeatingSetTemperature_${postFix}`;
        info.defaultCoolingSetTemperatureFile = `${prefDir}/defaultCoolingSetTemperature_${postFix}`;

        const temperatureFiles = [
          { file: info.defaultHeatingSetTemperatureFile, defaultValue: '20' },
          { file: info.defaultCoolingSetTemperatureFile, defaultValue: '23' },
        ];
        for (const { file, defaultValue } of temperatureFiles) {
          if (!existsSync(file)) writeFileSync(file, defaultValue);
        }
      } catch (error) {
        if (logLevel.error) log.error(`${host} ${deviceName}, Prepare files error: ${error.message ?? error}`);
        return;
      }
    }

    // Skip accessories already present in the Homebridge cache
    if (this.accessories.some(acc => acc.UUID === serialNumber)) {
      if (logLevel.debug) log.info(`${host} ${deviceName}, serial ${serialNumber} already registered — skipping.`);
      return;
    }

    let deviceClass;
    switch (type) {
      case 0: deviceClass = new MiElHvac(api, device, info, serialNumber, deviceInfo); break; // HVAC
      case 1: deviceClass = new Switches(api, device, info, serialNumber, deviceInfo); break; // switches
      case 2: deviceClass = new Lights(api, device, info, serialNumber, deviceInfo); break; // lights
      case 3: deviceClass = new Fans(api, device, info, serialNumber, deviceInfo); break; // fans
      case 4: deviceClass = new Sensors(api, device, info, serialNumber, deviceInfo); break; // sensors
      default:
        if (logLevel.warn) log.warn(`${host} ${deviceName}, received unknown device type: ${type}.`);
        return;
    }

    deviceClass
      .on('devInfo', (msg) => logLevel.devInfo && log.info(msg))
      .on('success', (msg) => logLevel.success && log.success(`${host} ${deviceName}, ${msg}`))
      .on('info', (msg) => log.info(`${host} ${deviceName}, ${msg}`))
      .on('debug', (msg) => log.info(`${host} ${deviceName}, debug: ${msg}`))
      .on('warn', (msg) => log.warn(`${host} ${deviceName}, ${msg}`))
      .on('error', (msg) => log.error(`${host} ${deviceName}, ${msg}`));

    const accessory = await deviceClass.start();
    if (accessory) {
      api.publishExternalAccessories(PluginName, [accessory]);
      if (logLevel.success) log.success(`${host} ${deviceName}, Published as external accessory.`);

      const timers = [{ name: 'checkState', sampling: refreshInterval }];
      if (remoteTemperatureSensorEnable) {
        timers.push({ name: 'updateRemoteTemp', sampling: remoteTemperatureSensorRefreshInterval });
      }

      await deviceClass.impulseGenerator.state(true, timers);
      activeGenerators.push(deviceClass.impulseGenerator);
    }
  }

  // ── Homebridge accessory cache ────────────────────────────────────────────

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}

export default (api) => {
  CustomCharacteristics(api);
  api.registerPlatform(PluginName, PlatformName, TasmotaPlatform);
};