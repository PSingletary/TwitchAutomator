// const { cli } = require('webpack');
import { debugLog } from "@/Helpers/Console";
import type { NotificationCategory } from "@common/Defs";
import { NotificationCategories, NotificationProvider } from "@common/Defs";
import type { NotifyData } from "@common/Webhook";
import type { AxiosError } from "axios";
import axios from "axios";
import chalk from "chalk";
import type express from "express";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { BaseConfigPath } from "./BaseConfig";
import { Config } from "./Config";
import { LiveStreamDVR } from "./LiveStreamDVR";
import { LOGLEVEL, log } from "./Log";

interface Client {
    id: string;
    ws: WebSocket;
    ip: string;
    alive: boolean;
    userAgent: string;
    authenticated: boolean;
}

interface TelegramSendMessagePayload {
    chat_id: number;
    text: string;
    parse_mode?: "MarkdownV2" | "Markdown" | "HTML";
    entities?: unknown;
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_to_message_id?: number;
    allow_sending_without_reply?: boolean;
    reply_markup?: unknown;
}

interface DiscordSendMessagePayload {
    content: string;
    username?: string;
    avatar_url?: string;
    tts?: boolean;
    embeds?: DiscordEmbed[];
    allowed_mentions?: unknown;
    components?: unknown;
    files?: unknown;
    payload_json?: string;
    attachments?: unknown;
    flags?: number;
}

interface DiscordEmbed {
    title?: string;
    type?: string;
    description?: string;
    url?: string;
    timestamp?: string;
    color?: number;
    footer?: DiscordEmbedFooter;
    image?: DiscordEmbedImage;
    thumbnail?: DiscordEmbedThumbnail;
    video?: DiscordEmbedVideo;
    provider?: DiscordEmbedProvider;
    author?: DiscordEmbedAuthor;
    fields?: DiscordEmbedField[];
}

interface DiscordEmbedFooter {
    text: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

interface DiscordEmbedImage {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

interface DiscordEmbedThumbnail {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

interface DiscordEmbedVideo {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

interface DiscordEmbedProvider {
    name?: string;
    url?: string;
}

interface DiscordEmbedAuthor {
    name?: string;
    url?: string;
    icon_url?: string;
    proxy_icon_url?: string;
}

interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

interface PushoverSendMessagePayload {
    token: string;
    user: string;
    message: string;
    attachment?: string;
    attachment_base64?: string;
    attachment_type?: string;
    device?: string;
    html?: 1;
    priority?: -2 | -1 | 0 | 1 | 2;
    sound?: string;
    timestamp?: number;
    title?: string;
    ttl?: number;
    url?: string;
    url_title?: string;
}

export class ClientBroker {
    public static clients: Client[] = [];
    public static wss: WebSocket.Server<WebSocket.WebSocket> | undefined =
        undefined;

    // bitmask of notification categories and providers
    public static notificationSettings: Record<NotificationCategory, number> =
        {} as Record<NotificationCategory, number>;

    public static attach(server: WebSocket.Server<WebSocket.WebSocket>): void {
        log(
            LOGLEVEL.INFO,
            "clientBroker.attach",
            "Attaching WebSocket server to broker..."
        );

        this.clients = [];

        this.wss = server;

        this.wss.on("listening", () => {
            log(
                LOGLEVEL.INFO,
                "clientBroker.attach",
                "Client broker now attached to websocket."
            );
        });

        this.wss.on("error", (error) => {
            log(
                LOGLEVEL.ERROR,
                "clientBroker.attach",
                "Websocket server error",
                error
            );
        });

        this.wss.on("connection", (ws: WebSocket, req: express.Request) => {
            const hasPassword =
                Config.getInstance().cfg<string>("password", "") != "";
            // const is_guest_mode = Config.getInstance().cfg<boolean>(
            //     "guest_mode",
            //     false
            // );

            if (!hasPassword) {
                this.onConnect(ws, req);
            } else {
                const sp = Config.getInstance().sessionParser;
                if (sp) {
                    sp(req, {} as any, () => {
                        const isAuthenticated = req.session.authenticated;
                        if (isAuthenticated) {
                            this.onConnect(ws, req, isAuthenticated);
                        } else {
                            console.log(
                                chalk.red(
                                    "Client attempted to connect without authentication."
                                )
                            );
                            // ws.write(JSON.stringify({ action: "alert", data: "Authentication required." }));
                            ws.close(3000, "Authentication required.");
                        }
                    });
                }
            }
        });

        this.wss.on("close", () => {
            debugLog("Shutting down websocket server");
        });
    }

