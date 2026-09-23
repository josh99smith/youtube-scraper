import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { type ApiResult, YouTubeClient } from './client.js';
import { runPool } from './pool.js';
import {
    assertList,
    type ChannelInfo,
    channelItem,
    type ChannelResource,
    type DurationFilter,
    DURATIONS,
    type ErrorType,
    type FailureItem,
    isAfter,
    isKeyWideError,
    type ListResponse,
    mapChannel,
    mapVideo,
    type Origin,
    parsePublishedAfter,
    parseTarget,
    type PlaylistItem,
    ResponseShapeError,
    SEARCH_ORDERS,
    type SearchOrder,
    type SearchResult,
    type Target,
    uploadsPlaylistId,
    type VideoItem,
    type VideoResource,
} from './youtube.js';

const VIDEO_EVENT = 'video';
const CHANNEL_EVENT = 'channel';
const SEARCH_COST = 100; // quota units per search.list page
const SHARED_KEY_MAX_QUERIES = 5;
const SHARED_KEY_MAX_SEARCH_RESULTS = 100;
const OLDER_IN_A_ROW_CUTOFF = 5;
const MISSING_KEY_MESSAGE =
    'No YouTube API key available. Add your free YouTube Data API v3 key to the "apiKey" input ' +
    '(https://developers.google.com/youtube/v3/getting-started) or set the YOUTUBE_API_KEY environment variable.';

interface Input {
    startUrls?: (string | { url: string })[];
    searchQueries?: string[];
    maxResults?: number;
    publishedAfter?: string;
    searchOrder?: string;
    searchDuration?: string;
    searchRegion?: string;
    searchLanguage?: string;
    outputMode?: string;
    maxDescriptionLength?: number;
    apiKey?: string;
    maxConcurrency?: number;
}

await Actor.init();

