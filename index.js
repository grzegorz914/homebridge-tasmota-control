'use strict';

const path = require('path');
const axios = require('axios');
const fs = require('fs');

const API_COMMANDS = {
  Status: 'Status0',
  PowerStatus: 'Power0', //0,1,2 - Power all
  Power: 'Power',
  Off: '%20off', //0
  On: '%20on', //1
  Toggle: '%20toggle', //2
  Blink: '%20blink', //3
  BlinkOff: '%20blinkoff' //4
};

const PLUGIN_NAME = 'homebridge-tasmota-control';
const PLATFORM_NAME = 'tasmotaControl';

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
  Accessory = api.platformAccessory;
  Characteristic = api.hap.Characteristic;
  Service = api.hap.Service;
  Categories = api.hap.Categories;
  UUID = api.hap.uuid;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, tasmotaPlatform, true);
};

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log(`No configuration found for ${PLUGIN_NAME}.`);
      return;
    };

    this.log = log;
    this.api = api;
    this.devices = config.devices;
    this.accessories = [];

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching');
      for (let i = 0; i < this.devices.length; i++) {
        const device = this.devices[i];
        if (!device.name || !device.host) {
          this.log.warn('Device name or host missing!');
        } else {
          new tasmotaDevice(this.log, device, this.api);
        };
      };
    });
  };

  configureAccessory(accessory) {
    this.log.debug('configureAccessory');
    this.accessories.push(accessory);
  };

  removeAccessory(accessory) {
    this.log.debug('removeAccessory');
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  };
};

class tasmotaDevice {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;

    //device configuration
    this.name = config.name;
    this.host = config.host;
    this.user = config.user;
    this.passwd = config.passwd;
    this.auth = config.auth;
    this.refreshInterval = config.refreshInterval || 5;
    this.enableDebugMode = config.enableDebugMode || false;
    this.disableLogInfo = config.disableLogInfo || false;
    this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;

    //get Device info
    this.manufacturer = 'Tasmota';
    this.modelName = 'Model Name';
    this.serialNumber = 'Serial Number';
    this.firmwareRevision = 'Firmware Revision';

    //setup variables
    this.channelsCount = 0;
    this.startPrepareAccessory = true;

    this.prefDir = path.join(api.user.storagePath(), 'tasmota');
    const url = this.auth ? `http://${this.host}/cm?user=${this.user}&password=${this.passwd}&cmnd=` : `http://${this.host}/cm?cmnd=`

    this.axiosInstance = axios.create({
      method: 'GET',
      baseURL: url,
      timeout: 10000
    });

    //check if the directory exists, if not then create it
    if (fs.existsSync(this.prefDir) == false) {
      fs.mkdirSync(this.prefDir);
    };

