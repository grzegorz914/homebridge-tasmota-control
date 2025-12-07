import axios from 'axios';
import EventEmitter from 'events';
import { ApiCommands, LightKeys, SensorKeys } from './constants.js';

class DeviceInfo extends EventEmitter {
    constructor(url, auth, user, passwd, deviceName, loadNameFromDevice, enableDebugMode) {
        super();
        this.name = deviceName
        this.loadNameFromDevice = loadNameFromDevice;
        this.enableDebugMode = enableDebugMode;

        //axios instance
        this.client = axios.create({
            baseURL: url,
            timeout: 20000,
            withCredentials: auth,
            auth: {
                username: user,
                password: passwd
            }
        });

    }

    async getInfo() {
        if (this.enableDebugMode) this.emit('debug', `Requesting info`);
        try {
            const deviceInfoData = await this.client.get(ApiCommands.Status);
            const deviceInfo = deviceInfoData.data ?? {};
            if (this.enableDebugMode) this.emit('debug', `Info: ${JSON.stringify(deviceInfo, null, 2)}`);
            await new Promise(resolve => setTimeout(resolve, 250));

            //status
            const friendlyNames = [];
            const status = deviceInfo.Status ?? {};
            const deviceName = this.loadNameFromDevice ? status.DeviceName ?? 'Unknown' : this.name;
            const friendlyName = status.FriendlyName ?? [];
            const relaysName = Array.isArray(friendlyName) ? friendlyName : [friendlyName];
            for (const relayName of relaysName) {
                const name = relayName ?? 'Unknown'
                friendlyNames.push(name);
            }

            //status FWR
            const statusFwr = deviceInfo.StatusFWR ?? {};
            const firmwareRevision = statusFwr.Version ?? 'Unknown';
            const modelName = statusFwr.Hardware ?? 'Unknown';

            //status NET
            const statusNet = deviceInfo.StatusNET ?? {};
            const addressMac = statusNet.Mac ?? false;

            //status SNS
            const statusSns = deviceInfo.StatusSNS ?? {};
            const statusSnsKeys = Object.keys(statusSns);

            //status STS
            const statusSts = deviceInfo.StatusSTS ?? {};
            const statusStsKeys = Object.keys(statusSts);

            //device types
            const types = [];
            const mielhvac = statusSnsKeys.includes('MiElHVAC') ? types.push(0) : false;
            const lights = statusStsKeys.some(key => LightKeys.includes(key)) ? types.push(2) : false;
            const fans = statusStsKeys.includes('FanSpeed') ? types.push(3) : false;
            const switches = !mielhvac && !lights && !fans ? types.push(1) : false
            const sensors = statusSnsKeys.some(key => SensorKeys.includes(key)) ? types.push(4) : false;
            const sensorName = Object.entries(statusSns).filter(([key]) => SensorKeys.some(type => key.includes(type))).reduce((obj, [key, value]) => { return key; }, {});
            const obj = {
                deviceTypes: types,
                deviceName: deviceName,
                sensorName: sensorName,
                friendlyNames: friendlyNames,
                modelName: modelName,
                serialNumber: addressMac,
                firmwareRevision: firmwareRevision
            };
            this.emit('debug', `Sensor: ${JSON.stringify(obj, null, 2)}`)
            return obj;
        } catch (error) {
            throw new Error(`Check info error: ${error}`);
        }
    }
}
export default DeviceInfo;
