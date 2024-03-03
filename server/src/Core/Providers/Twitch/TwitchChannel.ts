import { sanitizePath } from "@/Helpers/Filesystem";
import { imageThumbnail } from "@/Helpers/Image";
import type { ApiTwitchChannel } from "@common/Api/Client";
import type { TwitchChannelConfig, VideoQuality } from "@common/Config";
import type { Providers } from "@common/Defs";
import { MuteStatus, SubStatus } from "@common/Defs";
import { formatString } from "@common/Format";
import type { LocalVideo } from "@common/LocalVideo";
import type { AudioMetadata, VideoMetadata } from "@common/MediaInfo";
import type { VodBasenameTemplate } from "@common/Replacements";
import type { Channel, ChannelsResponse } from "@common/TwitchAPI/Channels";
import type { ErrorResponse, EventSubTypes } from "@common/TwitchAPI/Shared";
import type {
    Stream,
    StreamRequestParams,
    StreamsResponse,
} from "@common/TwitchAPI/Streams";
import type {
    SubscriptionRequest,
    SubscriptionResponse,
} from "@common/TwitchAPI/Subscriptions";
import type { BroadcasterType, UsersResponse } from "@common/TwitchAPI/Users";
import type { UserData } from "@common/User";
import type { AxiosResponse } from "axios";
import axios from "axios";
import chalk from "chalk";
import chokidar from "chokidar";
import { addSeconds, format, isValid, parseJSON } from "date-fns";
import { encode as htmlentities } from "html-entities";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sanitize from "sanitize-filename";
import { Readable } from "stream";
import { startJob } from "../../../Helpers/Execute";
import { formatBytes } from "../../../Helpers/Format";
import { xTimeout } from "../../../Helpers/Timeout";
import { isTwitchChannel } from "../../../Helpers/Types";
import { videoThumbnail, videometadata } from "../../../Helpers/Video";
import type { EventWebsocket } from "../../../Providers/Twitch";
import { TwitchHelper, parseTwitchDuration } from "../../../Providers/Twitch";
import type { TwitchVODChapterJSON } from "../../../Storage/JSON";
import {
    AppRoot,
    BaseConfigCacheFolder,
    BaseConfigDataFolder,
    BaseConfigPath,
} from "../../BaseConfig";
import { Config } from "../../Config";
import { Helper } from "../../Helper";
import type { Job } from "../../Job";
import { KeyValue } from "../../KeyValue";
import { LiveStreamDVR } from "../../LiveStreamDVR";
import { LOGLEVEL, log } from "../../Log";
import { Webhook } from "../../Webhook";
import { BaseChannel } from "../Base/BaseChannel";
import { TwitchGame } from "./TwitchGame";
import { TwitchVOD } from "./TwitchVOD";

export class TwitchChannel extends BaseChannel {
    public static channels_cache: Record<string, UserData> = {};

    public provider: Providers = "twitch";

    /**
     * Channel data directly from Twitch
     */
    public channel_data: UserData | undefined;

    public broadcaster_type: BroadcasterType = "";

    public offline_image_url: string | undefined;
    /** TODO: Not implemented */
    public banner_image_url: string | undefined;

    public vods_list: TwitchVOD[] = [];

    public subbed_at: Date | undefined;
    public expires_at: Date | undefined;

    // public ?int current_duration = null;
    // public bool deactivated = false;

    public deactivated = false;

    public fileWatcher?: chokidar.FSWatcher;

    public get livestreamUrl() {
        return `https://twitch.tv/${this.internalName}`;
    }

    public get current_vod(): TwitchVOD | undefined {
        return this.getVods().find((vod) => vod.is_capturing);
    }

    public get latest_vod(): TwitchVOD | undefined {
        if (!this.getVods() || this.getVods().length == 0) return undefined;
        return this.getVodByIndex(this.getVods().length - 1); // is this reliable?
    }

    public get displayName(): string {
        return this.channel_data?.display_name || "";
    }

    public get internalName(): string {
        return this.channel_data?.login || "";
    }

    public get internalId(): string {
        return this.channel_data?.id || "";
    }

    public get url(): string {
        return `https://twitch.tv/${this.internalName}`;
    }

    public get description(): string {
        return this.channel_data?.description || "";
    }

    public get profilePictureUrl(): string {
        if (this.channel_data && this.channel_data.avatar_thumb) {
            // return `${Config.getInstance().cfg<string>("basepath", "")}/cache/avatars/${this.channel_data.cache_avatar}`;
            // return `${Config.getInstance().cfg<string>("basepath", "")}/cache/thumbs/${this.channel_data.cache_avatar}`;
            const appUrl = Config.getInstance().cfg<string>("app_url", "");
            if (appUrl && appUrl !== "debug") {
                return `${appUrl}/cache/thumbs/${this.channel_data.avatar_thumb}`;
            } else {
                return `${Config.getInstance().cfg<string>(
                    "basepath",
                    ""
                )}/cache/thumbs/${this.channel_data.avatar_thumb}`;
            }
        }
        return this.channel_data?.profile_image_url || "";
    }

    public get channelLogoExists(): boolean {
        if (!this.channel_data) return false;
        // const logo_filename_jpg = `${this.channel_data.id}${path.extname(this.channel_data.profile_image_url)}`;
        return (
            fs.existsSync(
                path.join(
                    BaseConfigCacheFolder.public_cache_avatars,
                    `${this.channel_data.id}.jpg`
                )
            ) ||
            fs.existsSync(
                path.join(
                    BaseConfigCacheFolder.public_cache_avatars,
                    `${this.channel_data.id}.png`
                )
            )
        );
    }

    public get current_game(): TwitchGame | undefined {
        if (!this.current_vod) return undefined;
        return this.current_vod.current_game;
    }

    public get current_duration(): number | undefined {
        return this.current_vod?.duration;
    }

    /**
     * Returns true if the channel is currently live, not necessarily if it is capturing.
     * It is set when the hook is called with the channel.online event.
     * @returns {boolean}
     */
    public get is_live(): boolean {
        // return this.current_vod != undefined && this.current_vod.is_capturing;
        return KeyValue.getInstance().getBool(`${this.internalName}.online`);
    }

    public get saves_vods(): boolean {
        return KeyValue.getInstance().getBool(
            `${this.internalName}.saves_vods`
        );
    }

