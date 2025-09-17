import axios from 'axios';
import EventEmitter from 'events';
import ImpulseGenerator from './impulsegenerator.js';
import Functions from './functions.js';
import { ApiCommands, MiElHVAC, TemperatureDisplayUnits } from './constants.js';
let Accessory, Characteristic, Service, Categories, AccessoryUUID;

class MiElHvac extends EventEmitter {
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

        //mitsubishi ac
        const miElHvac = config.miElHvac ?? {};
        this.heatDryFanMode = miElHvac.heatDryFanMode || 1; //NONE, HEAT, DRY, FAN
        this.coolDryFanMode = miElHvac.coolDryFanMode || 1; //NONE, COOL, DRY, FAN
        this.autoDryFanMode = miElHvac.autoDryFanMode || 1; //NONE, COOL, DRY, FAN

        //external sensor
        const remoteTemperatureSensor = miElHvac.remoteTemperatureSensor ?? {};
        const remoteTemperatureSensorEnable = remoteTemperatureSensor.enable || false;
        const remoteTemperatureSensorPath = remoteTemperatureSensor.path;
        const remoteTemperatureSensorRefreshInterval = remoteTemperatureSensor.refreshInterval * 1000 || 5000;
        const remoteTemperatureSensorAuth = remoteTemperatureSensor.auth || false;
        const remoteTemperatureSensorUser = remoteTemperatureSensor.user;
        const remoteTemperatureSensorPasswd = remoteTemperatureSensor.passwd;
        this.remoteTemperatureSensorEnable = remoteTemperatureSensorEnable;
        this.remoteTemperatureSensorRefreshInterval = remoteTemperatureSensorRefreshInterval;

        //presets
        const presets = miElHvac.presets || [];
        this.presetsConfigured = [];
        for (const preset of presets) {
            const displayType = preset.displayType;
            if (!displayType) {
                continue;
            }

            const presetyServiceType = ['', Service.Outlet, Service.Switch, Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][displayType];
            const presetCharacteristicType = ['', Characteristic.On, Characteristic.On, Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][displayType];
            preset.serviceType = presetyServiceType;
            preset.characteristicType = presetCharacteristicType;
            preset.name = preset.name || 'Preset';
            preset.state = false;
            preset.previousSettings = {};
            this.presetsConfigured.push(preset);
        }
        this.presetsConfiguredCount = this.presetsConfigured.length || 0;

        //buttons
        const buttons = miElHvac.buttons || [];
        this.buttonsConfigured = [];
        for (const button of buttons) {
            const displayType = button.displayType;
            if (!displayType) {
                continue;
            }

            const buttonServiceType = ['', Service.Outlet, Service.Switch][displayType];
            const buttonCharacteristicType = ['', Characteristic.On, Characteristic.On][displayType];
            button.serviceType = buttonServiceType;
            button.characteristicType = buttonCharacteristicType;
            button.name = button.name || 'Button';
            button.state = false;
            button.previousValue = null;
            this.buttonsConfigured.push(button);
        }
        this.buttonsConfiguredCount = this.buttonsConfigured.length || 0;

        //sensors
        const sensors = miElHvac.sensors || [];
        this.sensorsConfigured = [];
        for (const sensor of sensors) {
            const displayType = sensor.displayType;
            if (!displayType) {
                continue;
            }

            const sensorServiceType = ['', Service.MotionSensor, Service.OccupancySensor, Service.ContactSensor][displayType];
            const sensorCharacteristicType = ['', Characteristic.MotionDetected, Characteristic.OccupancyDetected, Characteristic.ContactSensorState][displayType];
            sensor.serviceType = sensorServiceType;
            sensor.characteristicType = sensorCharacteristicType;
            sensor.name = sensor.name || 'Sensor';
            sensor.state = false;
            sensor.previousValue = null;
            this.sensorsConfigured.push(sensor);
        }
        this.sensorsConfiguredCount = this.sensorsConfigured.length || 0;

        //frost protect
        const frostProtect = miElHvac.frostProtect ?? {};
        this.frostProtectEnable = frostProtect.enable || false;
        this.frostProtectLowTemp = frostProtect.lowTemp || 14;
        this.frostProtectHighTemp = frostProtect.highTemp || 16;
        this.frostProtectActive = false;

        //extra sensors
        this.temperatureSensor = miElHvac.temperatureSensor || false;
        this.temperatureSensorOutdoor = miElHvac.temperatureSensorOutdoor || false;

        //other config
        this.sensorsNamePrefix = config.sensorsNamePrefix || false;
        this.enableDebugMode = config.enableDebugMode || false;
        this.disableLogInfo = config.disableLogInfo || false;
        this.disableLogDeviceInfo = config.disableLogDeviceInfo || false;
        this.refreshInterval = refreshInterval;

        //mielhvac
        this.mielHvac = {};
        this.previousStateSwingV = 'auto';
        this.previousStateSwingH = 'center';
        this.functions = new Functions();

        //axios instance
        const url = `http://${config.host}/cm?cmnd=`;
        this.axiosInstance = axios.create({
            baseURL: url,
            timeout: 15000,
            withCredentials: config.auth,
            auth: {
                username: config.user,
                password: config.passwd
            }
        });

        //axios instance remote temp
        if (remoteTemperatureSensorEnable) {
            this.axiosInstanceRemoteTemp = axios.create({
                baseURL: remoteTemperatureSensorPath,
                timeout: 10000,
                withCredentials: remoteTemperatureSensorAuth,
                auth: {
                    username: remoteTemperatureSensorUser,
                    password: remoteTemperatureSensorPasswd
                }
            });
        }