let aborting = false;
Actor.on('aborting', async () => {
    aborting = true;
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};
const outputMode = input.outputMode ?? 'videos';
if (outputMode !== 'videos' && outputMode !== 'channels') {
    await Actor.fail(`Input "outputMode" must be "videos" or "channels" (got "${input.outputMode}").`);
}
const searchOrder = (input.searchOrder ?? 'relevance') as SearchOrder;
if (!SEARCH_ORDERS.includes(searchOrder))
    await Actor.fail(`Input "searchOrder" must be one of ${SEARCH_ORDERS.join(', ')}.`);
const searchDuration = (input.searchDuration ?? 'any') as DurationFilter;
if (!DURATIONS.includes(searchDuration))
    await Actor.fail(`Input "searchDuration" must be one of ${DURATIONS.join(', ')}.`);
const publishedAfter = parsePublishedAfter(input.publishedAfter);
if (publishedAfter === null) {
    await Actor.fail(
        `Input "publishedAfter" must be a date like 2026-01-31 or a relative period like "30 days" (got "${input.publishedAfter}").`,
    );
}
const maxResults = Math.max(Math.floor(input.maxResults ?? 50), 0); // per channel / playlist / search query; 0 = all
const maxDescriptionLength = Math.max(Math.floor(input.maxDescriptionLength ?? 0), 0);
const maxConcurrency = Math.min(Math.max(Math.floor(input.maxConcurrency ?? 4), 1), 10);
const apiKey = (input.apiKey ?? process.env.YOUTUBE_API_KEY ?? '').trim();
const ownKey = Boolean(input.apiKey?.trim());
const region = (input.searchRegion ?? '').trim().toUpperCase() || undefined;
const language = (input.searchLanguage ?? '').trim().toLowerCase() || undefined;

const rawInputs = (input.startUrls ?? [])
    .map((u) => (typeof u === 'string' ? u : (u?.url ?? '')))
    .filter((s) => s.trim());
let queries = (input.searchQueries ?? []).map((q) => (q ?? '').trim()).filter(Boolean);
if (rawInputs.length === 0 && queries.length === 0) {
    await Actor.fail('Add at least one YouTube URL in "startUrls" or one search term in "searchQueries".');
}

const failures: FailureItem[] = [];
const fail = (inputStr: string, errorType: ErrorType, error: string, statusCode?: number): void => {
    failures.push({
        success: false,
        input: inputStr,
        errorType,
        error: error.slice(0, 500),
        statusCode,
        scrapedAt: new Date().toISOString(),
    });
    log.warning(`${inputStr}: ${errorType} - ${error.slice(0, 200)}`);
};

const targets: Target[] = [];
for (const raw of rawInputs) {
    const t = parseTarget(raw);
    if (t) targets.push(t);
    else fail(raw, 'invalid-url', 'Not a YouTube video, Shorts, channel, @handle or playlist URL (or ID)');
}

// The shared key's daily quota is shared by all users; searches cost 100 units per page, so cap them.
let searchCap = maxResults === 0 ? 500 : Math.min(maxResults, 500);
if (!ownKey && queries.length) {
    if (queries.length > SHARED_KEY_MAX_QUERIES) {
        for (const q of queries.slice(SHARED_KEY_MAX_QUERIES)) {
            fail(
                `search: ${q}`,
                'rate-limited',
                `The shared API key allows ${SHARED_KEY_MAX_QUERIES} search terms per run; add your own free API key for more.`,
            );
        }
        queries = queries.slice(0, SHARED_KEY_MAX_QUERIES);
    }
    if (searchCap > SHARED_KEY_MAX_SEARCH_RESULTS) {
        log.warning(
            `Search results are capped at ${SHARED_KEY_MAX_SEARCH_RESULTS} per term on the shared API key; add your own key for up to 500.`,
        );
        searchCap = SHARED_KEY_MAX_SEARCH_RESULTS;
    }
}

const { isPayPerEvent } = Actor.getChargingManager().getPricingInfo();
const client = new YouTubeClient({ apiKey });
let keyStop: { errorType: ErrorType; error: string } | null = null;
let budgetStop = false;
let charged = 0;
const shouldStop = () => aborting || budgetStop || keyStop !== null;

function handleError(res: Extract<ApiResult<unknown>, { ok: false }>, inputStr: string): void {
    if (isKeyWideError(res.reason) && !keyStop) {
        keyStop = { errorType: res.errorType, error: res.error };
        log.error(`${res.error}. Stopping: no further requests can succeed with this key.`);
    }
    fail(inputStr, res.errorType, res.error, res.statusCode);
}

if (!apiKey) {
    log.error(MISSING_KEY_MESSAGE);
    for (const t of targets) fail(t.input, 'missing-api-key', MISSING_KEY_MESSAGE);
    for (const q of queries) fail(`search: ${q}`, 'missing-api-key', MISSING_KEY_MESSAGE);
    targets.length = 0;
    queries = [];
}

// ---------- Channels (handles and IDs) ----------
const channels = new Map<string, ChannelInfo>();
const CHANNEL_PARTS = 'snippet,statistics,contentDetails,brandingSettings';

async function fetchChannels(ids: string[], inputFor: (id: string) => string): Promise<void> {
    const todo = [...new Set(ids)].filter((id) => !channels.has(id));
    for (let i = 0; i < todo.length && !shouldStop(); i += 50) {
        const chunk = todo.slice(i, i + 50);
        const res = await client.list<ListResponse<ChannelResource>>('channels', {
            part: CHANNEL_PARTS,
            id: chunk.join(','),
            maxResults: 50,
        });
        if (!res.ok) {
            handleError(res, inputFor(chunk[0]));
            continue;
        }
        for (const c of assertList<ChannelResource>(res.body, 'channels').items!) {
            const info = mapChannel(c);
            if (info) channels.set(info.channelId, info);
        }
    }
}

const channelTargets: { channelId: string; input: string }[] = [];
for (const t of targets) {
    if (shouldStop()) break;
    if (t.kind === 'handle') {
        const res = await client.list<ListResponse<ChannelResource>>('channels', {
            part: CHANNEL_PARTS,
            forHandle: t.handle,
        });
        if (!res.ok) {
            handleError(res, t.input);
            continue;
        }
        const info = res.body.items?.[0] ? mapChannel(res.body.items[0]) : null;
        if (!info) {
            fail(t.input, 'not-found', `No YouTube channel found for ${t.handle}`);
            continue;
        }
        channels.set(info.channelId, info);
        channelTargets.push({ channelId: info.channelId, input: t.input });
    } else if (t.kind === 'channel') {
        channelTargets.push({ channelId: t.channelId, input: t.input });
    }
}
await fetchChannels(
    channelTargets.map((c) => c.channelId),
    (id) => channelTargets.find((c) => c.channelId === id)?.input ?? id,
);
for (const c of [...channelTargets]) {
    if (!channels.has(c.channelId) && !keyStop) {
        fail(c.input, 'not-found', `No YouTube channel found with ID ${c.channelId}`);
        channelTargets.splice(channelTargets.indexOf(c), 1);
    }
}

// ---------- Collect video IDs from every source ----------
interface Job {
    videoId: string;
    origin: Origin;
}
const jobs: Job[] = [];
const seenVideos = new Set<string>();
const add = (videoId: string, origin: Origin) => {
    if (seenVideos.has(videoId)) return;
    seenVideos.add(videoId);
    jobs.push({ videoId, origin });
};
let collected = 0;

async function collectPlaylist(
    playlistId: string,
    inputStr: string,
    sourceType: 'channel' | 'playlist',
    newestFirst: boolean,
): Promise<void> {
    let pageToken: string | undefined;
    let found = 0;
    let olderInARow = 0;
    const cap = maxResults === 0 ? Infinity : maxResults;
    do {
        const res = await client.list<ListResponse<PlaylistItem>>('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: 50,
            pageToken,
        });
        if (!res.ok) {
            // An empty channel has no uploads playlist: YouTube answers 404 playlistNotFound.
            if (sourceType === 'channel' && res.reason === 'playlistNotFound') break;
            handleError(res, inputStr);
            return;
        }
        const body = assertList<PlaylistItem>(res.body, 'playlist items');
        let cutoff = false;
        for (const it of body.items!) {
            const id = it.contentDetails?.videoId;
            if (!id) continue;
            if (!isAfter(it.contentDetails?.videoPublishedAt, publishedAfter ?? undefined)) {
                olderInARow += 1;
                if (newestFirst && olderInARow >= OLDER_IN_A_ROW_CUTOFF) {
                    cutoff = true;
                    break;
                }
                continue;
            }
            olderInARow = 0;
            add(id, {
                input: inputStr,
                sourceType,
                searchQuery: null,
                playlistId,
                position: it.snippet?.position ?? null,
            });
            found += 1;
            if (found >= cap) break;
        }
        pageToken = cutoff || found >= cap ? undefined : body.nextPageToken;
    } while (pageToken && !shouldStop());
    collected += found;
    log.info(`${inputStr}: ${found} video(s) queued`);
}

