/**
 * Pure, network-free logic for the YouTube Data API v3 video/channel/playlist/search endpoints:
 * input parsing, response mapping and error categorisation. Unit-tested in test/youtube.test.ts.
 */

export const API_BASE = 'https://www.googleapis.com/youtube/v3';

export type ErrorType =
    'missing-api-key' | 'invalid-url' | 'not-found' | 'rate-limited' | 'http-error' | 'timeout' | 'network' | 'other';

export type Target =
    | { kind: 'video'; videoId: string; input: string }
    | { kind: 'channel'; channelId: string; input: string }
    | { kind: 'handle'; handle: string; input: string }
    | { kind: 'playlist'; playlistId: string; input: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
const PLAYLIST_ID = /^(PL|UU|LL|FL|OL|RD|UL|PU)[A-Za-z0-9_-]{10,}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/**
 * Accepts watch / Shorts / live / embed / youtu.be URLs, bare video IDs, channel URLs (/@handle, /channel/UC...),
 * bare @handles or channel IDs, and playlist URLs or IDs. A watch URL that also carries &list= is treated as the video.
 */
export function parseTarget(raw: string): Target | null {
    const input = (raw ?? '').trim();
    if (!input) return null;
    if (VIDEO_ID.test(input)) return { kind: 'video', videoId: input, input };
    if (CHANNEL_ID.test(input)) return { kind: 'channel', channelId: input, input };
    if (HANDLE.test(input)) return { kind: 'handle', handle: input, input };
    if (PLAYLIST_ID.test(input)) return { kind: 'playlist', playlistId: input, input };

    let url: URL;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' || host === 'www.youtu.be') {
        return parts[0] && VIDEO_ID.test(parts[0]) ? { kind: 'video', videoId: parts[0], input } : null;
    }
    if (!YT_HOSTS.has(host)) return null;

    const v = url.searchParams.get('v');
    const list = url.searchParams.get('list');
    if (parts[0] === 'watch' && v && VIDEO_ID.test(v)) return { kind: 'video', videoId: v, input };
    if (parts[0] === 'playlist' && list && PLAYLIST_ID.test(list)) return { kind: 'playlist', playlistId: list, input };
    if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') && parts[1] && VIDEO_ID.test(parts[1])) {
        return { kind: 'video', videoId: parts[1], input };
    }
    if (parts[0] === 'channel' && parts[1] && CHANNEL_ID.test(parts[1])) {
        return { kind: 'channel', channelId: parts[1], input };
    }
    if (parts[0]?.startsWith('@') && HANDLE.test(decodeURIComponent(parts[0]))) {
        return { kind: 'handle', handle: decodeURIComponent(parts[0]), input };
    }
    return null;
}

export function uploadsPlaylistId(channelId: string): string {
    return `UU${channelId.slice(2)}`;
}

/** ISO 8601 duration (PT1H2M3S, P1DT2H) to seconds. Returns null for missing or unparseable values. */
export function parseDuration(iso: string | undefined): number | null {
    if (!iso) return null;
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
    if (!m) return null;
    const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
    return d * 86400 + h * 3600 + min * 60 + s;
}

/** Parses an ISO date or a relative "N days/weeks/months/years" string. undefined when empty, null when invalid. */
export function parsePublishedAfter(value: unknown, now = new Date()): Date | null | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') return null;
    const rel = /^\s*(\d+)\s*(day|week|month|year)s?\s*(ago)?\s*$/i.exec(value);
    if (rel) {
        const n = Number(rel[1]);
        const d = new Date(now);
        const unit = rel[2].toLowerCase();
        if (unit === 'day') d.setUTCDate(d.getUTCDate() - n);
        else if (unit === 'week') d.setUTCDate(d.getUTCDate() - 7 * n);
        else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() - n);
        else d.setUTCFullYear(d.getUTCFullYear() - n);
        return d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export const SEARCH_ORDERS = ['relevance', 'date', 'viewCount', 'rating'] as const;