        //lock flags
        this.locks = {
            checkState: false,
            updateRemoteTemp: false,
        };
        this.impulseGenerator = new ImpulseGenerator()
            .on('checkState', () => this.handleWithLock('checkState', async () => {
                await this.checkState();
            }))
            .on('updateRemoteTemp', () => this.handleWithLock('updateRemoteTemp', async () => {
                await this.checkState();
            }))
            .on('state', (state) => {
                this.emit('success', `Impulse generator ${state ? 'started' : 'stopped'}.`);
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
        if (this.enableDebugMode) this.emit('debug', `Requesting status`);
        try {
            //power status
            const powerStatusData = await this.axiosInstance.get(ApiCommands.PowerStatus);
            const powerStatus = powerStatusData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Power status: ${JSON.stringify(powerStatus, null, 2)}`);

            //sensor status
            const sensorStatusData = await this.axiosInstance.get(ApiCommands.Status);
            const sensorStatus = sensorStatusData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Sensors status: ${JSON.stringify(sensorStatus, null, 2)}`);

            //sensor status keys
            const sensorStatusKeys = Object.keys(sensorStatus);

            //status SNS
            const statusSnsSupported = sensorStatusKeys.includes('StatusSNS');
            const statusSns = statusSnsSupported ? sensorStatus.StatusSNS : {};

            //status SNS
            const time = statusSns.Time ?? '';
            const temperatureUnit = statusSns.TempUnit === 'C' ? '°C' : 'F';

            //mielhvac
            const miElHvac = statusSns.MiElHVAC;

            if (!miElHvac || Object.keys(miElHvac).length === 0) {
                this.emit('warn', "Empty data received");
                return null;
            }

            const power = miElHvac.Power === 'on' ? 1 : 0;
            const roomTemperature = miElHvac.Temperature ?? null;
            if (!roomTemperature) return null;

            const outdoorTemperature = miElHvac.OutdoorTemperature ?? null;
            const setTemperature = miElHvac.SetTemperature;
            const operationMode = miElHvac.Mode ?? 'Unknown';
            const operationModeStatus = miElHvac.ModeStatus ?? 'Unknown';
            const fanSpeed = miElHvac.FanSpeed ?? 'Unknown';
            const fanSpeedStatus = miElHvac.FanStatus ?? 'Unknown';
            const vaneVerticalDirection = miElHvac.SwingV ?? 'Unknown';
            const vaneHorizontalDirection = miElHvac.SwingH ?? 'Unknown';
            const prohibit = miElHvac.Prohibit ?? 'Unknown';
            const purify = miElHvac.Purify ?? 'Unknown';
            const econoCool = miElHvac.EonoCool ?? 'Unknown';
            const powerFull = miElHvac.PowerFull ?? 'Unknown';
            const nightMode = miElHvac.NightMode ?? 'Unknown';
            const airDirection = miElHvac.AirDirection ?? 'Unknown';
            const compressor = miElHvac.Compressor ?? 'Unknown';
            const compressorFrequency = miElHvac.CompressorFrequency ?? 0;
            const operationPower = miElHvac.OperationPower ?? 0;
            const operationEnergy = miElHvac.OperationEnergy ?? 0;
            const operationStatus = miElHvac.OperationStatus ?? 'Unknown';
            const swingMode = vaneVerticalDirection === 'swing' && vaneHorizontalDirection === 'swing' ? 1 : 0;
            const defaultCoolingSetTemperature = parseFloat(await this.functions.readData(this.info.defaultCoolingSetTemperatureFile));
            const defaultHeatingSetTemperature = parseFloat(await this.functions.readData(this.info.defaultHeatingSetTemperatureFile));
            const remoteTemperatureSensorState = miElHvac.RemoteTemperatureSensorState ?? false; //ON, OFF
            const remoteTemperatureSensorAutoClearTime = miElHvac.RemoteTemperatureSensorAutoClearTime ?? 0; //time in ms

            const modelSupportsHeat = true;
            const modelSupportsDry = true;
            const modelSupportsCool = true;
            const modelSupportsAuto = true;
            const modelSupportsFanSpeed = true;
            const hasAutomaticFanSpeed = true;
            const numberOfFanSpeeds = 5;
            const lockPhysicalControl = prohibit === 'all' ?? false;
            const useFahrenheit = temperatureUnit === 'F' ?? false;
            const temperatureIncrement = useFahrenheit ? 1 : 0.5;

            const hideDryModeControl = false;
            const hideVaneControls = false;

            const obj = {
                time: time,
                power: power,
                roomTemperature: roomTemperature,
                outdoorTemperature: outdoorTemperature,
                setTemperature: setTemperature,
                operationMode: operationMode,
                operationModeStatus: operationModeStatus,
                currentOperationMode: 0,
                targetOperationMode: 0,
                vaneVerticalDirection: vaneVerticalDirection,
                vaneHorizontalDirection: vaneHorizontalDirection,
                prohibit: prohibit,
                purify: purify,
                econoCool: econoCool,
                powerFull: powerFull,
                nightMode: nightMode,
                airDirection: airDirection,
                swingMode: swingMode,
                compressor: compressor,
                compressorFrequency: compressorFrequency,
                operationPower: operationPower,
                operationEnergy: operationEnergy,
                operationStatus: operationStatus,
                defaultCoolingSetTemperature: defaultCoolingSetTemperature,
                defaultHeatingSetTemperature: defaultHeatingSetTemperature,
                remoteTemperatureSensorState: remoteTemperatureSensorState,
                remoteTemperatureSensorAutoClearTime: remoteTemperatureSensorAutoClearTime,
                modelSupportsHeat: modelSupportsHeat,
                modelSupportsDry: modelSupportsDry,
                modelSupportsCool: modelSupportsCool,
                modelSupportsAuto: modelSupportsAuto,
                modelSupportsFanSpeed: modelSupportsFanSpeed,
                hasAutomaticFanSpeed: hasAutomaticFanSpeed,
                numberOfFanSpeeds: numberOfFanSpeeds,
                lockPhysicalControl: prohibit === 'all' ? 1 : 0,
                temperatureUnit: temperatureUnit,
                useFahrenheit: useFahrenheit,
                temperatureIncrement: temperatureIncrement,
                hideDryModeControl: hideDryModeControl,
                hideVaneControls: hideVaneControls
            };

            // Map status to index safely, fallback to 0 if not found
            const operationModeStatusMap = {
                'manual': 0,
                'heat': 2,
                'dry': 1,
                'cool': 3,
                'fan': 1,
                'heat_isee': 2,
                'dry_isee': 1,
                'cool_isee': 3,
                'auto_fan': 1,
                'auto_heat': 2,
                'auto_cool': 3,
                'auto_leader': 4
            };

            const statusIndex = operationModeStatusMap[operationModeStatus] ?? 0;
            switch (operationMode) {
                case 'heat':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][statusIndex]; // INACTIVE, IDLE, HEATING, COOLING
                    obj.targetOperationMode = 1; // AUTO, HEAT, COOL
                    break;
                case 'dry':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : obj.targetOperationMode;
                    break;
                case 'cool':
                    obj.currentOperationMode = [3, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = 2;
                    break;
                case 'fan':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = this.autoDryFanMode === 3 ? 0 : this.heatDryFanMode === 3 ? 1 : this.coolDryFanMode === 3 ? 2 : obj.targetOperationMode;
                    break;
                case 'auto':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = 0;
                    break;
                case 'heat_isee':
                    obj.currentOperationMode = [2, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = 1;
                    break;
                case 'dry_isee':
                    obj.currentOperationMode = [1, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = this.autoDryFanMode === 2 ? 0 : this.heatDryFanMode === 2 ? 1 : this.coolDryFanMode === 2 ? 2 : obj.targetOperationMode;
                    break;
                case 'cool_isee':
                    obj.currentOperationMode = [3, 1, 2, 3, 0][statusIndex];
                    obj.targetOperationMode = 2;
                    break;
                default:
                    this.emit('warn', `Unknown operating mode: ${operationMode}`);
                    return null;
            }

            // If power is off, force currentOperationMode to 0 (inactive)
            obj.currentOperationMode = !power ? 0 : obj.currentOperationMode;

            // Set min/max/valid values for operation mode controls
            obj.operationModeSetPropsMinValue = modelSupportsAuto && modelSupportsHeat ? 0 : !modelSupportsAuto && modelSupportsHeat ? 1 : modelSupportsAuto && !modelSupportsHeat ? 0 : 2;
            obj.operationModeSetPropsMaxValue = 2;
            obj.operationModeSetPropsValidValues = modelSupportsAuto && modelSupportsHeat ? [0, 1, 2] : !modelSupportsAuto && modelSupportsHeat ? [1, 2] : modelSupportsAuto && !modelSupportsHeat ? [0, 2] : [2];


            if (modelSupportsFanSpeed) {
                const fanSpeedMap = {
                    'auto': 0,
                    'quiet': 1,
                    '1': 2,
                    '2': 3,
                    '3': 4,
                    '4': 5
                };

                const fanIndex = fanSpeedMap[fanSpeed];
                obj.fanSpeed = 0;
                obj.fanSpeedSetPropsMaxValue = 0;

                if (typeof fanIndex === 'number') {
                    switch (numberOfFanSpeeds) {
                        case 2:
                            obj.fanSpeed = hasAutomaticFanSpeed ? [3, 1, 2][fanIndex] ?? 1 : [0, 1, 2][fanIndex] ?? 1;
                            obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 3 : 2;
                            break;
                        case 3:
                            obj.fanSpeed = hasAutomaticFanSpeed ? [4, 1, 2, 3][fanIndex] ?? 1 : [0, 1, 2, 3][fanIndex] ?? 1;
                            obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 4 : 3;
                            break;
                        case 4:
                            obj.fanSpeed = hasAutomaticFanSpeed ? [5, 1, 2, 3, 4][fanIndex] ?? 1 : [0, 1, 2, 3, 4][fanIndex] ?? 1;
                            obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 5 : 4;
                            break;
                        case 5:
                            obj.fanSpeed = hasAutomaticFanSpeed ? [6, 1, 2, 3, 4, 5][fanIndex] ?? 1 : [0, 1, 2, 3, 4, 5][fanIndex] ?? 1;
                            obj.fanSpeedSetPropsMaxValue = hasAutomaticFanSpeed ? 6 : 5;
                            break;
                        default:
                            this.emit('warn', `Unknown fan speeds: ${numberOfFanSpeeds}`);
                    }

                    // Cap value to max
                    if (obj.fanSpeed > obj.fanSpeedSetPropsMaxValue) {
                        obj.fanSpeed = obj.fanSpeedSetPropsMaxValue;
                    }
                }
            }

            this.mielHvac = obj;

            //update characteristics
            if (this.miElHvacService) {
                const svc = this.miElHvacService;

                svc.updateCharacteristic(Characteristic.Active, power)
                    .updateCharacteristic(Characteristic.CurrentHeaterCoolerState, obj.currentOperationMode)
                    .updateCharacteristic(Characteristic.TargetHeaterCoolerState, obj.targetOperationMode)
                    .updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature)
                    .updateCharacteristic(Characteristic.LockPhysicalControls, lockPhysicalControl)
                    .updateCharacteristic(Characteristic.TemperatureDisplayUnits, useFahrenheit)
                    .updateCharacteristic(Characteristic.SwingMode, swingMode);

                if (obj.targetOperationMode === 0 || obj.targetOperationMode === 2) svc.updateCharacteristic(Characteristic.CoolingThresholdTemperature, obj.targetOperationMode === 0 ? defaultCoolingSetTemperature : setTemperature);
                if (obj.targetOperationMode === 0 || obj.targetOperationMode === 1) svc.updateCharacteristic(Characteristic.HeatingThresholdTemperature, obj.targetOperationMode === 0 ? defaultHeatingSetTemperature : setTemperature);
                if (modelSupportsFanSpeed) svc.updateCharacteristic(Characteristic.RotationSpeed, obj.fanSpeed);

                if (this.frostProtectEnable) {
                    if (roomTemperature <= this.frostProtectLowTemp && !power) {
                        svc.setCharacteristic(Characteristic.Active, true)
                            .setCharacteristic(Characteristic.TargetHeaterCoolerState, 1)
                            .setCharacteristic(Characteristic.HeatingThresholdTemperature, this.frostProtectHighTemp);
                        this.frostProtectActive = true;
                    }

                    if (roomTemperature >= this.frostProtectHighTemp && this.frostProtectActive) {
                        svc.setCharacteristic(Characteristic.Active, false);
                        this.frostProtectActive = false;
                    }
                }
            }

            // Update presets state
            if (this.presetsConfiguredCount > 0) {
                this.presetsConfigured.forEach((preset, index) => {
                    let iseeMode = operationMode;
                    if (iseeMode === 'heat_isee') iseeMode = 'heat';
                    else if (iseeMode === 'dry_isee') iseeMode = 'dry';
                    else if (iseeMode === 'cool_isee') iseeMode = 'cool';

                    const sameTemp = Number(preset.setTemp).toFixed(1) === Number(setTemperature).toFixed(1);
                    const sameFan = preset.fanSpeed === fanSpeed;
                    const sameSwingV = preset.swingV === vaneVerticalDirection;
                    const sameSwingH = preset.swingH === vaneHorizontalDirection;
                    const sameMode = preset.mode === iseeMode;

                    preset.state = power ? (sameMode && sameTemp && sameFan && sameSwingV && sameSwingH) : false;
                    this.presetsServices?.[index]?.updateCharacteristic(preset.characteristicType, preset.state);
                });
            }

            if (this.buttonsConfiguredCount > 0) {
                const modeMap = {
                    0: () => power === 1,
                    1: () => power && ['heat', 'heat_isee'].includes(operationMode),
                    2: () => power && ['dry', 'dry_isee'].includes(operationMode),
                    3: () => power && ['cool', 'cool_isee'].includes(operationMode),
                    4: () => power && operationMode === 'fan',
                    5: () => power && operationMode === 'auto',
                };

                const vaneHMap = {
                    10: 'left',
                    11: 'left_middle',
                    12: 'left_center',
                    13: 'center',
                    14: 'right_center',
                    15: 'right_middle',
                    16: 'right',
                    17: 'split',
                    18: 'swing',
                    19: 'airdirection',
                };

                const vaneVMap = {
                    20: 'auto',
                    21: 'up',
                    22: 'up_middle',
                    23: 'center',
                    24: 'down_middle',
                    25: 'down',
                    26: 'swing',
                };

                const fanSpeedMap = {
                    30: 'auto',
                    31: 'quiet',
                    32: '1',
                    33: '2',
                    34: '3',
                    35: '4',
                };

                const airDirMap = {
                    40: 'indirect',
                    41: 'direct',
                    42: 'even',
                };

                const prohibitMap = {
                    50: 'all',
                    51: 'power',
                    52: 'mode',
                    53: 'temp',
                };

                const functionsMap = {
                    60: 'purify', //purify
                    61: 'econoCool', //econocool
                    62: 'powerFull', //powerfull
                    63: 'noghtMode', //nightmode
                };

                const functionsStateMap = {
                    60: 'on', //purify
                    61: 'on', //econocool
                    62: 'on', //powerfull
                    63: 'on', //nightmode
                };

                this.buttonsConfigured.forEach((button, index) => {
                    const mode = button.mode;
                    let state = false;

                    if (modeMap[mode]) {
                        state = modeMap[mode]();
                    } else if (vaneHMap[mode]) {
                        state = power && vaneHorizontalDirection === vaneHMap[mode];
                    } else if (vaneVMap[mode]) {
                        state = power && vaneVerticalDirection === vaneVMap[mode];
                    } else if (fanSpeedMap[mode]) {
                        state = power && fanSpeed === fanSpeedMap[mode];
                    } else if (airDirMap[mode]) {
                        state = power && airDirection === airDirMap[mode];
                    } else if (prohibitMap[mode]) {
                        state = power && prohibit === prohibitMap[mode];
                    } else if (functionsStateMap[mode]) {
                        state = power && functionsMap[mode] === functionsStateMap[mode];
                    } else {
                        this.emit('warn', `Unknown button mode: ${mode} detected`);
                    }

                    button.state = state;

                    const characteristicType = button.characteristicType;
                    this.buttonsServices?.[index]?.updateCharacteristic(characteristicType, state);
                });
            }

            if (this.sensorsConfiguredCount > 0) {
                const powerOn = power === 1;

                // Helper: match by value with power check
                const is = (val, match) => powerOn && val === match;
                const isOneOf = (val, matches) => powerOn && matches.includes(val);

                this.sensorsConfigured.forEach((sensor, index) => {
                    const mode = sensor.mode;

                    const sensorStates = {
                        0: powerOn,
                        1: isOneOf(operationMode, ['heat', 'heat_isee']),
                        2: isOneOf(operationMode, ['dry', 'dry_isee']),
                        3: isOneOf(operationMode, ['cool', 'cool_isee']),
                        4: is(operationMode, 'fan'),
                        5: is(operationMode, 'auto'),
                        6: is(purify, 'on'),

                        10: is(vaneHorizontalDirection, 'left'),
                        11: is(vaneHorizontalDirection, 'left_middle'),
                        12: is(vaneHorizontalDirection, 'left_center'),
                        13: is(vaneHorizontalDirection, 'center'),
                        14: is(vaneHorizontalDirection, 'right_center'),
                        15: is(vaneHorizontalDirection, 'right_middle'),
                        16: is(vaneHorizontalDirection, 'right'),
                        17: is(vaneHorizontalDirection, 'split'),
                        18: is(vaneHorizontalDirection, 'swing'),
                        19: is(vaneHorizontalDirection, 'airdirection'),

                        20: is(vaneVerticalDirection, 'auto'),
                        21: is(vaneVerticalDirection, 'up'),
                        22: is(vaneVerticalDirection, 'up_middle'),
                        23: is(vaneVerticalDirection, 'center'),
                        24: is(vaneVerticalDirection, 'down_middle'),
                        25: is(vaneVerticalDirection, 'down'),
                        26: is(vaneVerticalDirection, 'swing'),

                        27: is(hideVaneControls, true),

                        30: is(fanSpeed, 'auto'),
                        31: is(fanSpeed, 'quiet'),
                        32: is(fanSpeed, '1'),
                        33: is(fanSpeed, '2'),
                        34: is(fanSpeed, '3'),
                        35: is(fanSpeed, '4'),

                        40: is(airDirection, 'indirect'),
                        41: is(airDirection, 'direct'),
                        42: is(airDirection, 'even'),

                        50: prohibit === 'all',
                        51: prohibit === 'power',
                        52: prohibit === 'mode',
                        53: prohibit === 'temp',

                        60: remoteTemperatureSensorState,

                        70: operationStatus === 'normal',
                        71: operationStatus === 'filter',
                        72: operationStatus === 'defrost',
                        73: operationStatus === 'standby',
                        74: operationStatus === 'preheat',

                        80: fanSpeedStatus === 'off',
                        81: fanSpeedStatus === 'quiet',
                        82: fanSpeedStatus === '1',
                        83: fanSpeedStatus === '2',
                        84: fanSpeedStatus === '3',
                        85: fanSpeedStatus === '4',
                        86: fanSpeedStatus === '5',

                        90: operationMode !== 'auto',
                        91: operationModeStatus === 'auto_fan',
                        92: operationModeStatus === 'auto_heat',
                        93: operationModeStatus === 'auto_cool',
                        94: operationModeStatus === 'auto_leader',
                    };

                    if (mode in sensorStates) {
                        sensor.state = sensorStates[mode];
                    } else {
                        this.emit('warn', `Unknown sensor mode: ${mode} detected`);
                    }

                    // Update characteristic{
                    const characteristicType = sensor.characteristicType;
                    this.sensorsServices?.[index]?.updateCharacteristic(characteristicType, sensor.state);
                });
            }

            //update room temperature sensor
            this.roomTemperatureSensorService?.updateCharacteristic(Characteristic.CurrentTemperature, roomTemperature);

            //update outdoor temperature sensor
            this.outdoorTemperatureSensorService?.updateCharacteristic(Characteristic.CurrentTemperature, outdoorTemperature);

            //log current state
            if (!this.disableLogInfo) {
                this.emit('info', `Power: ${power ? 'ON' : 'OFF'}`);
                const info = power ? this.emit('info', `Target operation mode: ${operationMode.toUpperCase()}`) : false;
                const info1 = power ? this.emit('info', `Current operation mode: ${operationModeStatus.toUpperCase()}`) : false;
                const info2 = power ? this.emit('info', `Target temperature: ${setTemperature}${temperatureUnit}`) : false;
                const info3 = power ? this.emit('info', `Current temperature: ${roomTemperature}${temperatureUnit}`) : false;
                const info4 = power && outdoorTemperature !== null ? this.emit('info', `Outdoor temperature: ${outdoorTemperature}${temperatureUnit}`) : false;
                const info5 = power && modelSupportsFanSpeed ? this.emit('info', `Target Fan speed: ${fanSpeed.toUpperCase()}`) : false;
                const info6 = power && modelSupportsFanSpeed ? this.emit('info', `Current Fan speed: ${fanSpeedStatus.toUpperCase()}`) : false;
                const info7 = power && vaneHorizontalDirection !== 'Unknown' ? this.emit('info', `Vane horizontal: ${MiElHVAC.HorizontalVane[vaneHorizontalDirection] ?? vaneHorizontalDirection}`) : false;
                const info8 = power && vaneVerticalDirection !== 'Unknown' ? this.emit('info', `Vane vertical: ${MiElHVAC.VerticalVane[vaneVerticalDirection] ?? vaneVerticalDirection}`) : false;
                const info9 = power ? this.emit('info', `Swing mode: ${MiElHVAC.SwingMode[swingMode]}`) : false;
                const info10 = power && vaneHorizontalDirection === 'isee' && airDirection !== 'Unknown' ? this.emit('info', `Air direction: ${MiElHVAC.AirDirection[airDirection]}`) : false;
                const info11 = power ? this.emit('info', `Prohibit: ${MiElHVAC.Prohibit[prohibit]}`) : false;
                const info12 = power ? this.emit('info', `Temperature display unit: ${temperatureUnit}`) : false;
                const info13 = power ? this.emit('info', `Compressor: ${compressor.toUpperCase()}`) : false;
                const info14 = power ? this.emit('info', `OperationPower: ${operationPower}W`) : false;
                const info15 = power ? this.emit('info', `OperationEnergy: ${operationEnergy}kWh`) : false;
            }

            return true;
        } catch (error) {
            throw new Error(`Check state error: ${error}`);
        }
    }

    async updateRemoteTemp() {
        try {
            //get remote temp
            const rmoteTempData = await this.axiosInstanceRemoteTemp.get();
            const remoteTemp = rmoteTempData.data ?? false;
            if (this.enableDebugMode) this.emit('debug', `Remote temp: ${JSON.stringify(remoteTemp, null, 2)}`);

            //set remote temp
            const temp = `${MiElHVAC.SetRemoteTemp}${remoteTemp}`
            await this.axiosInstance.get(temp);

            return true
        } catch (error) {
            throw new Error(`Update remote temperature error: ${error}`);
        }
    }

    async startImpulseGenerator() {
        try {
            //start impulse generator 
            const timers = [{ name: 'checkState', sampling: this.refreshInterval }];
            if (this.remoteTemperatureSensorEnable) timers.push({ name: 'updateRemoteTemp', sampling: this.remoteTemperatureSensorRefreshInterval });
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
        this.emit('devInfo', `Device: MiELHVAC`);
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
            const accessoryCategory = Categories.AIR_CONDITIONER
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
            if (this.enableDebugMode) this.emit('debug', `Prepare mitsubishi hvac service`);
            const autoDryFanMode = [MiElHVAC.SetMode.auto, MiElHVAC.SetMode.auto, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.autoDryFanMode]; //NONE, AUTO, DRY, FAN
            const heatDryFanMode = [MiElHVAC.SetMode.heat, MiElHVAC.SetMode.heat, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.heatDryFanMode]; //NONE, HEAT, DRY, FAN
            const coolDryFanMode = [MiElHVAC.SetMode.cool, MiElHVAC.SetMode.cool, MiElHVAC.SetMode.dry, MiElHVAC.SetMode.fan][this.coolDryFanMode]; //NONE, COOL, DRY, FAN

            //services
            this.miElHvacService = new Service.HeaterCooler(accessoryName, `HeaterCooler ${this.serialNumber}`);
            this.miElHvacService.setPrimaryService(true);
            this.miElHvacService.addOptionalCharacteristic(Characteristic.ConfiguredName);
            this.miElHvacService.setCharacteristic(Characteristic.ConfiguredName, accessoryName);
            this.miElHvacService.getCharacteristic(Characteristic.Active)
                .onGet(async () => {
                    const state = this.mielHvac.power;
                    return state;
                })
                .onSet(async (state) => {
                    try {
                        const power = [MiElHVAC.PowerOff, MiElHVAC.PowerOn][state];
                        await this.axiosInstance.get(power);
                        if (!this.disableLogInfo) this.emit('info', `Set power: ${state ? 'ON' : 'OFF'}`);
                    } catch (error) {
                        this.emit('warn', `Set power error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
                .onGet(async () => {
                    const value = this.mielHvac.currentOperationMode;
                    return value;
                });
            this.miElHvacService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                .setProps({
                    minValue: this.mielHvac.operationModeSetPropsMinValue,
                    maxValue: this.mielHvac.operationModeSetPropsMaxValue,
                    validValues: this.mielHvac.operationModeSetPropsValidValues
                })
                .onGet(async () => {
                    const value = this.mielHvac.targetOperationMode; //1 = HEAT, 2 = DRY 3 = COOL, 7 = FAN, 8 = AUTO
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        switch (value) {
                            case 0: //AUTO
                                await this.axiosInstance.get(autoDryFanMode);
                                break;
                            case 1: //HEAT
                                await this.axiosInstance.get(heatDryFanMode);
                                break;
                            case 2: //COOL
                                await this.axiosInstance.get(coolDryFanMode);
                                break;
                        };

                        if (!this.disableLogInfo) this.emit('info', `Set operation mode: ${MiElHVAC.OperationMode[value]}`);
                    } catch (error) {
                        this.emit('warn', `Set operation mode error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.CurrentTemperature)
                .onGet(async () => {
                    const value = this.mielHvac.roomTemperature;
                    return value;
                });
            if (this.mielHvac.modelSupportsFanSpeed) {
                this.miElHvacService.getCharacteristic(Characteristic.RotationSpeed)
                    .setProps({
                        minValue: 0,
                        maxValue: this.mielHvac.fanSpeedSetPropsMaxValue,
                        minStep: 1
                    })
                    .onGet(async () => {
                        const value = this.mielHvac.fanSpeed; //AUTO, 1, 2, 3, 4, 5
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            let fanSpeed = 0;
                            let fanSpeedModeText = 'off';
                            switch (this.mielHvac.numberOfFanSpeeds) {
                                case 2: //Fan speed mode 2
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 0][value] : [1, 1, 2][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', 'auto'][value] : ['off', 'quiet', '1'][value];
                                    break;
                                case 3: //Fan speed mode 3
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 0][value] : [1, 1, 2, 3][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', 'auto'][value] : ['off', 'quiet', '1', '2',][value];
                                    break;
                                case 4: //Fan speed mode 4
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 0][value] : [1, 1, 2, 3, 4][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', '3', 'auto'][value] : ['off', 'quiet', '1', '2', '3'][value];
                                    break;
                                case 5: //Fan speed mode 5
                                    fanSpeed = this.mielHvac.hasAutomaticFanSpeed ? [0, 1, 2, 3, 4, 5, 0][value] : [1, 1, 2, 3, 4, 5][value];
                                    fanSpeedModeText = this.mielHvac.hasAutomaticFanSpeed ? ['off', 'quiet', '1', '2', '3', '4', 'auto'][value] : ['off', 'quiet', '1', '2', '3', '4'][value];
                                    break;
                            }

                            //fan speed mode
                            const fanSpeedMap = ['auto', 'quiet', '1', '2', '3', '4'][fanSpeed];
                            await this.axiosInstance.get(MiElHVAC.SetFanSpeed[fanSpeedMap]);
                            if (!this.disableLogInfo) this.emit('info', `Set fan speed mode: ${MiElHVAC.FanSpeed[fanSpeedModeText]}`);
                        } catch (error) {
                            this.emit('warn', `Set fan speed mode error: ${error}`);
                        }
                    });
            }
            if (this.mielHvac.swingMode) {
                this.miElHvacService.getCharacteristic(Characteristic.SwingMode)
                    .onGet(async () => {
                        const value = this.mielHvac.swingMode;
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            switch (value) {
                                case 0:
                                    await this.axiosInstance.get(MiElHVAC.SetSwingV[this.previousStateSwingV]);
                                    await this.axiosInstance.get(MiElHVAC.SetSwingH[this.previousStateSwingH]);
                                    break;
                                case 1:
                                    //set vane v
                                    this.previousStateSwingV = this.mielHvac.vaneVerticalDirection;
                                    await this.axiosInstance.get(MiElHVAC.SetSwingV.swing);

                                    //set vane h
                                    this.previousStateSwingH = this.mielHvac.vaneHorizontalDirection;
                                    await this.axiosInstance.get(MiElHVAC.SetSwingH.swing);
                                    break;
                            }
                            if (!this.disableLogInfo) this.emit('info', `Set air direction mode: ${MiElHVAC.SwingMode[value]}`);
                        } catch (error) {
                            this.emit('warn', `Set vane swing mode error: ${error}`);
                        }
                    });
            }
            this.miElHvacService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                .setProps({
                    minValue: 16,
                    maxValue: 31,
                    minStep: this.mielHvac.temperatureIncrement
                })
                .onGet(async () => {
                    const value = this.mielHvac.targetOperationMode === 2 ? this.mielHvac.setTemperature : this.mielHvac.defaultCoolingSetTemperature;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        if (this.mielHvac.targetOperationMode === 0) {
                            await this.functions.saveData(this.info.defaultCoolingSetTemperatureFile, value);
                            value = (value + this.info.mielHvac.defaultHeatingSetTemperature) / 2;
                        }

                        const temp = `${MiElHVAC.SetTemp}${value}`
                        await this.axiosInstance.get(temp);
                        if (!this.disableLogInfo) this.emit('info', `Set ${this.mielHvac.targetOperationMode === 2 ? 'temperature' : 'cooling threshold temperature'}: ${value}${this.mielHvac.temperatureUnit}`);
                    } catch (error) {
                        this.emit('warn', `Set cooling threshold temperature error: ${error}`);
                    }
                });
            if (this.mielHvac.modelSupportsHeat) {
                this.miElHvacService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                    .setProps({
                        minValue: 10,
                        maxValue: 31,
                        minStep: this.mielHvac.temperatureIncrement
                    })
                    .onGet(async () => {
                        const value = this.mielHvac.targetOperationMode === 1 ? this.mielHvac.setTemperature : this.mielHvac.defaultHeatingSetTemperature;
                        return value;
                    })
                    .onSet(async (value) => {
                        try {
                            if (this.mielHvac.targetOperationMode === 0) {
                                await this.functions.saveData(this.info.defaultHeatingSetTemperatureFile, value);
                                value = (value + this.info.mielHvac.defaultCoolingSetTemperature) / 2;
                            }

                            const temp = `${MiElHVAC.SetTemp}${value}`
                            await this.axiosInstance.get(temp);
                            if (!this.disableLogInfo) this.emit('info', `Set ${this.mielHvac.targetOperationMode === 1 ? 'temperature' : 'heating threshold temperature'}: ${value}${this.mielHvac.temperatureUnit}`);
                        } catch (error) {
                            this.emit('warn', `Set heating threshold temperature error: ${error}`);
                        }
                    });
            }
            this.miElHvacService.getCharacteristic(Characteristic.LockPhysicalControls)
                .onGet(async () => {
                    const value = this.mielHvac.lockPhysicalControl;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        const lock = [MiElHVAC.SetProhibit.off, MiElHVAC.SetProhibit.all][value];
                        await this.axiosInstance.get(lock);
                        if (!this.disableLogInfo) this.emit('info', `Set local physical controls: ${value ? 'LOCK' : 'UNLOCK'}`);
                    } catch (error) {
                        this.emit('warn', `Set lock physical controls error: ${error}`);
                    }
                });
            this.miElHvacService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                .onGet(async () => {
                    const value = this.mielHvac.useFahrenheit;
                    return value;
                })
                .onSet(async (value) => {
                    try {
                        const unit = [MiElHVAC.SetDisplayUnit.c, MiElHVAC.SetDisplayUnit.f][value];
                        //await this.axiosInstance.get(unit);
                        if (!this.disableLogInfo) this.emit('info', `Set temperature display unit: ${TemperatureDisplayUnits[value]}`);
                    } catch (error) {
                        this.emit('warn', `Set temperature display unit error: ${error}`);
                    }
                });
            accessory.addService(this.miElHvacService);

            //presets services
            if (this.presetsConfiguredCount > 0) {
                if (this.enableDebugMode) this.emit('debug', 'Prepare presets services');
                this.presetsServices = [];

                this.presetsConfigured.forEach((preset, index) => {
                    const { name: presetName, namePrefix, serviceType, characteristicType, mode, setTemp, fanSpeed, swingV, swingH } = preset;
                    const serviceName = namePrefix ? `${accessoryName} ${presetName}` : presetName;

                    const presetService = new serviceType(serviceName, `Preset ${index}`);
                    presetService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    presetService.setCharacteristic(Characteristic.ConfiguredName, serviceName);

                    presetService.getCharacteristic(characteristicType)
                        .onGet(async () => preset.state)
                        .onSet(async (state) => {
                            try {
                                if (state) {
                                    // Power on if needed
                                    if (!this.mielHvac.power) {
                                        await this.axiosInstance.get(MiElHVAC.PowerOn);
                                    }

                                    // Apply preset commands in sequence
                                    const commands = [
                                        MiElHVAC.SetMode[mode],
                                        `${MiElHVAC.SetTemp}${setTemp}`,
                                        MiElHVAC.SetFanSpeed[fanSpeed],
                                        MiElHVAC.SetSwingV[swingV],
                                        MiElHVAC.SetSwingH[swingH]
                                    ];

                                    for (const cmd of commands) {
                                        await this.axiosInstance.get(cmd);
                                    }

                                    if (!this.disableLogInfo) {
                                        this.emit('info', `Set: ${presetName}`);
                                    }

                                    await new Promise(resolve => setTimeout(resolve, 250));
                                }
                            } catch (error) {
                                this.emit('warn', `Set preset error: ${error}`);
                            }
                        });

                    this.presetsServices.push(presetService);
                    accessory.addService(presetService);
                });
            }


            if (this.buttonsConfiguredCount > 0) {
                if (this.enableDebugMode) this.emit('debug', 'Prepare buttons services');
                this.buttonsServices = [];

                this.buttonsConfigured.forEach((button, index) => {
                    const { mode, name: buttonName, namePrefix, serviceType, characteristicType } = button;
                    const serviceName = namePrefix ? `${accessoryName} ${buttonName}` : buttonName;

                    const buttonService = new serviceType(serviceName, `Button ${index}`);
                    buttonService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    buttonService.setCharacteristic(Characteristic.ConfiguredName, serviceName);

                    buttonService.getCharacteristic(characteristicType)
                        .onGet(async () => button.state)
                        .onSet(async (state) => {
                            try {
                                let data;
                                const mappings = {
                                    0: () => state ? MiElHVAC.PowerOn : MiElHVAC.PowerOff,

                                    // Modes
                                    1: () => getCommand('SetMode', 'heat'),
                                    2: () => getCommand('SetMode', 'dry'),
                                    3: () => getCommand('SetMode', 'cool'),
                                    4: () => getCommand('SetMode', 'fan'),
                                    5: () => getCommand('SetMode', 'auto'),

                                    // Horizontal Swing
                                    10: () => getCommand('SetSwingH', 'left'),
                                    11: () => getCommand('SetSwingH', 'left_middle'),
                                    12: () => getCommand('SetSwingH', 'left_center'),
                                    13: () => getCommand('SetSwingH', 'center'),
                                    14: () => getCommand('SetSwingH', 'right_center'),
                                    15: () => getCommand('SetSwingH', 'right_middle'),
                                    16: () => getCommand('SetSwingH', 'right'),
                                    17: () => getCommand('SetSwingH', 'split'),
                                    18: () => getCommand('SetSwingH', 'swing'),

                                    // Vertical Swing
                                    20: () => getCommand('SetSwingV', 'auto'),
                                    21: () => getCommand('SetSwingV', 'up'),
                                    22: () => getCommand('SetSwingV', 'up_middle'),
                                    23: () => getCommand('SetSwingV', 'center'),
                                    24: () => getCommand('SetSwingV', 'down_middle'),
                                    25: () => getCommand('SetSwingV', 'down'),
                                    26: () => getCommand('SetSwingV', 'swing'),

                                    // Fan Speeds
                                    30: () => getCommand('SetFanSpeed', 'auto'),
                                    31: () => getCommand('SetFanSpeed', 'quiet'),
                                    32: () => getCommand('SetFanSpeed', '1'),
                                    33: () => getCommand('SetFanSpeed', '2'),
                                    34: () => getCommand('SetFanSpeed', '3'),
                                    35: () => getCommand('SetFanSpeed', '4'),

                                    // Air Direction
                                    40: () => getCommand('SetAirDirection', 'indirect'),
                                    41: () => getCommand('SetAirDirection', 'direct'),
                                    42: () => getCommand('SetAirDirection', 'even'),

                                    // Prohibit
                                    50: () => getCommand('SetProhibit', 'all'),
                                    51: () => getCommand('SetProhibit', 'power'),
                                    52: () => getCommand('SetProhibit', 'mode'),
                                    53: () => getCommand('SetProhibit', 'temp'),

                                    // Purify
                                    60: () => getCommand('SetPurify', 'purify'),
                                    61: () => getCommand('SetEconoCool', 'econocool'),
                                    62: () => getCommand('SetPowerFull', 'powerfull'),
                                    63: () => getCommand('SetNightMode', 'nightmode'),
                                };

                                const getCommand = (type, target) => {
                                    const current = this.mielHvac[getCurrentKey(type)];
                                    button.previousValue = state ? MiElHVAC[type][current] : button.previousValue;
                                    return state ? MiElHVAC[type][target] : button.previousValue;
                                };

                                const getCurrentKey = (type) => {
                                    switch (type) {
                                        case 'SetMode': return 'operationMode';
                                        case 'SetSwingH': return 'vaneHorizontalDirection';
                                        case 'SetSwingV': return 'vaneVerticalDirection';
                                        case 'SetFanSpeed': return 'fanSpeed';
                                        case 'SetAirDirection': return 'airDirection';
                                        case 'SetProhibit': return 'prohibit';
                                        case 'SetPurify': return 'purify';
                                        case 'SetEconoCool': return 'econoCool';
                                        case 'SetPowerFull': return 'powerFull';
                                        case 'SetNightMode': return 'nightMode';
                                        default: return '';
                                    }
                                };

                                if (!mappings.hasOwnProperty(mode)) {
                                    this.emit('warn', `Unknown button mode: ${mode}`);
                                    return;
                                }

                                data = mappings[mode]();
                                if (!this.mielHvac.power && state && mode > 0 && mode <= 63) {
                                    await this.axiosInstance.get(MiElHVAC.PowerOn);
                                }

                                await this.axiosInstance.get(data);

                                if (!this.disableLogInfo) {
                                    const action = state ? `Set: ${buttonName}` : `Unset: ${buttonName}, Set: ${button.previousValue}`;
                                    if (mode > 0) this.emit('info', action);
                                }

                                await new Promise(resolve => setTimeout(resolve, 250));
                            } catch (error) {
                                this.emit('warn', `Set button error: ${error}`);
                            }
                        });

                    this.buttonsServices.push(buttonService);
                    accessory.addService(buttonService);
                });
            }


            //sensors services
            if (this.sensorsConfiguredCount > 0) {
                if (this.enableDebugMode) this.emit('debug', `Prepare sensors services`);
                this.sensorsServices = [];

                this.sensorsConfigured.forEach((sensor, index) => {
                    //get sensor name
                    const sensorName = sensor.name;

                    //get sensor name prefix
                    const sensorNamePrefix = sensor.namePrefix;

                    const serviceName = sensorNamePrefix ? `${accessoryName} ${sensorName}` : sensorName;
                    const serviceType = sensor.serviceType;
                    const characteristicType = sensor.characteristicType;
                    const sensorService = new serviceType(serviceName, `Sensor ${index}`);
                    sensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                    sensorService.setCharacteristic(Characteristic.ConfiguredName, serviceName);
                    sensorService.getCharacteristic(characteristicType)
                        .onGet(async () => {
                            const state = sensor.state;
                            return state;
                        });
                    this.sensorsServices.push(sensorService);
                    accessory.addService(sensorService);
                });
            }

            //room temperature sensor service
            if (this.temperatureSensor && this.mielHvac.roomTemperature !== null) {
                if (this.enableDebugMode) this.emit('debug', `Prepare room temperature sensor service`);
                this.roomTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Room`, `Room Temperature Sensor`);
                this.roomTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.roomTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Room`);
                this.roomTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                    .setProps({
                        minValue: -35,
                        maxValue: 150,
                        minStep: 0.5
                    })
                    .onGet(async () => {
                        const state = this.mielHvac.roomTemperature;
                        return state;
                    })
                accessory.addService(this.roomTemperatureSensorService);
            }

            //outdoor temperature sensor service
            if (this.temperatureSensorOutdoor && this.mielHvac.hasOutdoorTemperature && this.mielHvac.outdoorTemperature !== null) {
                if (this.enableDebugMode) this.emit('debug', `Prepare outdoor temperature sensor service`);
                this.outdoorTemperatureSensorService = new Service.TemperatureSensor(`${serviceName} Outdoor`, `Outdoor Temperature Sensor`);
                this.outdoorTemperatureSensorService.addOptionalCharacteristic(Characteristic.ConfiguredName);
                this.outdoorTemperatureSensorService.setCharacteristic(Characteristic.ConfiguredName, `${accessoryName} Outdoor`);
                this.outdoorTemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
                    .setProps({
                        minValue: -35,
                        maxValue: 150,
                        minStep: 0.5
                    })
                    .onGet(async () => {
                        const state = this.mielHvac.outdoorTemperature;
                        return state;
                    })
                accessory.addService(this.outdoorTemperatureSensorService);
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
            const checkState = await this.checkState();
            if (!checkState) return null;

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
export default MiElHvac;