async function collectSearch(query: string): Promise<void> {
    let pageToken: string | undefined;
    let found = 0;
    const inputStr = `search: ${query}`;
    do {
        const res = await client.list<ListResponse<SearchResult>>(
            'search',
            {
                part: 'id',
                type: 'video',
                q: query,
                maxResults: Math.min(50, searchCap - found),
                order: searchOrder,
                videoDuration: searchDuration === 'any' ? undefined : searchDuration,
                publishedAfter: publishedAfter ? publishedAfter.toISOString() : undefined,
                regionCode: region,
                relevanceLanguage: language,
                pageToken,
            },
            SEARCH_COST,
        );
        if (!res.ok) {
            handleError(res, inputStr);
            return;
        }
        const body = assertList<SearchResult>(res.body, 'search results');
        for (const r of body.items!) {
            if (r.id?.videoId && found < searchCap) {
                found += 1;
                add(r.id.videoId, {
                    input: inputStr,
                    sourceType: 'search',
                    searchQuery: query,
                    playlistId: null,
                    position: found,
                });
            }
        }
        pageToken = found < searchCap ? body.nextPageToken : undefined;
    } while (pageToken && !shouldStop());
    collected += found;
    log.info(`${inputStr}: ${found} video(s) queued`);
}

const collectors: (() => Promise<void>)[] = [];
for (const t of targets) {
    if (t.kind === 'video')
        add(t.videoId, { input: t.input, sourceType: 'video', searchQuery: null, playlistId: null, position: null });
    if (t.kind === 'playlist') collectors.push(async () => collectPlaylist(t.playlistId, t.input, 'playlist', false));
}
if (outputMode === 'videos') {
    for (const c of channelTargets)
        collectors.push(async () => collectPlaylist(uploadsPlaylistId(c.channelId), c.input, 'channel', true));
}
for (const q of queries) collectors.push(async () => collectSearch(q));