export type SearchOrder = (typeof SEARCH_ORDERS)[number];
export const DURATIONS = ['any', 'short', 'medium', 'long'] as const;
export type DurationFilter = (typeof DURATIONS)[number];

// Standard YouTube video categories (stable IDs; avoids a videoCategories.list call per run).
export const CATEGORIES: Record<string, string> = {
    '1': 'Film & Animation',
    '2': 'Autos & Vehicles',
    '10': 'Music',
    '15': 'Pets & Animals',
    '17': 'Sports',
    '18': 'Short Movies',
    '19': 'Travel & Events',
    '20': 'Gaming',
    '21': 'Videoblogging',
    '22': 'People & Blogs',
    '23': 'Comedy',
    '24': 'Entertainment',
    '25': 'News & Politics',
    '26': 'Howto & Style',
    '27': 'Education',
    '28': 'Science & Technology',
    '29': 'Nonprofits & Activism',
    '30': 'Movies',
    '43': 'Shows',
    '44': 'Trailers',
};

// ---------- API response typing (only the fields we read) ----------

export interface ApiError {
    error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] };
}

export interface ListResponse<T> {
    items?: T[];
    nextPageToken?: string;
    pageInfo?: { totalResults?: number };
}

type Thumbs = Record<string, { url?: string; width?: number; height?: number } | undefined>;

export interface VideoResource {
    id?: string;
    snippet?: {
        publishedAt?: string;
        channelId?: string;
        channelTitle?: string;
        title?: string;
        description?: string;
        thumbnails?: Thumbs;
        tags?: string[];
        categoryId?: string;
        liveBroadcastContent?: string;
        defaultLanguage?: string;
        defaultAudioLanguage?: string;
    };
    contentDetails?: { duration?: string; definition?: string; caption?: string; licensedContent?: boolean };
    status?: { privacyStatus?: string; license?: string; embeddable?: boolean; madeForKids?: boolean };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    liveStreamingDetails?: {
        actualStartTime?: string;
        actualEndTime?: string;
        scheduledStartTime?: string;
        concurrentViewers?: string;
    };
}

export interface ChannelResource {
    id?: string;
    snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        publishedAt?: string;
        thumbnails?: Thumbs;
        country?: string;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
    statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
    brandingSettings?: { channel?: { keywords?: string } };
}

export interface PlaylistItem {
    snippet?: { position?: number };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

export interface PlaylistResource {
    id?: string;
    snippet?: { title?: string; channelId?: string; channelTitle?: string };
    contentDetails?: { itemCount?: number };
}

export interface SearchResult {
    id?: { kind?: string; videoId?: string };
}

export class ResponseShapeError extends Error {}

export function assertList<T>(body: unknown, what: string): ListResponse<T> {
    if (!body || typeof body !== 'object' || !Array.isArray((body as ListResponse<T>).items)) {
        throw new ResponseShapeError(`YouTube returned an unexpected response for ${what} (no items array)`);
    }
    return body as ListResponse<T>;
}

// ---------- Output ----------

export interface ChannelInfo {
    channelId: string;
    title: string | null;
    handle: string | null;
    url: string;
    description: string | null;
    country: string | null;
    publishedAt: string | null;
    subscriberCount: number | null;
    videoCount: number | null;
    viewCount: number | null;
    thumbnailUrl: string | null;
    keywords: string[];
}

export interface Origin {
    input: string;
    sourceType: 'video' | 'channel' | 'playlist' | 'search';
    searchQuery: string | null;
    playlistId: string | null;
    position: number | null;
}

export interface VideoItem {
    success: true;
    type: 'video';
    videoId: string;
    url: string;
    title: string;
    description: string;
    publishedAt: string | null;
    durationSeconds: number | null;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    tags: string[];
    categoryId: string | null;
    category: string | null;
    language: string | null;
    liveStatus: 'none' | 'live' | 'upcoming' | 'was-live';
    liveStartedAt: string | null;
    isMadeForKids: boolean | null;
    hasCaptions: boolean | null;
    definition: string | null;
    license: string | null;
    thumbnailUrl: string | null;
    channelId: string | null;
    channelTitle: string | null;
    channelUrl: string | null;
    channelSubscribers: number | null;
    channelVideoCount: number | null;
    channelCountry: string | null;
    input: string;
    sourceType: Origin['sourceType'];
    searchQuery: string | null;
    playlistId: string | null;
    position: number | null;
    scrapedAt: string;
}

export interface ChannelItem extends Omit<ChannelInfo, 'channelId'> {
    success: true;
    type: 'channel';
    channelId: string;
    uploadsPlaylistId: string;
    input: string;
    scrapedAt: string;
}

export interface FailureItem {
    success: false;
    input: string;
    errorType: ErrorType;
    error: string;
    statusCode?: number;
    scrapedAt: string;
}

const num = (s: string | undefined): number | null => (s === undefined || s === '' ? null : Number(s));

export function bestThumb(t: Thumbs | undefined): string | null {
    if (!t) return null;
    for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) if (t[k]?.url) return t[k]!.url!;
    return null;
}

