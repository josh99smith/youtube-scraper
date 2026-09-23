import { describe, expect, it } from 'vitest';

import { YouTubeClient } from '../src/client.js';
import {
    assertList,
    bestThumb,
    categorizeHttpError,
    channelItem,
    isAfter,
    isKeyWideError,
    liveStatus,
    mapChannel,
    mapVideo,
    type Origin,
    parseDuration,
    parsePublishedAfter,
    parseTarget,
    ResponseShapeError,
    uploadsPlaylistId,
    type ChannelResource,
    type VideoResource,
} from '../src/youtube.js';

// Synthetic fixtures shaped like YouTube Data API v3 responses.
const CHANNEL: ChannelResource = {
    id: 'UCtest00000000000000000A',
    snippet: {
        title: 'Test Channel',
        description: 'About us',
        customUrl: '@testchannel',
        publishedAt: '2015-06-01T00:00:00Z',
        country: 'US',
        thumbnails: { default: { url: 'https://yt3.ggpht.com/s88' }, high: { url: 'https://yt3.ggpht.com/s800' } },
    },
    statistics: { viewCount: '123456', subscriberCount: '7890', hiddenSubscriberCount: false, videoCount: '42' },
    brandingSettings: { channel: { keywords: 'tech "web scraping" tutorials' } },
};
const VIDEO: VideoResource = {
    id: 'AAAAAAAAAAA',
    snippet: {
        publishedAt: '2026-09-01T12:00:00Z',
        channelId: 'UCtest00000000000000000A',
        channelTitle: 'Test Channel',
        title: 'How to test',
        description: 'A long description that goes on',
        thumbnails: {
            high: { url: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg' },
            maxres: { url: 'https://i.ytimg.com/vi/AAAAAAAAAAA/maxresdefault.jpg' },
        },
        tags: ['testing', 'vitest'],
        categoryId: '28',
        liveBroadcastContent: 'none',
        defaultAudioLanguage: 'en-US',
    },
    contentDetails: { duration: 'PT1H2M3S', definition: 'hd', caption: 'false' },
    status: { license: 'creativeCommon', madeForKids: false },
    statistics: { viewCount: '1000', likeCount: '50', commentCount: '7' },
};
const ORIGIN: Origin = {
    input: '@testchannel',
    sourceType: 'channel',
    searchQuery: null,
    playlistId: 'UUtest00000000000000000A',
    position: 0,
};
const NOW = new Date('2026-09-23T00:00:00Z');

describe('parseTarget', () => {
    it('parses videos, channels, handles and playlists', () => {
        expect(
            parseTarget('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb'),
        ).toMatchObject({ kind: 'video', videoId: 'jNQXAC9IVRw' });
        expect(parseTarget('https://youtube.com/shorts/jNQXAC9IVRw')).toMatchObject({ kind: 'video' });
        expect(parseTarget('https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb')).toMatchObject({
            kind: 'playlist',
            playlistId: 'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
        });
        expect(parseTarget('PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb')).toMatchObject({ kind: 'playlist' });
        expect(parseTarget('https://www.youtube.com/@YouTube/shorts')).toMatchObject({
            kind: 'handle',
            handle: '@YouTube',
        });
        expect(parseTarget('https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ')).toMatchObject({
            kind: 'channel',
        });
        expect(parseTarget('jNQXAC9IVRw')).toMatchObject({ kind: 'video' });
    });

    it('rejects everything else', () => {
        for (const s of [
            '',
            'https://vimeo.com/123',
            'https://www.youtube.com/results?search_query=cats',
            'https://www.youtube.com/playlist?list=bad',
            'hello world',
        ]) {
            expect(parseTarget(s)).toBeNull();
        }
    });

    it('derives the uploads playlist from a channel ID', () => {
        expect(uploadsPlaylistId('UCBR8-60-B28hp2BmDPdntcQ')).toBe('UUBR8-60-B28hp2BmDPdntcQ');
    });
});

describe('parsers', () => {
    it('parses ISO 8601 durations', () => {
        expect(parseDuration('PT19S')).toBe(19);
        expect(parseDuration('PT1H2M3S')).toBe(3723);
        expect(parseDuration('P1DT2H')).toBe(93600);
        expect(parseDuration('P0D')).toBe(0);
        expect(parseDuration(undefined)).toBeNull();
        expect(parseDuration('garbage')).toBeNull();
    });

    it('parses publishedAfter values', () => {
        expect(parsePublishedAfter('7 days', NOW)?.toISOString()).toBe('2026-09-16T00:00:00.000Z');
        expect(parsePublishedAfter('1 year', NOW)?.toISOString()).toBe('2025-09-23T00:00:00.000Z');
        expect(parsePublishedAfter('2026-01-31')?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
        expect(parsePublishedAfter(undefined)).toBeUndefined();
        expect(parsePublishedAfter('soon')).toBeNull();
        expect(isAfter('2026-09-20T00:00:00Z', new Date('2026-09-16T00:00:00Z'))).toBe(true);
        expect(isAfter('2026-09-01T00:00:00Z', new Date('2026-09-16T00:00:00Z'))).toBe(false);
        expect(isAfter(undefined, new Date())).toBe(true);
    });

    it('picks the largest thumbnail', () => {
        expect(bestThumb(VIDEO.snippet!.thumbnails)).toContain('maxresdefault');
        expect(bestThumb(undefined)).toBeNull();
    });
});

describe('mapChannel / channelItem', () => {
    it('maps statistics, handle and keywords', () => {
        const c = mapChannel(CHANNEL)!;
        expect(c).toMatchObject({
            channelId: 'UCtest00000000000000000A',
            handle: '@testchannel',
            url: 'https://www.youtube.com/@testchannel',
            subscriberCount: 7890,
            viewCount: 123456,
            videoCount: 42,
            country: 'US',
            thumbnailUrl: 'https://yt3.ggpht.com/s800',
            keywords: ['tech', 'web scraping', 'tutorials'],
        });
        expect(channelItem(c, '@testchannel', NOW)).toMatchObject({
            type: 'channel',
            uploadsPlaylistId: 'UUtest00000000000000000A',
            scrapedAt: NOW.toISOString(),
        });
    });

    it('hides hidden subscriber counts and placeholder dates', () => {
        const c = mapChannel({
            ...CHANNEL,
            snippet: { ...CHANNEL.snippet, publishedAt: '1970-01-01T00:00:00Z', customUrl: undefined },
            statistics: { ...CHANNEL.statistics, hiddenSubscriberCount: true },
        })!;
        expect(c.subscriberCount).toBeNull();
        expect(c.publishedAt).toBeNull();
        expect(c.url).toBe('https://www.youtube.com/channel/UCtest00000000000000000A');
        expect(mapChannel({ id: 'x' })).toBeNull();
    });
});

describe('mapVideo', () => {
    it('maps statistics, metadata and channel stats', () => {
        const v = mapVideo(VIDEO, ORIGIN, mapChannel(CHANNEL)!, { now: NOW })!;
        expect(v).toMatchObject({
            type: 'video',
            url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
            durationSeconds: 3723,
            viewCount: 1000,
            likeCount: 50,
            commentCount: 7,
            tags: ['testing', 'vitest'],
            category: 'Science & Technology',
            language: 'en-US',
            liveStatus: 'none',
            hasCaptions: false,
            license: 'creativeCommon',
            thumbnailUrl: 'https://i.ytimg.com/vi/AAAAAAAAAAA/maxresdefault.jpg',
            channelUrl: 'https://www.youtube.com/@testchannel',
            channelSubscribers: 7890,
            channelVideoCount: 42,
            sourceType: 'channel',
            position: 0,
        });
    });

    it('keeps hidden likes and disabled comments as null, truncates descriptions', () => {
        const v = mapVideo({ ...VIDEO, statistics: { viewCount: '5' } }, ORIGIN, undefined, {
            maxDescriptionLength: 6,
        })!;
        expect(v.likeCount).toBeNull();
        expect(v.commentCount).toBeNull();
        expect(v.description).toBe('A long…');
        expect(v.channelUrl).toBe('https://www.youtube.com/channel/UCtest00000000000000000A');
        expect(v.channelSubscribers).toBeNull();
    });

    it('detects live states', () => {
        expect(liveStatus({ snippet: { liveBroadcastContent: 'live' } })).toBe('live');
        expect(liveStatus({ snippet: { liveBroadcastContent: 'upcoming' } })).toBe('upcoming');
        expect(
            liveStatus({
                snippet: { liveBroadcastContent: 'none' },
                liveStreamingDetails: { actualStartTime: '2026-01-01T00:00:00Z' },
            }),
        ).toBe('was-live');
    });

    it('refuses incomplete resources (silent-failure guard)', () => {
        expect(mapVideo({ id: 'x' }, ORIGIN, undefined)).toBeNull();
        expect(mapVideo({ snippet: VIDEO.snippet }, ORIGIN, undefined)).toBeNull();
        expect(() => assertList({}, 'videos')).toThrow(ResponseShapeError);
    });
});

const err = (code: number, reason: string, message = 'msg') => ({
    error: { code, message, errors: [{ reason, message }] },
});

describe('errors and client', () => {
    it('categorises API errors', () => {
        expect(categorizeHttpError(404, err(404, 'playlistNotFound'), '').errorType).toBe('not-found');
        expect(categorizeHttpError(403, err(403, 'quotaExceeded'), '')).toMatchObject({
            errorType: 'rate-limited',
            reason: 'quotaExceeded',
        });
        expect(
            categorizeHttpError(400, err(400, 'badRequest', 'API key not valid. Please pass a valid API key.'), '')
                .reason,
        ).toBe('keyInvalid');
        expect(categorizeHttpError(502, undefined, '').errorType).toBe('http-error');
        expect(isKeyWideError('quotaExceeded')).toBe(true);
        expect(isKeyWideError('playlistNotFound')).toBe(false);
    });

    it('counts search calls as 100 quota units and keeps the key out of the URL', async () => {
        const urls: string[] = [];
        const client = new YouTubeClient({
            apiKey: 'secret',
            fetchImpl: (async (url: URL) => {
                urls.push(String(url));
                return new Response(JSON.stringify({ items: [] }), { status: 200 });
            }) as unknown as typeof fetch,
        });
        await client.list('search', { q: 'cats', videoDuration: undefined }, 100);
        await client.list('videos', { id: 'AAAAAAAAAAA' });
        expect(client.unitsUsed).toBe(101);
        expect(urls.join(' ')).not.toContain('secret');
        expect(urls[0]).not.toContain('videoDuration');
    });
});
