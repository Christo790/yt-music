// Echo Music Web Backend
const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const axios = require('axios');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// YouTube Music API using Innertube (no auth needed for search)
const YTM_BASE = 'https://music.youtube.com/youtubei/v1';
const YTM_KEY = 'AIzaSyC9XL3ZjWYYXSDmUBcaYWDcZYF-GUuQsKY';
const YTM_CLIENT = {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20231204.01.00',
    hl: 'en',
    gl: 'US'
};

async function ytmRequest(endpoint, body = {}) {
    const url = `${YTM_BASE}/${endpoint}?key=${YTM_KEY}&prettyPrint=false`;
    const payload = {
        context: { client: YTM_CLIENT },
        ...body
    };
    
    const response = await axios.post(url, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://music.youtube.com',
            'Referer': 'https://music.youtube.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0'
        }
    });
    return response.data;
}

function getSectionList(data) {
    const contents = data?.contents;
    const tabs = contents?.tabbedSearchResultsRenderer?.tabs;
    return tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents 
        || contents?.sectionListRenderer?.contents 
        || [];
}

function parseSongs(sectionList) {
    const songs = [];
    if (!sectionList || !Array.isArray(sectionList)) return songs;
    
    for (const section of sectionList) {
        const shelf = section.musicShelfRenderer || section.musicCardShelfRenderer;
        if (!shelf || !shelf.contents) continue;
        
        for (const item of shelf.contents) {
            const renderer = item.musicResponsiveListItemRenderer;
            if (!renderer) continue;
            
            const videoId = renderer.playlistItemData?.videoId || 
                           renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                           renderer.doubleTapCommand?.watchEndpoint?.videoId;
            
            if (!videoId) continue;
            
            const flexColumns = renderer.flexColumns || [];
            const title = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || 'Unknown Title';
            
            const col1Runs = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            const artist = col1Runs[0]?.text || 'Unknown Artist';
            const duration = col1Runs.length > 1 ? col1Runs[col1Runs.length - 1]?.text || '0:00' : '0:00';
            
            const thumbs = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
            const thumbnail = thumbs[thumbs.length - 1]?.url || '';
            
            songs.push({
                id: videoId,
                title: title,
                artist: artist,
                thumbnail: thumbnail,
                duration: duration
            });
        }
    }
    
    return songs;
}

const audioUrlCache = new Map(); // videoId -> { url, timestamp }
const pendingAudioUrlPromises = new Map(); // videoId -> Promise<string>

