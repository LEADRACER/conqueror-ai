import { spawn } from "node:child_process";
const LOCAL_OMNIROUTE_URL = "http://localhost:3000";
const HEALTH_CHECK_PATH = "/v1/models";
const STARTUP_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 500;
export class OmnirouteService {
    process = null;
    baseURL;
    apiKey;
    started = false;
    constructor(options = {}) {
        this.baseURL = options.baseURL ?? LOCAL_OMNIROUTE_URL;
        if (options.apiKey !== undefined) {
            this.apiKey = options.apiKey;
        }
    }
    async isRunning() {
        try {
            const url = new URL(HEALTH_CHECK_PATH, this.baseURL);
            const resp = await fetch(url.toString(), {
                method: "GET",
                signal: AbortSignal.timeout(3000),
            });
            return resp.ok;
        }
        catch {
            return false;
        }
    }
    async start() {
        if (this.started) {
            return true;
        }
        const running = await this.isRunning();
        if (running) {
            this.started = true;
            return true;
        }
        const args = ["omniroute"];
        const env = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) {
                env[k] = v;
            }
        }
        if (this.apiKey) {
            env.OMNIROUTE_API_KEY = this.apiKey;
        }
        this.process = spawn("npx", args, {
            shell: true,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
        });
        this.process.stdout?.on("data", (data) => {
            process.stderr.write(`[omniroute] ${data}`);
        });
        this.process.stderr?.on("data", (data) => {
            process.stderr.write(`[omniroute] ${data}`);
        });
        const ready = await this.waitForReady(STARTUP_TIMEOUT_MS);
        if (!ready) {
            this.stop();
            return false;
        }
        this.started = true;
        return true;
    }
    async waitForReady(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isRunning()) {
                return true;
            }
            await sleep(POLL_INTERVAL_MS);
        }
        return false;
    }
    stop() {
        if (this.process) {
            this.process.kill("SIGTERM");
            try {
                this.process.kill("SIGKILL");
            }
            catch {
            }
            this.process = null;
        }
        this.started = false;
    }
    async ensureRunning() {
        if (await this.isRunning()) {
            this.started = true;
            return true;
        }
        return this.start();
    }
    getBaseURL() {
        return this.baseURL;
    }
    isStarted() {
        return this.started;
    }
}
export class RemoteOmnirouteProvider {
    baseURL;
    apiKey;
    id = "omniroute-remote";
    name = "Omniroute (Remote)";
    models = ["gpt-4o", "claude-3-5-sonnet-20241022"];
    constructor(baseURL, apiKey) {
        this.baseURL = baseURL;
        this.apiKey = apiKey;
    }
    getBaseURL() {
        return this.baseURL;
    }
    getAPIKey() {
        return this.apiKey;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export const REMOTE_OMNIROUTE_URL = "https://router.kilocode.ai/v1";
//# sourceMappingURL=service.js.map