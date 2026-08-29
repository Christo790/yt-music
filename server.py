from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS
from ytmusicapi import YTMusic
import yt_dlp
import requests
import os

app = Flask(__name__)
CORS(app)

yt = YTMusic()

# ============================================================
# FRONTEND
# ============================================================

@app.route("/")
def home():
    """Serve the Echo Music frontend."""
    return send_from_directory(".", "index.html")


# ============================================================
# YT-DLP AUDIO URL
# ============================================================

def get_audio_url_ytdlp(video_id):
    """
    Extract audio URL using yt-dlp.
    """

    url = f"https://music.youtube.com/watch?v={video_id}"

    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "nocheckcertificate": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            # Direct URL
            if info.get("url"):
                return info["url"]

            # Search formats
            formats = info.get("formats", [])

            audio_formats = [
                f for f in formats
                if f.get("url")
                and f.get("acodec") != "none"
                and f.get("vcodec") == "none"
            ]

            if audio_formats:
                audio_formats.sort(
                    key=lambda x: x.get("abr") or 0,
                    reverse=True
                )

                return audio_formats[0]["url"]

            # Fallback
            for fmt in formats:
                if fmt.get("url"):
                    return fmt["url"]

            return None

    except Exception as e:
        print(f"yt-dlp error: {e}")
        return None


# ============================================================
# STATUS / API
# ============================================================

@app.route("/api")
def api_status():
    return jsonify({
        "status": "Echo Music Backend Running",
        "version": "2.0"
    })


# ============================================================
# SEARCH
# ============================================================

@app.route("/search")
def search():

    query = request.args.get("q", "").strip()

    if not query:
        return jsonify({
            "error": "No query provided"
        }), 400

    try:

        results = yt.search(
            query,
            filter="songs",
            limit=20
        )

        songs = []

        for track in results:

            if "videoId" not in track:
                continue

            thumbnails = track.get("thumbnails", [])

            thumbnail = (
                thumbnails[-1].get("url", "")
                if thumbnails
                else ""
            )

            artists = track.get("artists", [])

            artist_names = ", ".join(
                artist.get("name", "Unknown")
                for artist in artists
            )

            album = track.get("album") or {}

            songs.append({
                "id": track["videoId"],
                "title": track.get("title", "Unknown"),
                "artist": artist_names,
                "album": album.get("name", ""),
                "duration": track.get("duration", "0:00"),
                "thumbnail": thumbnail
            })

        return jsonify(songs)

    except Exception as e:

        print(f"Search error: {e}")

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# TRENDING
# ============================================================

@app.route("/trending")
def trending():

    try:

        results = yt.search(
            "popular music",
            filter="songs",
            limit=20
        )

        songs = []

        for track in results:

            if "videoId" not in track:
                continue

            thumbnails = track.get("thumbnails", [])

            thumbnail = (
                thumbnails[-1].get("url", "")
                if thumbnails
                else ""
            )

            artists = track.get("artists", [])

            artist_names = ", ".join(
                artist.get("name", "Unknown")
                for artist in artists
            )

            songs.append({
                "id": track["videoId"],
                "title": track.get("title", "Unknown"),
                "artist": artist_names,
                "thumbnail": thumbnail,
                "duration": track.get(
                    "duration",
                    "0:00"
                )
            })

        return jsonify(songs)

    except Exception as e:

        print(f"Trending error: {e}")

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# GET SONG INFORMATION
# ============================================================

@app.route("/song/<song_id>")
def get_song(song_id):

    print("\n" + "=" * 60)
    print(f"Getting song: {song_id}")

    try:

        info = yt.get_song(song_id)

        video_details = info.get(
            "videoDetails",
            {}
        )

        title = video_details.get(
            "title",
            "Unknown"
        )

        artist = video_details.get(
            "author",
            "Unknown"
        )

        thumbnails = video_details.get(
            "thumbnail",
            {}
        )

        thumbnail_list = thumbnails.get(
            "thumbnails",
            []
        )

        thumbnail = (
            thumbnail_list[-1].get("url", "")
            if thumbnail_list
            else ""
        )

        print(f"Title: {title}")
        print(f"Artist: {artist}")

        # Test whether audio is available
        print("Getting stream URL with yt-dlp...")

        stream_url = get_audio_url_ytdlp(
            song_id
        )

        if stream_url:
            print("SUCCESS: Got stream URL")
        else:
            print("FAILED: Could not get stream URL")

        length_seconds = video_details.get(
            "lengthSeconds",
            0
        )

        try:
            length_seconds = int(
                length_seconds
            )
        except:
            length_seconds = 0

        response_data = {
            "id": song_id,
            "title": title,
            "artist": artist,
            "stream_url": (
                f"/stream/{song_id}"
                if stream_url
                else None
            ),
            "thumbnail": thumbnail,
            "duration_seconds": length_seconds
        }

        print(f"Response: {response_data}")
        print("=" * 60)

        return jsonify(response_data)

    except Exception as e:

        print(f"ERROR in get_song: {e}")

        import traceback
        traceback.print_exc()

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# STREAM AUDIO
# ============================================================

@app.route("/stream/<song_id>")
def stream_song(song_id):

    print("\n" + "=" * 60)
    print(f"Streaming request: {song_id}")

    try:

        stream_url = get_audio_url_ytdlp(
            song_id
        )

        if not stream_url:

            return jsonify({
                "error": "Stream not available"
            }), 404

        print("Audio URL obtained")

        range_header = request.headers.get(
            "Range"
        )

        headers = {
            "User-Agent": (
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/151.0 Safari/537.36"
            ),
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Referer": "https://music.youtube.com/"
        }

        if range_header:
            headers["Range"] = range_header

            print(
                f"Range request: {range_header}"
            )

        resp = requests.get(
            stream_url,
            headers=headers,
            stream=True,
            timeout=30
        )

        print(
            f"YouTube status: {resp.status_code}"
        )

        content_type = resp.headers.get(
            "Content-Type",
            "audio/webm"
        )

        response_headers = {
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache"
        }

        if "Content-Length" in resp.headers:

            response_headers[
                "Content-Length"
            ] = resp.headers["Content-Length"]

        if "Content-Range" in resp.headers:

            response_headers[
                "Content-Range"
            ] = resp.headers["Content-Range"]

        def generate():

            try:

                for chunk in resp.iter_content(
                    chunk_size=8192
                ):

                    if chunk:
                        yield chunk

            finally:
                resp.close()

        status = (
            206
            if "Content-Range" in resp.headers
            else resp.status_code
        )

        return Response(
            generate(),
            status=status,
            headers=response_headers
        )

    except Exception as e:

        print(
            f"Streaming error: {e}"
        )

        import traceback
        traceback.print_exc()

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# LYRICS
# ============================================================

@app.route("/lyrics/<song_id>")
def get_lyrics(song_id):

    try:

        lyrics = yt.get_lyrics(
            song_id
        )

        if not lyrics:
            return jsonify({
                "lyrics": "Lyrics not available"
            })

        return jsonify({
            "lyrics": lyrics.get(
                "lyrics",
                "Lyrics not available"
            )
        })

    except Exception as e:

        print(
            f"Lyrics error: {e}"
        )

        return jsonify({
            "lyrics": "Lyrics not available"
        })


# ============================================================
# HEALTH CHECK
# ============================================================

@app.route("/health")
def health():

    return jsonify({
        "status": "ok",
        "service": "Echo Music"
    })


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    print("=" * 60)
    print("Echo Music Web Backend")
    print("=" * 60)
    print(f"Starting server on port {port}")
    print("=" * 60)

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
