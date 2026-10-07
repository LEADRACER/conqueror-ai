export interface OmnirouteServiceOptions {
    baseURL?: string;
    apiKey?: string;
    autoStart?: boolean;
    noAutoStart?: boolean;
}
export declare class OmnirouteService {
    private process;
    private baseURL;
    private apiKey?;
    private started;
    constructor(options?: OmnirouteServiceOptions);
    isRunning(): Promise<boolean>;
    start(): Promise<boolean>;
    private waitForReady;
    stop(): void;
    ensureRunning(): Promise<boolean>;
    getBaseURL(): string;
    isStarted(): boolean;
}
export declare class RemoteOmnirouteProvider {
    private baseURL;
    private apiKey?;
    readonly id = "omniroute-remote";
    readonly name = "Omniroute (Remote)";
    readonly models: string[];
    constructor(baseURL: string, apiKey?: string | undefined);
    getBaseURL(): string;
    getAPIKey(): string | undefined;
}
export declare const REMOTE_OMNIROUTE_URL = "https://router.kilocode.ai/v1";
//# sourceMappingURL=service.d.ts.map