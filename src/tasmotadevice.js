'use strict';
const fs = require('fs');
const axios = require('axios');
const CONSTANS = require('./constans.json');
let Accessory, Characteristic, Service, Categories, UUID;

class TasmotaDevice {
    constructor(api, prefDir, config, log) {
        this.api = api;
        this.log = log;

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        UUID = api.hap.uuid;

        //device configuration
        this.name = config.name;
        this.host = config.host;
        this.user = config.user;
        this.passwd = config.passwd;
        this.auth = config.auth || false;
        this.refreshInterval = config.refreshInterval || 5;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;

        //device info
        this.manufacturer = 'Tasmota';
        this.modelName = 'Model Name';
        this.serialNumber = 'Serial Number';
        this.firmwareRevision = 'Firmware Revision';

        //relays
        this.relaysFriendlyNames = [];
        this.relaysCount = 0;

        //sensors
        this.sensors = [];
        this.sensorsCount = 0;
        this.sensorsTemperatureCount = 0;
        this.sensorsHumidityCount = 0;
        this.sensorsDewPointCount = 0;
        this.sensorsPressureCount = 0;
        this.sensorsGasCount = 0;

        //variable
        this.startPrepareAccessory = true;

        //axios instance
        const url = this.auth ? `http://${this.host}/cm?user=${this.user}&password=${this.passwd}&cmnd=` : `http://${this.host}/cm?cmnd=`
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: 10000
        });

        //check if the directory exists, if not then create it
        if (fs.existsSync(prefDir) == false) {
            fs.mkdirSync(prefDir);
        };

        this.getDeviceInfo();
    };

    async reconnect() {
        await new Promise(resolve => setTimeout(resolve, 15000));
        this.getDeviceInfo();
    };

    async updateDeviceState() {
        await new Promise(resolve => setTimeout(resolve, this.refreshInterval * 1000));
        this.checkDeviceState();
    };

    async getDeviceInfo() {
        const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, requesting info.`) : false;

        try {
            const deviceInfoData = await this.axiosInstance(CONSTANS.ApiCommands.Status);
            const deviceInfo = deviceInfoData.data;
            const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug info: ${JSON.stringify(deviceInfo, null, 2)}`) : false;

            //keys
            const deviceInfoKeys = Object.keys(deviceInfo);

            //status
            const deviceName = deviceInfo.Status.DeviceName ?? 'Tasmota';
            const relaysCount = deviceInfo.Status.FriendlyName.length ?? 0;
            for (let i = 0; i < relaysCount; i++) {
                const friendlyName = deviceInfo.Status.FriendlyName[i] ?? false;
                const push = friendlyName ? this.relaysFriendlyNames.push(friendlyName) : false;
            };

            //status fwr
            this.statusFWRSupported = deviceInfoKeys.includes('StatusFWR');
            const firmwareRevision = deviceInfo.StatusFWR.Version ?? 'unknown';
            const modelName = deviceInfo.StatusFWR.Hardware ?? '';

            //status net
            const addressMac = deviceInfo.StatusNET.Mac;

            //status sns
            this.statusSNSSupported = deviceInfoKeys.includes('StatusSNS');
            CONSTANS.StatusSNS.forEach(sensor => {
                const sensorData = deviceInfo.StatusSNS[sensor] ?? false;
                const push = sensorData ? this.sensors.push(sensorData) : false;
            });
            const sensorsCount = this.sensors.length

            //device info
            if (!this.disableLogDeviceInfo) {
                this.log(`----- ${this.name} -----`);
                this.log(`Manufacturer: ${this.manufacturer}`);
                this.log(`Hardware: ${modelName}`);
                this.log(`Serialnr: ${addressMac}`);
                this.log(`Firmware: ${firmwareRevision}`);
                const log = relaysCount > 0 ? this.log(`Relays: ${relaysCount}`) : false;
                const log1 = sensorsCount > 0 ? this.log(`Sensors: ${sensorsCount}`) : false;
                this.log(`----------------------------------`);
            };

            this.modelName = modelName;
            this.serialNumber = addressMac;
            this.firmwareRevision = firmwareRevision;
            this.relaysCount = relaysCount;
            this.sensorsCount = sensorsCount;

            this.checkDeviceState();
        } catch (error) {
            this.log.error(`Device: ${this.host} ${this.name}, check info error: ${error}, trying to reconnect in 15s.`);
            this.reconnect();
        };
    };

    async checkDeviceState() {
        const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, requesting status.`, this.host, this.name) : false;

        try {
            //relays
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                this.relaysStete = [];

                const relaysStatusData = await this.axiosInstance(CONSTANS.ApiCommands.PowerStatus);
                const relaysStatus = relaysStatusData.data;
                const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug ${relaysCount === 1 ? 'relay' : 'relays'} status: ${JSON.stringify(relaysStatus, null, 2)}`) : false;

                for (let i = 0; i < relaysCount; i++) {
                    const statusKey = relaysCount === 1 ? 'POWER' : 'POWER' + (i + 1);
                    const status = relaysStatus[statusKey] === 'ON'
                    this.relaysStete.push(status);

                    //update characteristics
                    if (this.relayServices) {
                        this.relayServices[i]
                            .updateCharacteristic(Characteristic.On, status);
                    };
                };
            };

            //sensors
            const sensorsCount = this.sensorsCount;
            if (sensorsCount > 0) {
                this.sensorsTemperature = [];
                this.sensorsHumidity = [];
                this.sensorsDewPoint = [];
                this.sensorsPressure = [];
                this.sensorsGas = [];

                const sensorsStatusData = await this.axiosInstance(CONSTANS.ApiCommands.Status);
                const sensorsStatus = sensorsStatusData.data.StatusSNS;
                const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug ${sensorsCount === 1 ? 'sensor' : 'sensors'} status: ${JSON.stringify(sensorsStatus, null, 2)}`) : false;

                for (let i = 0; i < sensorsCount; i++) {
                    const sensor = this.sensors[i];
                    const temperature = sensor.Temperature ?? false;
                    const humidity = sensor.Humidity ?? false;
                    const dewPoint = sensor.DewPoint ?? false;
                    const pressure = sensor.Pressure ?? false;
                    const gas = sensor.Gas ?? false;

                    const push = temperature ? this.sensorsTemperature.push(temperature) : false;
                    const push1 = humidity ? this.sensorsHumidity.push(humidity) : false;
                    const push2 = dewPoint ? this.sensorsDewPoint.push(dewPoint) : false;
                    const push3 = pressure ? this.sensorsPressure.push(pressure) : false;
                    const push4 = gas ? this.sensorsGas.push(gas) : false;
                };

                this.sensorsTemperatureCount = this.sensorsTemperature.length;
                this.sensorsHumidityCount = this.sensorsHumidity.length;
                this.sensorsDewPointCount = this.sensorsDewPoint.length;
                this.sensorsPressureCount = this.sensorsPressure.length;
                this.sensorsGasCount = this.sensorsGas.length;
                this.tempUnit = sensorsStatus.TempUnit ?? 'C';
                this.pressureUnit = sensorsStatus.PressureUnit ?? 'hPa';


                //update characteristics
                if (this.sensorTemperatureServices && this.sensorsTemperatureCount > 0) {
                    for (let i = 0; i < this.sensorsTemperatureCount; i++) {
                        const temperature = this.sensorsTemperature[i];
                        this.sensorTemperatureServices[i]
                            .updateCharacteristic(Characteristic.CurrentTemperature, temperature);
                    };
                };

                if (this.sensorHumidityServices && this.sensorsHumidityCount > 0) {
                    for (let i = 0; i < this.sensorsHumidityCount; i++) {
                        const humidity = this.sensorsHumidity[i];
                        this.sensorHumidityServices[i]
                            .updateCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
                    };
                };

                if (this.sensorDewPointServices && this.sensorsDewPointCount > 0) {
                    for (let i = 0; i < this.sensorsDewPointCount; i++) {
                        const dewPoint = this.sensorsDewPoint[i];
                        this.sensorDewPointServices[i]
                            .updateCharacteristic(Characteristic.CurrentTemperature, dewPoint);
                    };
                };
            };

            //start prepare accessory
            if (this.startPrepareAccessory && this.serialNumber) {
                try {
                    const accessory = await this.prepareAccessory();
                    this.startPrepareAccessory = false;

                    this.api.publishExternalAccessories(CONSTANS.PluginName, [accessory]);
                    const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, published as external accessory.`) : false;
                } catch (error) {
                    this.log.error(`Device: ${this.host} ${this.name}, Prepare accessory error: ${error}`);
                };
            };

            this.updateDeviceState();
        } catch (error) {
            this.log.error(`Device: ${this.host} ${this.name}, check state error: ${error}, trying again.`);
            this.updateDeviceState();
        };
    };

    //Prepare accessory
    prepareAccessory() {
        return new Promise((resolve, reject) => {
            const debug = this.enableDebugMode ? this.log('Prepare Accessory') : false;

            try {
                const accessoryName = this.name;
                const accessoryUUID = UUID.generate(this.serialNumber);
                const accessoryCategory = Categories.OTHER;
                const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

                //Prepare information service
                const debug1 = this.enableDebugMode ? this.log('Prepare Information Service') : false;
                accessory.getService(Service.AccessoryInformation)
                    .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
                    .setCharacteristic(Characteristic.Model, this.modelName)
                    .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
                    .setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);

                //Prepare services 
                const debug2 = this.enableDebugMode ? this.log('Prepare Services') : false;

                //relays
                const relaysCount = this.relaysCount;
                if (relaysCount > 0) {
                    const debug = this.enableDebugMode ? this.log('Prepare Relay Services') : false;
                    this.relayServices = [];
                    for (let i = 0; i < relaysCount; i++) {
                        const relaysName = this.relaysFriendlyNames[i];
                        const serviceName = relaysCount > 1 ? `${accessoryName} ${relaysName}` : accessoryName;
                        const logName = relaysCount > 1 ? `${accessoryName}, relay: ${relaysName}` : `${accessoryName}`
                        const relayService = new Service.Outlet(serviceName, `Relay${[i]}`);
                        relayService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        relayService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        relayService.getCharacteristic(Characteristic.On)
                            .onGet(async () => {
                                const state = this.relaysStete[i];
                                const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host} ${logName}, state: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            })
                            .onSet(async (state) => {
                                const powerOn = relaysCount === 1 ? CONSTANS.ApiCommands.Power + CONSTANS.ApiCommands.On : CONSTANS.ApiCommands.Power + (i + 1) + CONSTANS.ApiCommands.On;
                                const powerOff = relaysCount === 1 ? CONSTANS.ApiCommands.Power + CONSTANS.ApiCommands.Off : CONSTANS.ApiCommands.Power + (i + 1) + CONSTANS.ApiCommands.Off;
                                state = state ? powerOn : powerOff;
                                try {
                                    await this.axiosInstance(state);
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host} ${logName}, set state: ${state ? 'ON' : 'OFF'}`);
                                } catch (error) {
                                    this.log.error(`Device: ${this.host} ${logName}, set state error: ${error}`);
                                }
                            });
                        this.relayServices.push(relayService);
                        accessory.addService(relayService);
                    };
                }

                //sensors
                const sensorsCount = this.sensorsCount;
                if (sensorsCount > 0) {
                    const debug = this.enableDebugMode ? this.log('Prepare Sensor Services') : false;

                    //temperature
                    const sensorsTemperatureCount = this.sensorsTemperatureCount;
                    if (sensorsTemperatureCount > 0) {
                        const debug = this.enableDebugMode ? this.log('Prepare Temperature Sensor Services') : false;
                        this.sensorTemperatureServices = [];
                        for (let i = 0; i < sensorsTemperatureCount; i++) {
                            const serviceName = `${accessoryName} Temperature`;
                            const sensorTemperatureService = new Service.TemperatureSensor(serviceName, `Temperature Sensor${i}`);
                            sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                .onGet(async () => {
                                    const value = this.sensorsTemperature[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, temperature: ${value} °${this.tempUnit}`);
                                    return value;
                                });
                            this.sensorTemperatureServices.push(sensorTemperatureService);
                            accessory.addService(sensorTemperatureService);
                        };
                    }

                    //humidity
                    const sensorsHumidityCount = this.sensorsHumidityCount;
                    if (sensorsTemperatureCount > 0) {
                        const debug = this.enableDebugMode ? this.log('Prepare Humidity Sensor Services') : false;
                        this.sensorHumidityServices = [];
                        for (let i = 0; i < sensorsHumidityCount; i++) {
                            const serviceName = `${accessoryName} Humidity`;
                            const sensorHumidityService = new Service.HumiditySensor(serviceName, `Humidity Sensor${i}`);
                            sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                                .onGet(async () => {
                                    const value = this.sensorsHumidity[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, humidity: ${value} %`);
                                    return value;
                                });
                            this.sensorHumidityServices.push(sensorHumidityService);
                            accessory.addService(sensorHumidityService);
                        };
                    }

                    //dew point
                    const sensorsDewPointCount = this.sensorsDewPointCount;
                    if (sensorsDewPointCount > 0) {
                        const debug = this.enableDebugMode ? this.log('Prepare Dew Point Sensor Services') : false;
                        this.sensorDewPointServices = [];
                        for (let i = 0; i < sensorsDewPointCount; i++) {
                            const serviceName = `${accessoryName} Dew Point`;
                            const sensorDewPointService = new Service.TemperatureSensor(serviceName, `Dew Point Sensor${i}`);
                            sensorDewPointService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorDewPointService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorDewPointService.getCharacteristic(Characteristic.CurrentTemperature)
                                .onGet(async () => {
                                    const value = this.sensorsDewPoint[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, dew point: ${value} °${this.tempUnit}`);
                                    return value;
                                });
                            this.sensorDewPointServices.push(sensorDewPointService);
                            accessory.addService(sensorDewPointService);
                        };
                    }

                    //pressure

                    //gas
                }

                resolve(accessory);
            } catch (error) {
                reject(error)
            };
        });
    }
};
module.exports = TasmotaDevice;
