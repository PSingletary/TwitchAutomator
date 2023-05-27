import fs from "node:fs";
import { TwitchHelper } from "../../../Providers/Twitch";
import { BaseConfigCacheFolder, BaseConfigPath } from "../../BaseConfig";
import {  Log } from "../../Log";
import { ApiGame } from "@common/Api/Client";
import { GamesResponse } from "@common/TwitchAPI/Games";
import axios from "axios";
import path from "node:path";
import { Helper } from "../../../Core/Helper";
import { Config } from "../../../Core/Config";

interface TwitchGameJSON {
    name: string;
    box_art_url: string;
    added: string;
    deleted?: boolean;
}

export class TwitchGame {

    static game_db: Record<string, TwitchGame> = {};
    static favourite_games: string[] = [];

    public id!: string;
    public name!: string;
    public box_art_url!: string;
    public added!: Date;

    public deleted = false;

    public static populateGameDatabase(): void {
        if (!fs.existsSync(BaseConfigPath.gameDb)) return;
        Log.logAdvanced(Log.Level.INFO, "game", "Populating game database...");
        this.game_db = {};
        const raw_games: Record<string, TwitchGameJSON> = JSON.parse(fs.readFileSync(BaseConfigPath.gameDb, "utf8"));
        for (const id in raw_games) {
            const raw_game = raw_games[id];
            const game = new this();
            game.id = id;
            game.name = raw_game.name;
            game.box_art_url = raw_game.box_art_url;
            game.added = new Date(raw_game.added);
            if (raw_game.deleted) game.deleted = raw_game.deleted;
            this.game_db[id] = game;
        }
        Log.logAdvanced(Log.Level.INFO, "game", `Game database populated with ${Object.keys(this.game_db).length} games.`);
    }

    public static populateFavouriteGames(): void {
        if (!fs.existsSync(BaseConfigPath.favouriteGames)) {
            Log.logAdvanced(Log.Level.INFO, "game", "Favourite games file not found, creating...");
            fs.writeFileSync(BaseConfigPath.favouriteGames, "[]");
        }
        Log.logAdvanced(Log.Level.INFO, "game", "Populating favourite games...");
        this.favourite_games = JSON.parse(fs.readFileSync(BaseConfigPath.favouriteGames, "utf8"));
        Log.logAdvanced(Log.Level.INFO, "game", `Favourite games populated with ${this.favourite_games.length} games.`);
    }

    /**
     * Get game data from cache. **Does not fetch from server.**
     * @param game_id 
     * @returns 
     */
    public static getGameFromCache(game_id: string): TwitchGame | null {
        if (!this.game_db) {
            throw new Error("Game database not initialized!");
        }
        if (!this.game_db[game_id]) {
            Log.logAdvanced(Log.Level.WARNING, "game", `Game id ${game_id} not in cache.`);
            return null;
        }

        return this.game_db[game_id];
    }

    public static async getGameAsync(game_id: string, force = false): Promise<TwitchGame | null> {

        if (!game_id) {
            Log.logAdvanced(Log.Level.ERROR, "game", "No game id supplied for game fetch!");
            return null;
        }

        const cachedGame = this.getGameFromCache(game_id);

        if (cachedGame && !force) {
            if (cachedGame && cachedGame.added && Date.now() > cachedGame.added.getTime() + (60 * 60 * 24 * 60 * 1000)) { // two months?
                Log.logAdvanced(Log.Level.INFO, "game", `Game id ${game_id} (${cachedGame.name}) needs refreshing (${cachedGame.added.toISOString()}).`);
            } else if (cachedGame && cachedGame.added) { // check if date is set
                return this.game_db[game_id];
            } else {
                Log.logAdvanced(Log.Level.INFO, "game", `Game id ${game_id} needs refreshing (no date set).`);
            }
            if (cachedGame.deleted) {
                Log.logAdvanced(Log.Level.INFO, "game", `Game id ${game_id} is marked as deleted, return cached game.`);
                return this.game_db[game_id];
            }
        }

        Log.logAdvanced(Log.Level.DEBUG, "game", `Game id ${game_id} not in cache, fetching...`);

        if (!TwitchHelper.axios) {
            throw new Error("Axios is not initialized");
        }

        let response;
        try {
            response = await TwitchHelper.getRequest<GamesResponse>(`/helix/games?id=${game_id}`);
        } catch (th) {
            Log.logAdvanced(Log.Level.FATAL, "game", `Tried to get game data for ${game_id} but server returned: ${th}`);
            return null;
        }

        const json = response.data;

        const game_data = json.data[0];

        if (game_data) {

            /*
            const game = {
                "id": game_id,
                "name": game_data.name,
                "box_art_url": game_data.box_art_url,
                "added": Date.now(),
            } as TwitchGame;

            this.game_db[game_id] = game;
            */
            const game = new this();
            game.id = game_id;
            game.name = game_data.name;
            game.box_art_url = game_data.box_art_url;
            game.added = new Date();

            try {
                await game.fetchBoxArt();
            } catch (error) {
                Log.logAdvanced(Log.Level.ERROR, "game", `Failed to fetch box art for game ${game_id}: ${error}`);
            }
            
            game.save();

            // $game_db[ $id ] = $game_data["name"];

            Log.logAdvanced(Log.Level.SUCCESS, "game", `New game saved to cache: ${game.name}`);

            return game;

        } else {

            Log.logAdvanced(Log.Level.ERROR, "game", `Invalid game returned in query for ${game_id}`, json);

            if (cachedGame) {
                Log.logAdvanced(Log.Level.INFO, "game", `Cached game ${cachedGame.name} must have been deleted, marking as deleted.`);
                cachedGame.deleted = true;
                cachedGame.save();
            }

            return null;
        }
    }