export function mapChannel(c: ChannelResource): ChannelInfo | null {
    if (!c.id || !c.snippet) return null;
    const custom = c.snippet.customUrl;
    let handle: string | null = null;
    if (custom) handle = custom.startsWith('@') ? custom : `@${custom}`;
    const keywords = (c.brandingSettings?.channel?.keywords ?? '').match(/"[^"]+"|\S+/g) ?? [];
    return {
        channelId: c.id,
        title: c.snippet.title ?? null,
        handle,
        url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${c.id}`,
        description: c.snippet.description ?? null,
        country: c.snippet.country ?? null,
        // YouTube reports the Unix epoch for a few very old system channels; that is a placeholder, not a date.
        publishedAt:
            c.snippet.publishedAt && !c.snippet.publishedAt.startsWith('1970-01-01') ? c.snippet.publishedAt : null,
        subscriberCount: c.statistics?.hiddenSubscriberCount ? null : num(c.statistics?.subscriberCount),
        videoCount: num(c.statistics?.videoCount),
        viewCount: num(c.statistics?.viewCount),
        thumbnailUrl: bestThumb(c.snippet.thumbnails),
        keywords: keywords.map((k) => k.replace(/^"|"$/g, '')),
    };
}

export function channelItem(info: ChannelInfo, input: string, now = new Date()): ChannelItem {
    return {
        success: true,
        type: 'channel',
        ...info,
        uploadsPlaylistId: uploadsPlaylistId(info.channelId),
        input,
        scrapedAt: now.toISOString(),
    };
}

export function liveStatus(v: VideoResource): VideoItem['liveStatus'] {
    const b = v.snippet?.liveBroadcastContent;
    if (b === 'live') return 'live';
    if (b === 'upcoming') return 'upcoming';
    return v.liveStreamingDetails?.actualStartTime ? 'was-live' : 'none';
}

/** Returns null when the resource lacks the basics (silent-failure guard: such items are not billed). */
export function mapVideo(
    v: VideoResource,
    origin: Origin,
    channel: ChannelInfo | undefined,
    opts: { maxDescriptionLength?: number; now?: Date } = {},
): VideoItem | null {
    const s = v.snippet;
    if (!v.id || !s || typeof s.title !== 'string') return null;
    const desc = s.description ?? '';
    const max = opts.maxDescriptionLength ?? 0;
    return {
        success: true,
        type: 'video',
        videoId: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        title: s.title,
        description: max > 0 && desc.length > max ? `${desc.slice(0, max)}…` : desc,
        publishedAt: s.publishedAt ?? null,
        durationSeconds: parseDuration(v.contentDetails?.duration),
        viewCount: num(v.statistics?.viewCount),
        likeCount: num(v.statistics?.likeCount),
        commentCount: num(v.statistics?.commentCount),
        tags: s.tags ?? [],
        categoryId: s.categoryId ?? null,
        category: s.categoryId ? (CATEGORIES[s.categoryId] ?? null) : null,
        language: s.defaultAudioLanguage ?? s.defaultLanguage ?? null,
        liveStatus: liveStatus(v),
        liveStartedAt: v.liveStreamingDetails?.actualStartTime ?? null,
        isMadeForKids: v.status?.madeForKids ?? null,
        hasCaptions: v.contentDetails?.caption === undefined ? null : v.contentDetails.caption === 'true',
        definition: v.contentDetails?.definition ?? null,
        license: v.status?.license ?? null,
        thumbnailUrl: bestThumb(s.thumbnails),
        channelId: s.channelId ?? null,
        channelTitle: s.channelTitle ?? null,
        channelUrl: channel?.url ?? (s.channelId ? `https://www.youtube.com/channel/${s.channelId}` : null),
        channelSubscribers: channel?.subscriberCount ?? null,
        channelVideoCount: channel?.videoCount ?? null,
        channelCountry: channel?.country ?? null,
        input: origin.input,
        sourceType: origin.sourceType,
        searchQuery: origin.searchQuery,
        playlistId: origin.playlistId,
        position: origin.position,
        scrapedAt: (opts.now ?? new Date()).toISOString(),
    };
}

