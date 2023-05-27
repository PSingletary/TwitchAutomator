# LiveStreamDVR Webhooks

JSON format sent over POST. `action` key contains the action, and payload data is contained in `data`.

This really needs a rework, since all of these are sent both on websockets and webhooks.

## chapter_update
| Key     | Type          | Description  |
|---------|---------------|--------------|
| chapter | object        | Chapter data |
| vod     | BaseVOD | Assigned VOD |

## start_download
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |

When the download operation begins. Before capturing starts.

## end_download
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |

At the end of the entire download. After capture and conversion.

## start_convert
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |

Just at the start of conversion/remux of the video.

## end_convert
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |
| success | boolean       | Success?     |

Just at the end of conversion/remux of the video.

## start_capture
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |

Just at the start of capture with probably streamlink.

## end_capture
| Key     | Type          | Description  |
|---------|---------------|--------------|
| vod     | BaseVOD       | Assigned VOD |
| success | boolean       | Success?     |

Just at the end of capture with probably streamlink.

## config_save
When the config is saved

## chat_download
## vod_download

## notify
| Key     | Type          | Description  |
|---------|---------------|--------------|
| text    | string        | Alert text   |

## log
On a log event

## job_save
## job_clear
## job_update
## job_progress
## video_download
On some video downloads
## vod_removed
## vod_updated
## channel_updated
## init
## notify
## connected
## alert