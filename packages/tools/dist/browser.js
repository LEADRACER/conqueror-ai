import { z } from "zod";
import { defineTool } from "@alex-ai/core";
import { chromium } from "playwright";
const sessions = new Map();
function getSession(context) {
    let session = sessions.get(context.sessionID);
    if (!session) {
        session = {
            browser: null,
            context: null,
            pages: new Map(),
            currentSession: "default",
            connectedViaCDP: false,
        };
        sessions.set(context.sessionID, session);
    }
    return session;
}
export const BrowserTools = [
    defineTool({
        name: "browser_launch",
        description: "Launch a headless Chromium browser. Creates a new browser session that " +
            "can be controlled with subsequent browser_navigate, browser_click, " +
            "browser_screenshot, and other browser_* tools. Call this first before " +
            "using any other browser tool.",
        args: {
            headless: z.boolean().optional().describe("Run headless (default true)"),
            proxy: z.string().optional().describe("HTTP proxy URL (e.g. http://localhost:8080)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            if (session.browser) {
                return `Browser already launched for this session.`;
            }
            const launchOpts = {};
            launchOpts.headless = args.headless ?? true;
            if (args.proxy) {
                launchOpts.proxy = { server: args.proxy };
            }
            try {
                const browser = await chromium.launch(launchOpts);
                const browserContext = await browser.newContext({
                    viewport: { width: 1280, height: 720 },
                });
                session.browser = browser;
                session.context = browserContext;
                session.pages.clear();
                const page = await browserContext.newPage();
                session.pages.set("default", page);
                session.currentSession = "default";
                return `Browser launched successfully.`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Failed to launch browser: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_navigate",
        description: "Navigate to a URL in the current browser page. Returns the page title " +
            "and final URL after navigation.",
        args: {
            url: z.string().url().describe("The URL to navigate to"),
            wait: z.string().optional().describe('Wait strategy: "load", "dom", "networkidle", or "none" (default "load")'),
            timeout: z.number().int().min(1000).optional().describe("Timeout in ms (default 30000)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            const waitUntil = (args.wait ?? "load");
            const timeout = args.timeout ?? 30000;
            try {
                const response = await page.goto(args.url, { waitUntil, timeout });
                const title = await page.title();
                const finalUrl = response?.url ?? page.url();
                return `Navigated to: ${finalUrl}\nTitle: ${title}\nStatus: ${response?.status() ?? "unknown"}`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Navigation failed: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_click",
        description: "Click an element on the current browser page using a CSS selector.",
        args: {
            selector: z.string().describe("CSS selector for the element to click"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            try {
                await page.waitForSelector(args.selector, { state: "attached", timeout: 10000 });
                await page.click(args.selector);
                await page.waitForLoadState("load", { timeout: 10000 }).catch(() => { });
                const title = await page.title();
                return `Clicked: ${args.selector}\nCurrent page title: ${title}`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Click failed: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_type",
        description: "Type text into an input field on the current browser page using a CSS selector.",
        args: {
            selector: z.string().describe("CSS selector for the input element"),
            text: z.string().describe("Text to type"),
            submit: z.boolean().optional().describe("Press Enter after typing (default false)"),
            clear: z.boolean().optional().describe("Clear the field before typing (default false)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            try {
                await page.waitForSelector(args.selector, { state: "attached", timeout: 10000 });
                if (args.clear) {
                    await page.fill(args.selector, "");
                }
                await page.type(args.selector, args.text);
                if (args.submit) {
                    await page.press(args.selector, "Enter");
                    await page.waitForLoadState("load", { timeout: 10000 }).catch(() => { });
                }
                return `Typed "${args.text}" into ${args.selector}`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Type failed: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_screenshot",
        description: "Take a screenshot of the current browser page or a specific element " +
            "identified by a CSS selector.",
        args: {
            selector: z.string().optional().describe("CSS selector for element to screenshot (omit for full page)"),
            fullPage: z.boolean().optional().describe("Capture full page screenshot (default false)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            try {
                let screenshotBuffer;
                if (args.selector) {
                    const el = await page.waitForSelector(args.selector, { timeout: 10000 });
                    if (!el) {
                        return `Element not found: ${args.selector}`;
                    }
                    screenshotBuffer = await el.screenshot();
                }
                else {
                    screenshotBuffer = await page.screenshot({ fullPage: args.fullPage ?? false });
                }
                const base64 = screenshotBuffer.toString("base64");
                return {
                    output: `Screenshot captured (${base64.length} bytes base64).`,
                    attachments: [
                        {
                            type: "file",
                            mime: "image/png",
                            url: `data:image/png;base64,${base64}`,
                            filename: "screenshot.png",
                        },
                    ],
                };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Screenshot failed: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_get_content",
        description: "Get the text content of the current browser page, or the content of a " +
            "specific element if a CSS selector is provided.",
        args: {
            selector: z.string().optional().describe("CSS selector (defaults to body)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            try {
                const target = args.selector ?? "body";
                await page.waitForSelector(target, { timeout: 10000 }).catch(() => { });
                const content = await page.textContent(target);
                return content?.trim() ?? "No content found";
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Failed to get content: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_evaluate",
        description: "Execute JavaScript code in the context of the current browser page.",
        args: {
            code: z.string().describe("JavaScript code to execute"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(session.currentSession);
            if (!page) {
                return `No browser page. Call browser_launch first.`;
            }
            try {
                const result = await page.evaluate(args.code);
                const str = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
                return `Result: ${str}`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Evaluation failed: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_connect",
        description: "Hijack an already-running browser by connecting to its Chrome DevTools " +
            "Protocol (CDP) endpoint. The browser must be started with remote debugging " +
            "enabled (e.g., 'google-chrome --remote-debugging-port=9222' or " +
            "'chromium --headless --remote-debugging-port=9222'). " +
            "Once connected, all existing tabs become controllable. " +
            "Use browser_list_tabs to see available tabs.",
        args: {
            cdpURL: z
                .string()
                .optional()
                .describe("CDP endpoint URL (default http://localhost:9222)"),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            if (session.browser) {
                return `Browser session already active. Call browser_close first.`;
            }
            const cdpURL = args.cdpURL ?? "http://localhost:9222";
            try {
                const browser = await chromium.connectOverCDP({
                    endpointURL: cdpURL,
                });
                const contexts = browser.contexts();
                const pages = contexts.length > 0
                    ? await contexts[0].pages()
                    : [];
                session.browser = browser;
                session.connectedViaCDP = true;
                session.pages.clear();
                if (pages.length > 0) {
                    pages.forEach((page, i) => {
                        const name = `tab_${i}`;
                        session.pages.set(name, page);
                    });
                    session.currentSession = "tab_0";
                    const title = await pages[0].title();
                    const url = pages[0].url();
                    return `Hijacked browser via CDP at ${cdpURL}. Found ${pages.length} tab(s). Current tab: title="${title}", url="${url}".`;
                }
                else {
                    session.pages.set("default", await browser.newPage());
                    session.currentSession = "default";
                    return `Hijacked browser via CDP at ${cdpURL}. No existing tabs, created new page.`;
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Failed to connect to browser via CDP at ${cdpURL}: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_list_tabs",
        description: "List all open tabs/pages in the connected browser. Shows title, URL, and " +
            "assigned tab name for each. Use browser_switch_tab to select a different tab.",
        args: {},
        async handler(_args, ctx) {
            const session = getSession(ctx);
            if (!session.browser) {
                return `No browser session. Call browser_launch or browser_connect first.`;
            }
            try {
                const contexts = session.browser.contexts();
                const allPages = [];
                for (const ctx of contexts) {
                    allPages.push(...(await ctx.pages()));
                }
                session.pages.clear();
                const lines = [];
                for (const page of allPages) {
                    const name = `tab_${allPages.indexOf(page)}`;
                    session.pages.set(name, page);
                    const title = await page.title();
                    lines.push(`[${name}] title="${title}", url="${page.url()}"`);
                }
                return `Found ${allPages.length} tab(s):\n${lines.join("\n")}`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return `Failed to list tabs: ${msg}`;
            }
        },
    }),
    defineTool({
        name: "browser_switch_tab",
        description: "Switch the active tab/page. Use a tab name from browser_list_tabs (e.g., " +
            "\"tab_0\") or \"default\" to switch back to the originally launched page.",
        args: {
            tabName: z.string().describe('Tab name to switch to (e.g., "tab_0", "default")'),
        },
        async handler(args, ctx) {
            const session = getSession(ctx);
            const page = session.pages.get(args.tabName);
            if (!page) {
                return `Tab not found: ${args.tabName}. Call browser_list_tabs to see available tabs.`;
            }
            session.currentSession = args.tabName;
            const title = await page.title();
            const url = page.url();
            return `Switched to tab "${args.tabName}". Title: "${title}", URL: "${url}"`;
        },
    }),
    defineTool({
        name: "browser_close",
        description: "Close the browser and clean up the session. When connected via CDP (hijacked " +
            "browser), this detaches without closing the original browser process. When " +
            "launched locally, this closes the entire browser.",
        args: {},
        async handler(_args, ctx) {
            const session = sessions.get(ctx.sessionID);
            if (!session) {
                return `No browser session found.`;
            }
            if (!session.browser) {
                return `No browser session found.`;
            }
            try {
                if (session.connectedViaCDP) {
                    const contexts = session.browser.contexts();
                    for (const ctx of contexts) {
                        try {
                            await ctx.close();
                        }
                        catch {
                        }
                    }
                }
                else {
                    if (session.context) {
                        await session.context.close();
                    }
                    if (session.browser) {
                        await session.browser.close();
                    }
                }
                sessions.delete(ctx.sessionID);
                return `Browser ${session.connectedViaCDP ? "detached from" : "closed"}.`;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                sessions.delete(ctx.sessionID);
                return `Warning: ${msg}. Session cleared.`;
            }
        },
    }),
];
//# sourceMappingURL=browser.js.map