    public static broadcast(broadcastData: unknown) {
        if (LiveStreamDVR.shutting_down) return;

        // const jsonData = JSON.stringify(data);
        let jsonData: string;

        try {
            jsonData = JSON.stringify(broadcastData);
        } catch (error) {
            console.error(
                chalk.bgRed.whiteBright(
                    `Error stringifying data: ${(error as Error).message}`
                )
            );
            return;
        }

        if (!this.wss) {
            console.error(
                chalk.bgRed.whiteBright(
                    `No WebSocket server attached to broker for data: ${
                        jsonData.length > 64
                            ? jsonData.substring(0, 64) + "..."
                            : jsonData
                    }`
                )
            );
            return;
        }

        if (this.wss.clients.size == 0) {
            debugLog(
                chalk.grey(
                    `No clients connected to broker for data: ${
                        jsonData.length > 64
                            ? jsonData.substring(0, 64) + "..."
                            : jsonData
                    }`
                )
            );
            return;
        }

        // const has_password = Config.getInstance().cfg<string>("password", "") != "";
        // const is_guest_mode = Config.getInstance().cfg<boolean>("guest_mode", false);
        //
        // const clients = this.clients.filter((c) => {
        //     if (has_password && !is_guest_mode) {
        //         return c.authenticated;
        //     } else if (has_password && is_guest_mode) {
        //         // filter each type
        //     }

        debugLog(
            chalk.blueBright(
                `Broadcasting data to ${this.wss.clients.size} clients: ${
                    jsonData.length > 64
                        ? jsonData.substring(0, 64) + "..."
                        : jsonData
                }`
            )
        );
        this.wss.clients.forEach((client) => {
            client.send(jsonData);
        });
    }

    /**
     * Send a notification to all browsers/clients
     *
     * @param title
     * @param body
     * @param icon
     * @param category
     * @param url
     * @param tts
     */
    public static notify(
        title: string,
        body = "",
        icon = "",
        category: NotificationCategory, // change this?
        url = "",
        tts = false
    ) {
        // console.log(chalk.bgBlue.whiteBright(`Notifying clients: ${title}: ${body}, category ${category}`));

        log(
            LOGLEVEL.INFO,
            "clientBroker.notify",
            `(${category}) ${title}: ${body}`,
            {
                title: title,
                body: body,
                icon: icon,
                category: category,
                url: url,
                tts: tts,
            }
        );

        if (!title) {
            log(LOGLEVEL.WARNING, "clientBroker.notify", "No title specified", {
                title: title,
                body: body,
                icon: icon,
                category: category,
                url: url,
                tts: tts,
            });
        }

        if (!body) {
            log(LOGLEVEL.WARNING, "clientBroker.notify", "No body specified", {
                title: title,
                body: body,
                icon: icon,
                category: category,
                url: url,
                tts: tts,
            });
        }

        if (
            ClientBroker.getNotificationSettingForProvider(
                category,
                NotificationProvider.WEBSOCKET
            )
        ) {
            this.broadcast({
                action: "notify",
                data: {
                    title: title,
                    body: body,
                    icon: icon,
                    url: url,
                    tts: tts,
                } as NotifyData,
            });
        }

        if (
            Config.getInstance().cfg("telegram_enabled") &&
            ClientBroker.getNotificationSettingForProvider(
                category,
                NotificationProvider.TELEGRAM
            )
        ) {
            // escape with backslash
            // const escaped_title = title.replace(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, "\\$&");
            // const escaped_body = body.replace(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, "\\$&");

            const token = Config.getInstance().cfg("telegram_token");
            const chatId = Config.getInstance().cfg("telegram_chat_id");

            if (token && chatId) {
                axios
                    .post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: chatId,
                        text:
                            `<strong>${title}</strong>\n` +
                            `${body}` +
                            `${url ? `\n\n<a href="${url}">${url}</a>` : ""}`,
                        parse_mode: "HTML",
                    } as TelegramSendMessagePayload)
                    .then((res) => {
                        log(
                            LOGLEVEL.DEBUG,
                            "clientBroker.notify",
                            "Telegram response",
                            res.data
                        );
                    })
                    .catch((err: Error) => {
                        if (axios.isAxiosError(err)) {
                            // const data = err.response?.data;
                            // TwitchlogAdvanced(LOGLEVEL.ERROR, "notify", `Telegram axios error: ${err.message} (${data})`, { err: err, response: data });
                            // console.error(chalk.bgRed.whiteBright(`Telegram axios error: ${err.message} (${data})`), JSON.stringify(err, null, 2));

                            if (err.response) {
                                log(
                                    LOGLEVEL.ERROR,
                                    "clientBroker.notify",
                                    `Telegram axios error response: ${err.message} (${err.response.data})`,
                                    { err: err, response: err.response.data }
                                );
                                console.error(
                                    chalk.bgRed.whiteBright(
                                        `Telegram axios error response : ${err.message} (${err.response.data})`
                                    ),
                                    JSON.stringify(err, null, 2)
                                );
                            } else if (err.request) {
                                log(
                                    LOGLEVEL.ERROR,
                                    "clientBroker.notify",
                                    `Telegram axios error request: ${err.message} (${err.request})`,
                                    { err: err, request: err.request }
                                );
                                console.error(
                                    chalk.bgRed.whiteBright(
                                        `Telegram axios error request: ${err.message} (${err.request})`
                                    ),
                                    JSON.stringify(err, null, 2)
                                );
                            } else {
                                log(
                                    LOGLEVEL.ERROR,
                                    "clientBroker.notify",
                                    `Telegram axios error: ${err.message}`,
                                    err
                                );
                                console.error(
                                    chalk.bgRed.whiteBright(
                                        `Telegram axios error: ${err.message}`
                                    ),
                                    JSON.stringify(err, null, 2)
                                );
                            }
                        } else {
                            log(
                                LOGLEVEL.ERROR,
                                "clientBroker.notify",
                                `Telegram error: ${err.message}`,
                                err
                            );
                            console.error(
                                chalk.bgRed.whiteBright(
                                    `Telegram error: ${err.message}`
                                )
                            );
                        }
                    });
            } else if (!token && chatId) {
                log(
                    LOGLEVEL.ERROR,
                    "clientBroker.notify",
                    "Telegram token not set"
                );
                console.error(
                    chalk.bgRed.whiteBright("Telegram token not set")
                );
            } else if (!chatId && token) {
                log(
                    LOGLEVEL.ERROR,
                    "clientBroker.notify",
                    "Telegram chat ID not set"
                );
                console.error(
                    chalk.bgRed.whiteBright("Telegram chat ID not set")
                );
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "clientBroker.notify",
                    "Telegram token and chat ID not set"
                );
                console.error(
                    chalk.bgRed.whiteBright(
                        "Telegram token and chat ID not set"
                    )
                );
            }
        }

