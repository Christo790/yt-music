const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// Render provides PORT automatically.
// 5000 is used when running locally.
const PORT = process.env.PORT || 5000;

const YT_API = "https://music.youtube.com/youtubei/v1";
const CLIENT_VERSION = "1.20260827.01.00";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  Origin: "https://music.youtube.com",
  Referer: "https://music.youtube.com/",
};

// --------------------------------------------------
// YouTube Music request helper
// --------------------------------------------------

async function ytRequest(endpoint, body) {
  const response = await axios.post(
    `${YT_API}/${endpoint}?key=AIzaSyAO_F7bF5gZ1yJ4u7pQ8qT0JmJ3eYxNq2I`,
    {
      context: {
        client: {
          clientName: "WEB_REMIX",
          clientVersion: CLIENT_VERSION,
          hl: "en",
          gl: "US",
        },
      },
      ...body,
    },
    {
      headers: HEADERS,
      timeout: 20000,
    }
  );

  return response.data;
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function getVideoId(item) {
  return (
    item?.videoId ||
    item?.navigationEndpoint?.watchEndpoint?.videoId ||
    item?.playbackEndpoint?.watchEndpoint?.videoId ||
    null
  );
}

function cleanText(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  if (value.simpleText) {
    return value.simpleText;
  }

  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => run.text || "").join("");
  }

  return "";
}

function getRunsText(value) {
  return cleanText(value);
}

function getArtists(item) {
  const artists =
    item?.artists ||
    item?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
      ?.text?.runs ||
    [];

  if (Array.isArray(artists)) {
    return artists
      .map((artist) => artist.text)
      .filter(Boolean)
      .join(", ");
  }

  return cleanText(artists);
}

function parseSearchItem(item) {
  const renderer =
    item?.musicResponsiveListItemRenderer ||
    item?.musicTwoRowItemRenderer ||
    item;

  if (!renderer) return null;

  const videoId = getVideoId(renderer);

  if (!videoId) return null;

  const flexColumns = renderer.flexColumns || [];

  let title = "";
  let artist = "";
  let album = "";
  let duration = "";

  // Newer Music Responsive List Item format
  if (flexColumns.length) {
    title = cleanText(
      flexColumns[0]
        ?.musicResponsiveListItemFlexColumnRenderer
        ?.text
    );

    const secondText = cleanText(
      flexColumns[1]
        ?.musicResponsiveListItemFlexColumnRenderer
        ?.text
    );

    if (secondText) {
      artist = secondText.split(" • ")[0] || "";
      album = secondText.split(" • ")[1] || "";
    }
  }

  // Older / alternate format
  if (!title) {
    title =
      cleanText(renderer.title) ||
      cleanText(renderer.titleText) ||
      "";
  }

  if (!artist) {
    artist =
      cleanText(renderer.artist) ||
      cleanText(renderer.subtitle) ||
      "";
  }

  if (!album) {
    album = cleanText(renderer.album) || "";
  }

  duration =
    cleanText(renderer.lengthText) ||
    cleanText(renderer.duration) ||
    "";

  // Thumbnail
  let thumbnail = "";

  const thumbnails =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer.thumbnail?.thumbnails ||
    renderer.thumbnails ||
    [];

  if (Array.isArray(thumbnails) && thumbnails.length) {
    thumbnail = thumbnails[thumbnails.length - 1]?.url || "";
  }

  if (!thumbnail) {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  return {
    videoId,
    title: title || "Unknown",
    artist: artist || "Unknown Artist",
    album: album || "",
    duration: duration || "",
    thumbnail,
  };
}

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Echo Music Web Backend",
    playback: "YouTube Embed",
  });
});

// --------------------------------------------------
// Search
// --------------------------------------------------

app.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "Missing search query",
      });
    }

    console.log(`Searching for: ${query}`);

    const data = await ytRequest("search", {
      query,
      params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
    });

    const contents =
      data?.contents
        ?.tabbedSearchResultsRenderer
        ?.tabs?.[0]
        ?.tabRenderer
        ?.content
        ?.sectionListRenderer
        ?.contents || [];

    const results = [];

    for (const section of contents) {
      const items =
        section?.musicShelfRenderer?.contents ||
        section?.musicPlaylistShelfRenderer?.contents ||
        [];

      for (const item of items) {
        const parsed = parseSearchItem(item);

        if (parsed) {
          results.push(parsed);
        }
      }
    }

    // Fallback recursive extraction for different response formats.
    if (results.length === 0) {
      function walk(obj) {
        if (!obj || typeof obj !== "object") return;

        if (Array.isArray(obj)) {
          for (const child of obj) {
            walk(child);

            if (results.length >= 25) return;
          }

          return;
        }

        if (
          obj.musicResponsiveListItemRenderer ||
          obj.musicTwoRowItemRenderer
        ) {
          const parsed = parseSearchItem(obj);

          if (parsed) {
            results.push(parsed);
          }
        }

        if (results.length >= 25) return;

        for (const key of Object.keys(obj)) {
          walk(obj[key]);

          if (results.length >= 25) return;
        }
      }

      walk(data);
    }

    const unique = [];
    const seen = new Set();

    for (const item of results) {
      if (!seen.has(item.videoId)) {
        seen.add(item.videoId);
        unique.push(item);
      }

      if (unique.length >= 25) break;
    }

    console.log(`Found ${unique.length} results`);

    res.json(unique);
  } catch (error) {
    console.error("Search error:", error.message);

    res.status(500).json({
      error: "Search failed",
      details: error.message,
    });
  }
});

