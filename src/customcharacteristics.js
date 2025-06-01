export default (api) => {
    const { Service, Characteristic, Units, Formats, Perms } = api.hap;

    //Envoy production/consumption characteristics
    class Power extends Characteristic {
        constructor() {
            super('Power', '00000071-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'W',
                maxValue: 10000,
                minValue: -10000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.Power = Power;

    class ApparentPower extends Characteristic {
        constructor() {
            super('Apparent power', '00000072-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'VA',
                maxValue: 10000,
                minValue: -10000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.ApparentPower = ApparentPower;

    class ReactivePower extends Characteristic {
        constructor() {
            super('Reactive power', '00000073-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'VAr',
                maxValue: 10000,
                minValue: -10000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.ReactivePower = ReactivePower;

    class EnergyToday extends Characteristic {
        constructor() {
            super('Energy today', '00000074-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'kWh',
                maxValue: 1000,
                minValue: -1000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.EnergyToday = EnergyToday;

    class EnergyLastDay extends Characteristic {
        constructor() {
            super('Energy last day', '00000075-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'kWh',
                maxValue: 1000,
                minValue: -1000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.EnergyLastDay = EnergyLastDay;

    class EnergyLifetime extends Characteristic {
        constructor() {
            super('Energy lifetime', '00000076-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'kWh',
                maxValue: 100000000,
                minValue: -100000000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.EnergyLifetime = EnergyLifetime;

    class Current extends Characteristic {
        constructor() {
            super('Current', '00000077-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'A',
                maxValue: 1000,
                minValue: -1000,
                minStep: 0.001,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.Current = Current;

    class Voltage extends Characteristic {
        constructor() {
            super('Voltage', '00000078-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'V',
                maxValue: 1000,
                minValue: 0,
                minStep: 0.1,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.Voltage = Voltage;

    class Factor extends Characteristic {
        constructor() {
            super('Power factor', '00000079-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'cos φ',
                maxValue: 1,
                minValue: -1,
                minStep: 0.01,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.Factor = Factor;

    class Freqency extends Characteristic {
        constructor() {
            super('Frequency', '00000080-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.FLOAT,
                unit: 'Hz',
                maxValue: 100,
                minValue: 0,
                minStep: 0.01,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.Freqency = Freqency;

    class ReadingTime extends Characteristic {
        constructor() {
            super('Reading time', '00000081-000B-1000-8000-0026BB765291');
            this.setProps({
                format: Formats.STRING,
                perms: [Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
    Characteristic.ReadingTime = ReadingTime;

    //power production service
    class PowerAndEnergy extends Service {
        constructor(displayName, subtype) {
            super(displayName, '00000004-000A-1000-8000-0026BB765291', subtype);
            // Mandatory Characteristics
            this.addCharacteristic(Characteristic.Power)
            // Optional Characteristics
            this.addOptionalCharacteristic(Characteristic.ApparentPower);
            this.addOptionalCharacteristic(Characteristic.ReactivePower);
            this.addOptionalCharacteristic(Characteristic.EnergyToday);
            this.addOptionalCharacteristic(Characteristic.EnergyLastDay);
            this.addOptionalCharacteristic(Characteristic.EnergyLifetime);
            this.addOptionalCharacteristic(Characteristic.Current);
            this.addOptionalCharacteristic(Characteristic.Voltage);
            this.addOptionalCharacteristic(Characteristic.Factor);
            this.addOptionalCharacteristic(Characteristic.Freqency);
            this.addOptionalCharacteristic(Characteristic.ReadingTime);
            this.addOptionalCharacteristic(Characteristic.ConfiguredName);
        }
    }
    Service.PowerAndEnergy = PowerAndEnergy;
};