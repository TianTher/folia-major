import type { SongGroup, SongResult } from '../../types';
import type { OnlineProviderId, ProviderSongMetadata } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { getOnlineMusicProvider } from './providerRegistry';

// src/services/onlineMusic/songMetadata.ts

// Resolves legacy provider fields once at the provider boundary and exposes only canonical song metadata to consumers.
export const getProviderSongMetadata = (
    song: SongResult | null | undefined,
    providerId?: OnlineProviderId,
): ProviderSongMetadata => {
    if (!song) {
        return {
            artists: [],
            album: { id: 0, name: '' },
            durationMs: 0,
            aliases: [],
            translatedNames: [],
        };
    }
    const sourceRef = getPlaybackSourceRef(song);
    const provider = getOnlineMusicProvider(
        providerId || (sourceRef.kind === 'online' ? sourceRef.providerId : ''),
    );
    return provider?.songMetadata?.getSongMetadata(song) || createProviderSongMetadata(song);
};

export const getSongArtistLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).artists.map(artist => artist.name).filter(Boolean).join(', ') : ''
);

export const getSongAlbumLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).album?.name || '' : ''
);

export const getSongDurationMs = (song: SongResult | null | undefined, providerId?: OnlineProviderId): number => (
    song ? getProviderSongMetadata(song, providerId).durationMs : 0
);

export const getSongCoverUrl = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string | undefined => (
    song ? getProviderSongMetadata(song, providerId).coverUrl : undefined
);

/** The row this song shares with others (`songGroup`), where it belongs to one: a video and its parts. */
export const getSongGroup = (song: SongResult | null | undefined): SongGroup | undefined => (
    song ? (song as { songGroup?: SongGroup }).songGroup : undefined
);

/**
 * How many songs the row this one belongs to holds, as the library says it ("12P"): a video and its parts are one row
 * that opens (Folium 2.3 `songGroup`). '' for a song that is a row of its own.
 */
export const getSongGroupLabel = (song: SongResult | null | undefined): string => {
    const total = getSongGroup(song)?.total;
    return typeof total === 'number' && total > 1 ? `${total}P` : '';
};
export const getProviderSongPageUrl = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string | null => {
    if (!song) return null;
    const sourceRef = getPlaybackSourceRef(song);
    const provider = getOnlineMusicProvider(providerId || (sourceRef.kind === 'online' ? sourceRef.providerId : ''));
    return provider?.getSongPageUrl?.(song) || null;
};
