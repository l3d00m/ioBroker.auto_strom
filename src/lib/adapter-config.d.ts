// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
import { ConfigDevice } from '../AutoStromModels';
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            devices: ConfigDevice[];
            null_offset: number;
            winter_mode: boolean;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