    // TODO: load by uuid?
    public static async loadAbstract(
        // channel_id: string
        uuid: string
    ): Promise<TwitchChannel> {
        log(LOGLEVEL.DEBUG, "tw.channel.loadAbstract", `Load channel ${uuid}`);

        const channelMemory = LiveStreamDVR.getInstance()
            .getChannels()
            .find<TwitchChannel>(
                (channel): channel is TwitchChannel =>
                    isTwitchChannel(channel) && channel.uuid === uuid
            );
        if (channelMemory) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.loadAbstract",
                `Channel ${uuid} (${channelMemory.internalName}) already exists in memory, returning`
            );
            return channelMemory;
        }

        const channelConfig = LiveStreamDVR.getInstance().channels_config.find(
            (c) => c.provider == "twitch" && c.uuid === uuid
        );

        if (!channelConfig)
            throw new Error(`Could not find channel config for uuid ${uuid}`);

        const channelId =
            channelConfig.internalId ||
            (await this.channelIdFromLogin(channelConfig.internalName));

        if (!channelId)
            throw new Error(
                `Could not get channel id for login ${channelConfig.internalName}`
            );

        const channel = new this();

        const channelData = await this.getUserDataById(channelId);
        if (!channelData)
            throw new Error(
                `Could not get channel data for channel id: ${channelId}`
            );

        const channelLogin = channelData.login;

        channel.uuid = channelConfig.uuid;
        channel.channel_data = channelData;
        channel.config = channelConfig;

        if (!channel.uuid) {
            throw new Error(`Channel ${channelLogin} has no uuid`);
        }

        // migrate
        if (!channelConfig.internalName || !channelConfig.internalId) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.loadAbstract",
                `Channel ${channelLogin} has no internalName or internalId in config, migrating`
            );
            channelConfig.internalName = channelLogin;
            channelConfig.internalId = channelId;
            LiveStreamDVR.getInstance().saveChannelsConfig();
        }

        // channel.login = channel_data.login;
        // channel.display_name = channel_data.display_name;
        // channel.description = channel_data.description;
        // channel.profile_image_url = channel_data.profile_image_url;
        channel.broadcaster_type = channelData.broadcaster_type;
        channel.applyConfig(channelConfig);

        if (KeyValue.getInstance().getBool(`${channel.internalName}.online`)) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.loadAbstract",
                `Channel ${channel.internalName} is online, stale?`
            );
        }

        if (KeyValue.getInstance().has(`${channel.internalName}.channeldata`)) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.loadAbstract",
                `Channel ${channel.internalName} has stale chapter data.`
            );
        }

        if (
            channel.channel_data.profile_image_url &&
            !channel.channelLogoExists
        ) {
            log(
                LOGLEVEL.INFO,
                "tw.channel.loadAbstract",
                `Channel ${channel.internalName} has no logo during load, fetching`
            );
            await this.fetchChannelLogo(channel.channel_data);
        }

        // $channel->api_getSubscriptionStatus = $channel->getSubscriptionStatus();

        channel.makeFolder();

        try {
            channel.deleteEmptyVodFolders();
        } catch (error) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.loadAbstract",
                `Failed to delete empty vod folders for ${channel.internalName}: ${error}`
            );
        }

        // only needed if i implement watching
        // if (!fs.existsSync(path.join(BaseConfigDataFolder.saved_clips, "scheduler", channel.login)))
        //     fs.mkdirSync(path.join(BaseConfigDataFolder.saved_clips, "scheduler", channel.login), { recursive: true });
        //
        // if (!fs.existsSync(path.join(BaseConfigDataFolder.saved_clips, "downloader", channel.login)))
        //     fs.mkdirSync(path.join(BaseConfigDataFolder.saved_clips, "downloader", channel.login), { recursive: true });
        //
        // if (!fs.existsSync(path.join(BaseConfigDataFolder.saved_clips, "editor", channel.login)))
        //     fs.mkdirSync(path.join(BaseConfigDataFolder.saved_clips, "editor", channel.login), { recursive: true });

        // await channel.parseVODs();

        await channel.findClips();

        channel.saveKodiNfo();

        try {
            await channel.updateChapterData();
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.loadAbstract",
                `Failed to update chapter data for channel ${
                    channel.internalName
                }: ${(error as Error).message}`
            );
        }

        return channel;
    }

    /**
     * Create and insert channel in memory. Subscribe too.
     *
     * @param config
     * @returns
     */
    public static async create(
        config: TwitchChannelConfig
    ): Promise<TwitchChannel> {
        // check if channel already exists in config
        const existsConfig = LiveStreamDVR.getInstance().channels_config.find(
            (ch) =>
                ch.provider == "twitch" &&
                (ch.login === config.internalName ||
                    ch.internalName === config.internalName)
        );
        if (existsConfig)
            throw new Error(
                `Channel ${config.internalName} already exists in config`
            );

        // check if channel already exists in memory
        const existsChannel = LiveStreamDVR.getInstance()
            .getChannels()
            .find<TwitchChannel>(
                (channel): channel is TwitchChannel =>
                    isTwitchChannel(channel) &&
                    channel.internalName === config.internalName
            );
        if (existsChannel)
            throw new Error(
                `Channel ${config.internalName} already exists in channels`
            );

        // fetch channel data
        const data = await TwitchChannel.getUserDataByLogin(
            config.internalName
        );
        if (!data)
            throw new Error(
                `Could not get channel data for channel login: ${config.internalName}`
            );

        config.uuid = randomUUID();

        LiveStreamDVR.getInstance().channels_config.push(config);
        LiveStreamDVR.getInstance().saveChannelsConfig();

        // const channel = await TwitchChannel.loadFromLogin(config.internalName);
        const channel = await TwitchChannel.load(config.uuid);
        if (!channel || !channel.internalName)
            throw new Error(
                `Channel ${config.internalName} could not be loaded`
            );

        if (
            Config.getInstance().cfg<string>("app_url", "") !== "" &&
            Config.getInstance().cfg<string>("app_url", "") !== "debug" &&
            !Config.getInstance().cfg<boolean>("isolated_mode")
        ) {
            try {
                await channel.subscribe();
            } catch (error) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.channel.create",
                    `Failed to subscribe to channel ${channel.internalName}: ${
                        (error as Error).message
                    }`
                );
                LiveStreamDVR.getInstance().channels_config =
                    LiveStreamDVR.getInstance().channels_config.filter(
                        (ch) =>
                            ch.provider == "twitch" &&
                            ch.internalName !== config.internalName
                    ); // remove channel from config
                LiveStreamDVR.getInstance().saveChannelsConfig();
                throw error; // rethrow error
            }
        } else if (Config.getInstance().cfg("app_url") == "debug") {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.create",
                `Not subscribing to ${channel.internalName} due to debug app_url.`
            );
        } else if (Config.getInstance().cfg("isolated_mode")) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.create",
                `Not subscribing to ${channel.internalName} due to isolated mode.`
            );
        } else {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.create",
                `Can't subscribe to ${channel.internalName} due to either no app_url or isolated mode disabled.`
            );
            LiveStreamDVR.getInstance().channels_config =
                LiveStreamDVR.getInstance().channels_config.filter(
                    (ch) =>
                        ch.provider == "twitch" &&
                        ch.internalName !== config.internalName
                ); // remove channel from config
            LiveStreamDVR.getInstance().saveChannelsConfig();
            throw new Error(
                "Can't subscribe due to either no app_url or isolated mode disabled."
            );
        }

        LiveStreamDVR.getInstance().addChannel(channel);

        if (TwitchHelper.hasAxios()) {
            // bad hack?
            const streams = await TwitchChannel.getStreams(channel.internalId);
            if (streams && streams.length > 0) {
                KeyValue.getInstance().setBool(
                    `${channel.internalName}.online`,
                    true
                );
            }
        }

        return channel;
    }

    /**
     * Load channel cache into memory, like usernames and id's.
     * @test disable
     */
    public static loadChannelsCache(): boolean {
        if (!fs.existsSync(BaseConfigPath.streamerCache)) return false;

        const data = fs.readFileSync(BaseConfigPath.streamerCache, "utf8");
        this.channels_cache = JSON.parse(data);
        log(
            LOGLEVEL.SUCCESS,
            "tw.channel.loadChannelsCache",
            `Loaded ${
                Object.keys(this.channels_cache).length
            } channels from cache.`
        );
        return true;
    }

    public static async subscribeToAllChannels() {
        console.debug("Subscribing to all channels");
        for (const channel of TwitchChannel.getChannels()) {
            console.debug(`Subscribing to ${channel.internalName}`);
            await channel.subscribe();
            // break; // TODO: remove
        }
    }

    public static startChatDump(
        name: string,
        channel_login: string,
        channel_id: string,
        started: Date,
        output: string
    ): Job | false {
        const chatBin = Helper.path_node();
        const chatCmd: string[] = [];
        const jsfile = path.join(
            AppRoot,
            "twitch-chat-dumper",
            "build",
            "index.js"
        );

        if (!fs.existsSync(jsfile)) {
            throw new Error("Could not find chat dumper build");
        }

        if (!chatBin) {
            throw new Error("Could not find Node binary");
        }

        // todo: execute directly in node?
        chatCmd.push(jsfile);
        chatCmd.push("--channel", channel_login);
        chatCmd.push("--userid", channel_id);
        chatCmd.push("--date", JSON.stringify(started));
        chatCmd.push("--output", output);
        if (Config.getInstance().cfg("chatdump_notext")) {
            chatCmd.push("--notext"); // don't output plain text chat
        }

        log(
            LOGLEVEL.INFO,
            "tw.channel.startChatDump",
            `Starting chat dump with filename ${path.basename(output)}`
        );

        return startJob(`chatdump_${name}`, chatBin, chatCmd);
    }

    public static async getSubscriptionId(
        channel_id: string,
        sub_type: EventSubTypes
    ): Promise<string | false> {
        const allSubs = await TwitchHelper.getSubsList();
        if (allSubs) {
            const subId = allSubs.find(
                (sub) =>
                    sub.condition.broadcaster_user_id == channel_id &&
                    sub.type == sub_type
            );
            return subId ? subId.id : false;
        } else {
            return false;
        }
    }

    public static getChannels(): TwitchChannel[] {
        // return this.channels;
        return (
            LiveStreamDVR.getInstance()
                .getChannels()
                .filter<TwitchChannel>((channel): channel is TwitchChannel =>
                    isTwitchChannel(channel)
                ) || []
        );
    }

    /**
     * Fetch channel class object from memory by channel login.
     * This is the main function to get a channel object.
     * If it does not exist, undefined is returned.
     * It does not fetch the channel data from the API or create it.
     *
     * @param {string} login
     * @returns {TwitchChannel} Channel object
     */
    public static getChannelByLogin(login: string): TwitchChannel | undefined {
        return LiveStreamDVR.getInstance()
            .getChannels()
            .find<TwitchChannel>(
                (ch): ch is TwitchChannel =>
                    ch instanceof TwitchChannel && ch.internalName === login
            );
    }

    public static getChannelById(id: string): TwitchChannel | undefined {
        return LiveStreamDVR.getInstance()
            .getChannels()
            .find<TwitchChannel>(
                (ch): ch is TwitchChannel =>
                    ch instanceof TwitchChannel && ch.internalId === id
            );
    }

    public static async getStreams(
        streamer_id: string
    ): Promise<Stream[] | false> {
        let response;

        if (!TwitchHelper.hasAxios()) {
            throw new Error("Axios is not initialized (getStreams)");
        }

        try {
            response = await TwitchHelper.getRequest<StreamsResponse>(
                "/helix/streams",
                {
                    params: {
                        user_id: streamer_id,
                    } as StreamRequestParams,
                }
            );
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getStreams",
                `Could not get streams for ${streamer_id}: ${
                    (error as Error).message
                }`,
                error
            );
            return false;
        }

        const json = response.data;

        if (!json.data) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getStreams",
                `No streams found for user id ${streamer_id}`
            );
            return false;
        }

        log(
            LOGLEVEL.INFO,
            "tw.channel.getStreams",
            `Querying streams for streamer id ${streamer_id} returned ${json.data.length} streams`
        );

        return json.data ?? false;
    }

    public static async load(uuid: string): Promise<TwitchChannel> {
        /*
        const channel_config = LiveStreamDVR.getInstance().channels_config.find(
            (c) => c.uuid === uuid
        );
        if (!channel_config)
            throw new Error(`Could not find channel config for uuid: ${uuid}`);

        const channel_data = await this.getUserDataByLogin(
            channel_config.internalName
        );

        if (!channel_data)
            throw new Error(
                `Could not get channel data for channel login: ${channel_config.internalName}`
            );
        */
        return await this.loadAbstract(uuid);
    }

    public static async channelIdFromLogin(
        login: string
    ): Promise<string | false> {
        const channelData = await this.getUserDataByLogin(login, false);
        return channelData ? channelData.id : false;
    }

    public static async channelLoginFromId(
        channel_id: string
    ): Promise<string | false> {
        const channelData = await this.getUserDataById(channel_id, false);
        return channelData ? channelData.login : false;
    }

    public static async channelDisplayNameFromId(
        channel_id: string
    ): Promise<string | false> {
        const channelData = await this.getUserDataById(channel_id, false);
        return channelData ? channelData.display_name : false;
    }

    /**
     * Get user data using the channel id (numeric in string form)
     * @param channel_id
     * @param force
     * @throws
     * @returns
     */
    public static async getUserDataById(
        channel_id: string,
        force = false
    ): Promise<UserData | false> {
        return await this.getUserDataProxy("id", channel_id, force);
    }

    /**
     * Get user data using the channel login, not the display name
     * @param login
     * @param force
     * @throws
     * @returns
     */
    public static async getUserDataByLogin(
        login: string,
        force = false
    ): Promise<UserData | false> {
        return await this.getUserDataProxy("login", login, force);
    }

    /**
     * Get user data from api using either id or login, a helper
     * function for getChannelDataById and getChannelDataByLogin.
     *
     * @internal
     * @param method Either "id" or "login"
     * @param identifier Either channel id or channel login
     * @param force
     * @throws
     * @test disable
     * @returns
     */
    public static async getUserDataProxy(
        method: "id" | "login",
        identifier: string,
        force: boolean
    ): Promise<UserData | false> {
        log(
            LOGLEVEL.DEBUG,
            "tw.channel.getUserDataProxy",
            `Fetching user data for ${method} ${identifier}, force: ${force}`
        );

        if (identifier == undefined || identifier == null || identifier == "") {
            throw new Error(`getUserDataProxy: identifier is empty`);
        }

        // check cache first
        if (!force) {
            const channelData =
                method == "id"
                    ? this.channels_cache[identifier]
                    : Object.values(this.channels_cache).find(
                          (channel) => channel.login == identifier
                      );
            if (channelData) {
                log(
                    LOGLEVEL.DEBUG,
                    "tw.channel.getUserDataProxy",
                    `User data found in memory cache for ${method} ${identifier}`
                );
                if (
                    Date.now() >
                    channelData._updated + Config.streamerCacheTime
                ) {
                    log(
                        LOGLEVEL.INFO,
                        "tw.channel.getUserDataProxy",
                        `Memory cache for ${identifier} is outdated, fetching new data`
                    );
                } else {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.getUserDataProxy",
                        `Returning memory cache for ${method} ${identifier}`
                    );
                    return channelData;
                }
            } else {
                log(
                    LOGLEVEL.DEBUG,
                    "tw.channel.getUserDataProxy",
                    `User data not found in memory cache for ${method} ${identifier}, continue fetching`
                );
            }

            if (KeyValue.getInstance().has(`${identifier}.deleted`)) {
                log(
                    LOGLEVEL.WARNING,
                    "tw.channel.getUserDataProxy",
                    `Channel ${identifier} is deleted, ignore. Delete kv file to force update.`
                );
                return false;
            }
        }

        /*
        const access_token = await TwitchHelper.getAccessToken();

        if (!access_token) {
            logAdvanced(LOGLEVEL.ERROR, "channel", "Could not get access token, aborting.");
            throw new Error("Could not get access token, aborting.");
        }
        */

        if (!TwitchHelper.hasAxios()) {
            throw new Error("Axios is not initialized (getUserDataProxy)");
        }

        let response;

        try {
            response = await TwitchHelper.getRequest<
                UsersResponse | ErrorResponse
            >(`/helix/users?${method}=${identifier}`);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                // logAdvanced(LOGLEVEL.ERROR, "channel", `Could not get channel data for ${method} ${identifier}: ${err.message} / ${err.response?.data.message}`, err);
                // return false;
                if (err.response && err.response.status === 404) {
                    // throw new Error(`Could not find channel data for ${method} ${identifier}, server responded with 404`);
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.getUserDataProxy",
                        `Could not find user data for ${method} ${identifier}, server responded with 404`
                    );
                    return false;
                }
                throw new Error(
                    `Could not get user data for ${method} ${identifier} axios error: ${
                        (err as Error).message
                    }`
                );
            }

            log(
                LOGLEVEL.ERROR,
                "tw.channel.getUserDataProxy",
                `User data request for ${identifier} exceptioned: ${
                    (err as Error).message
                }`,
                err
            );
            console.error(err);
            return false;
        }

        // TwitchlogAdvanced(LOGLEVEL.INFO, "channel", `URL: ${response.request.path} (default ${axios.defaults.baseURL})`);

        if (response.status !== 200) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getUserDataProxy",
                `Could not get user data for ${identifier}, code ${response.status}.`
            );
            throw new Error(
                `Could not get user data for ${identifier}, code ${response.status}.`
            );
        }

        const json = response.data;

        if ("error" in json) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getUserDataProxy",
                `Could not get user data for ${identifier}: ${json.message}`
            );
            return false;
        }

        if (json.data.length === 0) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getUserDataProxy",
                `Could not get user data for ${identifier}, no data.`,
                { json }
            );
            throw new Error(
                `Could not get user data for ${identifier}, no data.`
            );
        }

        const data = json.data[0];

        // use as ChannelData
        const userData = data as unknown as UserData;

        userData._updated = Date.now();

        // download channel logo
        if (userData.profile_image_url) {
            await TwitchChannel.fetchChannelLogo(userData);
        } else {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.getUserDataProxy",
                `User ${userData.id} has no profile image url`
            );
        }

        if (userData.offline_image_url) {
            const offlineFilename = `${userData.id}${path.extname(
                userData.offline_image_url
            )}`;
            const offlinePath = path.join(
                BaseConfigCacheFolder.public_cache_banners,
                offlineFilename
            );
            if (fs.existsSync(offlinePath)) {
                fs.unlinkSync(offlinePath);
            }
            let offlineResponse;
            try {
                offlineResponse = await axios({
                    url: userData.offline_image_url,
                    method: "GET",
                    responseType: "stream",
                });
            } catch (error) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.channel.getUserDataProxy",
                    `Could not download user offline image for ${
                        userData.id
                    }: ${(error as Error).message}`,
                    error
                );
            }
            if (offlineResponse && offlineResponse.data instanceof Readable) {
                offlineResponse.data.pipe(fs.createWriteStream(offlinePath));
                userData.cache_offline_image = offlineFilename;
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.channel.getUserDataProxy",
                    `Could not download offline image for ${userData.id}, data is not readable`
                );
            }
        }

        // insert into memory and save to file
        // console.debug(`Inserting user data for ${method} ${identifier} into cache and file`);
        TwitchChannel.channels_cache[userData.id] = userData;
        fs.writeFileSync(
            BaseConfigPath.streamerCache,
            JSON.stringify(TwitchChannel.channels_cache)
        );

        return userData;
    }

    /**
     * Get channel data from api using either id or login, a helper
     * function for getChannelDataById and getChannelDataByLogin.
     *
     * @internal
     * @throws
     * @returns
     * @param broadcaster_id
     */
    public static async getChannelDataById(
        broadcaster_id: string
    ): Promise<Channel | false> {
        log(
            LOGLEVEL.DEBUG,
            "tw.channel.getChannelDataById",
            `Fetching channel data for ${broadcaster_id}`
        );

        if (!TwitchHelper.hasAxios()) {
            throw new Error("Axios is not initialized (getChannelDataById)");
        }

        let response;

        try {
            response = await TwitchHelper.getRequest<
                ChannelsResponse | ErrorResponse
            >(`/helix/channels?broadcaster_id=${broadcaster_id}`);
        } catch (err) {
            if (axios.isAxiosError<ErrorResponse>(err)) {
                // logAdvanced(LOGLEVEL.ERROR, "channel", `Could not get channel data for ${method} ${identifier}: ${err.message} / ${err.response?.data.message}`, err);
                // return false;
                if (err.response && err.response.status === 404) {
                    // throw new Error(`Could not find channel data for ${method} ${identifier}, server responded with 404`);
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.getChannelDataById",
                        `Could not find user data for ${broadcaster_id}, server responded with 404`
                    );
                    return false;
                }
                throw new Error(
                    `Could not get user data for ${broadcaster_id} axios error: ${
                        (err as Error).message
                    }`
                );
            }

            log(
                LOGLEVEL.ERROR,
                "tw.channel.getChannelDataById",
                `User data request for ${broadcaster_id} exceptioned: ${
                    (err as Error).message
                }`,
                err
            );
            console.error(err);
            return false;
        }

        if (response.status !== 200) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getChannelDataById",
                `Could not get user data for ${broadcaster_id}, code ${response.status}.`
            );
            throw new Error(
                `Could not get user data for ${broadcaster_id}, code ${response.status}.`
            );
        }

        const json = response.data;

        if ("error" in json) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getChannelDataById",
                `Could not get user data for ${broadcaster_id}: ${json.message}`
            );
            return false;
        }

        if (json.data.length === 0) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.getChannelDataById",
                `Could not get user data for ${broadcaster_id}, no data.`,
                { json }
            );
            throw new Error(
                `Could not get user data for ${broadcaster_id}, no data.`
            );
        }

        return json.data[0];
    }

    public static channelDataToChapterData(
        channelData: Channel
    ): TwitchVODChapterJSON {
        const game = channelData.game_id
            ? TwitchGame.getGameFromCache(channelData.game_id)
            : undefined;
        return {
            started_at: JSON.stringify(new Date()),
            title: channelData.title,

            game_id: channelData.game_id,
            game_name: channelData.game_name,
            box_art_url: game ? game.box_art_url : undefined,

            is_mature: false,
            online: false,
            // viewer_count:
        };
    }

    public static async subscribeToIdWithWebhook(
        channel_id: string,
        force = false
    ): Promise<boolean> {
        if (!Config.getInstance().hasValue("app_url")) {
            throw new Error("app_url is not set");
        }

        if (Config.getInstance().cfg("app_url") === "debug") {
            throw new Error(
                "app_url is set to debug, no subscriptions possible"
            );
        }

        let hookCallback = `${Config.getInstance().cfg(
            "app_url",
            ""
        )}/api/v0/hook/twitch`;

        if (Config.getInstance().hasValue("instance_id")) {
            hookCallback +=
                "?instance=" + Config.getInstance().cfg("instance_id", "");
        }

        if (!Config.getInstance().hasValue("eventsub_secret")) {
            throw new Error("eventsub_secret is not set");
        }

        const streamerLogin = await TwitchChannel.channelLoginFromId(
            channel_id
        );

        for (const subType of TwitchHelper.CHANNEL_SUB_TYPES) {
            if (
                KeyValue.getInstance().has(`${channel_id}.sub.${subType}`) &&
                !force
            ) {
                log(
                    LOGLEVEL.INFO,
                    "tw.ch.subWebhook",
                    `Skip subscription to ${channel_id}:${subType} (${streamerLogin}), in cache.`
                );
                continue; // todo: alert
            }

            log(
                LOGLEVEL.INFO,
                "tw.ch.subWebhook",
                `Subscribe to ${channel_id}:${subType} (${streamerLogin})`
            );

            const payload: SubscriptionRequest = {
                type: subType,
                version: "1",
                condition: {
                    broadcaster_user_id: channel_id,
                },
                transport: {
                    method: "webhook",
                    callback: hookCallback,
                    secret: Config.getInstance().cfg("eventsub_secret"),
                },
            };

            if (!TwitchHelper.hasAxios()) {
                throw new Error(
                    "Axios is not initialized (subscribeToIdWithWebhook)"
                );
            }

            let response;

            try {
                response = await TwitchHelper.postRequest<SubscriptionResponse>(
                    "/helix/eventsub/subscriptions",
                    payload
                );
            } catch (err) {
                if (axios.isAxiosError<ErrorResponse>(err)) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.ch.subWebhook",
                        `Could not subscribe to ${channel_id}:${subType}: ${err.message} / ${err.response?.data.message}`
                    );

                    if (err.response?.data.status == 409) {
                        // duplicate
                        const subId = await TwitchChannel.getSubscriptionId(
                            channel_id,
                            subType
                        );
                        if (subId) {
                            KeyValue.getInstance().set(
                                `${channel_id}.sub.${subType}`,
                                subId
                            );
                            KeyValue.getInstance().set(
                                `${channel_id}.substatus.${subType}`,
                                SubStatus.SUBSCRIBED
                            );
                        }
                        continue;
                    }

                    continue;
                }

                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subWebhook",
                    `Subscription request for ${channel_id} exceptioned: ${
                        (err as Error).message
                    }`
                );
                console.error(err);
                continue;
            }

            const json = response.data;
            const httpCode = response.status;

            KeyValue.getInstance().setInt(
                "twitch.max_total_cost",
                json.max_total_cost
            );
            KeyValue.getInstance().setInt("twitch.total_cost", json.total_cost);
            KeyValue.getInstance().setInt("twitch.total", json.total);

            if (httpCode == 202) {
                if (
                    json.data[0].status !==
                    "webhook_callback_verification_pending"
                ) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.ch.subWebhook",
                        `Got 202 return for subscription request for ${channel_id}:${subType} but did not get callback verification.`
                    );
                    return false;
                    // continue;
                }

                KeyValue.getInstance().set(
                    `${channel_id}.sub.${subType}`,
                    json.data[0].id
                );
                KeyValue.getInstance().set(
                    `${channel_id}.substatus.${subType}`,
                    SubStatus.WAITING
                );

                log(
                    LOGLEVEL.INFO,
                    "tw.ch.subWebhook",
                    `Subscribe request for ${channel_id}:${subType} (${streamerLogin}) sent, awaiting response...`
                );

                await new Promise((resolve, reject) => {
                    let kvResponse: boolean | undefined = undefined;
                    KeyValue.getInstance().once("set", (key, value) => {
                        if (
                            key === `${channel_id}.substatus.${subType}` &&
                            value === SubStatus.SUBSCRIBED
                        ) {
                            log(
                                LOGLEVEL.SUCCESS,
                                "tw.ch.subWebhook",
                                `Subscription for ${channel_id}:${subType} (${streamerLogin}) active.`
                            );
                            kvResponse = true;
                            resolve(true);
                            return;
                        } else if (
                            key === `${channel_id}.substatus.${subType}` &&
                            value === SubStatus.FAILED
                        ) {
                            log(
                                LOGLEVEL.ERROR,
                                "tw.ch.subWebhook",
                                `Subscription for ${channel_id}:${subType} (${streamerLogin}) failed.`
                            );
                            kvResponse = true;
                            reject(
                                new Error(
                                    "Subscription failed, check logs for details."
                                )
                            );
                            return;
                        } else if (
                            key === `${channel_id}.substatus.${subType}` &&
                            value === SubStatus.WAITING
                        ) {
                            // this one shouldn't happen?
                            log(
                                LOGLEVEL.ERROR,
                                "tw.ch.subWebhook",
                                `Subscription for ${channel_id}:${subType} (${streamerLogin}) failed, no response received.`
                            );
                            kvResponse = true;
                            reject(
                                new Error(
                                    "Subscription failed, check logs for details."
                                )
                            );
                            return;
                        }
                        kvResponse = false;
                        reject(new Error("Unknown error"));
                    });
                    // timeout and reject, remove if we get a response
                    xTimeout(() => {
                        if (kvResponse === undefined) {
                            log(
                                LOGLEVEL.ERROR,
                                "tw.ch.subWebhook",
                                `Subscription for ${channel_id}:${subType} (${streamerLogin}) failed, no response received within 10 seconds.`
                            );
                            reject(
                                new Error(
                                    "Timeout, no response received within 10 seconds."
                                )
                            );
                        }
                    }, 10000);
                });
            } else if (httpCode == 409) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subWebhook",
                    `Duplicate sub for ${channel_id}:${subType} detected.`
                );
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subWebhook",
                    `Failed to send subscription request for ${channel_id}:${subType}: ${JSON.stringify(
                        json
                    )}, HTTP ${httpCode})`
                );
                // return false;
                // continue;
                throw new Error(
                    `Failed to send subscription request for ${channel_id}:${subType}: ${JSON.stringify(
                        json
                    )}, HTTP ${httpCode})`
                );
            }
        }

        return true;
    }

    /**
     * @test disable
     * @param channel_id
     */
    public static async unsubscribeFromIdWithWebhook(
        channel_id: string
    ): Promise<boolean> {
        const subscriptions = await TwitchHelper.getSubsList();

        if (!subscriptions) {
            log(
                LOGLEVEL.ERROR,
                "tw.ch.unsubWebhook",
                "Failed to get subscriptions list, or no subscriptions found."
            );
            return false;
        }

        const streamerLogin = await TwitchChannel.channelLoginFromId(
            channel_id
        );

        let userSubscriptionsAmount = 0;
        let unsubbed = 0;
        for (const sub of subscriptions) {
            if (sub.condition.broadcaster_user_id !== channel_id) {
                continue;
            }

            userSubscriptionsAmount++;

            const unsub = await TwitchHelper.eventSubUnsubscribe(sub.id);

            if (unsub) {
                log(
                    LOGLEVEL.SUCCESS,
                    "tw.ch.unsubWebhook",
                    `Unsubscribed from ${channel_id}:${sub.type} (${streamerLogin})`
                );
                unsubbed++;
                KeyValue.getInstance().delete(`${channel_id}.sub.${sub.type}`);
                KeyValue.getInstance().delete(
                    `${channel_id}.substatus.${sub.type}`
                );
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.unsubWebhook",
                    `Failed to unsubscribe from ${channel_id}:${sub.type} (${streamerLogin})`
                );

                if (
                    KeyValue.getInstance().has(`${channel_id}.sub.${sub.type}`)
                ) {
                    KeyValue.getInstance().delete(
                        `${channel_id}.sub.${sub.type}`
                    );
                    KeyValue.getInstance().delete(
                        `${channel_id}.substatus.${sub.type}`
                    );
                    log(
                        LOGLEVEL.WARNING,
                        "tw.ch.unsubWebhook",
                        `Removed subscription from cache for ${channel_id}:${sub.type} (${streamerLogin})`
                    );
                }
            }
        }

        log(
            LOGLEVEL.INFO,
            "tw.ch.unsubWebhook",
            `Unsubscribed from ${unsubbed}/${userSubscriptionsAmount} subscriptions for ${channel_id} (${streamerLogin})`
        );

        return unsubbed === userSubscriptionsAmount;
    }

    /**
     * @test disable
     * @param channel_id
     * @param force
     */
    public static async subscribeToIdWithWebsocket(
        channel_id: string,
        force = false
    ): Promise<boolean> {
        const streamerLogin = await TwitchChannel.channelLoginFromId(
            channel_id
        );

        for (const subType of TwitchHelper.CHANNEL_SUB_TYPES) {
            let selectedWebsocket: EventWebsocket | undefined = undefined;
            for (const ws of TwitchHelper.eventWebsockets) {
                if (ws.isAvailable(1)) {
                    // estimated cost
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.ch.subscribeToIdWithWebsocket",
                        `Using existing websocket ${ws.id} for ${channel_id}:${subType} sub (${streamerLogin})`
                    );
                    selectedWebsocket = ws;
                    break;
                }
            }

            if (!selectedWebsocket) {
                // throw new Error("No websocket available for subscription");
                selectedWebsocket = await TwitchHelper.createNewWebsocket(
                    TwitchHelper.eventWebsocketUrl
                );
                log(
                    LOGLEVEL.DEBUG,
                    "tw.ch.subscribeToIdWithWebsocket",
                    `Using new websocket ${selectedWebsocket.id}/${selectedWebsocket.sessionId} for ${channel_id}:${subType} sub (${streamerLogin})`
                );
            }

            if (!selectedWebsocket) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subscribeToIdWithWebsocket",
                    `Could not create websocket for ${channel_id}:${subType} subscription, aborting`
                );
                throw new Error("Could not create websocket for subscription");
            }

            if (!selectedWebsocket.sessionId) {
                throw new Error(
                    `EventSub session ID is not set on websocket ${selectedWebsocket.id}`
                );
            }

            // if (KeyValue.getInstance().get(`${channel_id}.sub.${sub_type}`) && !force) {
            //     logAdvanced(LOGLEVEL.INFO, "tw.ch.subscribeToIdWithWebsocket", `Skip subscription to ${channel_id}:${sub_type} (${streamer_login}), in cache.`);
            //     continue; // todo: alert
            // }

            log(
                LOGLEVEL.INFO,
                "tw.ch.subscribeToIdWithWebsocket",
                `Subscribe to ${channel_id}:${subType} (${streamerLogin}) with websocket ${selectedWebsocket.id}/${selectedWebsocket.sessionId}`
            );

            const payload: SubscriptionRequest = {
                type: subType,
                version: "1",
                condition: {
                    broadcaster_user_id: channel_id,
                },
                transport: {
                    method: "websocket",
                    session_id: selectedWebsocket.sessionId,
                },
            };

            if (!TwitchHelper.hasAxios()) {
                throw new Error(
                    "Axios is not initialized (subscribeToIdWithWebsocket)"
                );
            }

            let response;

            try {
                response = await TwitchHelper.postRequest<SubscriptionResponse>(
                    "/helix/eventsub/subscriptions",
                    payload
                );
            } catch (err) {
                if (axios.isAxiosError<ErrorResponse>(err)) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.ch.subscribeToIdWithWebsocket",
                        `Could not subscribe to ${channel_id}:${subType}: ${err.message} / ${err.response?.data.message}`
                    );

                    if (err.response?.status == 409) {
                        // duplicate
                        // const sub_id = await TwitchChannel.getSubscriptionId(channel_id, sub_type);
                        // if (sub_id) {
                        //     KeyValue.getInstance().set(`${channel_id}.sub.${sub_type}`, sub_id);
                        //     KeyValue.getInstance().set(`${channel_id}.substatus.${sub_type}`, SubStatus.SUBSCRIBED);
                        // }
                        console.error(
                            `Duplicate subscription detected for ${channel_id}:${subType}`
                        );
                        continue;
                    } else if (err.response?.status == 429) {
                        // rate limit
                        log(
                            LOGLEVEL.ERROR,
                            "tw.ch.subscribeToIdWithWebsocket",
                            `Rate limit hit for ${channel_id}:${subType}, skipping`
                        );
                        continue;
                    }

                    continue;
                }

                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subscribeToIdWithWebsocket",
                    `Subscription request for ${channel_id} exceptioned: ${
                        (err as Error).message
                    }`
                );
                console.error(err);
                continue;
            }

            const json = response.data;
            const httpCode = response.status;

            KeyValue.getInstance().setInt(
                "twitch.ws.max_total_cost",
                json.max_total_cost
            );
            KeyValue.getInstance().setInt(
                "twitch.ws.total_cost",
                json.total_cost
            );
            KeyValue.getInstance().setInt("twitch.ws.total", json.total);

            selectedWebsocket.quotas = {
                max_total_cost: json.max_total_cost,
                total_cost: json.total_cost,
                total: json.total,
            };

            if (httpCode == 202) {
                if (json.data[0].status === "enabled") {
                    log(
                        LOGLEVEL.SUCCESS,
                        "tw.ch.subscribeToIdWithWebsocket",
                        `Subscribe for ${channel_id}:${subType} (${streamerLogin}) successful.`
                    );

                    if (selectedWebsocket) {
                        selectedWebsocket.addSubscription(json.data[0]);
                    } else {
                        log(
                            LOGLEVEL.ERROR,
                            "tw.ch.subscribeToIdWithWebsocket",
                            `Could not find websocket for ${channel_id}:${subType}`
                        );
                    }
                } else {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.ch.subscribeToIdWithWebsocket",
                        `Subscribe for ${channel_id}:${subType} (${streamerLogin}) failed: ${json.data[0].status}`
                    );
                }
            } else if (httpCode == 409) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subscribeToIdWithWebsocket",
                    `Duplicate sub for ${channel_id}:${subType} detected.`
                );
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.subscribeToIdWithWebsocket",
                    `Failed to send subscription request for ${channel_id}:${subType}: ${JSON.stringify(
                        json
                    )}, HTTP ${httpCode})`
                );
                return false;
            }
        }

        return true;
    }

    public static async unsubscribeFromIdWithWebsocket(
        channel_id: string
    ): Promise<boolean> {
        const subscriptions = await TwitchHelper.getSubsList();

        if (!subscriptions) {
            return false;
        }

        const streamerLogin = await TwitchChannel.channelLoginFromId(
            channel_id
        );

        let unsubbed = 0;
        for (const sub of subscriptions) {
            if (sub.condition.broadcaster_user_id !== channel_id) {
                continue;
            }

            const unsub = await TwitchHelper.eventSubUnsubscribe(sub.id);

            if (unsub) {
                log(
                    LOGLEVEL.SUCCESS,
                    "tw.ch.unsubscribeToIdWithWebsocket",
                    `Unsubscribed from ${channel_id}:${sub.type} (${streamerLogin})`
                );
                unsubbed++;
                // KeyValue.getInstance().delete(`${channel_id}.sub.${sub.type}`);
                // KeyValue.getInstance().delete(`${channel_id}.substatus.${sub.type}`);
                const ws = TwitchHelper.findWebsocketSubscriptionBearer(
                    channel_id,
                    sub.type
                );
                if (ws) {
                    ws.removeSubscription(sub.id);
                }
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.ch.unsubscribeToIdWithWebsocket",
                    `Failed to unsubscribe from ${channel_id}:${sub.type} (${streamerLogin})`
                );
            }
        }

        return unsubbed === subscriptions.length;
    }

    private static async fetchChannelLogo(userData: UserData) {
        log(
            LOGLEVEL.INFO,
            "tw.channel.fetchChannelLogo",
            `Fetching channel logo for ${userData.id} (${userData.login})`
        );

        const logoFilename = `${userData.id}${path.extname(
            userData.profile_image_url
        )}`;

        const logoPath = path.join(
            BaseConfigCacheFolder.public_cache_avatars,
            logoFilename
        );

        if (fs.existsSync(logoPath)) {
            fs.unlinkSync(logoPath);
            log(
                LOGLEVEL.DEBUG,
                "tw.channel.fetchChannelLogo",
                `Deleted old avatar for ${userData.id}`
            );
        }

        let avatarResponse: AxiosResponse<Readable> | undefined;

        try {
            avatarResponse = await axios({
                url: userData.profile_image_url,
                method: "GET",
                responseType: "stream",
            });
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.fetchChannelLogo",
                `Could not download user logo for ${userData.id}: ${
                    (error as Error).message
                }`,
                error
            );
        }

        if (avatarResponse) {
            log(
                LOGLEVEL.DEBUG,
                "tw.channel.fetchChannelLogo",
                `Fetched avatar for ${userData.id}`
            );

            await pipeline(avatarResponse.data, fs.createWriteStream(logoPath));

            log(
                LOGLEVEL.DEBUG,
                "tw.channel.fetchChannelLogo",
                `Saved avatar for ${userData.id}`
            );

            if (fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
                userData.avatar_cache = logoFilename;

                // make thumbnails

                log(
                    LOGLEVEL.DEBUG,
                    "tw.channel.fetchChannelLogo",
                    `Create thumbnail for ${userData.id}`
                );

                let avatarThumbnail;
                try {
                    avatarThumbnail = await imageThumbnail(logoPath, 64);
                } catch (error) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.fetchChannelLogo",
                        `Could not create thumbnail for user logo for ${
                            userData.id
                        }: ${(error as Error).message}`,
                        error
                    );
                }

                if (avatarThumbnail) {
                    userData.avatar_thumb = avatarThumbnail;
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.fetchChannelLogo",
                        `Created thumbnail for user logo for ${userData.id}`
                    );
                } else {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.fetchChannelLogo",
                        `Could not create thumbnail for user logo for ${userData.id}`
                    );
                }

                TwitchChannel.channels_cache[userData.id] = userData; // TODO: is this a good idea
            } else {
                log(
                    LOGLEVEL.ERROR,
                    "tw.channel.fetchChannelLogo",
                    `Could not find downloaded avatar for ${userData.id}`
                );
            }
        }
    }

    public async getStreams(): Promise<Stream[] | false> {
        return await TwitchChannel.getStreams(this.internalId);
    }

    public async parseVODs(rescan = false): Promise<void> {
        log(
            LOGLEVEL.INFO,
            "channel.parseVODs",
            `Parsing VODs for ${this.internalName}`
        );

        if (
            fs.existsSync(
                path.join(
                    BaseConfigDataFolder.vods_db,
                    `${this.internalName}.json`
                )
            ) &&
            !rescan
        ) {
            let list: string[] = JSON.parse(
                fs.readFileSync(
                    path.join(
                        BaseConfigDataFolder.vods_db,
                        `${this.internalName}.json`
                    ),
                    { encoding: "utf-8" }
                )
            );
            log(
                LOGLEVEL.DEBUG,
                "channel.parseVODs",
                `Found ${list.length} stored VODs in database for ${this.internalName}`
            );
            // console.log(list);
            list = list.filter((p) =>
                fs.existsSync(path.join(BaseConfigDataFolder.vod, p))
            );
            // console.log(list);
            this.vods_raw = list;
            log(
                LOGLEVEL.DEBUG,
                "channel.parseVODs",
                `Found ${this.vods_raw.length} existing VODs in database for ${this.internalName}`
            );
        } else {
            this.vods_raw = this.rescanVods();
            log(
                LOGLEVEL.INFO,
                "channel.parseVODs",
                `No VODs in database found for ${this.internalName}, migrate ${this.vods_raw.length} from recursive file search`
            );
            // fs.writeFileSync(path.join(BaseConfigDataFolder.vods_db, `${this.internalName}.json`), JSON.stringify(this.vods_raw));
            this.saveVodDatabase();
        }

        this.vods_list = [];

        log(
            LOGLEVEL.INFO,
            "channel.parseVODs",
            `Found ${this.vods_raw.length} VODs for ${this.internalName}`
        );

        for (const vod of this.vods_raw) {
            log(LOGLEVEL.INFO, "channel.parseVODs", `Try to parse VOD ${vod}`);

            const vodFullPath = path.join(BaseConfigDataFolder.vod, vod);

            let vodclass;

            try {
                vodclass = await TwitchVOD.load(vodFullPath, true);
            } catch (e) {
                log(
                    LOGLEVEL.ERROR,
                    "channel.parseVODs",
                    `Could not load VOD ${vod}: ${(e as Error).message}`,
                    e
                );
                console.error(e);
                continue;
            }

            if (!vodclass) {
                continue;
            }

            if (!vodclass.channel_uuid) {
                log(
                    LOGLEVEL.WARNING,
                    "channel.parseVODs",
                    `VOD '${vod}' does not have a channel UUID, setting it to '${this.uuid}'`
                );
                vodclass.channel_uuid = this.uuid;
            } else if (
                vodclass.channel_uuid &&
                vodclass.channel_uuid !== this.uuid
            ) {
                log(
                    LOGLEVEL.WARNING,
                    "channel.parseVODs",
                    `VOD '${vod}' has a channel UUID '${vodclass.channel_uuid}', but it should be '${this.uuid}', setting it to '${this.uuid}'`
                );
                vodclass.channel_uuid = this.uuid;
            }

            // await vodclass.fixIssues();
            log(LOGLEVEL.DEBUG, "channel.parseVODs", `Fix issues for ${vod}`);
            let noIssues = false;
            do {
                noIssues = await vodclass.fixIssues("channel parseVODs");
            } while (!noIssues);

            // if (vodclass.is_capturing) {
            //     $this->is_live = true;
            //     $this->current_vod = $vodclass;
            //     $this->current_game = $vodclass->getCurrentGame();
            //     $this->current_duration = $vodclass->getDurationLive() ?: null;
            // }
            //
            // if ($vodclass->is_converting) {
            //     $this->is_converting = true;
            // }

            // if (vodclass.segments) {
            //     this.vods_size += vodclass.segments.reduce((acc, seg) => acc + (seg && seg.filesize ? seg.filesize : 0), 0);
            // }

            this.addVod(vodclass);

            log(
                LOGLEVEL.DEBUG,
                "channel.parseVODs",
                `VOD ${vod} added to ${this.internalName}`
            );
        }
        this.sortVods();
    }

    public getSubscriptionStatus(): boolean {
        // for (const sub_type of TwitchHelper.CHANNEL_SUB_TYPES) {
        //     if (KeyValue.getInstance().get(`${this.userid}.substatus.${sub_type}`) != SubStatus.SUBSCRIBED) {
        //         return false;
        //     }
        // }
        // return true;
        return TwitchHelper.CHANNEL_SUB_TYPES.every(
            (sub_type) =>
                KeyValue.getInstance().get(
                    `${this.internalId}.substatus.${sub_type}`
                ) === SubStatus.SUBSCRIBED
        );
    }

    public override async toAPI(): Promise<ApiTwitchChannel> {
        if (!this.internalId || !this.internalName || !this.displayName)
            console.error(
                chalk.red(
                    `Channel ${this.internalId} is missing internalId, internalName or displayName`
                )
            );

        const vodsList = await Promise.all(
            this.getVods().map(async (vod) => await vod.toAPI())
        );

        return {
            ...(await super.toAPI()),
            provider: "twitch",
            // userid: this.userid || "",
            // login: this.login || "",
            // display_name: this.display_name || "",
            profile_image_url: this.profile_image_url || "",
            offline_image_url: this.offline_image_url || "",
            banner_image_url: this.banner_image_url || "",
            broadcaster_type: this.broadcaster_type || "",
            current_vod: await this.current_vod?.toAPI(),
            current_game: this.current_game?.toAPI(),
            current_chapter: this.current_chapter?.toAPI(),
            // current_duration: this.current_duration,
            // subbed_at: this.subbed_at,
            // expires_at: this.expires_at,
            // last_online: this.last_online,
            channel_data: this.channel_data,
            // config: this.config,
            // deactivated: this.deactivated,
            api_getSubscriptionStatus: this.getSubscriptionStatus(),

            subbed_at: this.subbed_at
                ? this.subbed_at.toISOString()
                : undefined,
            expires_at: this.expires_at
                ? this.expires_at.toISOString()
                : undefined,

            chapter_data: this.getChapterData(),

            saves_vods: this.saves_vods,

            quality: this.quality,

            vods_list: vodsList,
        };
    }

    /**
     * Update and save channel config
     *
     * @param config
     */
    public update(config: TwitchChannelConfig): boolean {
        const i = LiveStreamDVR.getInstance().channels_config.findIndex(
            (ch) => ch.uuid === this.uuid
        );
        if (i !== -1) {
            this.config = config;
            this.applyConfig(config);
            log(
                LOGLEVEL.INFO,
                "tw.channel.update",
                `Replacing channel config for ${this.internalName}`
            );
            LiveStreamDVR.getInstance().channels_config[i] = config;
            LiveStreamDVR.getInstance().saveChannelsConfig();
            return true;
        } else {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.update",
                `Could not update channel ${this.internalName}`
            );
        }
        return false;
    }

    /**
     * Create an empty VOD object. This is the only method to use to create a new VOD. Do NOT use the constructor of the VOD class.
     *
     * @param filename The filename of the vod including json extension.
     * @returns Empty VOD
     */
    public async createVOD(
        filename: string,
        capture_id: string
    ): Promise<TwitchVOD> {
        if (!this.internalId) throw new Error("Channel internalId is not set");
        if (!this.internalName)
            throw new Error("Channel internalName is not set");
        if (!this.displayName)
            throw new Error("Channel displayName is not set");

        log(
            LOGLEVEL.INFO,
            "tw.channel.createVOD",
            `Create VOD JSON for ${this.internalName}: ${path.basename(
                filename
            )} @ ${path.dirname(filename)}`
        );

        if (fs.existsSync(filename)) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.createVOD",
                `VOD JSON already exists for ${
                    this.internalName
                }: ${path.basename(filename)} @ ${path.dirname(filename)}`
            );
            throw new Error(
                `VOD JSON already exists for ${
                    this.internalName
                }: ${path.basename(filename)} @ ${path.dirname(filename)}`
            );
        }

        const vod = new TwitchVOD();

        vod.created = true;
        vod.not_started = true;

        vod.filename = filename;
        vod.basename = path.basename(filename, ".json");
        vod.directory = path.dirname(filename);

        vod.channel_uuid = this.uuid;

        vod.created_at = new Date();

        vod.uuid = randomUUID();

        vod.capture_id = capture_id;

        await vod.saveJSON("create json");

        // reload
        const loadVod = await TwitchVOD.load(vod.filename, true);

        loadVod.created = true; // re-set created flag
        loadVod.not_started = true; // re-set not_started flag

        // TwitchVOD.addVod(vod);
        this.addVod(loadVod);
        this.sortVods();

        // add to database
        this.addVodToDatabase(
            path.relative(BaseConfigDataFolder.vod, filename)
        );
        this.saveVodDatabase();

        this.checkStaleVodsInMemory();

        return loadVod;
    }

    public checkStaleVodsInMemory(): void {
        log(
            LOGLEVEL.DEBUG,
            "tw.channel.checkStaleVodsInMemory",
            `Check stale VODs in memory for ${this.internalName}`
        );

        // const vods_on_disk = fs.readdirSync(Helper.vodFolder(this.login)).filter(f => this.login && f.startsWith(this.login) && f.endsWith(".json") && !f.endsWith("_chat.json"));
        // const vods_on_disk = this.rescanVods();
        // const vods_in_channel_memory = this.getVods();
        // const vods_in_main_memory =
        //     LiveStreamDVR.getInstance().getVodsByChannelUUID(this.uuid);

        /**
         * // TODO: rewrite all of this, it's a mess. it doesn't make any sense anymore when vods can be stored in customised folders.
         * It always assumes the vod is in the channel folder and as such counts are not correct anymore.
        /*

        if (vods_on_disk.length !== vods_in_channel_memory.length) {
            const removedVods = vods_in_channel_memory.filter(v => !vods_on_disk.includes(v.basename));
            ClientBroker.notify(
                "VOD changed externally",
                `Please do not delete or rename VOD files manually.\nRemoved VODs: ${removedVods.map(v => v.basename).join(", ")}`,
                undefined,
                "system"
            );
            // console.log("Removed VODs: ", removedVods.map(v => v.basename).join(", "));
            logAdvanced(LOGLEVEL.ERROR, "channel", `Vod on disk and vod in memory are not the same for ${this.internalName}`, {
                vods_on_disk,
                vods_in_channel_memory: vods_in_channel_memory.map(v => v.basename),
                vods_in_main_memory: vods_in_main_memory.map(v => v.basename),
            });
        }

        if (vods_on_disk.length !== vods_in_main_memory.length) {
            const removedVods = vods_in_main_memory.filter(v => !vods_on_disk.includes(v.basename));
            ClientBroker.notify(
                "VOD changed externally",
                `Please do not delete or rename VOD files manually.\nRemoved VODs: ${removedVods.map(v => v.basename).join(", ")}`,
                undefined,
                "system"
            );
            // console.log("Removed VODs: ", removedVods.map(v => v.basename).join(", "));
            logAdvanced(LOGLEVEL.ERROR, "channel", `Vod on disk and vod in main memory are not the same for ${this.internalName}`, {
                vods_on_disk,
                vods_in_channel_memory: vods_in_channel_memory.map(v => v.basename),
                vods_in_main_memory: vods_in_main_memory.map(v => v.basename),
            });
        }

        if (vods_in_channel_memory.length !== vods_in_main_memory.length) {
            const removedVods = vods_in_main_memory.filter(v => v instanceof TwitchVOD && !vods_in_channel_memory.includes(v));
            ClientBroker.notify(
                "VOD changed externally",
                `Please do not delete or rename VOD files manually.\nRemoved VODs: ${removedVods.map(v => v.basename).join(", ")}`,
                undefined,
                "system"
            );
            // console.log("Removed VODs: ", removedVods.map(v => v.basename).join(", "));
            logAdvanced(LOGLEVEL.ERROR, "channel", `Vod in memory and vod in main memory are not the same for ${this.internalName}`, {
                vods_on_disk,
                vods_in_channel_memory: vods_in_channel_memory.map(v => v.basename),
                vods_in_main_memory: vods_in_main_memory.map(v => v.basename),
            });
        }
        */
    }

    public hasVod(video_id: string): boolean {
        return (
            this.getVods().find(
                (v) => v.external_vod_id && v.external_vod_id === video_id
            ) != undefined
        );
    }

    /**
     * Get the latest chapter data stored in cache
     *
     * @returns {TwitchVODChapterJSON|undefined} Chapter data
     */
    public getChapterData(): TwitchVODChapterJSON | undefined {
        const cd = KeyValue.getInstance().get(
            `${this.internalName}.chapterdata`
        );
        return cd ? (JSON.parse(cd) as TwitchVODChapterJSON) : undefined;
    }

    public async updateChapterData(force = false): Promise<void> {
        if (!this.internalId) return;
        if (
            KeyValue.getInstance().has(`${this.internalName}.chapterdata`) &&
            !force
        )
            return;
        const data = await TwitchChannel.getChannelDataById(this.internalId);
        if (!data) return;
        const chapter = TwitchChannel.channelDataToChapterData(data);
        KeyValue.getInstance().set(
            `${this.internalName}.chapterdata`,
            JSON.stringify(chapter)
        );
        log(
            LOGLEVEL.INFO,
            "tw.channel.updateChapterData",
            `Updated chapter data for ${this.internalName}`
        );
    }

    public roundupCleanupVodCandidates(ignore_uuid = ""): TwitchVOD[] {
        let totalSize = 0;
        let totalVods = 0;

        let vodCandidates: TwitchVOD[] = [];

        const maxStorage =
            this.max_storage > 0
                ? this.max_storage
                : Config.getInstance().cfg<number>("storage_per_streamer", 100);
        const maxVods =
            this.max_vods > 0
                ? this.max_vods
                : Config.getInstance().cfg<number>("vods_to_keep", 5);

        const maxGigabytes = maxStorage * 1024 * 1024 * 1024;
        // const vods_to_keep = max_vods;

        if (this.vods_list) {
            for (const vodclass of [...this.vods_list].reverse()) {
                // reverse so we can delete the oldest ones first

                if (!vodclass.is_finalized) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to not being finalized`
                    );
                    continue;
                }

                if (!vodclass.uuid) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.roundupCleanupVodCandidates",
                        `VOD ${vodclass.basename} does not have an UUID, will not remove.`
                    );
                    continue;
                }

                if (vodclass.uuid === ignore_uuid) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to ignore_uuid '${ignore_uuid}'`
                    );
                    continue;
                }

                if (
                    Config.getInstance().cfg<boolean>("keep_deleted_vods") &&
                    vodclass.external_vod_exists === false
                ) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to it being deleted on Twitch.`
                    );
                    continue;
                }

                if (
                    Config.getInstance().cfg<boolean>("keep_favourite_vods") &&
                    vodclass.hasFavouriteGame()
                ) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to it having a favourite game.`
                    );
                    continue;
                }

                if (
                    Config.getInstance().cfg<boolean>("keep_muted_vods") &&
                    vodclass.twitch_vod_muted === MuteStatus.MUTED
                ) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to it being muted on Twitch.`
                    );
                    continue;
                }

                if (
                    Config.getInstance().cfg<boolean>("keep_commented_vods") &&
                    vodclass.comment !== "" &&
                    vodclass.comment !== undefined
                ) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to it having a comment set.`
                    );
                    continue;
                }

                if (vodclass.prevent_deletion) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${vodclass.basename} due to prevent_deletion`
                    );
                    continue;
                }

                totalSize += vodclass.total_size;
                totalVods += 1;

                if (totalSize > maxGigabytes) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Adding ${
                            vodclass.basename
                        } to vod_candidates due to storage limit (${formatBytes(
                            vodclass.total_size
                        )} of current total ${formatBytes(
                            totalSize
                        )}, limit ${formatBytes(maxGigabytes)})`
                    );
                    vodCandidates.push(vodclass);
                }

                if (totalVods > maxVods) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Adding ${vodclass.basename} to vod_candidates due to vod limit (${totalVods} of limit ${maxVods})`
                    );
                    vodCandidates.push(vodclass);
                }

                if (!vodCandidates.includes(vodclass)) {
                    log(
                        LOGLEVEL.DEBUG,
                        "tw.channel.roundupCleanupVodCandidates",
                        `Keeping ${
                            vodclass.basename
                        } due to it not being over storage limit (${formatBytes(
                            totalSize
                        )}/${formatBytes(
                            maxGigabytes
                        )}) and not being over vod limit (${totalVods}/${maxVods})`
                    );
                }
            }
        }

        // remove duplicates
        vodCandidates = vodCandidates.filter(
            (v, i, a) => a.findIndex((t) => t.basename === v.basename) === i
        );

        log(
            LOGLEVEL.INFO,
            "tw.channel.roundupCleanupVodCandidates",
            `Chose ${vodCandidates.length} vods to delete`,
            { vod_candidates: vodCandidates.map((v) => v.basename) }
        );

        return vodCandidates;
    }

    public async cleanupVods(ignore_uuid = ""): Promise<number | false> {
        if (this.no_cleanup) {
            log(
                LOGLEVEL.INFO,
                "tw.channel.cleanupVods",
                `Skipping cleanup for ${this.internalName} due to no_cleanup flag`
            );
            return false;
        }

        log(
            LOGLEVEL.INFO,
            "tw.channel.cleanupVods",
            `Cleanup VODs for ${this.internalName}, ignore ${ignore_uuid}`
        );

        const vodCandidates = this.roundupCleanupVodCandidates(ignore_uuid);

        if (vodCandidates.length === 0) {
            log(
                LOGLEVEL.INFO,
                "tw.channel.cleanupVods",
                `Not enough vods to delete for ${this.internalName}`
            );
            return false;
        }

        if (Config.getInstance().cfg("delete_only_one_vod")) {
            log(
                LOGLEVEL.INFO,
                "tw.channel.cleanupVods",
                `Deleting only one vod for ${this.internalName}: ${vodCandidates[0].basename}`
            );
            try {
                await vodCandidates[0].delete();
            } catch (error) {
                log(
                    LOGLEVEL.ERROR,
                    "tw.channel.cleanupVods",
                    `Failed to delete ${vodCandidates[0].basename} for ${
                        this.internalName
                    }: ${(error as Error).message}`
                );
                return false;
            }
            return 1;
        } else {
            for (const vodclass of vodCandidates) {
                log(
                    LOGLEVEL.INFO,
                    "tw.channel.cleanupVods",
                    `Cleanup delete: ${vodclass.basename}`
                );
                try {
                    await vodclass.delete();
                } catch (error) {
                    log(
                        LOGLEVEL.ERROR,
                        "tw.channel.cleanupVods",
                        `Failed to delete ${vodclass.basename} for ${
                            this.internalName
                        }: ${(error as Error).message}`
                    );
                }
            }
        }

        try {
            this.deleteEmptyVodFolders();
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.cleanupVods",
                `Failed to delete empty folders for ${this.internalName}: ${
                    (error as Error).message
                }`
            );
        }

        return vodCandidates.length;
    }

    public async refreshData(): Promise<boolean> {
        if (!this.internalId) throw new Error("Userid not set");
        log(
            LOGLEVEL.INFO,
            "tw.channel.refreshData",
            `Refreshing data for ${this.internalName}`
        );

        const channelData = await TwitchChannel.getUserDataById(
            this.internalId,
            true
        );

        if (channelData) {
            this.channel_data = channelData;
            // this.userid = channel_data.id;
            // this.login = channel_data.login;
            // this.display_name = channel_data.display_name;
            // this.profile_image_url = channel_data.profile_image_url;
            this.broadcaster_type = channelData.broadcaster_type;
            // this.description = channel_data.description;

            await this.checkIfChannelSavesVods();

            this.saveKodiNfo();

            return true;
        }

        return false;
    }

    /**
     * Save Kodi-style nfo file for the channel into the channel folder
     * @returns {boolean} True if the nfo file was saved
     */
    public saveKodiNfo(): boolean {
        if (!this.channel_data) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.kodi",
                `Cannot save Kodi nfo for ${this.internalName}, channel_data is not set`
            );
            return false;
        }
        if (!Config.getInstance().cfg("create_kodi_nfo")) return false;
        if (!Config.getInstance().cfg("channel_folders")) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.kodi",
                `Not creating nfo for ${this.internalName}, channel_folders is disabled`
            );
            return false;
        }

        const nfoFile = path.join(this.getFolder(), "tvshow.nfo");
        let avatar;

        if (this.channel_data.avatar_cache) {
            const avatarPath = path.join(
                BaseConfigCacheFolder.public_cache_avatars,
                this.channel_data.avatar_cache
            );

            if (fs.existsSync(avatarPath)) {
                fs.copyFileSync(
                    avatarPath,
                    path.join(
                        this.getFolder(),
                        `poster${path.extname(this.channel_data.avatar_cache)}`
                    )
                );
                avatar = `poster${path.extname(
                    this.channel_data.avatar_cache
                )}`;
                log(
                    LOGLEVEL.DEBUG,
                    "tw.channel.kodi",
                    `Copied avatar ${this.channel_data.avatar_cache} to ${avatar}`
                );
            } else {
                log(
                    LOGLEVEL.WARNING,
                    "tw.channel.kodi",
                    `Avatar ${
                        this.channel_data.avatar_cache
                    } not found in cache, not copying to ${this.getFolder()}`,
                    {
                        avatar_cache: this.channel_data.avatar_cache,
                        public_cache_avatars:
                            BaseConfigCacheFolder.public_cache_avatars,
                        getFolder: this.getFolder(),
                    }
                );
            }
        } else {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.kodi",
                `Avatar not found for ${this.internalName}, it is recommended to refresh the channel data`
            );
        }

        let nfoContent =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
        nfoContent += "<tvshow>\n";
        nfoContent += `<title>${this.channel_data.display_name}</title>\n`;
        nfoContent += `<uniqueid type="twitch>${this.internalId}</uniqueid>\n`;
        if (avatar) nfoContent += `<thumb aspect="poster">${avatar}</thumb>\n`;
        // nfo_content += `<thumb aspect="fanart">${this.channel_data.profile_banner_url}</thumb>\n`;
        nfoContent += `<episode>${this.getVods().length}</episode>\n`;
        nfoContent += `<plot>${htmlentities(
            this.channel_data.description
        )}</plot>\n`;
        nfoContent += "<actor>\n";
        nfoContent += `\t<name>${this.channel_data.display_name}</name>\n`;
        nfoContent += "\t<role>Themselves</role>\n";
        nfoContent += "</actor>\n";
        nfoContent += "</tvshow>";

        fs.writeFileSync(nfoFile, nfoContent);

        log(
            LOGLEVEL.INFO,
            "tw.channel.kodi",
            `Wrote nfo file for ${this.internalName} to ${nfoFile}`
        );

        return fs.existsSync(nfoFile);
    }

    public async setupStreamNumber(): Promise<void> {
        // set season
        if (
            !KeyValue.getInstance().has(
                `${this.internalName}.season_identifier`
            )
        ) {
            KeyValue.getInstance().set(
                `${this.internalName}.season_identifier`,
                format(new Date(), Config.SeasonFormat)
            );
            this.current_season = format(new Date(), Config.SeasonFormat);
            log(
                LOGLEVEL.INFO,
                "channel.setupStreamNumber",
                `Setting season for ${this.internalName} to ${this.current_season} as it is not set`
            );
        } else {
            this.current_season = KeyValue.getInstance().get(
                `${this.internalName}.season_identifier`
            ) as string;
        }

        // absolute season numbering, one each month that goes on forever
        if (
            !KeyValue.getInstance().has(
                `${this.internalName}.absolute_season_identifier`
            )
        ) {
            KeyValue.getInstance().setInt(
                `${this.internalName}.absolute_season_identifier`,
                1
            );
            KeyValue.getInstance().setInt(
                `${this.internalName}.absolute_season_month`,
                parseInt(format(new Date(), "M"))
            );
            this.current_absolute_season = 1;
            log(
                LOGLEVEL.INFO,
                "channel.setupStreamNumber",
                `Setting season for ${this.internalName} to ${this.current_season} as it is not set`
            );
        } else {
            this.current_absolute_season = KeyValue.getInstance().getInt(
                `${this.internalName}.absolute_season_identifier`
            );
        }

        if (KeyValue.getInstance().has(`${this.internalName}.stream_number`)) {
            this.current_stream_number = KeyValue.getInstance().getInt(
                `${this.internalName}.stream_number`
            );
        } else {
            this.current_stream_number = 1;
            log(
                LOGLEVEL.INFO,
                "channel.setupStreamNumber",
                `Channel ${this.internalName} has no stream number, setting to 1`
            );
            KeyValue.getInstance().setInt(
                `${this.internalName}.stream_number`,
                1
            );
        }
    }

    public async postLoad(): Promise<void> {
        await this.parseVODs();
        await this.setupStreamNumber();
        if (!KeyValue.getInstance().has(`${this.internalName}.saves_vods`)) {
            await this.checkIfChannelSavesVods();
        }
        this.addAllLocalVideos();
        await this.startWatching();
    }

    /**
     * Rename a channel.
     * Resets all channels and vods.
     *
     * @resets
     * @param new_login
     * @returns
     */
    public async rename(new_login: string): Promise<boolean> {
        log(
            LOGLEVEL.INFO,
            "channel.rename",
            `Renaming channel ${this.internalName} to ${new_login}`
        );

        if (this.internalName === new_login) {
            throw new Error("Cannot rename channel to same name");
        }

        const oldLogin = this.internalName;
        if (!oldLogin) {
            throw new Error("Cannot rename channel without login");
        }

        // update config
        const channelConfigIndex =
            LiveStreamDVR.getInstance().channels_config.findIndex(
                (c) => c.provider == "twitch" && c.uuid === this.uuid
            );
        if (channelConfigIndex !== -1) {
            const c = LiveStreamDVR.getInstance().channels_config[
                channelConfigIndex
            ] as TwitchChannelConfig;
            c.login = new_login;
            c.internalName = new_login;
            LiveStreamDVR.getInstance().saveChannelsConfig();
        } else {
            throw new Error(`Could not find channel config for ${oldLogin}`);
        }

        // rename vods
        for (const vod of this.getVods()) {
            await vod.changeBaseName(vod.basename.replace(oldLogin, new_login));
        }

        // rename channel folder
        const oldChannelFolder = Helper.vodFolder(oldLogin);
        const newChannelFolder = Helper.vodFolder(new_login);
        if (fs.existsSync(oldChannelFolder)) {
            fs.renameSync(oldChannelFolder, newChannelFolder);
        }

        await Config.resetChannels();

        const newChannel = TwitchChannel.getChannelByLogin(new_login);
        if (!newChannel) {
            throw new Error("Failed to get new channel.");
        }

        await newChannel.refreshData(); // refresh data for new login

        return true;
    }

    public async isLiveApi(): Promise<boolean> {
        if (!this.internalId) return false;
        const streams = await this.getStreams();
        log(
            LOGLEVEL.DEBUG,
            "tw.channel.isLiveApi",
            `Checking if channel ${this.internalName} is live: ${
                streams ? streams.length : 0
            } streams found`
        );
        return streams && streams.length > 0;
    }

    public async checkIfChannelSavesVods(): Promise<boolean> {
        if (!this.internalId) return false;
        log(
            LOGLEVEL.DEBUG,
            "tw.channel.checkIfChannelSavesVods",
            `Checking if channel ${this.internalName} saves vods`
        );
        const videos = await TwitchVOD.getLatestVideos(this.internalId);
        const state = videos && videos.length > 0;
        KeyValue.getInstance().setBool(
            `${this.internalName}.saves_vods`,
            state
        );
        if (state) {
            log(
                LOGLEVEL.SUCCESS,
                "tw.channel.checkIfChannelSavesVods",
                `Channel ${this.internalName} saves vods`
            );
        } else {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.checkIfChannelSavesVods",
                `Channel ${this.internalName} does not save vods`
            );
        }
        return state;
    }

    public async downloadLatestVod(quality: VideoQuality): Promise<string> {
        if (!this.internalId) {
            throw new Error("Cannot download latest vod without userid");
        }

        const vods = await TwitchVOD.getLatestVideos(this.internalId);

        if (!vods || vods.length === 0) {
            throw new Error("No vods found");
        }

        const latestVodData = vods[0];
        const now = new Date();
        const latestVodDate = new Date(latestVodData.created_at);
        const latestVodDuration = parseTwitchDuration(latestVodData.duration);
        const latestVodDateTotal = new Date(
            latestVodDate.getTime() + latestVodDuration * 1000
        );
        const latestVodDateDiff = Math.abs(
            now.getTime() - latestVodDateTotal.getTime()
        );
        const latestVodId = latestVodData.id;

        // check locally captured vods for a base vod object to use instead of downloading a new one
        const localVod = this.getVods().find(
            (v) =>
                v.external_vod_id === latestVodData.id ||
                (v.created_at?.getTime() &&
                    now.getTime() - v.created_at?.getTime() < latestVodDateDiff)
        );
        if (localVod) {
            await localVod.downloadVod(quality);
            return localVod.path_downloaded_vod;
        }

        if (latestVodDateDiff > 1000 * 60 * 15) {
            throw new Error(
                `Latest vod is older than 15 minutes (${Math.floor(
                    latestVodDateDiff / 1000 / 60
                )} minutes, ${latestVodDateTotal.toISOString()})`
            );
        }

        const channelBasepath = this.getFolder();
        let basepath = "";

        // fetch supplementary data
        let videoGqlData;
        try {
            videoGqlData = await TwitchVOD.getGqlVideoInfo(latestVodId);
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "route.channels.download",
                `Failed to fetch video data: ${(error as Error).message}`
            );
        }

        let gameName = "";
        let gameId = "";

        if (videoGqlData) {
            gameName = videoGqlData.game.displayName;
            gameId = videoGqlData.game.id;
        }

        const streamNumberInfo = this.incrementStreamNumber();
        // this.vod_season = s.season;
        // this.vod_absolute_season = s.absolute_season;
        // this.vod_episode = s.stream_number;
        // this.vod_absolute_episode = s.absolute_stream_number;

        // const basename = `${this.login}_${latestVodData.created_at.replaceAll(":", "-")}_${latestVodData.stream_id}`;

        if (Config.getInstance().cfg<boolean>("vod_folders")) {
            const vodFolderTemplateVariables: VodBasenameTemplate = {
                login: this.internalName,
                internalName: this.internalName,
                displayName: this.displayName,
                date: latestVodData.created_at.replaceAll(":", "_"),
                year: isValid(latestVodDate)
                    ? format(latestVodDate, "yyyy")
                    : "",
                year_short: isValid(latestVodDate)
                    ? format(latestVodDate, "yy")
                    : "",
                month: isValid(latestVodDate)
                    ? format(latestVodDate, "MM")
                    : "",
                day: isValid(latestVodDate) ? format(latestVodDate, "dd") : "",
                hour: isValid(latestVodDate) ? format(latestVodDate, "HH") : "",
                minute: isValid(latestVodDate)
                    ? format(latestVodDate, "mm")
                    : "",
                second: isValid(latestVodDate)
                    ? format(latestVodDate, "ss")
                    : "",
                id: latestVodId.toString(),
                // season: this.vod_season || "",
                // absolute_season: this.vod_absolute_season ? this.vod_absolute_season.toString().padStart(2, "0") : "",
                // episode: this.vod_episode ? this.vod_episode.toString().padStart(2, "0") : "",
                // absolute_episode: this.vod_absolute_episode ? this.vod_absolute_episode.toString().padStart(2, "0") : "",

                // TODO: add season and episode
                season: streamNumberInfo.season,
                absolute_season: streamNumberInfo.absolute_season.toString(),
                episode: streamNumberInfo.stream_number.toString(),
                absolute_episode:
                    streamNumberInfo.absolute_stream_number.toString(),
                title: latestVodData.title,
                game_name: gameName,
                game_id: gameId,
            };

            const vodFolderBase = sanitize(
                formatString(
                    Config.getInstance().cfg("filename_vod_folder"),
                    vodFolderTemplateVariables
                )
            );

            basepath = sanitizePath(path.join(channelBasepath, vodFolderBase));
        } else {
            basepath = channelBasepath;
        }

        if (!fs.existsSync(basepath)) {
            fs.mkdirSync(basepath, { recursive: true });
        }

        const vodFilenameTemplateVariables: VodBasenameTemplate = {
            login: this.internalName,
            internalName: this.internalName,
            displayName: this.displayName,
            date: latestVodData.created_at.replaceAll(":", "_"),
            year: isValid(latestVodDate) ? format(latestVodDate, "yyyy") : "",
            year_short: isValid(latestVodDate)
                ? format(latestVodDate, "yy")
                : "",
            month: isValid(latestVodDate) ? format(latestVodDate, "MM") : "",
            day: isValid(latestVodDate) ? format(latestVodDate, "dd") : "",
            hour: isValid(latestVodDate) ? format(latestVodDate, "HH") : "",
            minute: isValid(latestVodDate) ? format(latestVodDate, "mm") : "",
            second: isValid(latestVodDate) ? format(latestVodDate, "ss") : "",
            id: latestVodId.toString(),
            // season: this.vod_season || "",
            // absolute_season: this.vod_absolute_season ? this.vod_absolute_season.toString().padStart(2, "0") : "",
            // episode: this.vod_episode ? this.vod_episode.toString().padStart(2, "0") : "",
            // absolute_episode: this.vod_absolute_episode ? this.vod_absolute_episode.toString().padStart(2, "0") : "",

            // TODO: add season and episode
            season: streamNumberInfo.season,
            absolute_season: streamNumberInfo.absolute_season.toString(),
            episode: streamNumberInfo.stream_number.toString(),
            absolute_episode:
                streamNumberInfo.absolute_stream_number.toString(),
            title: latestVodData.title,
            game_name: gameName,
            game_id: gameId,
        };

        const vodFilenameBase = sanitize(
            formatString(
                Config.getInstance().cfg("filename_vod"),
                vodFilenameTemplateVariables
            )
        );

        const basename = `${vodFilenameBase}`;

        const videoFilePath = path.join(
            basepath,
            `${basename}.${Config.getInstance().cfg("vod_container", "mp4")}`
        );

        let success;

        try {
            success = await TwitchVOD.downloadVideo(
                latestVodData.id,
                quality,
                videoFilePath
            );
        } catch (e) {
            throw new Error(`Failed to download vod: ${(e as Error).message}`);
        }

        if (!success) {
            throw new Error("Failed to download vod");
        }

        const vod = await this.createVOD(
            path.join(basepath, `${basename}.json`),
            latestVodData.stream_id || latestVodData.id
        );
        vod.started_at = parseJSON(latestVodData.created_at);

        const duration = parseTwitchDuration(latestVodData.duration);
        vod.ended_at = new Date(vod.started_at.getTime() + duration * 1000);
        await vod.saveJSON("manual creation");

        await vod.addSegment(path.basename(videoFilePath));

        // fetch supplementary chapter data
        let chapterData;

        try {
            chapterData = await TwitchVOD.getGqlVideoChapters(latestVodId);
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "route.channels.download",
                `Failed to fetch chapter data: ${(error as Error).message}`
            );
        }

        if (chapterData && chapterData.length > 0) {
            const chapters: TwitchVODChapterJSON[] = [];
            for (const c of chapterData) {
                if (!vod.started_at) continue;
                const startTime = addSeconds(
                    vod.started_at,
                    c.positionMilliseconds / 1000
                );
                chapters.push({
                    title: c.description,
                    game_id: c.details.game.id,
                    game_name: c.details.game.displayName,
                    started_at: startTime.toJSON(),
                    is_mature: false,
                    online: true,
                });
            }

            await vod.parseChapters(chapters);
        } else if (videoGqlData) {
            const chapters: TwitchVODChapterJSON[] = [];
            chapters.push({
                title: videoGqlData.title,
                game_id: videoGqlData.game.id,
                game_name: videoGqlData.game.displayName,
                started_at: vod.started_at.toJSON(),
                is_mature: false,
                online: true,
            });

            await vod.parseChapters(chapters);
        }

        await vod.finalize();
        await vod.saveJSON("manual finalize");

        Webhook.dispatchAll("end_download", {
            vod: await vod.toAPI(),
        });

        return videoFilePath;
    }

    /**
     * Get videos (shortcut for TwitchVOD.getVideos)
     */
    public async getVideos() {
        if (!this.internalId) return false;
        return await TwitchVOD.getLatestVideos(this.internalId);
    }

    /**
     * Get clips (shortcut for TwitchVOD.getClips)
     */
    public async getClips(max_age?: number, limit?: number) {
        if (!this.internalId) return false;
        return await TwitchVOD.getClips(
            { broadcaster_id: this.internalId },
            max_age,
            limit
        );
    }

    public async matchAllProviderVods(force = false): Promise<void> {
        const channelVideos = await TwitchVOD.getLatestVideos(this.internalId);

        if (!channelVideos) {
            throw new Error("No videos returned from streamer");
        }

        for (const vod of this.getVods()) {
            if (vod.external_vod_id && !force) {
                // throw new Error("VOD already has a provider VOD ID");
                log(
                    LOGLEVEL.WARNING,
                    "channel.matchProviderVod",
                    `VOD ${vod.basename} already has a provider VOD ID`
                );
                continue;
            }

            if (vod.is_capturing || vod.is_converting) {
                // throw new Error("VOD is still capturing or converting");
                log(
                    LOGLEVEL.ERROR,
                    "channel.matchProviderVod",
                    `VOD ${vod.basename} is still capturing or converting`
                );
                continue;
            }

            if (!vod.started_at) {
                // throw new Error("VOD has no start time");
                log(
                    LOGLEVEL.ERROR,
                    "channel.matchProviderVod",
                    `VOD ${vod.basename} has no start time`
                );
                continue;
            }

            log(
                LOGLEVEL.INFO,
                "channel.matchProviderVod",
                `Trying to match ${vod.basename} to provider...`
            );

            let found = false;
            for (const video of channelVideos) {
                const videoTime = parseJSON(video.created_at);
                if (!videoTime) continue;

                const startOffset = Math.abs(
                    vod.started_at.getTime() - videoTime.getTime()
                );
                const matchingCaptureId =
                    video.stream_id &&
                    vod.capture_id &&
                    video.stream_id == vod.capture_id;
                const maxOffset = 1000 * 60 * 5; // 5 minutes

                const videoDuration = parseTwitchDuration(video.duration);

                if (
                    startOffset < maxOffset || // 5 minutes
                    matchingCaptureId
                ) {
                    log(
                        LOGLEVEL.SUCCESS,
                        "channel.matchProviderVod",
                        `Found matching VOD for ${
                            vod.basename
                        } (${vod.started_at.toISOString()}): ${video.id} (${
                            video.title
                        })`
                    );

                    vod.setProviderVod(video);
                    vod.external_vod_exists = true;

                    vod.broadcastUpdate();

                    found = true;
                    break;
                }
            }

            if (found) {
                await vod.saveJSON("matchProviderVod: found");
                continue;
            }

            vod.twitch_vod_attempted = true;
            vod.twitch_vod_neversaved = true;
            vod.external_vod_exists = false;

            log(
                LOGLEVEL.ERROR,
                "vod.matchProviderVod",
                `No matching VOD for ${vod.basename}`
            );

            await vod.saveJSON("matchProviderVod: not found");

            vod.broadcastUpdate();

            // throw new Error(`No matching VOD from ${channel_videos.length} videos`);
        }
    }

    /**
     * @test disable
     * @returns
     */
    public async startWatching(): Promise<boolean> {
        if (this.fileWatcher) await this.stopWatching();

        // no blocks in testing
        // if (process.env.NODE_ENV === "test") return;

        if (!Config.getInstance().cfg("channel_folders")) {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.startWatching",
                `Channel folders are disabled, not watching channel ${this.internalName}`
            );
            return false; // don't watch if no channel folders are enabled
        }

        if (Config.getInstance().cfg("storage.no_watch_files", false)) {
            log(
                LOGLEVEL.DEBUG,
                "tw.channel.startWatching",
                `Not watching files for ${this.internalName} due to setting being enabled`
            );
            return false;
        }

        const folders = [Helper.vodFolder(this.internalName)];

        // if (this.login && fs.existsSync(path.join(BaseConfigDataFolder.saved_clips, "scheduler", this.login)))
        //     folders.push(path.join(BaseConfigDataFolder.saved_clips, "scheduler", this.login));

        // if (this.login && fs.existsSync(path.join(BaseConfigDataFolder.saved_clips, "downloader", this.login)))
        //     folders.push(path.join(BaseConfigDataFolder.saved_clips, "downloader", this.login));

        console.log(`Watching channel ${this.internalName} folders...`);

        this.fileWatcher = chokidar
            .watch(folders, {
                ignoreInitial: true,
            })
            .on("all", (eventType, filename) => {
                if (eventType === "add") {
                    if (Config.getInstance().cfg("localvideos.enabled")) {
                        const allVodFiles = this.getVods()
                            .map((v) =>
                                v.associatedFiles.map((f) => path.basename(f))
                            )
                            .flat();

                        if (allVodFiles.includes(filename)) {
                            return; // skip actual vods
                        }

                        if (!filename.endsWith(".mp4")) return;

                        if (eventType === "add") {
                            void this.addLocalVideo(path.basename(filename));
                        }
                    }
                } else if (eventType === "unlink") {
                    this.video_list = this.video_list.filter(
                        (v) => v.basename !== path.basename(filename)
                    );
                    this.sortLocalVideos();
                    this.broadcastUpdate();
                }
            });

        return true;
    }

    public addAllLocalVideos() {
        if (!Config.getInstance().cfg("channel_folders")) return; // don't watch if no channel folders are enabled
        if (!Config.getInstance().cfg("localvideos.enabled")) return;
        const folder = this.getFolder();
        const files = fs.readdirSync(folder);
        const allVodFiles = this.getVods()
            .map((v) => v.associatedFiles.map((f) => path.basename(f)))
            .flat();
        for (const file of files) {
            if (!file.endsWith(".mp4")) continue;
            if (allVodFiles.includes(path.basename(file))) continue;
            // console.debug(`Adding local video ${file} for channel ${this.internalName}`);
            void this.addLocalVideo(path.basename(file));
        }
        // console.log(`Added ${this.video_list.length} local videos to ${this.internalName}`);
        log(
            LOGLEVEL.INFO,
            "tw.channel.addAllLocalVideos",
            `Added ${this.video_list.length} local videos to ${this.internalName}`
        );
    }

    public async subscribe(force = false): Promise<boolean> {
        if (Config.getInstance().cfg("twitchapi.eventsub_type") === "webhook") {
            return await TwitchChannel.subscribeToIdWithWebhook(
                this.internalId,
                force
            );
        } else {
            return await TwitchChannel.subscribeToIdWithWebsocket(
                this.internalId,
                force
            );
        }
    }

    /**
     * @test disable
     * @param channel_id
     * @param force
     * @throws
     */

    public async unsubscribe(): Promise<boolean> {
        // if (Config.getInstance().cfg("app_url") === "debug") {
        //     return false;
        // }
        // return await TwitchChannel.unsubscribeFromIdWithWebhook(this.internalId);
        if (Config.getInstance().cfg("twitchapi.eventsub_type") === "webhook") {
            return await TwitchChannel.unsubscribeFromIdWithWebhook(
                this.internalId
            );
        } else {
            return await TwitchChannel.unsubscribeFromIdWithWebsocket(
                this.internalId
            );
        }
    }

    /**
     * Retrieves the list of Twitch VODs for the channel.
     */
    public getVods(): TwitchVOD[] {
        return this.vods_list;
    }

    public getVodByIndex(index: number): TwitchVOD | undefined {
        if (index < 0 || index >= this.getVods().length) {
            return undefined;
        }
        return this.getVods().at(index);
    }

    public addVod(vod: TwitchVOD): void {
        // don't add vods that are already in the list
        if (this.getVods().includes(vod)) {
            throw new Error("VOD already exists (instance)");
        }

        // don't add vods that have the same basename
        if (this.getVods().find((v) => v.basename === vod.basename)) {
            throw new Error(`VOD already exists (basename=${vod.basename})`);
        }

        // don't add vods that have the same capture id
        if (
            this.getVods().find(
                (v) =>
                    v.capture_id &&
                    vod.capture_id &&
                    v.capture_id === vod.capture_id
            )
        ) {
            // throw new Error(
            // `VOD already exists (capture_id=${vod.capture_id})`
            // );
            log(
                LOGLEVEL.WARNING,
                "tw.channel.addVod",
                `VOD already exists (capture_id=${vod.capture_id})`
            );
        }

        // don't add vods that have the same uuid
        if (this.getVods().find((v) => v.uuid === vod.uuid))
            throw new Error(`VOD already exists (uuid=${vod.uuid})`);

        this.vods_list.push(vod);
    }

    private async addLocalVideo(basename: string): Promise<boolean> {
        const filename = path.join(this.getFolder(), basename);

        let videoMetadata: VideoMetadata | AudioMetadata;

        try {
            videoMetadata = await videometadata(filename);
        } catch (th) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.addLocalVideo",
                `Trying to get mediainfo of ${filename} returned: ${
                    (th as Error).message
                }`
            );
            return false;
        }

        if (!videoMetadata || videoMetadata.type !== "video") {
            log(
                LOGLEVEL.WARNING,
                "tw.channel.addLocalVideo",
                `${filename} is not a local video, not adding`
            );
            return false;
        }

        let thumbnail;
        try {
            thumbnail = await videoThumbnail(filename, 240);
        } catch (error) {
            log(
                LOGLEVEL.ERROR,
                "tw.channel.addLocalVideo",
                `Failed to generate thumbnail for ${filename}: ${
                    (error as Error).message
                }`
            );
        }

        const videoEntry: LocalVideo = {
            basename: basename,
            extension: path.extname(filename).substring(1),
            channel: this.internalName,
            duration: videoMetadata.duration,
            size: videoMetadata.size,
            video_metadata: videoMetadata,
            thumbnail: thumbnail ? path.basename(thumbnail) : undefined,
        };

        this.video_list.push(videoEntry);

        this.sortLocalVideos();

        this.broadcastUpdate();

        return true;
    }

    private sortLocalVideos() {
        this.video_list.sort((a, b) => {
            return a.basename.localeCompare(b.basename);
        });
    }
}