        if (
            Config.getInstance().cfg("discord_enabled") &&
            ClientBroker.getNotificationSettingForProvider(
                category,
                NotificationProvider.DISCORD
            )
        ) {
            axios
                .post(Config.getInstance().cfg("discord_webhook"), {
                    content: `**${title}**\n${body}${url ? `\n\n${url}` : ""}`,
                    avatar_url:
                        icon && icon.startsWith("https") ? icon : undefined, // only allow https
                    tts: tts,
                } as DiscordSendMessagePayload)
                .then((res) => {
                    log(
                        LOGLEVEL.DEBUG,
                        "clientBroker.notify",
                        "Discord response",
                        res.data
                    );
                })
                .catch((err: AxiosError) => {
                    if (axios.isAxiosError(err)) {
                        log(
                            LOGLEVEL.ERROR,
                            "clientBroker.notify",
                            `Discord axios error: ${
                                err.message
                            } (${JSON.stringify(err.response?.data)})`,
                            { err: err, response: err.response?.data }
                        );
                    } else {
                        log(
                            LOGLEVEL.ERROR,
                            "clientBroker.notify",
                            `Discord error: ${(err as Error).message}`,
                            err
                        );
                    }
                });
        }

        if (
            Config.getInstance().cfg("notifications.pushover.enabled") &&
            ClientBroker.getNotificationSettingForProvider(
                category,
                NotificationProvider.PUSHOVER
            )
        ) {
            // escape with backslash
            // const escaped_title = title.replace(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, "\\$&");
            // const escaped_body = body.replace(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, "\\$&");

            axios
                .post("https://api.pushover.net/1/messages.json", {
                    token: Config.getInstance().cfg(
                        "notifications.pushover.token"
                    ),
                    user: Config.getInstance().cfg(
                        "notifications.pushover.user"
                    ),
                    title: title,
                    message: body,
                    url: url,
                    // html: 1,
                } as PushoverSendMessagePayload)
                .then((res) => {
                    log(
                        LOGLEVEL.DEBUG,
                        "clientBroker.notify",
                        "Pushover response",
                        res.data
                    );
                })
                .catch((err: Error) => {
                    if (axios.isAxiosError(err)) {
                        // const data = err.response?.data;
                        // TwitchlogAdvanced(LOGLEVEL.ERROR, "notify", `Telegram axios error: ${err.message} (${data})`, { err: err, response: data });
                        // console.error(chalk.bgRed.whiteBright(`Telegram axios error: ${err.message} (${data})`), JSON.stringify(err, null, 2));

                        if (err.response) {
                            log(
                                LOGLEVEL.ERROR,
                                "clientBroker.notify",
                                `Pushover axios error response: ${err.message} (${err.response.data})`,
                                { err: err, response: err.response.data }
                            );
                            console.error(
                                chalk.bgRed.whiteBright(
                                    `Pushover axios error response : ${err.message} (${err.response.data})`
                                ),
                                JSON.stringify(err, null, 2)
                            );
                        } else if (err.request) {
                            log(
                                LOGLEVEL.ERROR,
                                "clientBroker.notify",
                                `Pushover axios error request: ${err.message} (${err.request})`,
                                { err: err, request: err.request }
                            );
                            console.error(
                                chalk.bgRed.whiteBright(
                                    `Pushover axios error request: ${err.message} (${err.request})`
                                ),
                                JSON.stringify(err, null, 2)
                            );
                        } else {
                            log(
                                LOGLEVEL.ERROR,
                                "clientBroker.notify",
                                `Pushover axios error: ${err.message}`,
                                err
                            );
                            console.error(
                                chalk.bgRed.whiteBright(
                                    `Pushover axios error: ${err.message}`
                                ),
                                JSON.stringify(err, null, 2)
                            );
                        }
                    } else {
                        log(
                            LOGLEVEL.ERROR,
                            "clientBroker.notify",
                            `Pushover error: ${err.message}`,
                            err
                        );
                        console.error(
                            chalk.bgRed.whiteBright(
                                `Pushover error: ${err.message}`
                            )
                        );
                    }
                });
        }
    }

