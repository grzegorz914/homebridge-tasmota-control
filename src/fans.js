import { promises as fsPromises } from 'fs';
import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import { ApiCommands } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Fans extends EventEmitter {
    constructor(api, config, info, serialNumber, refreshInterval) {
        super();

        Accessory = api.platformAccessory;
        Characteristic = api.hap.Characteristic;
        Service = api.hap.Service;
        Categories = api.hap.Categories;
        AccessoryUUID = api.hap.uuid;

        //info
        this.info = info;
        this.serialNumber = serialNumber;
        this.relaysCount = info.friendlyNames.length;

        //other config
        this.lightsNamePrefix = config.lightsNamePrefix || false;
        this.fansNamePrefix = config.fansNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.refreshInterval = refreshInterval;

        //variable
        this.startPrepareAccessory = true;

        //axios instance
        const url = `http://${config.host}/cm?cmnd=`;
        this.axiosInstance = axios.create({
            method: 'GET',
            baseURL: url,
            timeout: refreshInterval > 10000 ? 10000 : refreshInterval,
            withCredentials: config.auth,
            auth: {
                username: config.user,
                password: config.passwd
            }
        });

        //impulse generator
        this.call = false;
        this.impulseGenerator = new ImpulseGenerator();
        this.impulseGenerator.on('checkDeviceState', async () => {
            if (this.call) return;

            try {
                this.call = true;
                await this.checkDeviceState();
                this.call = false;
            } catch (error) {
                this.call = false;
                this.emit('error', `Inpulse generator error: ${error}`);
            };
        }).on('state', (state) => {
            const emitState = state ? this.emit('success', `Impulse generator started`) : this.emit('warn', `Impulse generator stopped`);
        });
    }

    async checkDeviceState() {
        const debug = this.enableDebugMode ? this.emit('debug', `Requesting status`) : false;
        try {
            //power status
            const powerStatusData = await this.axiosInstance(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            const powerStatusKeys = Object.keys(powerStatus);
            const debug = this.enableDebugMode ? this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`) : false;

            //sensor status
            const sensorStatusData = await this.axiosInstance(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            const debug1 = this.enableDebugMode ? this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`) : false;

            //sensor status keys
            const sensorStatusKeys = Object.keys(sensorStatus);

            //status STS
            const statusStsSupported = sensorStatusKeys.includes('StatusSTS');
            const statusSts = statusStsSupported ? sensorStatus.StatusSTS : {};

            //relays
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                this.lights = [];
                this.fans = [];

                //iFan02/iFan03 only - 0 = turn fan OFF, 1..3 = set fan speed, + = increase fan speed, - = decrease fan speed
                for (let i = 0; i < relaysCount; i++) {
                    const friendlyName = this.info.friendlyNames[i];
                    const powerNr = i + 1;
                    const power1 = powerStatusKeys.includes('POWER1');
                    const powerKey = relaysCount === 1 ? (power1 ? 'POWER1' : 'POWER') : `POWER${powerNr}`;
                    const power = powerStatus[powerKey] === 'ON';

                    //light
                    const light = {
                        friendlyName: friendlyName,
                        power: power,
                        power1: power1
                    };
                    this.lights.push(light);

                    //update characteristics
                    const lightService = this.lightServices?.[i];
                    if (lightService) {
                        const serviceName = this.lightsNamePrefix ? `${this.info.deviceName} ${friendlyName}` : friendlyName;
                        lightService.updateCharacteristic(Characteristic.ConfiguredName, serviceName)
                            .updateCharacteristic(Characteristic.On, power);
                    }

                    //fan
                    const powerFan = statusSts.FanSpeed > 0;
                    const direction = statusSts.FanDirection ?? 0;
                    const speed = statusSts.FanSpeed;
                    const fan = {
                        friendlyName: friendlyName,
                        power: powerFan,
                        direction: direction,
                        speed: speed,
                        power1: power1
                    };
                    this.fans.push(fan);

                    //update characteristics
                    const fanService = this.fanServices?.[i];
                    if (fanService) {
                        const serviceName = this.fansNamePrefix ? `${this.info.deviceName} ${friendlyName}` : friendlyName;
                        fanService.updateCharacteristic(Characteristic.ConfiguredName, serviceName)
                            .updateCharacteristic(Characteristic.On, powerFan)
                            // .updateCharacteristic(Characteristic.Direction, direction)
                            .updateCharacteristic(Characteristic.RotationSpeed, speed);
                    }


                    //log info
                    if (!this.disableLogInfo) {
                        this.emit('info', `${friendlyName}, light: ${power ? 'ON' : 'OFF'}`);
                        this.emit('info', `${friendlyName}, fan: ${powerFan ? 'ON' : 'OFF'}`);
                        //this.emit('info', `${friendlyName}, direction: ${direction}`);
                        this.emit('info', `${friendlyName}, fan speed: ${speed}`);
                    }
                }
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
    }

    async saveData(path, data) {
        try {
            data = JSON.stringify(data, null, 2);
            await fsPromises.writeFile(path, data);
            const debug = !this.enableDebugMode ? false : this.emit('debug', `Saved data: ${data}`);
            return true;
        } catch (error) {
            throw new Error(`Save data error: ${error}`);
        }
    }

    async readData(path) {
        try {
            const data = await fsPromises.readFile(path);
            return data;
        } catch (error) {
            throw new Error(`Read data error: ${error}`);
        }
    }

    async startImpulseGenerator() {
        try {
            //start impulse generator 
            const timers = [{ name: 'checkDeviceState', sampling: this.refreshInterval }];
            await this.impulseGenerator.start(timers);
            return true;
        } catch (error) {
            throw new Error(`Impulse generator start error: ${error}`);
        }
    }

    async deviceInfo() {
        this.emit('devInfo', `----- ${this.info.deviceName} -----`);
        this.emit('devInfo', `Manufacturer: Tasmota`);
        this.emit('devInfo', `Hardware: ${this.info.modelName}`);
        this.emit('devInfo', `Serialnr: ${this.serialNumber}`)
        this.emit('devInfo', `Firmware: ${this.info.firmwareRevision}`);
        this.emit('devInfo', `Relays: ${this.relaysCount}`);
        this.emit('devInfo', `----------------------------------`);
        return;
    }

    //prepare accessory
    async prepareAccessory() {
        const debug = this.enableDebugMode ? this.emit('debug', `Prepare Accessory`) : false;

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.FAN;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            const debug1 = this.enableDebugMode ? this.emit('debug', `Prepare Information Service`) : false;
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            const debug2 = this.enableDebugMode ? this.emit('debug', `Prepare Services`) : false;
            if (this.fans.length > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Fan Services`) : false;
                this.fanServices = [];

                for (let i = 0; i < this.fans.length; i++) {
                    const friendlyName = this.fans[i].friendlyName;
                    const serviceName = this.fansNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const fanService = accessory.addService(Service.Fan, serviceName, `Fan ${i}`)
                    fanService.setPrimaryService(true);
                    fanService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    fanService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    fanService.getCharacteristic(Characteristic.On)
                        .onGet(async () => {
                            const state = this.fans[i].power;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                state = state ? 1 : 0;
                                const speed = `${ApiCommands.FanSpeed}${state}`;
                                await this.axiosInstance(speed);
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    //fanService.getCharacteristic(Characteristic.RotationDirection)
                    //    .onGet(async () => {
                    //        const value = this.fans[i].direction;
                    //        return value;
                    //    })
                    //   .onSet(async (value) => {
                    //        try {
                    //            const direction = `${ApiCommands.FanDirection}${value}`;
                    //            await this.axiosInstance(direction);
                    //            const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set direction: ${value}`);
                    //        } catch (error) {
                    //            this.emit('warn', `${friendlyName}, set direction error: ${error}`);
                    //        }
                    //    });
                    fanService.getCharacteristic(Characteristic.RotationSpeed)
                        .setProps({
                            minValue: 0,
                            maxValue: 3,
                            minStep: 1
                        })
                        .onGet(async () => {
                            const value = this.fans[i].speed;
                            return value;
                        })
                        .onSet(async (value) => {
                            try {
                                const speed = `${ApiCommands.FanSpeed}${value}`;
                                await this.axiosInstance(speed);
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set speed: ${value}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set rotation speed error: ${error}`);
                            }
                        });
                    this.fanServices.push(fanService);
                }
            }

            if (this.lights.length > 0) {
                this.lightServices = [];

                for (let i = 0; i < this.lights.length; i++) {
                    const friendlyName = this.lights[i].friendlyName;
                    const serviceName = this.lightsNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const lightService = accessory.addService(Service.Lightbulb, serviceName, `Light ${i}`);
                    lightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    lightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    lightService.getCharacteristic(Characteristic.On)
                        .onGet(async () => {
                            const state = this.lights[i].power;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                const relayNr = i + 1;
                                const powerOn = this.lights.length === 1 ? (this.lights[i].power1 ? `${ApiCommands.Power}${relayNr}${ApiCommands.On}` : ApiCommands.PowerOn) : `${ApiCommands.Power}${relayNr}${ApiCommands.On}`;
                                const powerOff = this.lights.length === 1 ? (this.lights[i].power1 ? `${ApiCommands.Power}${relayNr}${ApiCommands.Off}` : ApiCommands.PowerOff) : `${ApiCommands.Power}${relayNr}${ApiCommands.Off}`;
                                state = state ? powerOn : powerOff;
                                await this.axiosInstance(state);
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    this.lightServices.push(lightService);
                }
            }

            //sensors
            if (this.sensorsCount > 0) {
                const debug = this.enableDebugMode ? this.emit('debug', `Prepare Sensor Services`) : false;

                //temperature
                const sensorsTemperatureCount = this.sensorsTemperatureCount;
                if (sensorsTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Temperature Sensor Services`) : false;
                    this.sensorTemperatureServices = [];
                    for (let i = 0; i < sensorsTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Temperature` : `${sensorName} Temperature`;
                        const sensorTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Temperature Sensor ${i}`);
                        sensorTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorTemperatureServices.push(sensorTemperatureService);
                    }
                }

                //reference temperature
                const sensorsReferenceTemperatureCount = this.sensorsReferenceTemperatureCount;
                if (sensorsReferenceTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Reference Temperature Sensor Services`) : false;
                    this.sensorReferenceTemperatureServices = [];
                    for (let i = 0; i < sensorsReferenceTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Reference Temperature` : `${sensorName} Reference Temperature`;
                        const sensorReferenceTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Reference Temperature Sensor ${i}`);
                        sensorReferenceTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorReferenceTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorReferenceTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsReferenceTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} reference temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorReferenceTemperatureServices.push(sensorReferenceTemperatureService);
                    }
                }

                //object temperature
                const sensorsObjTemperatureCount = this.sensorsObjTemperatureCount;
                if (sensorsObjTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Obj Temperature Sensor Services`) : false;
                    this.sensorObjTemperatureServices = [];
                    for (let i = 0; i < sensorsObjTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Obj Temperature` : `${sensorName} Obj Temperature`;
                        const sensorObjTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Obj Temperature Sensor ${i}`);
                        sensorObjTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorObjTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorObjTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsObjTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} obj temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorObjTemperatureServices.push(sensorObjTemperatureService);
                    }
                }

                //ambient temperature
                const sensorsAmbTemperatureCount = this.sensorsAmbTemperatureCount;
                if (sensorsAmbTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Amb Temperature Sensor Services`) : false;
                    this.sensorAmbTemperatureServices = [];
                    for (let i = 0; i < sensorsAmbTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Amb Temperature` : `${sensorName} Amb Temperature`;
                        const sensorAmbTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Amb Temperature Sensor ${i}`);
                        sensorAmbTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsAmbTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} amb temperature: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorAmbTemperatureServices.push(sensorAmbTemperatureService);
                    }
                }

                //dew point temperature
                const sensorsDewPointTemperatureCount = this.sensorsDewPointTemperatureCount;
                if (sensorsDewPointTemperatureCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Dew Point Temperature Sensor Services`) : false;
                    this.sensorDewPointTemperatureServices = [];
                    for (let i = 0; i < sensorsDewPointTemperatureCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Dew Point` : `${sensorName} Dew Point`;
                        const sensorDewPointTemperatureService = accessory.addService(Service.TemperatureSensor, serviceName, `Dew Point Temperature Sensor ${i}`);
                        sensorDewPointTemperatureService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorDewPointTemperatureService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorDewPointTemperatureService.getCharacteristic(Characteristic.CurrentTemperature)
                            .onGet(async () => {
                                const value = this.sensorsDewPointTemperature[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} dew point: ${value} °${this.tempUnit}`);
                                return value;
                            });
                        this.sensorDewPointTemperatureServices.push(sensorDewPointTemperatureService);
                    }
                }

                //humidity
                const sensorsHumidityCount = this.sensorsHumidityCount;
                if (sensorsHumidityCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Humidity Sensor Services`) : false;
                    this.sensorHumidityServices = [];
                    for (let i = 0; i < sensorsHumidityCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Humidity` : `${sensorName} Humidity`;
                        const sensorHumidityService = accessory.addService(Service.HumiditySensor, serviceName, `Humidity Sensor ${i}`);
                        sensorHumidityService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorHumidityService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorHumidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
                            .onGet(async () => {
                                const value = this.sensorsHumidity[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} humidity: ${value} %`);
                                return value;
                            });
                        this.sensorHumidityServices.push(sensorHumidityService);
                    }
                }

                //pressure

                //gas

                //carbon dioxyde
                const sensorsCarbonDioxydeCount = this.sensorsCarbonDioxydeCount;
                if (sensorsCarbonDioxydeCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Carbon Dioxyde Sensor Services`) : false;
                    this.sensorCarbonDioxydeServices = [];
                    for (let i = 0; i < sensorsCarbonDioxydeCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Carbon Dioxyde` : `${sensorName} Carbon Dioxyde`;
                        const sensorCarbonDioxydeService = accessory.addService(Service.CarbonDioxideSensor, serviceName, `Carbon Dioxyde Sensor ${i}`);
                        sensorCarbonDioxydeService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorCarbonDioxydeService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideDetected)
                            .onGet(async () => {
                                const state = this.sensorsCarbonDioxyde[i] > 1000;
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde detected: ${state ? 'Yes' : 'No'}`);
                                return state;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxideLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde level: ${value} ppm`);
                                return value;
                            });
                        sensorCarbonDioxydeService.getCharacteristic(Characteristic.CarbonDioxidePeakLevel)
                            .onGet(async () => {
                                const value = this.sensorsCarbonDioxyde[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} carbon dioxyde peak level: ${value} ppm`);
                                return value;
                            });
                        this.sensorCarbonDioxydeServices.push(sensorCarbonDioxydeService);
                    }
                }

                //ambient light
                const sensorsAmbientLightCount = this.sensorsAmbientLightCount;
                if (sensorsAmbientLightCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Ambient Light Sensor Services`) : false;
                    this.sensorAmbientLightServices = [];
                    for (let i = 0; i < sensorsAmbientLightCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Ambient Light` : `${sensorName} Ambient Light`;
                        const sensorAmbientLightService = accessory.addService(Service.LightSensor, serviceName, `Ambient Light Sensor ${i}`);
                        sensorAmbientLightService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorAmbientLightService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorAmbientLightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                            .onGet(async () => {
                                const value = this.sensorsAmbientLight[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} ambient light: ${value} lx`);
                                return value;
                            });
                        this.sensorAmbientLightServices.push(sensorAmbientLightService);
                    }
                }

                //motion
                const sensorsMotionCount = this.sensorsMotionCount;
                if (sensorsMotionCount > 0) {
                    const debug = this.enableDebugMode ? this.emit('debug', `Prepare Motion Sensor Services`) : false;
                    this.sensorMotionServices = [];
                    for (let i = 0; i < sensorsMotionCount; i++) {
                        const sensorName = this.sensorsName[i];
                        const serviceName = this.sensorsNamePrefix ? `${accessoryName} ${sensorName} Motion` : `${sensorName} Motion`;
                        const sensorMotionService = accessory.addService(Service.MotionSensor, serviceName, `Motion Sensor ${i}`);
                        sensorMotionService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                        sensorMotionService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                        sensorMotionService.getCharacteristic(Characteristic.MotionDetected)
                            .onGet(async () => {
                                const state = this.sensorsMotion[i];
                                const logInfo = this.disableLogInfo ? false : this.emit('info', `sensor: ${sensorName} motion: ${state ? 'ON' : 'OFF'}`);
                                return state;
                            });
                        this.sensorMotionServices.push(sensorMotionService);
                    }
                }
            }

            return accessory;
        } catch (error) {
            throw new Error(`Prepare accessory error: ${error}`)
        }
    }

    //start
    async start() {
        try {
            //check device state 
            await this.checkDeviceState();

            //connect to deice success
            this.emit('success', `Connect Success`)

            //check device info 
            const devInfo = !this.disableLogDeviceInfo ? await this.deviceInfo() : false;

            //start prepare accessory
            if (this.startPrepareAccessory) {
                const accessory = await this.prepareAccessory();
                const publishAccessory = this.emit('publishAccessory', accessory);
                this.startPrepareAccessory = false;
            }

            return true;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        }
    }
}
export default Fans;
