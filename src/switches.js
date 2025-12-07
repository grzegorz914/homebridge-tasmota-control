import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import Functions from './functions.js';
import { ApiCommands } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class Switches extends EventEmitter {
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
        this.relaysDisplayType = config.relaysDisplayType || 0;
        this.relaysNamePrefix = config.relaysNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.functions = new Functions();

        //axios instance
        this.client = deviceInfo.client;

        //lock flags
        this.locks = false;
        this.impulseGenerator = new ImpulseGenerator()
            .on('checkState', () => this.handleWithLock(async () => {
                await this.checkState();
            }))
            .on('state', (state) => {
                this.emit(state ? 'success' : 'warn', `Impulse generator ${state ? 'started' : 'stopped'}`);
            });
    }

    async handleWithLock(fn) {
        if (this.locks) return;

        this.locks = true;
        try {
            await fn();
        } catch (error) {
            this.emit('error', `Inpulse generator error: ${error}`);
        } finally {
            this.locks = false;
        }
    }

    async checkState() {
        if (this.enableDebugMode) this.emit('debug', `Requesting status`);
        try {
            //power status
            const powerStatusData = await this.client.get(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`);

            //relays
            const relaysCount = this.relaysCount;
            if (relaysCount > 0) {
                this.switchesOutlets = [];

                for (let i = 0; i < relaysCount; i++) {
                    const friendlyName = this.info.friendlyNames[i];
                    const powerNr = i + 1;
                    const powerKey = relaysCount === 1 ? 'POWER' : `POWER${powerNr}`;
                    const power = powerStatus[powerKey] === 'ON';

                    //push to array
                    const switchOutlet = {
                        friendlyName: friendlyName,
                        power: power
                    };
                    this.switchesOutlets.push(switchOutlet);

                    //update characteristics
                    const serviceName = this.relaysNamePrefix ? `${this.info.deviceName} ${friendlyName}` : friendlyName;
                    this.lightServices?.[i]
                        ?.setCharacteristic(Characteristic.ConfiguredName, serviceName)
                        .updateCharacteristic(Characteristic.On, power);

                    //log info
                    if (!this.disableLogInfo) this.emit('info', `${friendlyName}, state: ${power ? 'ON' : 'OFF'}`);
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
        if (this.enableDebugMode) this.emit('debug', `Prepare Accessory`);

        try {
            //accessory
            const accessoryName = this.info.deviceName;
            const accessoryUUID = AccessoryUUID.generate(this.serialNumber);
            const accessoryCategory = this.relaysDisplayType === 0 ? Categories.OUTLET : Categories.SWITCH;
            const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

            //Prepare information service
            if (this.enableDebugMode) this.emit('debug', `Prepare Information Service`);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Tasmota')
                .setCharacteristic(Characteristic.Model, this.info.modelName ?? 'Model Name')
                .setCharacteristic(Characteristic.SerialNumber, this.serialNumber ?? 'Serial Number')
                .setCharacteristic(Characteristic.FirmwareRevision, this.info.firmwareRevision.replace(/[a-zA-Z]/g, '') ?? '0')
                .setCharacteristic(Characteristic.ConfiguredName, accessoryName);

            //Prepare services 
            if (this.enableDebugMode) this.emit('debug', `Prepare Services`);
            if (this.switchesOutlets.length > 0) {
                if (this.enableDebugMode) this.emit('debug', `Prepare Switch/Outlet Services`);
                this.switchOutletServices = [];

                for (let i = 0; i < this.switchesOutlets.length; i++) {
                    const friendlyName = this.switchesOutlets[i].friendlyName;
                    const serviceName = this.relaysNamePrefix ? `${accessoryName} ${friendlyName}` : friendlyName;
                    const serviceSwitchOutlet = [Service.Outlet, Service.Switch][this.relaysDisplayType];
                    const switchOutletService = accessory.addService(serviceSwitchOutlet, serviceName, `Power ${i}`)
                    switchOutletService.setPrimaryService(true);
                    switchOutletService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    switchOutletService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    switchOutletService.getCharacteristic(Characteristic.On)
                        .onGet(async () => {
                            const state = this.switchesOutlets[i].power ?? false;
                            return state;
                        })
                        .onSet(async (state) => {
                            try {
                                const relayNr = i + 1;
                                const powerOn = this.switchesOutlets.length === 1 ? ApiCommands.PowerOn : `${ApiCommands.Power}${relayNr}${ApiCommands.On}`;
                                const powerOff = this.switchesOutlets.length === 1 ? ApiCommands.PowerOff : `${ApiCommands.Power}${relayNr}${ApiCommands.Off}`;
                                state = state ? powerOn : powerOff;

                                await this.client.get(state);
                                if (!this.disableLogInfo) this.emit('info', `${friendlyName}, set state: ${state ? 'ON' : 'OFF'}`);
                            } catch (error) {
                                this.emit('warn', `${friendlyName}, set state error: ${error}`);
                            }
                        });
                    this.switchOutletServices.push(switchOutletService);
                }
            };

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
            if (!this.disableLogDeviceInfo) await this.deviceInfo();

            //start prepare accessory
            const accessory = await this.prepareAccessory();
            return accessory;
        } catch (error) {
            throw new Error(`Start error: ${error}`);
        }
    }
}
export default Switches;
