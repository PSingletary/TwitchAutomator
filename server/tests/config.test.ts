import { Config } from "../src/Core/Config";
import "./environment";

describe("Config", () => {
    it("external url validation", () => {
        expect(() =>
            Config.validateExternalURLRules("http://example.com")
        ).toThrow();
        expect(() =>
            Config.validateExternalURLRules("http://example.com:1234")
        ).toThrow();
        expect(() =>
            Config.validateExternalURLRules("http://example.com:80")
        ).toThrow();
        expect(Config.validateExternalURLRules("https://example.com:443")).toBe(
            true
        );
        expect(Config.validateExternalURLRules("https://example.com")).toBe(
            true
        );
        expect(Config.validateExternalURLRules("https://sub.example.com")).toBe(
            true
        );
        expect(() =>
            Config.validateExternalURLRules("https://sub.example.com/folder/")
        ).toThrow();
        expect(
            Config.validateExternalURLRules("https://sub.example.com/folder")
        ).toBe(true);
    });

    it("config value set", () => {
        const config = Config.getCleanInstance();
        config.config = {};
        config.setConfig("app_url", "https://example.com");
        expect(config.cfg("app_url")).toBe("https://example.com");
        expect(config.cfg("app_url1" as any)).toBeUndefined();

        // automatic type casting
        config.setConfig("trust_proxy", "1");
        expect(config.cfg("trust_proxy")).toBe(true);
        config.setConfig("trust_proxy", "0");
        expect(config.cfg("trust_proxy")).toBe(false);
        config.setConfig("server_port", "1234");
        expect(config.cfg("server_port")).toBe(1234);

        // a few values
        config.setConfig("schedule_muted_vods", false);
        expect(config.cfg<boolean>("schedule_muted_vods")).toBe(false);
        config.setConfig("schedule_muted_vods", true);
        expect(config.cfg<boolean>("schedule_muted_vods")).toBe(true);
    });

    it("config value set with default", () => {
        const config = Config.getCleanInstance();
        config.config = {};
        expect(config.cfg("app_url", "https://example.com")).toBe(
            "https://example.com"
        );
        expect(config.cfg("app_url", "")).toBe("");
        expect(config.cfg("app_url")).toBeUndefined();

        expect(config.cfg("file_permissions")).toBe(false);
        expect(config.cfg("file_permissions", true)).toBe(true);

        expect(config.cfg("low_latency")).toBe(undefined);
        expect(config.cfg("low_latency", true)).toBe(true);
        expect(config.cfg("low_latency", false)).toBe(false);
    });

    it("generate config", () => {
        const config = Config.getCleanInstance();

        // const spy = jest.spyOn(config, "saveConfig").mockImplementation((source) => { console.log("save config", source); return true; });

        config.generateConfig();
        expect(config.saveConfig).toHaveBeenCalled();

        expect(config.cfg("server_port")).toBe(8080);
        expect(config.cfg("trust_proxy")).toBe(false);
        expect(config.cfg("channel_folders")).toBe(true);

        // spy.mockRestore();
    });

    it("empty values", () => {
        const config = Config.getCleanInstance();
        config.config = {};
        expect(config.cfg("password")).toBe(undefined);
        expect(config.cfg("password", "")).toBe("");
        config.setConfig("password", "test");
        expect(config.cfg("password")).toBe("test");
        config.setConfig("password", "");
        expect(config.cfg("password")).toBe(undefined);
        expect(config.cfg("password", "")).toBe("");
    });

    it("hasValue", () => {
        const config = Config.getCleanInstance();

        config.config = {};

        expect(config.hasValue("password")).toBe(false);

        // config value is set
        config.setConfig("password", "test");
        expect(config.hasValue("password")).toBe(true);

        // config value is empty string
        config.setConfig("password", "");
        expect(config.hasValue("password")).toBe(false);

        // config value is undefined
        config.setConfig("password", undefined as any);
        expect(config.hasValue("password")).toBe(false);

        // config value is null
        config.setConfig("password", null as any);
        expect(config.hasValue("password")).toBe(false);

        // config value is false
        config.setConfig("trust_proxy", false);
        expect(config.hasValue("trust_proxy")).toBe(false);

        // config value is true
        config.setConfig("trust_proxy", true);
        expect(config.hasValue("trust_proxy")).toBe(true);

        // config value is 0
        config.setConfig("server_port", 0);
        expect(config.hasValue("server_port")).toBe(true);

        // config value is 1
        config.setConfig("server_port", 1);
        expect(config.hasValue("server_port")).toBe(true);

        // env value is set
        config.unsetConfig("password");
        process.env.TCD_PASSWORD = "test";
        expect(config.hasValue("password")).toBe(true);

        // env value is undefined
        process.env.TCD_PASSWORD = "";
        expect(config.hasValue("password")).toBe(false);
    });

    it("choice values", () => {
        const config = Config.getCleanInstance();
        config.config = {};

        // object
        config.setConfig("locale.date-format", "dd-MM-yyyy");
        expect(config.cfg("locale.date-format")).toBe("dd-MM-yyyy");
        expect(() =>
            config.setConfig("locale.date-format", "dd-mm-yyyy")
        ).toThrowError();
        expect(config.cfg("locale.date-format")).toBe("dd-MM-yyyy");

        // array
        config.setConfig("vod_container", "mkv");
        expect(config.cfg("vod_container")).toBe("mkv");
        expect(() => config.setConfig("vod_container", "asdf")).toThrowError();
        expect(config.cfg("vod_container")).toBe("mkv");
    });

    it("number values", () => {
        const config = Config.getCleanInstance();
        config.config = {};

        // number
        config.setConfig("server_port", 1234);
        expect(config.cfg("server_port")).toBe(1234);
        expect(() => config.setConfig("server_port", "asdf")).toThrowError();
        expect(config.cfg("server_port")).toBe(1234);

        // cast to number
        config.setConfig("server_port", "1234");
        expect(config.cfg("server_port")).toBe(1234);
    });

    it("boolean values", () => {
        const config = Config.getCleanInstance();
        config.config = {};

        // boolean
        config.setConfig("trust_proxy", true);
        expect(config.cfg("trust_proxy")).toBe(true);
        expect(() => config.setConfig("trust_proxy", "asdf")).toThrowError();
        expect(config.cfg("trust_proxy")).toBe(true);

        // cast to boolean
        config.setConfig("trust_proxy", "1");
        expect(config.cfg("trust_proxy")).toBe(true);
        config.setConfig("trust_proxy", "0");
        expect(config.cfg("trust_proxy")).toBe(false);
    });

    it("stripslashes", () => {
        const config = Config.getCleanInstance();
        config.config = {};

        // windows
        config.setConfig("bin_dir", "C:\\Program Files\\ffmpeg\\bin\\");
        expect(config.cfg("bin_dir")).toBe("C:\\Program Files\\ffmpeg\\bin");

        // linux
        config.setConfig("bin_dir", "/usr/bin/");
        expect(config.cfg("bin_dir")).toBe("/usr/bin");
    });

    it("setting exists", () => {
        expect(Config.settingExists("app_url")).toBe(true);
        expect(Config.settingExists("app_url1" as any)).toBe(false);
        expect(Config.getSettingField("app_url")).toHaveProperty("text");
        expect(Config.getSettingField("app_url1" as any)).toBeUndefined();
    });
});
