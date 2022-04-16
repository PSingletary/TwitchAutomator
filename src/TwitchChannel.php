<?php

declare(strict_types=1);

namespace App;

use GuzzleHttp\Exception\GuzzleException;

class TwitchChannel
{

    /**
     * Username. Different from $login
     * deprecated 6.0.0
     */
    // public ?string $username = null;

    /**
     * User ID
     */
    public ?string $userid = null;

    /**
     * Login name, used in URLs
     */
    public ?string $login = null;

    /**
     * Display name, used in texts
     */
    public ?string $display_name = null;

    public ?string $description = null;
    public ?string $profile_image_url = null;
    public ?bool $is_live = false;
    public ?bool $is_converting = false;
    public ?TwitchVOD $current_vod = null;
    public ?array $current_game = null;
    public ?int $current_duration = null;

    /**
     * Quality selected from download.
     * audio_only, 160p (worst), 360p, 480p, 720p, 720p60, 1080p60 (best)
     */
    public ?array $quality = [];

    public ?array $match = [];
    public ?bool $download_chat = null;
    public ?bool $no_capture = null;
    public ?bool $burn_chat = null;

    public ?\DateTime $subbed_at = null;
    public ?\DateTime $expires_at = null;
    public ?\DateTime $last_online = null;

    public array $vods_list = [];
    public array $vods_raw = [];
    public int $vods_size = 0;

    public array $channel_data = [];
    public array $config = [];

    public bool $deactivated = false;

