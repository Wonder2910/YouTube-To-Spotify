require('dotenv').config();
const http = require('http');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const querystring = require('querystring');

const app = express();

// Enhanced CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Test route
app.get('/', (req, res) => {
    res.json({
        status: 'Server running',
        endpoints: {
            fetchPlaylist: 'POST /fetch-playlist',
            spotifyLogin: 'GET /spotify-login',
            exportPlaylist: 'POST /export-playlist'
        }
    });
});

// YouTube playlist endpoint — SEARCH SPOTIFY IF TOKEN PROVIDED
app.post('/fetch-playlist', async (req, res) => {
    try {
        const { youtubeUrl } = req.body;
        if (!youtubeUrl) {
            return res.status(400).json({ error: 'YouTube URL is required' });
        }

        let playlistId;
        try {
            const url = new URL(youtubeUrl);
            playlistId = url.searchParams.get('list');
        } catch (e) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        if (!playlistId) {
            return res.status(400).json({ error: 'No playlist ID found in URL' });
        }

        const [playlistInfo, playlistItems] = await Promise.all([
            axios.get('https://www.googleapis.com/youtube/v3/playlists', {
                params: { part: 'snippet', id: playlistId, key: process.env.YOUTUBE_API_KEY }
            }),
            axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                params: { part: 'snippet', playlistId, key: process.env.YOUTUBE_API_KEY, maxResults: 50 }
            })
        ]);

        const tracks = playlistItems.data.items.map(item => ({
            name: cleanTrackName(item.snippet.title),
            artist: cleanArtistName(item.snippet.videoOwnerChannelTitle),
            status: 'searching',
            spotifyId: null
        }));

        // ← FIXED: Use Authorization header to search Spotify
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            await findSpotifyMatches(tracks, token);
        }

        const playlistTitle = playlistInfo.data.items[0]?.snippet.title || 'Converted Playlist';
        res.json({ playlistTitle, tracks });

    } catch (error) {
        console.error('Fetch error:', error.message);
        res.status(500).json({ error: 'Failed to fetch playlist', details: error.message });
    }
});

// Spotify Login
app.get('/spotify-login', (req, res) => {
    const scope = 'playlist-modify-public playlist-modify-private';
    const authUrl = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
        response_type: 'code',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        scope: scope,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    });
    res.redirect(authUrl);
});

// Spotify Callback — SEND TOKEN TO FRONTEND
app.get('/spotify-callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) throw new Error(error);

        const tokenResponse = await axios.post(
            'https://accounts.spotify.com/api/token',
            querystring.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
            }),
            {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(
                        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
                    ).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        const access_token = tokenResponse.data.access_token;
        res.redirect(`${process.env.FRONTEND_URL}/?auth=success&token=${access_token}`);
    } catch (error) {
        console.error('Spotify auth error:', error.message);
        res.redirect(`${process.env.FRONTEND_URL}/?auth=error&message=${encodeURIComponent(error.message)}`);
    }
});

// Export to Spotify — USE AUTH HEADER
app.post('/export-playlist', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Spotify authentication required' });
        }
        const token = authHeader.split(' ')[1];

        const { playlistTitle, tracks } = req.body;
        const spotifyTracks = tracks
            .filter(t => t.status === 'found' && t.spotifyId)
            .map(t => `spotify:track:${t.spotifyId}`);

        if (spotifyTracks.length === 0) {
            return res.status(400).json({ error: 'No tracks to export' });
        }

        const userInfo = await axios.get('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const playlist = await axios.post(
            `https://api.spotify.com/v1/users/${userInfo.data.id}/playlists`,
            { name: playlistTitle, public: false },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        await axios.post(
            `https://api.spotify.com/v1/playlists/${playlist.data.id}/tracks`,
            { uris: spotifyTracks },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        res.json({ playlistUrl: playlist.data.external_urls.spotify });

    } catch (error) {
        console.error('Export error:', error.message);
        res.status(500).json({ error: 'Failed to export playlist', details: error.message });
    }
});

// Helpers
function cleanTrackName(title) {
    return title
        .replace(/\(Official.*?\)/i, '')
        .replace(/\[Official.*?\]/i, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();
}

function cleanArtistName(artist) {
    return (artist || 'Unknown Artist')
        .replace(/- Topic$/, '')
        .trim();
}

async function findSpotifyMatches(tracks, accessToken) {
    await Promise.all(tracks.map(async track => {
        try {
            const response = await axios.get('https://api.spotify.com/v1/search', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    q: `${track.name} ${track.artist}`,
                    type: 'track',
                    limit: 1
                }
            });

            const spotifyTrack = response.data.tracks.items[0];
            if (spotifyTrack) {
                track.status = 'found';
                track.spotifyId = spotifyTrack.id;
                track.artist = spotifyTrack.artists[0].name;
            } else {
                track.status = 'not-found';
            }
        } catch (error) {
            console.error(`Spotify search failed for ${track.name}:`, error.message);
            track.status = 'not-found';
        }
    }));
}

// Start server
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    console.log(`Frontend: ${process.env.FRONTEND_URL}`);
    console.log(`Spotify Redirect: ${process.env.SPOTIFY_REDIRECT_URI}`);
});

server.on('error', error => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
    }
});