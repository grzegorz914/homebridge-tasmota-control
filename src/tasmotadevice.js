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
        this.sensorsCarbonDioxydeCount = 0;
        this.sensorsAmbientLightCount = 0;

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

        this.start();
    };

    async start() {
        try {
            const serialNumber = await this.getDeviceInfo();
            await this.checkDeviceState();

            //start prepare accessory
            const accessory = this.startPrepareAccessory && serialNumber ? await this.prepareAccessory() : false;
            this.startPrepareAccessory = false;

            this.api.publishExternalAccessories(CONSTANS.PluginName, [accessory]);
            const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, published as external accessory.`) : false;

            this.updateDeviceState();
        } catch (error) {
            this.log.error(error);
            await new Promise(resolve => setTimeout(resolve, 15000));
            this.start();
        };
    };

    async updateDeviceState() {
        try {
            await this.checkDeviceState();
        } catch (error) {
            this.log.error(error);
        };

        await new Promise(resolve => setTimeout(resolve, this.refreshInterval * 1000));
        this.updateDeviceState();
    };

    getDeviceInfo() {
        return new Promise(async (resolve, reject) => {
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
                const statusSNSSupported = deviceInfoKeys.includes('StatusSNS') ?? false;
                if (statusSNSSupported) {
                    const sensorTypes = CONSTANS.StatusSNS;
                    const sensor = Object.entries(deviceInfo.StatusSNS)
                        .filter(([key]) => sensorTypes.some(type => key.includes(type)))
                        .reduce((obj, [key, value]) => {
                            obj[key] = value;
                            return obj;
                        }, {});

                    for (const [key, value] of Object.entries(sensor)) {
                        const obj = {
                            'name': key,
                            'data': value
                        }
                        this.sensors.push(obj);
                    }
                }
                const sensorsCount = this.sensors.length;

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

                resolve(addressMac)
            } catch (error) {
                reject(`Device: ${this.host} ${this.name}, check info error: ${error}, trying to reconnect in 15s.`);
            };
        });
    };

    checkDeviceState() {
        return new Promise(async (resolve, reject) => {
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
                        const status = relaysStatus[statusKey] === 'ON' ?? false;
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
                    this.sensorsName = [];
                    this.sensorsTemperature = [];
                    this.sensorsHumidity = [];
                    this.sensorsDewPoint = [];
                    this.sensorsPressure = [];
                    this.sensorsGas = [];
                    this.sensorsCarbonDioxyde = [];
                    this.sensorsAmbientLight = [];

                    const sensorsStatusData = await this.axiosInstance(CONSTANS.ApiCommands.Status);
                    const sensorsStatus = sensorsStatusData.data.StatusSNS;
                    const debug = this.enableDebugMode ? this.log(`Device: ${this.host} ${this.name}, debug ${sensorsCount === 1 ? 'sensor' : 'sensors'} status: ${JSON.stringify(sensorsStatus, null, 2)}`) : false;

                    for (let i = 0; i < sensorsCount; i++) {
                        const sensorName = this.sensors[i].name;
                        const sensorData = this.sensors[i].data;
                        const temperature = sensorData.Temperature ?? false;
                        const humidity = sensorData.Humidity ?? false;
                        const dewPoint = sensorData.DewPoint ?? false;
                        const pressure = sensorData.Pressure ?? false;
                        const gas = sensorData.Gas ?? false;
                        const carbonDioxyde = sensorData.CarbonDioxyde ?? false;
                        const ambientLight = sensorData.Ambient ?? false;

                        const push = sensorName !== false && sensorName !== undefined && sensorName !== null ? this.sensorsName.push(sensorName) : false;
                        const push1 = temperature !== false && temperature !== undefined && temperature !== null ? this.sensorsTemperature.push(temperature) : false;
                        const push2 = humidity !== false && humidity !== undefined && humidity !== null ? this.sensorsHumidity.push(humidity) : false;
                        const push3 = dewPoint !== false && dewPoint !== undefined && dewPoint !== null ? this.sensorsDewPoint.push(dewPoint) : false;
                        const push4 = pressure !== false && pressure !== undefined && pressure !== null ? this.sensorsPressure.push(pressure) : false;
                        const push5 = gas !== false && gas !== undefined && gas !== null ? this.sensorsGas.push(gas) : false;
                        const push6 = carbonDioxyde !== false && carbonDioxyde !== undefined && carbonDioxyde !== null ? this.sensorsCarbonDioxyde.push(carbonDioxyde) : false;
                        const push7 = ambientLight !== false && ambientLight !== undefined && ambientLight !== null ? this.sensorsAmbientLight.push(ambientLight) : false;
                    };

                    this.sensorsTemperatureCount = this.sensorsTemperature.length;
                    this.sensorsHumidityCount = this.sensorsHumidity.length;
                    this.sensorsDewPointCount = this.sensorsDewPoint.length;
                    this.sensorsPressureCount = this.sensorsPressure.length;
                    this.sensorsGasCount = this.sensorsGas.length;
                    this.sensorsCarbonDioxydeCount = this.sensorsCarbonDioxyde.length;
                    this.sensorsAmbientLightCount = this.sensorsAmbientLight.length;
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

                    if (this.sensorCarbonDioxydeServices && this.sensorsCarbonDioxydeCount > 0) {
                        for (let i = 0; i < this.sensorsCarbonDioxydeCount; i++) {
                            const carbonDioxydeDetected = this.sensorsCarbonDioxyde[i] > 1000;
                            const carbonDioxydeLevel = this.sensorsCarbonDioxyde[i];
                            this.sensorCarbonDioxydeServices[i]
                                .updateCharacteristic(Characteristic.CarbonDioxideDetected, carbonDioxydeDetected)
                                .updateCharacteristic(Characteristic.CarbonDioxideLevel, carbonDioxydeLevel)
                                .updateCharacteristic(Characteristic.CarbonDioxidePeakLevel, carbonDioxydeLevel);
                        };
                    };

                    if (this.sensorAmbientLightServices && this.sensorsAmbientLightCount > 0) {
                        for (let i = 0; i < this.sensorsAmbientLightCount; i++) {
                            const ambientLight = this.sensorsAmbientLight[i];
                            this.sensorAmbientLightServices[i]
                                .updateCharacteristic(Characteristic.CurrentAmbientLightLevel, ambientLight);
                        };
                    };
                };

                resolve();
            } catch (error) {
                reject(`Device: ${this.host} ${this.name}, check state error: ${error}, trying again.`);
            };
        });
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
                                const state = this.relaysStete[i] ?? false;
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
                            const sensorName = this.sensorsName[i];
                            const serviceName = `${accessoryName} ${sensorName} Temperature`;
                            const sensorTemperatureService = new Service.TemperatureSensor(serviceName, `Temperature Sensor${i}`);
                            sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                                .onGet(async () => {
                                    const value = this.sensorsTemperature[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor:${sensorName} temperature: ${value} °${this.tempUnit}`);
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
                            const sensorName = this.sensorsName[i];
                            const serviceName = `${accessoryName} ${sensorName} Humidity`;
                            const sensorHumidityService = new Service.HumiditySensor(serviceName, `Humidity Sensor${i}`);
                            sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                                .onGet(async () => {
                                    const value = this.sensorsHumidity[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} humidity: ${value} %`);
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
                            const sensorName = this.sensorsName[i];
                            const serviceName = `${accessoryName} ${sensorName} Dew Point`;
                            const sensorDewPointService = new Service.TemperatureSensor(serviceName, `Dew Point Sensor${i}`);
                            sensorDewPointService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorDewPointService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorDewPointService.getCharacteristic(Characteristic.CurrentTemperature)
                                .onGet(async () => {
                                    const value = this.sensorsDewPoint[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                    return value;
                                });
                            this.sensorDewPointServices.push(sensorDewPointService);
                            accessory.addService(sensorDewPointService);
                        };
                    }

                    //pressure

                    //gas

                    //carbon dioxyde
                    const sensorsCarbonDioxydeCount = this.sensorsCarbonDioxydeCount;
                    if (sensorsCarbonDioxydeCount > 0) {
                        const debug = this.enableDebugMode ? this.log('Prepare Carbon Dioxyde Sensor Services') : false;
                        this.sensorCarbonDioxydeServices = [];
                        for (let i = 0; i < sensorsCarbonDioxydeCount; i++) {
                            const sensorName = this.sensorsName[i];
                            const serviceName = `${accessoryName} ${sensorName} Carbon Dioxyde`;
                            const sensorCarbonDioxydeService = new Service.CarbonDioxideSensor(serviceName, `Carbon Dioxyde Sensor${i}`);
                            sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                                .onGet(async () => {
                                    const state = this.sensorsCarbonDioxyde[i] > 1000;
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                    return state;
                                });
                            sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                                .onGet(async () => {
                                    const value = this.sensorsCarbonDioxyde[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                    return value;
                                });
                            sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                                .onGet(async () => {
                                    const value = this.sensorsCarbonDioxyde[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                    return value;
                                });
                            this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                            accessory.addService(sensorCarbonDioxydeService);
                        };
                    }

                    //ambient light
                    const sensorsAmbientLightCount = this.sensorsAmbientLightCount;
                    if (sensorsAmbientLightCount > 0) {
                        const debug = this.enableDebugMode ? this.log('Prepare Ambient Light Sensor Services') : false;
                        this.sensorAmbientLightServices = [];
                        for (let i = 0; i < sensorsAmbientLightCount; i++) {
                            const sensorName = this.sensorsName[i];
                            const serviceName = `${accessoryName} ${sensorName} Ambient Light`;
                            const sensorAmbientLightService = new Service.LightSensor(serviceName, `Ambient Light Sensor${i}`);
                            sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                            sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                            sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                                .onGet(async () => {
                                    const value = this.sensorsAmbientLight[i];
                                    const logInfo = this.disableLogInfo ? false : this.log(`Device: ${this.host}, ${accessoryName}, sensor: ${sensorName} ambient light: ${value} lx`);
                                    return value;
                                });
                            this.sensorAmbientLightServices.push(sensorAmbientLightService);
                            accessory.addService(sensorAmbientLightService);
                        };
                    }
                };

                resolve(accessory);
            } catch (error) {
                reject(error)
            };
        });
    }
};
module.exports = TasmotaDevice;