try {
    await runPool(collectors, maxConcurrency, async (fn) => fn(), shouldStop);
} catch (err) {
    if (!(err instanceof ResponseShapeError)) throw err;
    fail('run', 'other', err.message);
}

// ---------- Fetch full video details, then channel stats ----------
const VIDEO_PARTS = 'snippet,contentDetails,statistics,status,liveStreamingDetails';
const videos = new Map<string, VideoResource>();
for (let i = 0; i < jobs.length && !shouldStop(); i += 50) {
    const chunk = jobs.slice(i, i + 50);
    const res = await client.list<ListResponse<VideoResource>>('videos', {
        part: VIDEO_PARTS,
        id: chunk.map((j) => j.videoId).join(','),
        maxResults: 50,
    });
    if (!res.ok) {
        handleError(res, chunk[0].origin.input);
        continue;
    }
    for (const v of assertList<VideoResource>(res.body, 'videos').items!) if (v.id) videos.set(v.id, v);
}
let skippedUnavailable = 0;
for (const j of jobs) {
    if (videos.has(j.videoId) || keyStop) continue;
    // A directly requested video that YouTube does not return is private, deleted or mistyped; in playlists
    // and channels such entries are just skipped (they are not billed either way).
    if (j.origin.sourceType === 'video')
        fail(j.origin.input, 'not-found', 'Video not found: it is private, deleted or the ID is wrong');
    else skippedUnavailable += 1;
}
const videoChannelIds = [...videos.values()].map((v) => v.snippet?.channelId).filter((id): id is string => Boolean(id));
await fetchChannels(videoChannelIds, (id) => id);

// ---------- Output ----------
async function deliver(items: object[], event: string): Promise<boolean> {
    if (!items.length) return true;
    const { eventChargeLimitReached } = await Actor.pushData(items, event);
    charged += items.length;
    if (eventChargeLimitReached) {
        budgetStop = true;
        log.warning(
            'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to get more results.',
        );
        return false;
    }
    return true;
}

let delivered = 0;
if (outputMode === 'channels') {
    // One record per channel: channel inputs first, then channels of any videos, playlists or searches.
    const ordered: { id: string; input: string }[] = channelTargets.map((c) => ({ id: c.channelId, input: c.input }));
    for (const j of jobs) {
        const id = videos.get(j.videoId)?.snippet?.channelId;
        if (id) ordered.push({ id, input: j.origin.input });
    }
    const done = new Set<string>();
    const batch = [];
    for (const o of ordered) {
        const info = channels.get(o.id);
        if (!info || done.has(o.id)) continue;
        done.add(o.id);
        batch.push(channelItem(info, o.input));
    }
    for (let i = 0; i < batch.length && !budgetStop; i += 50) {
        const part = batch.slice(i, i + 50);
        if (await deliver(part, CHANNEL_EVENT)) delivered += part.length;
    }
} else {
    const batch: VideoItem[] = [];
    for (const j of jobs) {
        const v = videos.get(j.videoId);
        if (!v) continue;
        const item = mapVideo(v, j.origin, v.snippet?.channelId ? channels.get(v.snippet.channelId) : undefined, {
            maxDescriptionLength,
        });
        if (item) batch.push(item);
        else fail(j.origin.input, 'other', `YouTube returned incomplete data for video ${j.videoId}`);
    }
    for (let i = 0; i < batch.length && !budgetStop; i += 50) {
        const part = batch.slice(i, i + 50);
        if (await deliver(part, VIDEO_EVENT)) delivered += part.length;
    }
}

if (keyStop) {
    const stopped: { errorType: ErrorType; error: string } = keyStop;
    fail('run', stopped.errorType, `${stopped.error} Some inputs were not processed.`);
}
if (failures.length) await Actor.pushData(failures); // free of charge

const summary = {
    inputs: rawInputs.length,
    searchQueries: queries.length,
    outputMode,
    videosQueued: jobs.length,
    delivered,
    unavailableSkipped: skippedUnavailable,
    failed: failures.length,
    quotaUnitsUsed: client.unitsUsed,
    chargedEvents: isPayPerEvent ? charged : undefined,
    stoppedEarlyDueToBudget: budgetStop,
    stoppedBecauseOfKey: keyStop ? (keyStop as { error: string }).error : null,
    collectedFromSources: collected,
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify(summary)}`);

await Actor.exit();