    private static function loadAbstract(string $streamer_id, $api = false)
    {

        $channel = new self();

        $channel->userid = $streamer_id;

        /*
        if (!$channel->userid || !is_numeric($channel->userid)) {
            // TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Could not get channel id in channel for {$username}");
            throw new \Exception("Could not get channel id in channel: {$username} => {$channel->userid}");
            return false;
        }
        */

        try {
            $channel_data = self::getChannelDataById($channel->userid);
        } catch (\Throwable $th) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_FATAL, "channel", "Could not get channel data for {$channel->userid} in loadAbstract: {$th->getMessage()}");
            throw new \Exception("Could not get channel data for {$channel->userid} in loadAbstract: {$th->getMessage()}", TwitchConfig::ERROR_CHANNEL_NOT_FOUND);
            return false;
        }


        $channel_login = $channel_data['login'];

        $config = [];
        foreach (TwitchConfig::$channels_config as $channel_config) {
            if ($channel_config['login'] == $channel_data['login']) $config = $channel_config;
        }

        if (!$config) {
            throw new \Exception("Streamer not found in config: {$channel_login}");
            return false;
        }

        if (!isset($channel_data['login'])) {
            throw new \Exception("Streamer data could not be fetched: {$channel_login}");
            return false;
        }

        $channel->channel_data = $channel_data;
        $channel->config       = $config;

        // $channel->userid               = (int)$channel->channel_data['id'];
        // $channel->username             = $channel->channel_data['login'];
        $channel->login                = $channel->channel_data['login'];
        $channel->display_name         = $channel->channel_data['display_name'];
        $channel->description          = $channel->channel_data['description'];
        $channel->profile_image_url    = $channel->channel_data['profile_image_url'];
        $channel->quality              = isset($config['quality']) ? $config['quality'] : "best";
        $channel->match                = isset($config['match']) ? $config['match'] : [];
        $channel->download_chat        = isset($config['download_chat']) ? $config['download_chat'] : false;
        $channel->no_capture           = isset($config['no_capture']) ? $config['no_capture'] : false;
        $channel->burn_chat           = isset($config['burn_chat']) ? $config['burn_chat'] : false;
        // $channel->last_online          = TwitchConfig::getCache("{$channel->login}.last.offline") ? new DateTime(TwitchConfig::getCache("{$channel->login}.last.offline")) : null;

        $subfile = TwitchHelper::$cache_folder . DIRECTORY_SEPARATOR . "subs.json";
        if (file_exists($subfile)) {
            $sub_data = json_decode(file_get_contents($subfile), true);
            if (isset($sub_data[$channel->display_name])) {
                if (isset($sub_data[$channel->display_name]['subbed_at']))
                    $channel->subbed_at = \DateTime::createFromFormat(TwitchHelper::DATE_FORMAT, $sub_data[$channel->display_name]['subbed_at']);

                if (isset($sub_data[$channel->display_name]['expires_at']))
                    $channel->expires_at = \DateTime::createFromFormat(TwitchHelper::DATE_FORMAT, $sub_data[$channel->display_name]['expires_at']);
            }
        }

        if (TwitchConfig::cfg('channel_folders') && !file_exists($channel->getFolder())) {
            // mkdir(TwitchHelper::vodFolder($streamer['username']));
            mkdir($channel->getFolder());
        }

        $channel->parseVODs($api);

        return $channel;
    }

    /**
     * Load channel from login
     * Don't use this, access from TwitchConfig::getChannel() instead
     */
    public static function loadFromId($streamer_id, $api = false)
    {
        if (!$streamer_id) throw new \ValueError("Streamer id is empty");
        return self::loadAbstract($streamer_id, $api); // $channel;
    }

    /**
     * Load channel from login
     * Don't use this, access from TwitchConfig::getChannel() instead
     */
    public static function loadFromLogin(string $login, $api = false)
    {
        if (!$login) throw new \ValueError("Streamer login is empty");
        if (!is_string($login)) throw new \TypeError("Streamer login is not a string");
        $channel_id = self::channelIdFromLogin($login);
        if (!$channel_id) throw new \Exception("Could not get channel id from login: {$login}");
        return self::loadAbstract($channel_id, $api); // $channel;
    }

    public static function channelIdFromLogin(string $login)
    {

        $cd = self::getChannelDataByLogin($login);
        if ($cd) return $cd['id'];

        return false;
    }

    // DRY
    public static function channelLoginFromId(string $streamer_id)
    {

        $cd = self::getChannelDataById($streamer_id);
        if ($cd) return $cd['login'];

        return false;
    }

    // DRY
    /**
     * Get username but actually it's display name
     * @deprecated
     */
    public static function channelUsernameFromId(string $streamer_id)
    {

        $cd = self::getChannelDataById($streamer_id);
        if ($cd) return $cd['display_name'];

        return false;
    }

    public static function channelDisplayNameFromId(string $streamer_id)
    {

        $cd = self::getChannelDataById($streamer_id);
        if ($cd) return $cd['display_name'];

        return false;
    }

    /**
     * Get channel data from remote endpoint
     *
     * @param string $streamer_id
     * @return array|boolean
     * @throws Exception
     */
    public static function getChannelDataById(string $streamer_id, $force = false)
    {

        if (!is_numeric($streamer_id)) {
            throw new \TypeError("Non-numeric passed to getChannelDataById with id ({$streamer_id})");
            return false;
        }

        // first, check cache
        if (file_exists(TwitchConfig::$streamerCachePath)) {

            $json_streamers = json_decode(file_get_contents(TwitchConfig::$streamerCachePath), true);

            if ($json_streamers && isset($json_streamers[$streamer_id])) {

                TwitchHelper::logAdvanced(TwitchHelper::LOG_DEBUG, "helper", "Fetched channel data from cache for {$streamer_id} ({$json_streamers[$streamer_id]['display_name']})");

                // check if too old, continue if true
                if (!isset($json_streamers[$streamer_id]['_updated']) || time() > $json_streamers[$streamer_id]['_updated'] + 2592000) {
                    TwitchHelper::logAdvanced(TwitchHelper::LOG_INFO, "helper", "Channel data in cache for {$streamer_id} is too old, proceed to updating!");
                    if (isset($streamer['_updated']))
                        TwitchHelper::logAdvanced(TwitchHelper::LOG_DEBUG, "helper", "{$streamer_id} age: " . (time() - $streamer['_updated']) . " seconds");
                } else {
                    return $json_streamers[$streamer_id];
                }
            }
        } else {

            $json_streamers = [];
        }

        if ( TwitchConfig::getCache("{$streamer_id}.deleted") == "1" && !$force) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_WARNING, "helper", "Channel {$streamer_id} is deleted, ignore. Delete kv file to force update.");
            return false;
        }

        $access_token = TwitchHelper::getAccessToken();

        if (!$access_token) {
            throw new \Exception('Fatal error, could not get access token for channel id request');
            return false;
        }

        $query = [];
        $query['id'] = $streamer_id;

        // fetch user from endpoint
        try {
            $response = TwitchHelper::$guzzler->request('GET', '/helix/users', [
                'query' => $query
            ]);
        } catch (GuzzleException $th) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_FATAL, "helper", "getChannelDataById for {$streamer_id} errored: " . $th->getMessage());
            // throw new \Exception("Guzzle error when fetching channel data for {$streamer_id}: {$th->getMessage()}");
            throw $th;
            return false;
        }

        $server_output = $response->getBody()->getContents();
        $json = json_decode($server_output, true);

        if (!$json["data"] || $response->getStatusCode() != 200) {
            TwitchConfig::setCache("{$streamer_id}.deleted", "1");
            TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Failed to fetch channel data for {$streamer_id}: {$server_output} ({$response->getStatusCode()}");
            throw new \Exception("Failed to fetch channel data for {$streamer_id}: {$server_output} ({$response->getStatusCode()})", TwitchConfig::ERROR_CHANNEL_NOT_FOUND);
            return false;
        }

        $data = $json["data"][0];

        $data["_updated"] = time();
        TwitchHelper::logAdvanced(TwitchHelper::LOG_DEBUG, "helper", "Set _updated for ${streamer_id} to " . $data["_updated"]);

        // convert/download avatar
        if (isset($data["profile_image_url"]) && $data["profile_image_url"]) {
            $client = new \GuzzleHttp\Client;
            $avatar_ext = pathinfo($data["profile_image_url"], PATHINFO_EXTENSION);
            $avatar_output = TwitchHelper::$cache_folder . DIRECTORY_SEPARATOR . "channel" . DIRECTORY_SEPARATOR . "avatar" . DIRECTORY_SEPARATOR . $data["display_name"] . "." . $avatar_ext;
            $avatar_final = TwitchHelper::$cache_folder . DIRECTORY_SEPARATOR . "channel" . DIRECTORY_SEPARATOR . "avatar" . DIRECTORY_SEPARATOR . $data["display_name"] . ".webp";
            try {
                $response = $client->request("GET", $data["profile_image_url"], [
                    "query" => $query,
                    "sink" => $avatar_output
                ]);
            } catch (\Throwable $th) {
                TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Avatar fetching for {$streamer_id} errored: " . $th->getMessage());
            }
            if (file_exists($avatar_output)) {
                $data["cache_avatar"] = $data["display_name"] . "." . $avatar_ext;
                if (TwitchHelper::path_ffmpeg()) {
                    TwitchHelper::exec([TwitchHelper::path_ffmpeg(), "-i", $avatar_output, "-y", $avatar_final]);
                    $data["cache_avatar"] = $data["display_name"] . ".webp";
                }
            }
        }

        $json_streamers[$streamer_id] = $data;

        $success = file_put_contents(TwitchConfig::$streamerCachePath, json_encode($json_streamers)) !== false;

        if (!$success) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Failed to write channel data to cache for {$streamer_id}");
        }

        TwitchHelper::logAdvanced(TwitchHelper::LOG_INFO, "helper", "Fetched channel data online for {$streamer_id}");

        return $data;
    }

    /**
     * DRY
     *
     * @param string $streamer_id
     * @return array
     */
    public static function getChannelDataByLogin($streamer_login, $force = false)
    {

        if (!$streamer_login) {
            throw new \ValueError("Invalid passed to getChannelDataByLogin ({$streamer_login})");
            return false;
        }

        // first, check cache
        if (file_exists(TwitchConfig::$streamerCachePath)) {

            $json_streamers = json_decode(file_get_contents(TwitchConfig::$streamerCachePath), true);

            if ($json_streamers) {

                foreach ($json_streamers as $streamer) {
                    if ($streamer['login'] == $streamer_login) {
                        // check if too old, continue if true
                        if (!isset($streamer['_updated']) || time() > $streamer['_updated'] + 2592000) {
                            TwitchHelper::logAdvanced(TwitchHelper::LOG_INFO, "helper", "Channel data in cache for {$streamer_login} is too old, proceed to updating!");
                            if (isset($streamer['_updated']))
                                TwitchHelper::logAdvanced(TwitchHelper::LOG_DEBUG, "helper", "{$streamer_login} age: " . (time() - $streamer['_updated']) . " seconds");
                        } else {
                            return $streamer;
                        }
                        break;
                    }
                }
            }
        } else {

            $json_streamers = [];
        }

        if ( TwitchConfig::getCache("{$streamer_login}.deleted") == "1" && !$force) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_WARNING, "helper", "Channel {$streamer_login} is deleted, ignore. Delete kv file to force update.");
            return false;
        }

        $access_token = TwitchHelper::getAccessToken();

        if (!$access_token) {
            throw new \Exception('Fatal error, could not get access token for channel id request');
            return false;
        }

        $query = [];
        $query['login'] = $streamer_login;

        // fetch user from endpoint
        try {
            $response = TwitchHelper::$guzzler->request('GET', '/helix/users', [
                'query' => $query
            ]);
        } catch (\Throwable $th) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_FATAL, "helper", "getChannelDataById for {$streamer_login} errored: " . $th->getMessage());
            return false;
        }

        $server_output = $response->getBody()->getContents();
        $json = json_decode($server_output, true);

        if (!$json["data"]) {
            TwitchConfig::setCache("{$streamer_login}.deleted", "1");
            TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Failed to fetch channel data for {$streamer_login}: {$server_output}");
            throw new \Exception("Failed to fetch channel data for {$streamer_login}: {$server_output} ({$response->getStatusCode()})", TwitchConfig::ERROR_CHANNEL_NOT_FOUND);
            return false;
        }

        $data = $json["data"][0];

        $data["_updated"] = time();
        TwitchHelper::logAdvanced(TwitchHelper::LOG_DEBUG, "helper", "Set _updated for ${streamer_login} to " . $data["_updated"]);

        $streamer_id = $data['id'];

        // convert/download avatar
        if (isset($data["profile_image_url"]) && $data["profile_image_url"]) {
            $client = new \GuzzleHttp\Client;
            $avatar_ext = pathinfo($data["profile_image_url"], PATHINFO_EXTENSION);
            $avatar_output = TwitchHelper::$cache_folder . DIRECTORY_SEPARATOR . "channel" . DIRECTORY_SEPARATOR . "avatar" . DIRECTORY_SEPARATOR . $data["display_name"] . "." . $avatar_ext;
            $avatar_final = TwitchHelper::$cache_folder . DIRECTORY_SEPARATOR . "channel" . DIRECTORY_SEPARATOR . "avatar" . DIRECTORY_SEPARATOR . $data["display_name"] . ".webp";
            try {
                $response = $client->request("GET", $data["profile_image_url"], [
                    "query" => $query,
                    "sink" => $avatar_output
                ]);
            } catch (\Throwable $th) {
                TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Avatar fetching for {$streamer_login} errored: " . $th->getMessage());
            }
            if (file_exists($avatar_output)) {
                $data["cache_avatar"] = $data["display_name"] . "." . $avatar_ext;
                if (TwitchHelper::path_ffmpeg()) {
                    TwitchHelper::exec([TwitchHelper::path_ffmpeg(), "-i", $avatar_output, "-y", $avatar_final]);
                    $data["cache_avatar"] = $data["display_name"] . ".webp";
                }
            }
        }

        $json_streamers[$streamer_id] = $data;
        $success = file_put_contents(TwitchConfig::$streamerCachePath, json_encode($json_streamers));

        if (!$success) {
            TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "helper", "Failed to write channel data to cache for {$streamer_id}");
        }

        TwitchHelper::logAdvanced(TwitchHelper::LOG_INFO, "helper", "Fetched channel data online for {$streamer_login}");

        return $data;
    }

    /**
     * Get base folder for channel
     *
     * @return string
     */
    public function getFolder()
    {
        return TwitchHelper::vodFolder($this->login);
    }

    /**
     * Load and add each vod to channel
     *
     * @return void
     */
    private function parseVODs($api = false)
    {

        $this->vods_raw = glob($this->getFolder() . DIRECTORY_SEPARATOR . $this->login . "_*.json");

        foreach ($this->vods_raw as $k => $v) {

            if (!$vodclass = TwitchVOD::load($v, $api)) {
                continue;
            }

            // if ($vodclass->is_recording && !$vodclass->is_converting) {
            if ($vodclass->is_capturing) {
                $this->is_live = true;
                $this->current_vod = $vodclass;
                $this->current_game = $vodclass->getCurrentGame();
                $this->current_duration = $vodclass->getDurationLive() ?: null;
            }

            if ($vodclass->is_converting) {
                $this->is_converting = true;
            }

            if ($vodclass->segments) {
                foreach ($vodclass->segments as $s) {
                    $this->vods_size += $s['filesize'];
                }
            }

            $this->vods_list[] = $vodclass;
        }
    }

    /**
     * Match vods online
     *
     * @return void
     */
    public function matchVods()
    {
        foreach ($this->vods_list as $vod) {
            if (!$vod->is_finalized) continue;
            if ($vod->matchProviderVod()) {
                $vod->saveJSON('matched vod');
            }
        }
    }

    /**
     * Check vods online
     *
     * @return boolean Is a vod deleted?
     */
    public function checkValidVods()
    {

        $list = [];

        $is_a_vod_deleted = false;

        foreach ($this->vods_list as $vod) {

            if (!$vod->is_finalized) continue;

            $isvalid = $vod->checkValidVod(true);

            $list[$vod->basename] = $isvalid;

            if (!$isvalid) {
                $is_a_vod_deleted = true;
                // echo '<!-- deleted: ' . $vod->basename . ' -->';
            }
        }

        return $is_a_vod_deleted;
    }

    public function getPlaylists()
    {

        $videos = TwitchHelper::getVideos($this->userid);

        $data = [];

        foreach ($videos as $i => $video) {
            $video_id = $video['id'];
            $video_url = $video['url'];
            $playlist_urls = [];

            $stream_urls_raw = TwitchHelper::exec([TwitchHelper::path_streamlink(), '--json', '--url', $video_url, '--stream-url']);
            $stream_urls = json_decode($stream_urls_raw, true);

            if ($stream_urls && isset($stream_urls['streams'])) {
                $entry = array_merge($video, [
                    "playlist_urls" => $stream_urls['streams']
                ]);
                $data[(string)$video_id] = $entry;
            } else {
                TwitchHelper::logAdvanced(TwitchHelper::LOG_ERROR, "channel", "No videos api response for {$this->username}.", ['output' => $stream_urls_raw]);
            }

            if ($i > 5) break;
        }

        return $data;
    }

    public function getSubscription()
    {

        $subs = TwitchHelper::getSubs();

        if (!$subs['data']) return false;

        foreach ($subs['data'] as $sub) {
            if ($this->userid == $sub['condition']['broadcaster_user_id']) {
                return $sub;
            }
        }

        return false;
    }

    public function getStreamInfo()
    {
        $streams = TwitchHelper::getStreams($this->userid);
        if (!$streams) return false;
        return $streams[0];
    }
}
