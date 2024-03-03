import { ClientBroker } from "@/Core/ClientBroker";
import { Job } from "@/Core/Job";
import { LiveStreamDVR } from "@/Core/LiveStreamDVR";
import { TwitchChannel } from "@/Core/Providers/Twitch/TwitchChannel";
import { YouTubeChannel } from "@/Core/Providers/YouTube/YouTubeChannel";
import { xInterval } from "@/Helpers/Timeout";
import type { VideoQuality } from "@common/Config";
import type express from "express";

export function ListVodsInMemory(
    req: express.Request,
    res: express.Response
): void {
    res.send({
        status: "OK",
        data: LiveStreamDVR.getInstance().getVods(),
    });
}

export function ListChannelsInMemory(
    req: express.Request,
    res: express.Response
): void {
    res.send({
        status: "OK",
        data: LiveStreamDVR.getInstance().getChannels(),
    });
}

export function NotifyTest(req: express.Request, res: express.Response): void {
    ClientBroker.notify(
        req.query.title as string,
        req.query.body as string,
        "",
        "debug"
    );
    res.send("OK");
}

export async function VodDownloadAtEnd(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const login = req.query.login as string;
    const quality = req.query.quality as VideoQuality;
    const channel = TwitchChannel.getChannelByLogin(login);

    let status;
    try {
        status = await channel?.downloadLatestVod(quality);
    } catch (error) {
        res.api(500, (error as Error).message);
        return;
    }

    res.send(status);
}

export async function ReencodeVod(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const basename = req.params.basename as string;

    const vod = LiveStreamDVR.getInstance()
        .getVods()
        .find((v) => v.basename === basename);

    if (!vod) {
        res.api(
            500,
            LiveStreamDVR.getInstance()
                .getVods()
                .map((v) => v.basename)
        );
        return;
    }

    let status;
    try {
        status = await vod.reencodeSegments();
    } catch (error) {
        res.api(500, (error as Error).message);
        return;
    }

    res.send(status);
}

export async function GetYouTubeChannel(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const id = req.query.id as string;

    let d;

    try {
        d = await YouTubeChannel.getUserDataById(id);
    } catch (error) {
        res.api(500, (error as Error).message);
        return;
    }

    res.send(d);
}

export function JobProgress(req: express.Request, res: express.Response): void {
    const job = Job.create("progress_test" + Math.round(Math.random() * 1000));
    job.dummy = true;
    job.save();

    let progress = 0;
    const i = xInterval(() => {
        progress += 0.01;
        job.setProgress(progress);
        console.debug(progress);
        if (progress >= 1) {
            clearInterval(i);
            job.clear();
            console.debug("Job cleared");
        }
    }, 100);

    res.send("ok");
}

export async function rebuildSegmentList(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const uuid = req.query.uuid as string;

    const vod = LiveStreamDVR.getInstance().getVodByUUID(uuid);

    if (!vod) {
        res.api(500, "VOD not found");
        return;
    }

    let status;
    try {
        status = await vod.rebuildSegmentList();
    } catch (error) {
        res.api(500, (error as Error).message);
        return;
    }

    res.send(status);
}

export function TranslateTest(
    req: express.Request,
    res: express.Response
): void {
    res.send({
        status: "OK",
        data: req.t("test"),
    });
}