// --------------------------------------------------
// Trending / Home
// --------------------------------------------------

app.get("/trending", async (req, res) => {
  try {
    console.log("Getting trending music...");

    const data = await ytRequest("browse", {
      browseId: "FEmusic_home",
    });

    const results = [];

    function walk(obj) {
      if (!obj || typeof obj !== "object") return;

      if (Array.isArray(obj)) {
        for (const child of obj) {
          walk(child);

          if (results.length >= 30) return;
        }

        return;
      }

      if (
        obj.musicTwoRowItemRenderer ||
        obj.musicResponsiveListItemRenderer
      ) {
        const parsed = parseSearchItem(obj);

        if (parsed) {
          results.push(parsed);
        }
      }

      if (results.length >= 30) return;

      for (const key of Object.keys(obj)) {
        walk(obj[key]);

        if (results.length >= 30) return;
      }
    }

    walk(data);

    const unique = [];
    const seen = new Set();

    for (const item of results) {
      if (!seen.has(item.videoId)) {
        seen.add(item.videoId);
        unique.push(item);
      }

      if (unique.length >= 30) break;
    }

    res.json(unique);
  } catch (error) {
    console.error("Trending error:", error.message);

    res.status(500).json({
      error: "Could not get trending music",
      details: error.message,
    });
  }
});

// --------------------------------------------------
// Song metadata
// --------------------------------------------------

app.get("/song/:id", async (req, res) => {
  try {
    const videoId = req.params.id;

    if (!videoId) {
      return res.status(400).json({
        error: "Missing video ID",
      });
    }

    console.log(`Getting song: ${videoId}`);

    const data = await ytRequest("player", {
      videoId,
      params: "CgIQBg==",
    });

    const details = data?.videoDetails || {};

    const title = details.title || "Unknown";
    const artist = details.author || "Unknown Artist";

    let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    if (
      data?.videoDetails?.thumbnail?.thumbnails &&
      data.videoDetails.thumbnail.thumbnails.length
    ) {
      const thumbnails = data.videoDetails.thumbnail.thumbnails;

      thumbnail = thumbnails[thumbnails.length - 1].url;
    }

    res.json({
      videoId,
      title,
      artist,
      thumbnail,
      duration: details.lengthSeconds || "",
      channelId: details.channelId || "",
      description: details.shortDescription || "",
    });
  } catch (error) {
    console.error("Song metadata error:", error.message);

    res.status(500).json({
      error: "Could not get song information",
      details: error.message,
    });
  }
});

// --------------------------------------------------
// YouTube Embed information
// --------------------------------------------------
//
// The frontend uses this endpoint to obtain the video ID.
// Playback is handled by YouTube's official embedded player.
// No audio URL extraction happens here.
// --------------------------------------------------

app.get("/api/video/:id", (req, res) => {
  const videoId = req.params.id;

  if (!videoId) {
    return res.status(400).json({
      error: "Missing video ID",
    });
  }

  res.json({
    videoId,
    embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(
      videoId
    )}?autoplay=1&rel=0`,
  });
});

// --------------------------------------------------
// Lyrics
// --------------------------------------------------

app.get("/lyrics/:id", async (req, res) => {
  try {
    const videoId = req.params.id;

    if (!videoId) {
      return res.status(400).json({
        error: "Missing video ID",
      });
    }

    // Lyrics are not extracted through yt-dlp.
    // Return a clean response when lyrics aren't available.
    res.json({
      videoId,
      lyrics: "",
      available: false,
      message: "Lyrics are not available from this backend.",
    });
  } catch (error) {
    console.error("Lyrics error:", error.message);

    res.status(500).json({
      error: "Could not get lyrics",
      details: error.message,
    });
  }
});

// --------------------------------------------------
// Serve frontend
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// --------------------------------------------------
// 404 handler
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
  });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log("============================================================");
  console.log("Echo Music Web Backend (Node.js)");
  console.log("============================================================");
  console.log("");
  console.log("Playback: YouTube Embedded Player");
  console.log("yt-dlp: DISABLED");
  console.log("");
  console.log(`Server listening on port ${PORT}`);
  console.log("============================================================");
});
