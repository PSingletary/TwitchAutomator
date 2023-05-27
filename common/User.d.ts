import { User } from "./TwitchAPI/Users";

export interface UserData extends User {
    _updated: number;
    cache_avatar: string;
    cache_offline_image: string;
}