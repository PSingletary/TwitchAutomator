# Routes
- [x] GET /vod/{basename}
// - [ ] POST /vod/{basename}/search_chatdump
- [x] POST /vod/{basename}/download_chat
- [x] POST /vod/{basename}/download
- [x] POST /vod/{basename}/check_mute
- [?] POST /vod/{basename}/delete
- [?] POST /vod/{basename}/save
- [x] POST /vod/{basename}/cut
- [x] POST /vod/{basename}/renderwizard
// - [ ] POST /vod/{basename}/unbreak
- 
- [x] GET /api/v0/channels
- [x] POST /api/v0/channels
- 
- [x] GET /api/v0/channels/{login}
- [?] PUT /api/v0/channels/{login}
- [x] DELETE /api/v0/channels/{login}
- [ ] GET /api/v0/channels/{login}/force_record
- [ ] GET /api/v0/channels/{login}/dump_playlist
- [ ] GET /api/v0/channels/{login}/subscription
- [x] GET /api/v0/channels/{login}/download/{video_id}
- 
- [x] GET /api/v0/jobs
- [?] DELETE /api/v0/jobs/{job}
- 
- [x] GET /api/v0/twitchapi/videos/{login}
- [x] GET /api/v0/twitchapi/video/{video_id}
- 
- [x] GET /api/v0/settings
- [x] PUT /api/v0/settings
- 
- [x] GET /api/v0/favourites
- [x] PUT /api/v0/favourites
- 
- [x] GET /api/v0/games
- 
- [x] GET /api/v0/about
- 
- // [ ] GET /api/v0/tools/fullvodburn
- [x] GET /api/v0/tools/voddownload
- [x] GET /api/v0/tools/chatdownload
- [ ] GET /api/v0/tools/playlist_dump/{username}
- [ ] GET /api/v0/tools/check_vods
- 
- [x] GET /subscriptions
- [?] POST /subscriptions
- [ ] POST /subscriptions/{id}
- [?] DELETE /subscriptions/{id}
- 
- [x] GET /api/v0/cron/check_deleted_vods
- [x] GET /api/v0/cron/check_muted_vods
- [ ] GET /api/v0/cron/dump_playlists
- 
- [x] GET /api/v0/hook
- 
- [x] GET /api/v0/log/{filename}/{last_line}


# Features
- [x] record a stream
- [ ] delete vod from disk and handle
- [x] integrate websocket server into ts-server?
- [x] burnwizard
- [x] password protection
- [x] webhook+websocket
- [ ] vod folders inside channel folders

# Key
- [x] = implemented
- [?] = not tested
- [ ] = to do
