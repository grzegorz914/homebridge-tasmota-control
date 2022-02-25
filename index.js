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
}

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
}

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log('No configuration found for %s', PLUGIN_NAME);
      return;
    }
    this.log = log;
    this.api = api;
    this.devices = config.devices || [];
    this.accessories = [];

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching');
      for (let i = 0; i < this.devices.length; i++) {
        const device = this.devices[i];
        if (!device.name) {
          this.log.warn('Device Name Missing');
        } else {
          new tasmotaDevice(this.log, device, this.api);
        }
      }
    });
  }

  configureAccessory(accessory) {
    this.log.debug('configureAccessory');
    this.accessories.push(accessory);
  }

  removeAccessory(accessory) {
    this.log.debug('removeAccessory');
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
}

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

    //get Device info
    this.manufacturer = 'Tasmota';
    this.modelName = 'Model Name';
    this.serialNumber = 'Serial Number';
    this.firmwareRevision = 'Firmware Revision';

    //setup variables
    this.channelsCount = 0;
    this.checkDeviceInfo = true;
    this.checkDeviceState = false;
    this.startPrepareAccessory = true;

    this.prefDir = path.join(api.user.storagePath(), 'tasmota');
    const url = this.auth ? `http://${this.host}/cm?user=${this.user}&password=${this.passwd}&cmnd=` : `http://${this.host}/cm?cmnd=`

    this.axiosInstance = axios.create({
      method: 'GET',
      baseURL: url,
      timeout: 5000
    });

    //check if the directory exists, if not then create it
    if (fs.existsSync(this.prefDir) == false) {
      fs.mkdirSync(this.prefDir);
    }

    //Check device state
    setInterval(function () {
      if (this.checkDeviceInfo) {
        this.getDeviceInfo();
      } else {
        this.updateDeviceState();
      }
    }.bind(this), this.refreshInterval * 1000);
  }

  async getDeviceInfo() {
    this.log.debug('Device: %s %s, requesting Device Info.', this.host, this.name);
    try {
      const response = await this.axiosInstance(API_COMMANDS.Status);
      const debug = this.enableDebugMode ? this.log('Device: %s %s, debug response: %s', this.host, this.name, JSON.stringify(response.data, null, 2)) : false;

      const deviceName = response.data.Status.DeviceName;
      const modelName = response.data.StatusFWR.Hardware;
      const addressMac = response.data.StatusNET.Mac;
      const firmwareRevision = response.data.StatusFWR.Version;
      const channelsCount = response.data.Status.FriendlyName.length;

      this.log(`----- ${deviceName} ${channelsCount}CH -----`);
      this.log('Manufacturer: %s', this.manufacturer);
      this.log('Hardware: %s', modelName);
      this.log('Serialnr: %s', addressMac);
      this.log('Firmware: %s', firmwareRevision);
      this.log('----------------------------------');

      this.modelName = modelName;
      this.serialNumber = addressMac;
      this.firmwareRevision = firmwareRevision;
      this.channelsCount = channelsCount;

      this.checkDeviceInfo = (channelsCount == 0);
    } catch (error) {
      this.log.error('Device: %s %s, Device Info eror: %s, state: Offline, trying to reconnect', this.host, this.name, error);
    }
  }

  async updateDeviceState() {
    this.log.debug('Device: %s %s, requesting Device state.', this.host, this.name);
    try {
      const response = await this.axiosInstance(API_COMMANDS.PowerStatus);
      const debug = this.enableDebugMode ? this.log('Device: %s %s, debug response: %s', this.host, this.name, JSON.stringify(response.data, null, 2)) : false;

      this.powerState = new Array();
      for (let i = 0; i < this.channelsCount; i++) {
        const channel = this.channelsCount == 1 ? 'POWER' : 'POWER' + (i + 1);
        const powerState = (response.data[channel] == 'ON');
        if (this.tasmotaServices) {
          this.tasmotaServices[i]
            .updateCharacteristic(Characteristic.On, powerState)
        }
        this.powerState.push(powerState);
      }
      this.checkDeviceState = true;

      //start prepare accessory
      if (this.startPrepareAccessory) {
        this.prepareAccessory();
      }
    } catch (error) {
      this.log.error('Device: %s %s, update Device state error: %s, state: Offline', this.host, this.name, error);
      this.checkDeviceState = false;
      this.checkDeviceInfo = true;
    }
  }

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

    accessory.removeService(accessory.getService(Service.AccessoryInformation));
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Name, accessoryName)
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.Model, modelName)
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);
    accessory.addService(informationService);

    //Prepare service 
    this.log.debug('prepareTasmotaService');
    this.tasmotaServices = new Array();
    for (let i = 0; i < this.channelsCount; i++) {
      const tasmotaService = new Service.Outlet(accessoryName, `tasmotaService${[i]}`);
      tasmotaService.getCharacteristic(Characteristic.On)
        .onGet(async () => {
          const state = this.powerState[i];
          const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, get state: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
          return state;
        })
        .onSet(async (state) => {
          const powerOn = this.channelsCount == 1 ? API_COMMANDS.Power + API_COMMANDS.On : API_COMMANDS.Power + (i + 1) + API_COMMANDS.On;
          const powerOff = this.channelsCount == 1 ? API_COMMANDS.Power + API_COMMANDS.Off : API_COMMANDS.Power + (i + 1) + API_COMMANDS.Off;
          state = state ? powerOn : powerOff;
          try {
            await this.axiosInstance(state);
            const logInfo = this.disableLogInfo ? false : this.log('Device: %s %s, set state: %s', this.host, accessoryName, state ? 'ON' : 'OFF');
          } catch (error) {
            this.log.error('Device: %s %s, set state: %s', this.host, this.name, error);
          }
        });
      this.tasmotaServices.push(tasmotaService);
      accessory.addService(this.tasmotaServices[i]);
    }

    this.startPrepareAccessory = false;
    this.log.debug('Device: %s %s, publishExternalAccessories.', this.host, accessoryName);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }
}