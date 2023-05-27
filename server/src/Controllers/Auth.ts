import { Config } from "../Core/Config";
import express from "express";
import { ApiLoginResponse, ApiAuthResponse } from "@common/Api/Api";
export function Login(req: express.Request, res: express.Response): void {

    const password = Config.getInstance().cfg<string>("password");
    const client_password = req.body.password;

    if (req.session.authenticated) {
        res.status(400).send({
            authenticated: true,
            message: "Already authenticated",
            status: "ERROR",
        } as ApiLoginResponse);
        return;
    }

    if (!password) {
        res.status(400).send({
            authenticated: false,
            message: "No password set",
            status: "ERROR",
        } as ApiLoginResponse);
        return;
    }

    if (client_password == password) {
        req.session.regenerate((err) => {
            if (err) {
                console.error(err);
                res.status(500).send("Internal server error");
                return;
            }

            req.session.cookie.expires = new Date(Date.now() + (1000 * 60 * 60 * 24 * 7)); // 7 days

            req.session.authenticated = true;

            req.session.save((err) => {
                if (err) {
                    console.error(err);
                    res.status(500).send("Internal server error");
                    return;
                }

                res.send({
                    "authenticated": true,
                    "message": "Login successful",
                    "status": "OK",
                } as ApiLoginResponse);
            });
        });
    } else {
        res.send({
            "authenticated": false,
            "message": "Login failed",
            "status": "ERROR",
        } as ApiLoginResponse);
    }
}

export function Logout(req: express.Request, res: express.Response): void {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            res.status(500).send("Internal server error");
            return;
        }
        res.send({
            "authenticated": false,
            "message": "Logout successful",
            "status": "OK",
        } as ApiLoginResponse);
    });
}

export function CheckLogin(req: express.Request, res: express.Response): void {
    if (!Config.getInstance().cfg<boolean>("password")) {
        res.status(200).send({
            "authentication": false,
            "authenticated": false,
            "message": "No password protection",
        } as ApiAuthResponse);
    } else if (req.session.authenticated) {
        res.status(200).send({
            "authentication": true,
            "authenticated": true,
            "guest_mode": Config.getInstance().cfg<boolean>("guest_mode", false),
            "message": "You are logged in",
            "status": "OK",
        } as ApiAuthResponse);
    } else {
        res.status(401).send({
            "authentication": true,
            "authenticated": false,
            "guest_mode": Config.getInstance().cfg<boolean>("guest_mode", false),
            "message": "You are not logged in",
            "status": "ERROR",
        } as ApiAuthResponse);
    }
}