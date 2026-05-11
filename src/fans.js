import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import Functions from './functions.js';
import { ApiCommands } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Fans extends EventEmitter {
    constructor(api, config, info, serialNumber, deviceInfo) {
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
        this.logDeviceInfo = config.log?.deviceInfo || false;
        this.logInfo = config.log?.info || false;
        this.logDebug = config.log?.debug || false;
        this.functions = new Functions();

        //axios instance
        this.client = deviceInfo.client;

        //lock flags
        this.locks = {
            checkState: false,
        };
        this.impulseGenerator = new ImpulseGenerator()
            .on('checkState', () => this.handleWithLock('checkState', async () => {
                await this.checkState();
            }))
            .on('state', (state) => {
                this.emit(state ? 'success' : 'warn', `Impulse generator ${state ? 'started' : 'stopped'}`);
            });
    }

    async handleWithLock(lockKey, fn) {
        if (this.locks[lockKey]) return;

        this.locks[lockKey] = true;
        try {
            await fn();
        } catch (error) {
            this.emit('error', `Inpulse generator error: ${error}`);
        } finally {
            this.locks[lockKey] = false;
        }
    }

    async checkState() {
        if (this.logDebug) this.emit('debug', `Requesting status`);
        try {
            //power status
            const powerStatusData = await this.client.get(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            const powerStatusKeys = Object.keys(powerStatus);
            if (this.logDebug) this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`);

            //sensor status
            const sensorStatusData = await this.client.get(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            if (this.logDebug) this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`);

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
                        friendlyName: `Light ${friendlyName}`,
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
                        friendlyName: `Fan ${friendlyName}`,
                        power: powerFan,
                        direction: direction,
                        speed: speed,
                        power1: power1
                    };
                    this.fans.push(fan);

                    //update characteristics
                    const serviceName = this.fansNamePrefix ? `${this.info.deviceName} ${friendlyName}` : friendlyName;
                    this.fanServices?.[i]
                        ?.setCharacteristic(Characteristic.ConfiguredName, serviceName)
                        .updateCharacteristic(Characteristic.On, powerFan)
                        // .updateCharacteristic(Characteristic.Direction, direction)
                        .updateCharacteristic(Characteristic.RotationSpeed, speed);


                    //log info
                    if (this.logInfo) {
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
        if (this.logDebug) this.emit('debug', `Prepare Accessory`);

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = Categories.FAN;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            if (this.logDebug) this.emit('debug', `Prepare Information Service`);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            if (this.logDebug) this.emit('debug', `Prepare Services`);
            if (this.fans.length > 0) {
                if (this.logDebug) this.emit('debug', `Prepare Fan Services`);
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
                                await this.client.get(speed);
                                if (this.logInfo) this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
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
                    //            await this.client.get(direction);
                    //            if (this.logInfo) this.emit('info', `${friendlyName}, set direction: ${value}`);
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
                                await this.client.get(speed);
                                if (this.logInfo) this.emit('info', `${friendlyName}, set speed: ${value}`);
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
                                await this.client.get(state);
                                if (this.logInfo) this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    this.lightServices.push(lightService);
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
            await this.checkState();

            //connect to deice success
            this.emit('success', `Connect Success`)

            //check device info 
            if (this.logDeviceInfo) await this.deviceInfo();

            //start prepare accessory
            const accessory = await this.prepareAccessory();
            return accessory;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        }
    }
}
export default Fans;
