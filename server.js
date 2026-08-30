const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const YT_API = "https://music.youtube.com/youtubei/v1";

const CLIENT_VERSION = "1.20260827.01.00";

const HEADERS = {
    "Content-Type": "application/json",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Origin": "https://music.youtube.com",
    "Referer": "https://music.youtube.com/"
};


// ============================================================
// YouTube Music API helper
// ============================================================

async function ytRequest(endpoint, body) {

    const response = await axios.post(
        `${YT_API}/${endpoint}`,
        {
            context: {
                client: {
                    clientName: "WEB_REMIX",
                    clientVersion: CLIENT_VERSION,
                    hl: "en",
                    gl: "US"
                }
            },
            ...body
        },
        {
            headers: HEADERS,
            timeout: 20000
        }
    );

    return response.data;
}


// ============================================================
// Text helper
// ============================================================

function getText(value) {

    if (!value) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (value.simpleText) {
        return value.simpleText;
    }

    if (Array.isArray(value.runs)) {

        return value.runs
            .map(run => run.text || "")
            .join("");

    }

    return "";
}


// ============================================================
// Search result parser
// ============================================================

function addSearchResult(renderer, results, seen) {

    if (!renderer) {
        return;
    }

    const videoId =
        renderer.videoId ||
        renderer.navigationEndpoint
            ?.watchEndpoint
            ?.videoId;

    if (!videoId) {
        return;
    }

    if (seen.has(videoId)) {
        return;
    }


    let title = "Unknown Title";
    let artist = "Unknown Artist";
    let album = "";
    let duration = "";


    // --------------------------------------------------------
    // musicResponsiveListItemRenderer
    // --------------------------------------------------------

    if (renderer.flexColumns) {

        const firstColumn =
            renderer.flexColumns[0]
                ?.musicResponsiveListItemFlexColumnRenderer
                ?.text;

        const secondColumn =
            renderer.flexColumns[1]
                ?.musicResponsiveListItemFlexColumnRenderer
                ?.text;


        if (firstColumn) {

            title = getText(firstColumn);

        }


        if (secondColumn) {

            const text =
                getText(secondColumn);

            const parts =
                text
                    .split(" • ")
                    .map(x => x.trim())
                    .filter(Boolean);


            if (parts.length > 0) {

                artist = parts[0];

            }


            if (parts.length > 1) {

                album = parts[1];

            }


            if (parts.length > 2) {

                duration = parts[2];

            }

        }

    }


    // --------------------------------------------------------
    // musicTwoRowItemRenderer
    // --------------------------------------------------------

    if (renderer.title) {

        const possibleTitle =
            getText(renderer.title);

        if (possibleTitle) {

            title = possibleTitle;

        }

    }


    if (renderer.subtitle) {

        const possibleArtist =
            getText(renderer.subtitle);

        if (possibleArtist) {

            artist = possibleArtist;

        }

    }


    // --------------------------------------------------------
    // Thumbnail
    // --------------------------------------------------------

    let thumbnail =
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;


    const thumbnails =
        renderer.thumbnail
            ?.musicThumbnailRenderer
            ?.thumbnail
            ?.thumbnails;


    if (
        Array.isArray(thumbnails) &&
        thumbnails.length > 0
    ) {

        thumbnail =
            thumbnails[thumbnails.length - 1]?.url ||
            thumbnail;

    }


    seen.add(videoId);


    results.push({

        id: videoId,

        videoId: videoId,

        title: title,

        artist: artist,

        album: album,

        duration: duration,

        thumbnail: thumbnail

    });

}


// ============================================================
// Recursively find music results
// ============================================================

function extractResults(data) {

    const results = [];

    const seen = new Set();


    function walk(obj) {

        if (!obj) {
            return;
        }


        if (Array.isArray(obj)) {

            for (const item of obj) {

                walk(item);

                if (results.length >= 30) {
                    return;
                }

            }

            return;
        }


        if (typeof obj !== "object") {
            return;
        }


        if (obj.musicResponsiveListItemRenderer) {

            addSearchResult(
                obj.musicResponsiveListItemRenderer,
                results,
                seen
            );

        }


        if (obj.musicTwoRowItemRenderer) {

            addSearchResult(
                obj.musicTwoRowItemRenderer,
                results,
                seen
            );

        }


        if (results.length >= 30) {
            return;
        }


        for (const key of Object.keys(obj)) {

            walk(obj[key]);

            if (results.length >= 30) {
                return;
            }

        }

    }


    walk(data);


    return results;

}


// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {

    res.json({

        status: "ok",

        service: "Echo Music Web Backend",

        playback: "YouTube Embedded Player",

        ytdlp: "disabled"

    });

});


// ============================================================
// SEARCH
// ============================================================

app.get("/search", async (req, res) => {

    try {

        const query =
            String(req.query.q || "").trim();


        if (!query) {

            return res.status(400).json({

                error: "Missing search query"

            });

        }


        console.log(
            `Searching for: ${query}`
        );


        const data =
            await ytRequest(
                "search",
                {
                    query: query
                }
            );


        const results =
            extractResults(data);


        console.log(
            `Found ${results.length} results`
        );


        res.json(results);


    } catch (error) {

        console.error(
            "Search error:",
            error.response?.data ||
            error.message
        );


        res.status(500).json({

            error: "Search failed",

            details: error.message

        });

    }

});


// ============================================================
// TRENDING
// ============================================================

app.get("/trending", async (req, res) => {

    try {

        console.log(
            "Getting trending music..."
        );


        const data =
            await ytRequest(
                "browse",
                {
                    browseId: "FEmusic_home"
                }
            );


        const results =
            extractResults(data);


        console.log(
            `Found ${results.length} trending results`
        );


        res.json(results);


    } catch (error) {

        console.error(
            "Trending error:",
            error.response?.data ||
            error.message
        );


        res.status(500).json({

            error: "Could not get trending music",

            details: error.message

        });

    }

});


// ============================================================
// SONG INFORMATION
// ============================================================

app.get("/song/:id", async (req, res) => {

    try {

        const videoId =
            req.params.id;


        if (!videoId) {

            return res.status(400).json({

                error: "Missing video ID"

            });

        }


        console.log(
            `Getting song: ${videoId}`
        );


        const data =
            await ytRequest(
                "player",
                {
                    videoId: videoId
                }
            );


        const details =
            data.videoDetails || {};


        const thumbnails =
            details.thumbnail
                ?.thumbnails || [];


        let thumbnail =
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;


        if (thumbnails.length) {

            thumbnail =
                thumbnails[
                    thumbnails.length - 1
                ].url;

        }


        res.json({

            id: videoId,

            videoId: videoId,

            title:
                details.title ||
                "Unknown Title",

            artist:
                details.author ||
                "Unknown Artist",

            thumbnail: thumbnail,

            duration:
                details.lengthSeconds ||
                "",

            channelId:
                details.channelId ||
                ""

        });


    } catch (error) {

        console.error(
            "Song error:",
            error.response?.data ||
            error.message
        );


        res.status(500).json({

            error: "Could not get song information",

            details: error.message

        });

    }

});


// ============================================================
// YOUTUBE VIDEO
// ============================================================

app.get("/api/video/:id", (req, res) => {

    const videoId =
        req.params.id;


    if (!videoId) {

        return res.status(400).json({

            error: "Missing video ID"

        });

    }


    res.json({

        videoId: videoId,

        embedUrl:
            `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`

    });

});


// ============================================================
// LYRICS
// ============================================================

app.get("/lyrics/:id", (req, res) => {

    res.json({

        videoId: req.params.id,

        lyrics: "",

        available: false

    });

});


// ============================================================
// SERVE INDEX.HTML
// ============================================================

app.get("/", (req, res) => {

    res.sendFile(
        __dirname + "/index.html"
    );

});


// ============================================================
// 404
// ============================================================

app.use((req, res) => {

    res.status(404).json({

        error: "Not found"

    });

});


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "============================================================"
        );

        console.log(
            "Echo Music Web Backend (Node.js)"
        );

        console.log(
            "============================================================"
        );

        console.log(
            "Playback: YouTube Embedded Player"
        );

        console.log(
            "yt-dlp: DISABLED"
        );

        console.log(
            `Server listening on port ${PORT}`
        );

        console.log(
            "============================================================"
        );

    }
);
