import { Log } from "../src/Core/Log";
import { BaseChannel } from "../src/Core/Providers/Base/BaseChannel";
import { BaseVOD } from "../src/Core/Providers/Base/BaseVOD";
import { TwitchChannel } from "../src/Core/Providers/Twitch/TwitchChannel";
import { TwitchVOD } from "../src/Core/Providers/Twitch/TwitchVOD";
import { YouTubeVOD } from "../src/Core/Providers/YouTube/YouTubeVOD";
import { Config } from "../src/Core/Config";
import { LiveStreamDVR } from "../src/Core/LiveStreamDVR";
import { Scheduler } from "../src/Core/Scheduler";
import { TwitchHelper } from "../src/Providers/Twitch";
import { AppRoot, DataRoot } from "../src/Core/BaseConfig";
import { KeyValue } from "../src/Core/KeyValue";
import { TwitchGame } from "../src/Core/Providers/Twitch/TwitchGame";
import { Job } from "../src/Core/Job";

/*
// dangerous methods that need to be mocked/disabled for tests
Config.prototype.loadConfig
Config.prototype.saveConfig
Config.prototype.startWatchingConfig
Config.checkBuiltDependencies
Config.checkAppRoot
Config.createFolders
KeyValue.prototype.save
KeyValue.prototype.load
LiveStreamDVR.prototype.loadChannelsConfig
LiveStreamDVR.prototype.saveChannelsConfig
LiveStreamDVR.checkVersion
Log.logAdvanced
Scheduler.defaultJobs
BaseChannel.prototype.broadcastUpdate
BaseChannel.prototype.saveVodDatabase
BaseChannel.prototype.findClips
BaseChannel.prototype.makeFolder
BaseVOD.prototype.startWatching
BaseVOD.prototype.broadcastUpdate
TwitchChannel.prototype.startWatching
TwitchChannel.loadChannelsCache
TwitchChannel.getUserDataProxy
TwitchChannel.subscribeToId
TwitchChannel.unsubscribeFromId
TwitchVOD.prototype.startWatching
TwitchVOD.prototype.saveJSON
YouTubeVOD.prototype.saveJSON
TwitchHelper.getAccessToken
TwitchGame.populateFavouriteGames
TwitchGame.populateGameDatabase
Job.loadJobsFromCache
*/

// mock methods
beforeAll(() => {
    jest.spyOn(Config.prototype, "loadConfig").mockImplementation(function(this: Config) {
        this.generateConfig();
        return true;
    });
    jest.spyOn(Config.prototype, "saveConfig").mockImplementation(() => { return true; });
    jest.spyOn(Config.prototype, "startWatchingConfig").mockImplementation(() => { console.debug("Disable start watching config"); return; });
    jest.spyOn(Config, "checkBuiltDependencies").mockImplementation(() => { return; });
    jest.spyOn(Config, "checkAppRoot").mockImplementation(() => { return; });
    jest.spyOn(Config, "createFolders").mockImplementation(() => { return; });
    jest.spyOn(KeyValue.prototype, "save").mockImplementation(() => { return; });
    jest.spyOn(KeyValue.prototype, "load").mockImplementation(() => { return; });
    jest.spyOn(LiveStreamDVR.prototype, "loadChannelsConfig").mockImplementation(() => { return true; });
    jest.spyOn(LiveStreamDVR.prototype, "saveChannelsConfig").mockImplementation(() => { return true; });
    jest.spyOn(LiveStreamDVR.prototype, "startDiskSpaceInterval").mockImplementation(() => { return true; });
    jest.spyOn(LiveStreamDVR, "checkBinaryVersions").mockImplementation(() => { return Promise.resolve(); });
    jest.spyOn(LiveStreamDVR, "checkVersion").mockImplementation(() => { return; });
    jest.spyOn(Log, "logAdvanced").mockImplementation((level, module, text, meta) => {
        console.log(`[TEST][${level}] ${module}: ${text}`);
        return;
    });
    jest.spyOn(Scheduler, "defaultJobs").mockImplementation(() => { return; });
    jest.spyOn(BaseChannel.prototype, "broadcastUpdate").mockImplementation(() => { return; });
    jest.spyOn(BaseChannel.prototype, "saveVodDatabase").mockImplementation(() => { return; });
    jest.spyOn(BaseChannel.prototype, "findClips").mockImplementation(() => { return Promise.resolve(); });
    jest.spyOn(BaseChannel.prototype, "makeFolder").mockImplementation(() => { return; });
    jest.spyOn(BaseVOD.prototype, "startWatching").mockImplementation(() => { console.debug("Disable start watching basevod"); return Promise.resolve(true); });
    jest.spyOn(BaseVOD.prototype, "broadcastUpdate").mockImplementation(() => { return; });
    jest.spyOn(TwitchChannel.prototype, "startWatching").mockImplementation(() => { console.debug("Disable start watching twitchchannel"); return Promise.resolve(); });
    jest.spyOn(TwitchChannel, "loadChannelsCache").mockImplementation(() => { return true; });
    jest.spyOn(TwitchChannel, "getUserDataProxy").mockImplementation(() => { return Promise.resolve(false); });
    jest.spyOn(TwitchVOD.prototype, "startWatching").mockImplementation(() => { console.debug("Disable start watching twitchvod"); return Promise.resolve(true); });
    jest.spyOn(TwitchVOD.prototype, "saveJSON").mockImplementation(() => { return Promise.resolve(true); });
    jest.spyOn(YouTubeVOD.prototype, "saveJSON").mockImplementation(() => { return Promise.resolve(true); });
    jest.spyOn(TwitchChannel, "subscribeToIdWithWebhook").mockImplementation(() => { return Promise.resolve(true); });
    jest.spyOn(TwitchChannel, "unsubscribeFromIdWithWebhook").mockImplementation(() => { return Promise.resolve(true); });
    jest.spyOn(TwitchChannel, "subscribeToIdWithWebsocket").mockImplementation(() => { return Promise.resolve(true); });
    // jest.spyOn(TwitchChannel, "unsubscribeFromIdWithWebsocket").mockImplementation(() => { return Promise.resolve(true); });
    jest.spyOn(TwitchHelper, "getAccessToken").mockImplementation(() => { return Promise.resolve("test"); });
    jest.spyOn(TwitchGame, "populateFavouriteGames").mockImplementation(() => { return Promise.resolve(); });
    jest.spyOn(TwitchGame, "populateGameDatabase").mockImplementation(() => { return Promise.resolve(); });
    jest.spyOn(Job, "loadJobsFromCache").mockImplementation(() => { return; });

    // mock data consts
    // jest.spyOn(AppRoot, "get").mockImplementation(() => { return "test"; });
    // jest.mock("../src/Core/BaseConfig", () => ({
    //     get AppRoot() {
    //         return "
    //     }
    // })
});

beforeEach(() => {
    Config.getInstance().generateConfig();
});

afterEach(() => {
    Config.getInstance().config = {};
});

afterAll(() => {
    jest.restoreAllMocks();
});
