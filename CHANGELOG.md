# Changelog

## 0.1.0 (2026-09-23)

- Initial release: YouTube videos from channels (@handle, channel URL or ID), playlists, video/Shorts URLs and keyword search through the official YouTube Data API v3.
- Per video: views, likes, comments, duration, tags, category, language, live status, captions, licence, thumbnail, plus channel subscribers, video count and country.
- "Channels only" output mode for channel profiles (subscribers, total views, videos, country, keywords).
- Date filter with early stop on channel uploads; search order, length, country and language filters; duplicate videos across inputs are returned (and billed) once.
- Free failure records for invalid URLs, missing channels, playlists and videos, quota and key errors; clean stop when the key quota is used up. Shared-key search capped at 5 terms and 100 results per term per run.