    public static getNotificationSettingForProvider(
        category: NotificationCategory,
        provider: NotificationProvider
    ): boolean {
        if (!this.notificationSettings[category]) return false;
        return this.notificationSettings[category] & provider ? true : false;
    }

    public static setNotificationSettingForProvider(
        category: NotificationCategory,
        provider: NotificationProvider,
        value: boolean
    ) {
        if (!this.notificationSettings[category])
            this.notificationSettings[category] = 0;
        if (value) {
            this.notificationSettings[category] |= provider;
        } else {
            this.notificationSettings[category] &= ~provider;
        }
    }

    public static resetNotificationSettings() {
        this.notificationSettings = {} as Record<NotificationCategory, number>;
        for (const category of NotificationCategories) {
            this.notificationSettings[category.id as NotificationCategory] = 0;
        }
    }

    public static loadNotificationSettings() {
        if (!fs.existsSync(BaseConfigPath.notifications)) {
            this.resetNotificationSettings();
            return;
        }

        const data = fs.readFileSync(BaseConfigPath.notifications, "utf8");
        const settings = JSON.parse(data);

        for (const category of NotificationCategories) {
            if (settings[category.id as NotificationCategory]) {
                this.notificationSettings[category.id as NotificationCategory] =
                    settings[category.id as NotificationCategory];
            } else {
                this.notificationSettings[
                    category.id as NotificationCategory
                ] = 0;
            }
        }
    }

    public static saveNotificationSettings() {
        const data = JSON.stringify(this.notificationSettings);
        fs.writeFileSync(BaseConfigPath.notifications, data);
    }

    private static onConnect(
        ws: WebSocket.WebSocket,
        req: IncomingMessage,
        is_authenticated = false
    ) {
        const client: Client = {
            id: req.headers["sec-websocket-key"] || "",
            ws: ws,
            ip: (req.headers["x-real-ip"] ||
                req.headers["x-forwarded-for"] ||
                req.socket.remoteAddress) as string,
            alive: true,
            userAgent: req.headers["user-agent"] || "",
            authenticated: is_authenticated,
        };

        // console.debug(chalk.magenta(`Client ${client.id} connected from ${client.ip}, user-agent: ${client.userAgent}`));

        this.clients.push(client);

        ws.on("message", (raw_message: WebSocket.RawData): void => {
            if (!this.wss) return;

            // console.log("message", ws, message);

            const message = raw_message.toString();

            if (message == "ping") {
                // console.debug(`Pong to ${ws.clientIP}`);
                ws.send("pong");
                return;
            }

            let data: unknown;

            try {
                data = JSON.parse(message);
            } catch (error) {
                console.error(`Invalid data from ${client.ip}: ${message}`);
                return;
            }

            /*
            if(data.server){
                this.wss.clients.forEach((client) => {
                    client.send(JSON.stringify({
                        action: "server",
                        data: data.data,
                    }));
                });
            }
            */

            debugLog(`JSON from ${client.ip}:`, data);
            // console.debug(`Clients: ${this.wss.clients.size}`);
        });

        ws.on("pong", () => {
            client.alive = true;
            // console.log(`Pong from ${client.ip}`);
        });

        ws.on("error", (err) => {
            console.error("Client error", err);
        });

        ws.on("close", (code, reason) => {
            // console.log(`Client ${client.id} disconnected from ${client.ip}`);
            this.clients = this.clients.filter((c) => c.id != client.id);
        });

        ws.send(JSON.stringify({ action: "connected" }));
    }
}
