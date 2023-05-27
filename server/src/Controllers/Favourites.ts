import express from "express";
import { ApiFavouriteGamesResponse } from "@common/Api/Api";
import { TwitchGame } from "../Core/Providers/Twitch/TwitchGame";
import {  Log } from "../Core/Log";

export function ListFavourites(req: express.Request, res: express.Response): void {
    res.send({
        status: "OK",
        data: TwitchGame.favourite_games,
    } as ApiFavouriteGamesResponse);
}

export function SaveFavourites(req: express.Request, res: express.Response): void {

    const formdata: {
        games: string[];
    } = req.body;

    TwitchGame.favourite_games = formdata.games;

    TwitchGame.saveFavouriteGames();

    Log.logAdvanced(Log.Level.INFO, "route.favourites.save", `Saved ${TwitchGame.favourite_games.length} favourite games.`);

    res.send({
        status: "OK",
        message: `Saved ${TwitchGame.favourite_games.length} favourite games.`,
    });

}

export function AddFavourite(req: express.Request, res: express.Response): void {

    const formdata: {
        game: string
    } = req.body;

    TwitchGame.favourite_games.push(formdata.game);

    TwitchGame.saveFavouriteGames();

    Log.logAdvanced(Log.Level.INFO, "route.favourites.add", `Added ${formdata.game} to favourites.`);

    res.send({
        status: "OK",
        message: `Added ${formdata.game} to favourites.`,
    });

}