export function isAfter(publishedAt: string | null | undefined, after: Date | undefined): boolean {
    if (!after || !publishedAt) return true;
    return new Date(publishedAt).getTime() >= after.getTime();
}

// ---------- Errors ----------

export function errorReason(body: unknown): string | undefined {
    return (body as ApiError | undefined)?.error?.errors?.[0]?.reason;
}

export function categorizeHttpError(
    status: number,
    body: unknown,
    rawText: string,
): { errorType: ErrorType; error: string; reason?: string } {
    const reason = errorReason(body);
    const message = (body as ApiError | undefined)?.error?.message ?? (rawText.slice(0, 200) || `HTTP ${status}`);
    if (reason === 'videoNotFound' || reason === 'channelNotFound' || reason === 'playlistNotFound' || status === 404) {
        return { errorType: 'not-found', error: message, reason };
    }
    if (
        reason === 'quotaExceeded' ||
        reason === 'rateLimitExceeded' ||
        reason === 'dailyLimitExceeded' ||
        status === 429
    ) {
        return {
            errorType: 'rate-limited',
            error: 'The YouTube API quota for this key is used up. Try again after midnight Pacific Time or add your own free API key.',
            reason,
        };
    }
    if (reason === 'keyInvalid' || (reason === 'badRequest' && /api key/i.test(message))) {
        return { errorType: 'other', error: 'The YouTube API key is not valid', reason: 'keyInvalid' };
    }
    if (
        reason === 'accessNotConfigured' ||
        (reason === 'forbidden' && /has not been used|is disabled/i.test(message))
    ) {
        return {
            errorType: 'other',
            error: "The YouTube Data API v3 is not enabled for this API key's Google Cloud project",
            reason: 'accessNotConfigured',
        };
    }
    return { errorType: 'http-error', error: `${message} (HTTP ${status})`, reason };
}

export function categorizeFetchError(err: unknown): { errorType: ErrorType; error: string } {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
        return { errorType: 'timeout', error: 'Request timed out' };
    return { errorType: 'network', error: e?.cause?.code ?? e?.message ?? 'Network error' };
}

export function isKeyWideError(reason: string | undefined): boolean {
    return (
        reason === 'quotaExceeded' ||
        reason === 'dailyLimitExceeded' ||
        reason === 'keyInvalid' ||
        reason === 'accessNotConfigured'
    );
}
