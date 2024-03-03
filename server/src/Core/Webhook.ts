import type { WebhookAction, WebhookData } from "@common/Webhook";
import axios from "axios";
import { ClientBroker } from "./ClientBroker";
import { Config } from "./Config";
import { LiveStreamDVR } from "./LiveStreamDVR";
import { LOGLEVEL, log } from "./Log";

export class Webhook {
    /**
     * Dispatch a webhook + websocket message to all connected clients
     * The payload constructed consists of a JSON object with the following properties:
     * - action: the action to perform
     * - data: the data to pass, can be anything.
     *
     * @param action
     * @param data
     */
    static dispatchAll(action: WebhookAction, data: WebhookData): void {
        if (LiveStreamDVR.shutting_down) return;

        // console.log("Webhook:", action, data);

        // if (Config.debug) console.log(chalk.bgGrey.whiteBright(`WebSocket payload ${action} dispatching...`));

        log(
            LOGLEVEL.DEBUG,
            "webhook.dispatchAll",
            `Dispatching all for ${action}...`
        );

        Webhook.dispatchWebsocket(action, data);
        Webhook.dispatchWebhook(action, data);
    }

    static dispatchWebhook(action: WebhookAction, data: WebhookData): void {
        // send websocket broadcast
        const payload = {
            server: true,
            action: action,
            data: data,
        };

        // send webhook
        if (Config.getInstance().hasValue("webhook_url")) {
            log(
                LOGLEVEL.DEBUG,
                "webhook.dispatchWebhook",
                `Dispatching webhook for ${action}...`
            );
            const url = Config.getInstance().cfg<string>("webhook_url");
            axios
                .post(url, payload)
                .then((response) => {
                    log(
                        LOGLEVEL.DEBUG,
                        "webhook.dispatchWebhook",
                        `Webhook response from '${url}': ${response.status} ${response.statusText}`
                    );
                })
                .catch((error) => {
                    if (axios.isAxiosError(error)) {
                        log(
                            LOGLEVEL.ERROR,
                            "webhook.dispatchWebhook",
                            `Webhook error to '${url}': ${error.response?.status} ${error.response?.statusText}`,
                            error
                        );
                    } else {
                        log(
                            LOGLEVEL.ERROR,
                            "webhook.dispatchWebhook",
                            `Webhook error to '${url}': ${error}`,
                            error
                        );
                    }
                });
        } else {
            log(
                LOGLEVEL.DEBUG,
                "webhook.dispatchWebhook",
                `Not dispatching webhook for ${action} because no webhook_url is set.`
            );
        }
    }

    static dispatchWebsocket(action: WebhookAction, data: WebhookData): void {
        if (LiveStreamDVR.shutting_down) return;

        const payload = {
            action: action,
            data: data,
        };

        log(
            LOGLEVEL.DEBUG,
            "webhook.dispatchWebsocket",
            `Dispatching websocket for ${action}...`
        );

        ClientBroker.broadcast(payload);
    }
}
