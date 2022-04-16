# TwitchAutomator API
## Vod

### `GET /api/v0/vod/{basename}`
Return the stored information about the vod `basename`

### `POST /api/v0/vod/{basename}/search_chatdump`
#### POST parameters
|Name |Description            |
|-----|-----------------------|
|words|The words to search for|

Search the captured chatdump.

### `POST /api/v0/vod/{basename}/download_chat`
Download the chat to `{basename}.chat`

### `POST /api/v0/vod/{basename}/download`
Download the VOD to `{basename}_vod.mp4`

This file will be muted if twitch muted it too.

### `POST /api/v0/vod/{basename}/check_mute`
Check if the published VOD is muted.

### `POST /api/v0/vod/{basename}/full_burn`

Download the VOD if the captured one is muted, download the chat if it isn't downloaded, render the chat to video, then burn it to the VOD on new copy on disk.

### `POST /api/v0/vod/{basename}/render_chat`
#### POST parameters
|Name   |Description                                 |
|-------|--------------------------------------------|
|use_vod|Use downloaded VOD instead of captured video|

Render the downloaded chat to video.

### `POST /api/v0/vod/{basename}/delete`
Delete the VOD and all its metadata.

### `POST /api/v0/vod/{basename}/save`
Archive the VOD.

---

## Channels
### `GET /api/v0/channels`
List all channels and their vods

### `POST /api/v0/channels`
Add channel

### `GET /api/v0/channels/{login}`
Get information on the channel itself

### `PUT /api/v0/channels/{login}`
Modify channel

### `DELETE /api/v0/channels/{login}`
Delete channel

### `GET /api/v0/channels/{login}/force_record`
Force record the current stream

### `GET /api/v0/channels/{login}/dump_playlist`
Dump the stream from the playlist (vod)

### `GET /api/v0/channels/{login}/subscription`
Show the (webhook) subscription for the channel

---