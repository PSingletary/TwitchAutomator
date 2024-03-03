import { BaseConfigDataFolder } from "@/Core/BaseConfig";
import { Config } from "@/Core/Config";
import { LiveStreamDVR } from "@/Core/LiveStreamDVR";
import { LOGLEVEL, log } from "@/Core/Log";
import { TwitchChannel } from "@/Core/Providers/Twitch/TwitchChannel";
import { TwitchVOD } from "@/Core/Providers/Twitch/TwitchVOD";
import { Scheduler } from "@/Core/Scheduler";
import { getTwitchClipId, getTwitchVideoId } from "@/Providers/Twitch";
import type { ApiErrorResponse } from "@common/Api/Api";
import type { VideoQuality } from "@common/Config";
import { formatString } from "@common/Format";
import type { ClipBasenameTemplate } from "@common/Replacements";
import { format, parseJSON } from "date-fns";
import type express from "express";
import fs from "node:fs";
import path from "node:path";
import sanitize from "sanitize-filename";

export async function ResetChannels(
    req: express.Request,
    res: express.Response
): Promise<void> {
    await Config.resetChannels();

    res.send({
        status: "OK",
        message: "Reset channels.",
    });
}

export async function DownloadVod(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const url = req.body.url as string | undefined;
    const quality = (req.body.quality as VideoQuality | undefined) || "best";

    if (!url) {
        res.api(400, {
            status: "ERROR",
            message: "No url provided",
        });
        return;
    }

    const id = getTwitchVideoId(url);

    if (!id) {
        res.api(400, {
            status: "ERROR",
            message: "No id found in url",
        });
        return;
    }

    const metadata = await TwitchVOD.getVideo(id);

    if (!metadata) {
        res.api(400, {
            status: "ERROR",
            message: "No metadata found",
        });
        return;
    }

    const basename = `${metadata.user_login}.${id}.${quality}.mp4`;
    const filePath = path.join(BaseConfigDataFolder.saved_vods, basename);

    let success;

    try {
        success = await TwitchVOD.downloadVideo(id, quality, filePath);
    } catch (e) {
        res.api(400, {
            status: "ERROR",
            message: `Error downloading video: ${(e as Error).message}`,
        });
        return;
    }

    if (success) {
        res.send({
            status: "OK",
            message: `Downloaded to ${filePath}`,
        });
    } else {
        res.api(400, {
            status: "ERROR",
            message: "Failed to download",
        });
    }
}

export async function DownloadChat(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const url = req.body.url as string | undefined;

    const method = (req.body.method as string | undefined) || "td";

    if (!url) {
        res.api(400, {
            status: "ERROR",
            message: "No url provided",
        });
        return;
    }

    if (method !== "td" && method !== "tcd") {
        res.api(400, {
            status: "ERROR",
            message: "Invalid method. Must be 'td' or 'tcd'",
        });
        return;
    }

    const id = getTwitchVideoId(url);

    if (!id) {
        res.api(400, {
            status: "ERROR",
            message: "No id found in url",
        });
        return;
    }

    let metadata;

    try {
        metadata = await TwitchVOD.getVideo(id);
    } catch (error) {
        res.api(400, {
            status: "ERROR",
            message: `Error while fetching video data: ${
                (error as Error).message
            }`,
        } as ApiErrorResponse);
        return;
    }

    if (!metadata) {
        res.api(400, {
            status: "ERROR",
            message: "No metadata found",
        });
        return;
    }

    const basename = `${metadata.user_login}.${id}.chat.json`;
    const filePath = path.join(BaseConfigDataFolder.saved_vods, basename);

    let success;

    try {
        success = await TwitchVOD.downloadChat(method, id, filePath);
    } catch (e) {
        res.api(400, {
            status: "ERROR",
            message: `Error downloading chat: ${(e as Error).message}`,
        });
        return;
    }

    if (success) {
        res.send({
            status: "OK",
            message: `Downloaded to ${filePath}`,
        });
    } else {
        res.api(400, {
            status: "ERROR",
            message: "Failed to download",
        });
    }
}

export async function ChatDump(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const login = req.body.login as string | undefined;
    if (!login) {
        res.api(400, {
            status: "ERROR",
            message: "No login provided",
        });
        return;
    }

    const channelData = await TwitchChannel.getUserDataByLogin(login);
    if (!channelData) {
        res.api(400, {
            status: "ERROR",
            message: "No channel data found",
        });
        return;
    }

    const name = `${channelData.login}-${new Date()
        .toISOString()
        .replace(/:/g, "-")}.json`;
    const started = new Date();
    const output = path.join(BaseConfigDataFolder.saved_vods, name);

    const job = TwitchChannel.startChatDump(
        name,
        login,
        channelData.id,
        started,
        output
    );

    if (!job) {
        res.api(400, {
            status: "ERROR",
            message: "Failed to start chat dump",
        });
        return;
    }

    res.send({
        status: "OK",
        message: `Started chat dump for ${login}. It does not end by itself.`,
    });
}

