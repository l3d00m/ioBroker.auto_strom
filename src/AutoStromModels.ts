export interface ConfigDevice {
    id: string;
    priority: number;
    verbrauch: number;
    analog: boolean | number | null;
    analog_min: any;
    analog_max: any;
    delay: any;
    erzeuger: boolean | number | null;
}
export interface BaseDevice {
    readonly id: string;
    readonly priority: number;
    readonly verbrauch: number;
    readonly delay_ms: number;
    readonly analog: boolean;
    readonly erzeuger: boolean;
}

export interface AnalogDevice extends BaseDevice {
    value: number;
    analog_min: number;
    analog_max: number;
}

export interface DigitalDevice extends BaseDevice {
    value: boolean;
}

export type AutoStromDevice = AnalogDevice | DigitalDevice;

export function isAnalog(param: BaseDevice): param is AnalogDevice {
    return param.analog === true;
}

export function isDigital(param: BaseDevice): param is DigitalDevice {
    return !isAnalog(param);
}

export enum PowerCalcMode {
    ADDITIONAL_CONSUMABLE,
    ADDITIONAL_FREEABLE,
    TOTAL_ANALOG_POWER,
}
