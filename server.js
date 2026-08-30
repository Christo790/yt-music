app.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "Missing search query"
      });
    }

    console.log(`Searching for: ${query}`);

    const data = await ytRequest("search", {
      query: query
    });

    const results = [];
    const seen = new Set();

    function addResult(renderer) {
      if (!renderer) return;

      const videoId =
        renderer.videoId ||
        renderer.navigationEndpoint?.watchEndpoint?.videoId;

      if (!videoId || seen.has(videoId)) {
        return;
      }

      let title = "Unknown Title";
      let artist = "Unknown Artist";
      let album = "";
      let duration = "";

      /*
       * musicResponsiveListItemRenderer
       */

      if (renderer.flexColumns) {

        const first =
          renderer.flexColumns[0]
            ?.musicResponsiveListItemFlexColumnRenderer
            ?.text;

        const second =
          renderer.flexColumns[1]
            ?.musicResponsiveListItemFlexColumnRenderer
            ?.text;

        if (first?.runs) {
          title = first.runs
            .map(x => x.text || "")
            .join("");
        } else if (first?.simpleText) {
          title = first.simpleText;
        }

        if (second?.runs) {

          const text = second.runs
            .map(x => x.text || "")
            .join("");

          const parts = text
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

      /*
       * musicTwoRowItemRenderer
       */

      if (
        renderer.musicTwoRowItemRenderer
      ) {
        const item =
          renderer.musicTwoRowItemRenderer;

        title =
          item.title?.runs
            ?.map(x => x.text || "")
            .join("") ||
          item.title?.simpleText ||
          title;

        artist =
          item.subtitle?.runs
            ?.map(x => x.text || "")
            .join("") ||
          artist;
      }

      /*
       * Thumbnail
       */

      let thumbnail =
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const thumbnails =
        renderer.thumbnail
          ?.musicThumbnailRenderer
          ?.thumbnail
          ?.thumbnails;

      if (
        Array.isArray(thumbnails) &&
        thumbnails.length
      ) {
        thumbnail =
          thumbnails[thumbnails.length - 1].url ||
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

    /*
     * Recursively search the entire response.
     */

    function walk(obj) {

      if (!obj || typeof obj !== "object") {
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

      if (
        obj.musicResponsiveListItemRenderer
      ) {

        addResult(
          obj.musicResponsiveListItemRenderer
        );

      }

      if (
        obj.musicTwoRowItemRenderer
      ) {

        addResult(
          obj.musicTwoRowItemRenderer
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
