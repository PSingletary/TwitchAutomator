import type { PubsubVideo } from "@common/YouTubeAPI/Pubsub";
import type express from "express";
import { KeyValue } from "../../../Core/KeyValue";
import { BaseAutomator } from "../Base/BaseAutomator";

export class YouTubeAutomator extends BaseAutomator {
    public getVodID(): string | false {
        return (
            KeyValue.getInstance().get(`yt.${this.getUserID()}.vod.id`) || false
        );
        // return $this->payload['id'];
    }

    public getStartDate(): string {
        return (
            KeyValue.getInstance().get(
                `yt.${this.getUserID()}.vod.started_at`
            ) || ""
        );
    }

    public handle(
        entry: PubsubVideo,
        request: express.Request
    ): Promise<boolean> {
        console.log(
            "ya",
            entry["yt:channelId"],
            entry["yt:videoId"],
            entry.title
        );
        return Promise.resolve(false);
    }

    public providerArgs(): string[] {
        const cmd = [];

        // start recording from start of stream
        cmd.push("--hls-live-restart");

        return cmd;
    }
}