    /**
     * Get favourite games in a string array.
     * 
     * @returns {string[]} Favourite games
     */
    public static getFavouriteGames(): string[] {
        return this.favourite_games;
    }

    /**
     * Save game data to cache.
     */
    public save(): void {

        if (!this.id) {
            throw new Error("Cannot save game without id!");
        }

        TwitchGame.game_db[this.id] = this;

        const json_db: Record<string, TwitchGameJSON> = {};

        for (const id in TwitchGame.game_db) {
            const game = TwitchGame.game_db[id];
            const json_game: TwitchGameJSON = {
                name: game.name || "",
                box_art_url: game.box_art_url || "",
                added: game.added.toISOString(),
                deleted: game.deleted || undefined,
            };
            json_db[id] = json_game;
        }

        fs.writeFileSync(BaseConfigPath.gameDb, JSON.stringify(json_db));

    }

    public fetchBoxArt(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.box_art_url) {
                reject("No box art url set!");
            }
            const url = this.box_art_url.replace("{width}", "140").replace("{height}", "190");
            const file = path.join(BaseConfigCacheFolder.public_cache_covers, `${this.id}.${path.extname(url).substring(1)}`);
            if (fs.existsSync(file)) {
                resolve(file);
            } else {
                const writer = fs.createWriteStream(file);
                writer.on("finish", () => {
                    resolve(file);
                });
                writer.on("error", (err) => {
                    reject(err);
                });
                axios.get(url, { responseType: "stream" }).then((response) => {
                    response.data.pipe(writer);
                }).catch((err) => {
                    reject(err);
                });
            }
        });
    }

    /**
     * Make box art url from dimensions.
     * 
     * @param width 
     * @param height 
     * @returns string URL
     */
    public getBoxArtUrl(width = 140, height = 190): string {
        if (!this.box_art_url) {
            return "";
        }
        if (fs.existsSync(path.join(BaseConfigCacheFolder.public_cache_covers, `${this.id}.${path.extname(this.box_art_url).substring(1)}`))) {
            // console.debug("Using cached box art", this.box_art_url);
            const app_url = Config.getInstance().cfg<string>("app_url", "");
            if (app_url && app_url !== "debug") {
                return `${app_url}/cache/covers/${this.id}.${path.extname(this.box_art_url).substring(1)}`;
            } else {
                return `${Config.getInstance().cfg<string>("basepath", "")}/cache/covers/${this.id}.${path.extname(this.box_art_url).substring(1)}`;
            }
        } else {
            this.fetchBoxArt(); // for next time
        }
        return this.box_art_url.replace("{width}", width.toString()).replace("{height}", height.toString()); // does {width} have a % next to it?
    }

    public async getThumbnailUrl(): Promise<string> {

        if (!this.id) {
            throw new Error("Cannot get thumbnail url without id!");
        }

        const file = path.join(BaseConfigCacheFolder.public_cache_covers, `${this.id}.${path.extname(this.box_art_url).substring(1)}`);

        if (fs.existsSync(file)) {
            return await Helper.imageThumbnail(file, 64);
        }

        throw new Error("Thumbnail not found!");

    }

    public isFavourite(): boolean {
        if (!this.id) return false;
        return TwitchGame.getFavouriteGames().includes(this.id);
    }

    /**
     * Set game as favourite and save the database.
     * 
     * @param fav 
     */
    public setFavourite(fav: boolean): void {
        if (!this.id) return;
        if (fav) {
            if (!TwitchGame.favourite_games.includes(this.id)) {
                TwitchGame.favourite_games.push(this.id);
            }
        } else {
            const index = TwitchGame.favourite_games.indexOf(this.id);
            if (index > -1) {
                TwitchGame.favourite_games.splice(index, 1);
            }
        }
        TwitchGame.saveFavouriteGames();
    }

    public static saveFavouriteGames(): void {
        Log.logAdvanced(Log.Level.INFO, "game", "Saving favourite games...");
        fs.writeFileSync(BaseConfigPath.favouriteGames, JSON.stringify(TwitchGame.favourite_games));
    }

    public toAPI(): ApiGame {
        return {
            id: this.id || "",
            name: this.name || "",
            game_name: this.name || "",
            box_art_url: this.box_art_url || "",
            favourite: this.isFavourite(),
            image_url: this.getBoxArtUrl(140, 190),
            added: this.added.toISOString(),
            deleted: this.deleted || undefined,
        };
    }

}