    this.getDeviceInfo();
  };

  reconnect() {
    setTimeout(() => {
      this.getDeviceInfo();
    }, 15000);
  };

  updateDeviceState() {
    setTimeout(() => {
      this.checkDeviceState();
    }, this.refreshInterval * 1000);
  };

  async getDeviceInfo() {
    this.log.debug(`Device: ${this.host} ${this.name}, requesting info.`);
    try {
      const deviceInfo = await this.axiosInstance(API_COMMANDS.Status);
      const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug device info: ${JSON.stringify(deviceInfo.data, null, 2)}`) : false;

      const deviceName = deviceInfo.data.Status.DeviceName;
      const friendlyName = Array.isArray(deviceInfo.data.Status.FriendlyName) ? deviceInfo.data.Status.FriendlyName : [];
      const friendlyNameCount = friendlyName.length;
      const modelName = deviceInfo.data.StatusFWR.Hardware;
      const addressMac = deviceInfo.data.StatusNET.Mac;
      const firmwareRevision = deviceInfo.data.StatusFWR.Version;

      if (!this.disableLogDeviceInfo) {
        this.log(`----- ${this.name} -----`);
        this.log(`Manufacturer: ${this.manufacturer}`);
        this.log(`Hardware: ${modelName}`);
        this.log(`Serialnr: ${addressMac}`);
        this.log(`Firmware: ${firmwareRevision}`);
        this.log(`Channels: ${friendlyNameCount}`);
        this.log(`----------------------------------`);
      };

      this.modelName = modelName;
      this.serialNumber = addressMac;
      this.firmwareRevision = firmwareRevision;
      this.friendlyName = friendlyName;
      this.channelsCount = friendlyNameCount;

      this.checkDeviceState();
    } catch (error) {
      this.log.error(`Device: ${this.host} ${this.name}, check info error: ${error}, trying to reconnect in 15s.`);
      this.reconnect();
    };
  };

  async checkDeviceState() {
    this.log.debug(`Device: ${this.host} ${this.name}, requesting state.`, this.host, this.name);
    try {
      const friendlyName = this.friendlyName;
      const channelsCount = this.channelsCount;
      const deviceState = await this.axiosInstance(API_COMMANDS.PowerStatus);
      const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug state: ${JSON.stringify(deviceState.data, null, 2)}`) : false;

      this.powerState = [];
      this.names = [];
      for (let i = 0; i < channelsCount; i++) {
        const power = channelsCount == 1 ? 'POWER' : 'POWER' + (i + 1);
        const power1 = channelsCount == 1 ? 'POWER1' : 'POWER' + (i + 1);
        const powerState = (deviceState.data[power] != undefined) ? (deviceState.data[power] == 'ON') : (deviceState.data[power1] == 'ON');
        const name = friendlyName[i];

        this.powerState.push(powerState);
        this.names.push(name);

        if (this.tasmotaServices) {
          this.tasmotaServices[i]
            .updateCharacteristic(Characteristic.On, powerState);
        };
      };

      this.updateDeviceState();

      //start prepare accessory
      if (this.startPrepareAccessory && this.serialNumber) {
        this.prepareAccessory();
      };
    } catch (error) {
      this.log.error(`Device: ${this.host} ${this.name}, check state error: ${error}, trying again.`);
      this.updateDeviceState();
    };
  };

  //Prepare accessory
  prepareAccessory() {
    this.log.debug('prepareAccessory');
    const accessoryName = this.name;
    const accessoryUUID = UUID.generate(this.serialNumber);
    const accessoryCategory = Categories.OTHER;
    const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

    //Prepare information service
    this.log.debug('prepareInformationService');
    const manufacturer = this.manufacturer;
    const modelName = this.modelName;
    const serialNumber = this.serialNumber;
    const firmwareRevision = this.firmwareRevision;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.Model, modelName)
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);

    //Prepare service 
    this.log.debug('prepareTasmotaService');
    this.tasmotaServices = [];
    const channelsName = this.names;
    const channelsCount = this.channelsCount;;
    for (let i = 0; i < channelsCount; i++) {
      const serviceName = (channelsCount > 1) ? `${accessoryName} ${channelsName[i]}` : accessoryName;
      const logName = (channelsCount > 1) ? `${accessoryName}, channel: ${channelsName[i]}` : `${accessoryName}`
      const tasmotaService = new Service.Outlet(serviceName, `tasmotaService${[i]}`);
      tasmotaService.getCharacteristic(Characteristic.On)
        .onGet(async () => {
          const state = this.powerState[i];
          const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host} ${logName}, state: ${state ? 'ON' : 'OFF'}`);
          return state;
        })
        .onSet(async (state) => {
          const powerOn = (channelsCount == 1) ? API_COMMANDS.Power + API_COMMANDS.On : API_COMMANDS.Power + (i + 1) + API_COMMANDS.On;
          const powerOff = (channelsCount == 1) ? API_COMMANDS.Power + API_COMMANDS.Off : API_COMMANDS.Power + (i + 1) + API_COMMANDS.Off;
          state = state ? powerOn : powerOff;
          try {
            await this.axiosInstance(state);
            const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host} ${logName}, set state: ${state ? 'ON' : 'OFF'}`);
          } catch (error) {
            this.log.error(`Device: ${this.host} ${logName}, set state error: ${error}`);
          }
        });
      this.tasmotaServices.push(tasmotaService);
      accessory.addService(this.tasmotaServices[i]);
    };

    this.startPrepareAccessory = false;
    this.log.debug(`Device: ${this.host} ${accessoryName}, publish as external accessory.`);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  };
};