// Get audio URL using yt-dlp via direct execFile to handle spaces in folder path
async function getAudioUrl(videoId) {
    const cached = audioUrlCache.get(videoId);
    const now = Date.now();
    // Cache valid for 30 minutes
    if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
        console.log(`[Cache Hit] Audio URL for ${videoId}`);
        return cached.url;
    }
    
    // Deduplicate in-flight requests for the same videoId
    if (pendingAudioUrlPromises.has(videoId)) {
        console.log(`[In-Flight Reuse] Waiting on pending yt-dlp for ${videoId}`);
        return pendingAudioUrlPromises.get(videoId);
    }

    const promise = new Promise((resolve) => {
        let binaryPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
        if (!fs.existsSync(binaryPath)) {
            binaryPath = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');
        }
        
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const args = [
            url,
            '-j',
            '--no-warnings',
            '--no-call-home',
            '-f', 'bestaudio/best',
            '--referer', 'https://music.youtube.com/'
        ];
        
        execFile(binaryPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            pendingAudioUrlPromises.delete(videoId);
            if (err) {
                console.error('yt-dlp execFile error:', err.message);
                return resolve(null);
            }
            try {
                const data = JSON.parse(stdout);
                let streamUrl = data.url;
                if (!streamUrl && data.formats) {
                    const audioFormats = data.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
                    if (audioFormats.length > 0) {
                        audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                        streamUrl = audioFormats[0].url;
                    } else {
                        for (const fmt of data.formats) {
                            if (fmt.url) {
                                streamUrl = fmt.url;
                                break;
                            }
                        }
                    }
                }
                if (streamUrl) {
                    audioUrlCache.set(videoId, { url: streamUrl, timestamp: Date.now() });
                }
                resolve(streamUrl || null);
            } catch (e) {
                console.error('yt-dlp JSON parse error:', e.message);
                resolve(null);
            }
        });
    });

    pendingAudioUrlPromises.set(videoId, promise);
    return promise;
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (req, res) => {
    res.json({ status: "Echo Music Backend Running (Node.js)", version: "2.0" });
});

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: "No query provided" });
    }
    
    try {
        const data = await ytmRequest('search', {
            query: query,
            params: 'EgWKAQIIAWoQEAMQBBAFEAkQChAEEAAYACgB' // Songs filter
        });
        
        const sectionList = getSectionList(data);
        const songs = parseSongs(sectionList);
        
        // Pre-cache stream URL for top 3 songs in background
        songs.slice(0, 3).forEach(s => {
            getAudioUrl(s.id).catch(() => {});
        });

        res.json(songs);
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/trending', async (req, res) => {
    try {
        // Search for popular music
        const data = await ytmRequest('search', {
            query: 'popular music trending',
            params: 'EgWKAQIIAWoQEAMQBBAFEAkQChAEEAAYACgB'
        });
        
        const sectionList = getSectionList(data);
        const songs = parseSongs(sectionList);
        
        // Pre-cache stream URL for top 3 songs in background
        songs.slice(0, 3).forEach(s => {
            getAudioUrl(s.id).catch(() => {});
        });

        res.json(songs);
    } catch (error) {
        console.error('Trending error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/song/:songId', async (req, res) => {
    const { songId } = req.params;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Getting song: ${songId}`);
    
    try {
        // Get video details
        const data = await ytmRequest('player', {
            videoId: songId,
            racyCheckOk: true,
            contentCheckOk: true
        });
        
        const details = data.videoDetails;
        const title = details?.title || 'Unknown';
        const author = details?.author || 'Unknown';
        const thumbnails = details?.thumbnail?.thumbnails || [];
        const thumbnail = thumbnails[thumbnails.length - 1]?.url || '';
        const duration = parseInt(details?.lengthSeconds || 0);
        
        console.log(`Title: ${title}`);
        console.log(`Artist: ${author}`);
        console.log('Getting stream URL with yt-dlp...');
        
        const streamUrl = await getAudioUrl(songId);
        
        if (streamUrl) {
            console.log(`SUCCESS: Got stream URL`);
            console.log(`URL preview: ${streamUrl.substring(0, 60)}...`);
        } else {
            console.log('FAILED: Could not get stream URL');
        }
        
        const responseData = {
            id: songId,
            title: title,
            artist: author,
            stream_url: streamUrl ? `/stream/${songId}` : null,
            thumbnail: thumbnail,
            duration_seconds: duration
        };
        
        console.log(`${'='.repeat(50)}\n`);
        res.json(responseData);
        
    } catch (error) {
        console.error('ERROR in get_song:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/stream/:songId', async (req, res) => {
    const { songId } = req.params;
    
    // Log rich terminal output for song play request
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Getting song: ${songId}`);
    
    try {
        let title = 'Unknown', author = 'Unknown';
        try {
            const playerDetails = await ytmRequest('player', { videoId: songId, racyCheckOk: true, contentCheckOk: true });
            title = playerDetails?.videoDetails?.title || 'Unknown';
            author = playerDetails?.videoDetails?.author || 'Unknown';
        } catch (e) {}
        
        console.log(`Title: ${title}`);
        console.log(`Artist: ${author}`);
        console.log('Getting stream URL with yt-dlp...');
        
        const streamUrl = await getAudioUrl(songId);
        
        if (streamUrl) {
            console.log(`SUCCESS: Got stream URL`);
            console.log(`URL preview: ${streamUrl.substring(0, 60)}...`);
        } else {
            console.log('FAILED: Could not get stream URL');
            console.log(`${'='.repeat(50)}\n`);
            return res.status(404).json({ error: 'Stream not available' });
        }
        console.log(`${'='.repeat(50)}\n`);

        console.log(`Streaming request for: ${songId}`);
        console.log(`Proxying stream from: ${streamUrl.substring(0, 60)}...`);
        
        const rangeHeader = req.headers.range;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Referer': 'https://music.youtube.com/'
        };
        
        if (rangeHeader) {
            headers['Range'] = rangeHeader;
            console.log(`Range request: ${rangeHeader}`);
        }
        
        const response = await axios({
            method: 'get',
            url: streamUrl,
            headers: headers,
            responseType: 'stream',
            timeout: 30000
        });
        
        console.log(`YouTube response status: ${response.status}`);
        console.log(`Content-Type: ${response.headers['content-type']}`);
        
        const responseHeaders = {
            'Content-Type': response.headers['content-type'] || 'audio/webm',
            'Accept-Ranges': 'bytes'
        };
        
        if (response.headers['content-length']) {
            responseHeaders['Content-Length'] = response.headers['content-length'];
        }
        if (response.headers['content-range']) {
            responseHeaders['Content-Range'] = response.headers['content-range'];
        }
        
        res.status(response.status);
        Object.entries(responseHeaders).forEach(([key, value]) => {
            res.setHeader(key, value);
        });
        
        response.data.pipe(res);
        
    } catch (error) {
        console.error('Streaming error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/lyrics/:songId', async (req, res) => {
    const { songId } = req.params;
    
    try {
        // Try to get lyrics from browse endpoint
        const browseData = await ytmRequest('browse', {
            browseId: `MPLYt_${songId}`,
            params: 'ggMIegJADwodd2F0Y2gtbXVzaWMtbHlyaWNzMgYQ2pYBCBI%3D'
        });
        
        // Parse lyrics from response (simplified)
        const lyrics = browseData.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description?.runs?.[0]?.text;
        
        res.json({ lyrics: lyrics || 'Lyrics not available' });
    } catch (error) {
        res.json({ lyrics: 'Lyrics not available' });
    }
});

// Serve static files (your HTML frontend)
app.use(express.static(path.join(__dirname, '.')));

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('Echo Music Web Backend (Node.js)');
    console.log('='.repeat(60));
    console.log('\nInstall required packages:');
    console.log('  npm install express cors youtube-dl-exec axios');
    console.log(`\nStarting server on http://localhost:${PORT}`);
    console.log('='.repeat(60));
});