export async function DownloadClip(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const url = req.body.url as string | undefined;
    const quality = (req.body.quality as VideoQuality | undefined) || "best";

    if (!url) {
        res.api(400, {
            status: "ERROR",
            message: "No url provided",
        });
        return;
    }

    const id = getTwitchClipId(url);

    if (!id) {
        res.api(400, {
            status: "ERROR",
            message: "No id found in url",
        });
        return;
    }

    const clips = await TwitchVOD.getClips({ id: id });

    if (!clips) {
        res.api(400, {
            status: "ERROR",
            message: "No metadata found",
        });
        return;
    }

    const metadata = clips[0];

    const clipDate = parseJSON(metadata.created_at);

    const variables: ClipBasenameTemplate = {
        id: metadata.id,
        quality: quality,
        clip_date: format(clipDate, Config.getInstance().dateFormat),
        title: metadata.title,
        creator: metadata.creator_name,
        broadcaster: metadata.broadcaster_name,
    };

    const basename = sanitize(
        formatString(
            Config.getInstance().cfg(
                "filename_clip",
                "{broadcaster} - {title} [{id}] [{quality}]"
            ),
            variables
        )
    );
    // const basename = sanitize(`[${format(clip_date, "yyyy-MM-dd")}] ${metadata.broadcaster_name} - ${metadata.title} [${metadata.id}] [${quality}].mp4`); // new filename? sanitize(`${metadata.broadcaster_name}.${metadata.title}.${metadata.id}.${quality}.mp4`);

    const user = await TwitchChannel.getUserDataById(metadata.broadcaster_id);
    if (!user) {
        res.api(500, {
            status: "ERROR",
            message: "Failed to get broadcaster user data",
        });
        return;
    }

    const filePath = path.join(
        BaseConfigDataFolder.saved_clips,
        "downloader",
        user.login,
        basename
    );

    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    let success;

    try {
        success = await TwitchVOD.downloadClip(id, `${filePath}.mp4`, quality);
    } catch (e) {
        res.api(400, {
            status: "ERROR",
            message: `Error downloading video: ${(e as Error).message}`,
        });
        return;
    }

    fs.writeFileSync(
        `${filePath}.info.json`,
        JSON.stringify(metadata, null, 4)
    );

    if (success) {
        res.send({
            status: "OK",
            message: `Downloaded to ${filePath}`,
        });

        const channel = TwitchChannel.getChannelById(metadata.broadcaster_id);
        if (channel) {
            log(
                LOGLEVEL.INFO,
                "route.tools.DownloadClip",
                `Downloaded clip ${metadata.id}, scan channel ${metadata.broadcaster_name} for new clips`
            );
            await channel.findClips();
        } else {
            log(
                LOGLEVEL.INFO,
                "route.tools.DownloadClip",
                `Downloaded clip ${metadata.id}, channel ${metadata.broadcaster_name} not found`
            );
        }
    } else {
        res.api(400, {
            status: "ERROR",
            message: "Failed to download",
        });
    }
}

export function Shutdown(req: express.Request, res: express.Response): void {
    const force = req.query.force == "true";

    if (
        !force &&
        LiveStreamDVR.getInstance()
            .getChannels()
            .some((c) => c.is_capturing || c.is_converting)
    ) {
        res.api(500, {
            status: "ERROR",
            message: "There are still active streams",
        });
        return;
    }

    res.send({
        status: "OK",
        message: "Shutting down",
    });

    LiveStreamDVR.shutdown("tools");
}

export function RunScheduler(
    req: express.Request,
    res: express.Response
): void {
    const name = req.params.name as string | undefined;

    if (!name) {
        res.api(400, {
            status: "ERROR",
            message: "No name provided",
        });
        return;
    }

    if (!Scheduler.hasJob(name)) {
        res.api(400, {
            status: "ERROR",
            message: "No job found",
        });
        return;
    }

    Scheduler.runJob(name);

    res.send({
        status: "OK",
        message: `Running job ${name}`,
    });
}

/*
export async function BuildClient(req: express.Request, res: express.Response): Promise<void> {

    const basepath = req.query.basepath as string || "/";

    await LiveStreamDVR.getInstance().buildClientWithBasepath(basepath);

    res.send({
        status: "OK",
        message: "Client built",
    });

}
*/
