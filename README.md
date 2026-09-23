![youtube-scraper banner](https://raw.githubusercontent.com/josh99smith/apify-actor-assets/main/banners/youtube-scraper.png?v=bd1)

Scrape **YouTube videos, channels, playlists and search results** through the **official YouTube Data API v3**. For every video you get views, likes, comment count, duration, tags, category, publish date, live status and thumbnail, plus the channel's subscriber count, all in one downloadable dataset. Switch to **Channels only** for bulk subscriber counts and channel stats.

Built for **marketers, agencies, creators, analysts and AI builders** who track channels, research competitors, shortlist influencers or build video datasets. You pay a flat price per video, and anything YouTube cannot return (private, deleted or unavailable videos) costs nothing.

## Features

- Scrape all videos from a YouTube channel (`@handle`, channel URL or channel ID), newest first
- Scrape YouTube playlists and single video, Shorts or live URLs
- Scrape YouTube search results by keyword, sorted by relevance, upload date, views or rating
- Filter by publish date ("last 7 days"), video length, country and language
- Get YouTube subscriber counts and channel stats in bulk ("Channels only" mode)
- Views, likes, comments, duration in seconds, tags, category, captions, licence and live status for every video
- Duplicates across inputs are removed, so every video is returned and billed once
- Export YouTube data to CSV, Excel, JSON or Google Sheets

## What can you do with Best Damn YouTube Scraper?

- **Competitor and channel monitoring**: schedule a weekly run over competitor channels with "Only videos published after: 7 days" and chart what performs.
- **Influencer research**: turn a list of creators into subscriber counts, upload frequency and average views before you reach out.
- **Content research and SEO**: see which videos rank for your keywords, and which titles, tags and lengths get the most views.
- **Reporting**: pull your own channel's full video history into Google Sheets or Looker Studio.
- **AI and data science**: build video metadata datasets, or feed video lists into the [Best Damn YouTube Comments Scraper](https://apify.com/josh99smith/youtube-comments-scraper).

## How it works

The Actor calls Google's official YouTube Data API v3 (`channels`, `playlistItems`, `search` and `videos`), the same public data YouTube shows on its pages. Nothing is scraped from HTML, no browser runs and no login is used, so runs are fast and don't break when YouTube changes its layout. Channel uploads come from the channel's uploads playlist, newest first. Statistics are fetched 50 videos at a time. Subscriber counts are rounded by YouTube itself (for example 46,300,000), and channels that hide their count return `null`.

## How to use it

1. Paste channel, playlist or video URLs into **YouTube URLs** and/or keywords into **Search terms**, one per line.
2. Set **Max results per channel, playlist or search** (0 = all) and, optionally, **Only videos published after**.
3. Choose **Videos** or **Channels only** output, and adjust the search sort, length, country and language if you search.
4. Click **Start**. Results appear in the **Output** tab; download them as JSON, CSV or Excel, or connect an integration.

```json
{
    "startUrls": ["https://www.youtube.com/@YouTube", "https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb"],
    "searchQueries": ["web scraping tutorial"],
    "maxResults": 50,
    "publishedAfter": "90 days",
    "searchOrder": "viewCount"
}
```

## Use it from the API, Python, JavaScript or an AI agent

Get a channel's latest 50 videos in one HTTP call:

```bash
curl -X POST "https://api.apify.com/v2/acts/josh99smith~youtube-scraper/run-sync-get-dataset-items?token=<YOUR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"startUrls": ["https://www.youtube.com/@YouTube"], "maxResults": 50}'
```

Python, with the `apify-client` package:

```python
from apify_client import ApifyClient

client = ApifyClient("<YOUR_API_TOKEN>")
run = client.actor("josh99smith/youtube-scraper").call(
    run_input={"searchQueries": ["home espresso"], "maxResults": 50, "searchOrder": "viewCount"}
)
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    if item["success"]:
        print(item["viewCount"], item["title"], item["channelTitle"])
```

JavaScript or TypeScript, with the `apify-client` package:

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: '<YOUR_API_TOKEN>' });
const run = await client.actor('josh99smith/youtube-scraper').call({
    startUrls: ['https://www.youtube.com/@YouTube', 'https://www.youtube.com/@jawed'],
    outputMode: 'channels',
});
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items.map((c) => `${c.title}: ${c.subscriberCount} subscribers`));
```

### Use it from Claude, Cursor, ChatGPT or any MCP client

The Actor is exposed as a tool by the [Apify MCP server](https://mcp.apify.com), so an AI agent can call it by name. Add this to your MCP client configuration (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf and others):

```json
{
    "mcpServers": {
        "apify": {
            "url": "https://mcp.apify.com?tools=josh99smith/youtube-scraper",
            "headers": { "Authorization": "Bearer <YOUR_API_TOKEN>" }
        }
    }
}
```

Then ask, for example: _"Use josh99smith/youtube-scraper to get the last 30 videos from @YouTube and tell me which topics get the most views."_ The agent fills in the input, runs the Actor and reads the dataset back; you pay the same per-video price as in the Console.

## Output

One record per video. Real example (description trimmed):

```json
{
    "success": true,
    "type": "video",
    "videoId": "jNQXAC9IVRw",
    "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "title": "Me at the zoo",
    "publishedAt": "2005-04-24T03:31:52Z",
    "durationSeconds": 19,
    "viewCount": 435887912,
    "likeCount": 19914774,
    "commentCount": 10626831,
    "tags": ["me at the zoo", "jawed karim", "first youtube video"],
    "category": "Film & Animation",
    "language": "en",
    "liveStatus": "none",
    "hasCaptions": true,
    "definition": "hd",
    "thumbnailUrl": "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
    "channelTitle": "jawed",
    "channelUrl": "https://www.youtube.com/@jawed",
    "channelSubscribers": 6610000,
    "channelCountry": "US",
    "sourceType": "video",
    "scrapedAt": "2026-09-23T15:30:00.209Z"
}
```

In **Channels only** mode each record is a channel: `title`, `handle`, `url`, `subscriberCount`, `viewCount`, `videoCount`, `country`, `publishedAt`, `description`, `keywords`, `thumbnailUrl` and `uploadsPlaylistId`. Inputs that cannot be read produce a free record such as `{"success": false, "input": "@thisHandleDoesNotExist", "errorType": "not-found"}`.

## Output fields

| Field | Description |
| --- | --- |
| `videoId` / `url` / `title` / `description` | The video. Use **Max description length** to trim long descriptions. |
| `publishedAt` / `durationSeconds` | Upload date and length in seconds. |
| `viewCount` / `likeCount` / `commentCount` | Current statistics (`null` when the owner hides likes or turns comments off). |
| `tags` / `categoryId` / `category` / `language` | Uploader tags, YouTube category and default language. |
| `liveStatus` / `liveStartedAt` | `none`, `live`, `upcoming` or `was-live`. |
| `isMadeForKids` / `hasCaptions` / `definition` / `license` | Audience, captions, HD/SD and `youtube` or `creativeCommon` licence. |
| `thumbnailUrl` | Largest available thumbnail. |
| `channelId` / `channelTitle` / `channelUrl` / `channelSubscribers` / `channelVideoCount` / `channelCountry` | The uploading channel and its stats. |
| `input` / `sourceType` / `searchQuery` / `playlistId` / `position` | Where the video came from: `video`, `channel`, `playlist` or `search`. |
| `success` / `errorType` | `true` for billed results; failures carry `invalid-url`, `not-found`, `rate-limited`, `missing-api-key`, `http-error`, `timeout`, `network` or `other`. |

A `SUMMARY` record in the key-value store lists videos queued and delivered, failures and the API quota units used.

## Pricing: how much does it cost to scrape YouTube?

You pay a **flat price per delivered video** (or per channel in Channels only mode; see the price next to the Start button): 1,000 videos cost $1.00. Private, deleted and unavailable videos, invalid inputs and quota errors cost nothing, and there is no charge for Actor start-up. The Actor stops automatically when it reaches the maximum cost you set for a run.

**How it compares (September 2026).** The most-used YouTube scraper on Apify Store charges $4.00 per 1,000 videos, and channel scrapers charge $1.00 to $1.30 per 1,000 results. This one charges $1.00 per 1,000 for full video statistics with channel stats included, through the official API rather than the YouTube website.

## API key and quota

By default the Actor uses a built-in YouTube API key shared by all its users. The YouTube Data API is free, but each key has a daily quota of 10,000 units. Reading channels, playlists and videos is cheap (about 1 unit per 50 videos), but **each search page costs 100 units**, so the shared key allows up to 5 search terms and 100 results per term per run. For heavy searching or large scheduled workloads, create your own free key in the [Google Cloud Console](https://developers.google.com/youtube/v3/getting-started) (enable "YouTube Data API v3", then create an API key) and paste it into **YouTube API key**. The key is stored encrypted and never written to the log or dataset. When a quota runs out, the run stops cleanly and reports free `rate-limited` records; quotas reset at midnight Pacific Time.

## Tips

- **Whole channel**: set **Max results** to 0. Even channels with thousands of uploads take only a few seconds.
- **Only new uploads**: combine a channel list with "Only videos published after: 7 days" on a weekly schedule. Paging stops as soon as older videos appear.
- **Influencer lists**: use **Channels only** with a list of `@handles` for one row per creator.
- **Search in a market**: set **Search country** (for example `DE`) and **Search language** (`de`) to see what local viewers get.
- **Comments too**: pass the video URLs to the [Best Damn YouTube Comments Scraper](https://apify.com/josh99smith/youtube-comments-scraper).

## FAQ

### Is it legal to scrape YouTube?

The Actor does not scrape YouTube's website: it uses Google's official, documented YouTube Data API under its terms of service and returns only public video and channel data. No personal data about viewers is collected. This Actor is not affiliated with, endorsed by or sponsored by YouTube or Google.

### Why is a subscriber count rounded or null?

YouTube rounds public subscriber counts to three significant figures, and channels can hide the count entirely. The Actor returns exactly what YouTube publishes.

### Why did a channel return fewer videos than it shows?

Private, unlisted, members-only and removed videos are not public. Live streams that have not started yet are included with `liveStatus: "upcoming"`.

### Can it get Shorts?

Yes. Shorts appear in channel uploads and search like any other video, and Shorts URLs work as input; `durationSeconds` tells you the length.

### Will the output fields change between runs?

No. Output fields are stable: existing fields are never renamed or removed without a major version bump announced in the changelog, and new fields are only ever added.

## Integrate Best Damn YouTube Scraper and automate your workflow

Best Damn YouTube Scraper plugs into the tools you already use through [Apify integrations](https://docs.apify.com/platform/integrations), so results can flow on without anyone downloading a file. Ready-made connectors include:

- [Make](https://docs.apify.com/platform/integrations/make)
- [Zapier](https://docs.apify.com/platform/integrations/zapier)
- [n8n](https://docs.apify.com/platform/integrations/n8n)
- [Slack](https://docs.apify.com/platform/integrations/slack)
- [Airbyte](https://docs.apify.com/platform/integrations/airbyte)
- [GitHub](https://docs.apify.com/platform/integrations/github)
- [Google Drive](https://docs.apify.com/platform/integrations/drive)
- and [many more](https://docs.apify.com/platform/integrations).

You can also attach [webhooks](https://docs.apify.com/platform/integrations/webhooks) to trigger your own endpoint whenever a run succeeds, fails or times out. For example, post every new competitor upload to Slack, or append weekly channel stats to a Google Sheet.

## Related Actors by the same developer

- [Best Damn YouTube Comments Scraper](https://apify.com/josh99smith/youtube-comments-scraper): comments and replies from YouTube videos and channels.
- [Best Damn App Reviews Scraper](https://apify.com/josh99smith/app-reviews-scraper): App Store and Google Play reviews as JSON.
- [Best Damn Google Autocomplete Scraper](https://apify.com/josh99smith/google-autocomplete-scraper): keyword suggestions from Google search.
- [Best Damn RSS to JSON Converter](https://apify.com/josh99smith/rss-feed-to-json): RSS and Atom feeds as JSON.
- [Best Damn Tech Stack Detector](https://apify.com/josh99smith/tech-stack-detector): find out what a website is built with.
- [Best Damn Website Screenshot API](https://apify.com/josh99smith/website-screenshot-api): full-page screenshots and PDFs of any URL.
- [Best Damn PageSpeed Insights Audit](https://apify.com/josh99smith/pagespeed-insights-audit): Core Web Vitals and Lighthouse scores in bulk.
- [Best Damn Remote Jobs Aggregator](https://apify.com/josh99smith/remote-jobs-aggregator): remote job listings from five public boards.
- [Best Damn PDF Text Extractor](https://apify.com/josh99smith/pdf-text-extractor): text and metadata from PDF files.
- [Best Damn Sitemap URL Extractor](https://apify.com/josh99smith/sitemap-url-extractor): all URLs from XML sitemaps.

## Support and feedback

Found a channel or video that fails unexpectedly, or a field you are missing? Open a ticket in the **Issues** tab of this Actor.
