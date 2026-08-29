from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from ytmusicapi import YTMusic
import yt_dlp
import requests

app = Flask(__name__)
CORS(app)

yt = YTMusic()

def get_audio_url_ytdlp(video_id):
    """
    Extract audio URL using yt-dlp (most reliable)
    """
    url = f"https://music.youtube.com/watch?v={video_id}"
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Get the best audio format
            if 'url' in info:
                # Direct URL available
                return info['url']
            elif 'formats' in info:
                # Find best audio format
                audio_formats = [f for f in info['formats'] 
                               if f.get('acodec') != 'none' and f.get('vcodec') == 'none']
                if audio_formats:
                    # Sort by quality (abr - audio bitrate)
                    audio_formats.sort(key=lambda x: x.get('abr', 0), reverse=True)
                    return audio_formats[0]['url']
                else:
                    # Fallback to first format with URL
                    for fmt in info['formats']:
                        if 'url' in fmt:
                            return fmt['url']
            
            return None
    except Exception as e:
        print(f"yt-dlp error: {e}")
        return None

@app.route('/')
def home():
    return jsonify({"status": "Echo Music Backend Running", "version": "2.0"})

@app.route('/search')
def search():
    query = request.args.get('q', '')
    if not query:
        return jsonify({"error": "No query provided"}), 400
    
    try:
        results = yt.search(query, filter="songs", limit=20)
        songs = []
        
        for track in results:
            if 'videoId' in track:
                thumbs = track.get('thumbnails', [])
                thumb_url = thumbs[-1]['url'] if thumbs else ''
                
                songs.append({
                    "id": track['videoId'],
                    "title": track.get('title', 'Unknown'),
                    "artist": ", ".join([a['name'] for a in track.get('artists', [])]),
                    "album": track.get('album', {}).get('name', ''),
                    "duration": track.get('duration', '0:00'),
                    "thumbnail": thumb_url,
                })
        
        return jsonify(songs)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/trending')
def trending():
    try:
        results = yt.search("popular music", filter="songs", limit=20)
        songs = []
        
        for track in results:
            if 'videoId' in track:
                thumbs = track.get('thumbnails', [])
                thumb_url = thumbs[-1]['url'] if thumbs else ''
                
                songs.append({
                    "id": track['videoId'],
                    "title": track.get('title', 'Unknown'),
                    "artist": ", ".join([a['name'] for a in track.get('artists', [])]),
                    "thumbnail": thumb_url,
                    "duration": track.get('duration', '0:00')
                })
        
        return jsonify(songs)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/song/<song_id>')
def get_song(song_id):
    print(f"\n{'='*50}")
    print(f"Getting song: {song_id}")
    
    try:
        # Get metadata from ytmusicapi
        info = yt.get_song(song_id)
        video_details = info.get('videoDetails', {})
        
        title = video_details.get('title', 'Unknown')
        artist = video_details.get('author', 'Unknown')
        
        print(f"Title: {title}")
        print(f"Artist: {artist}")
        
        # Try to get stream URL using yt-dlp
        print("Getting stream URL with yt-dlp...")
        stream_url = get_audio_url_ytdlp(song_id)
        
        if stream_url:
            print(f"SUCCESS: Got stream URL")
            print(f"URL preview: {stream_url[:60]}...")
        else:
            print("FAILED: Could not get stream URL")
        
        response_data = {
            "id": song_id,
            "title": title,
            "artist": artist,
            "stream_url": f"/stream/{song_id}" if stream_url else None,
            "thumbnail": video_details.get('thumbnails', [{}])[-1].get('url', ''),
            "duration_seconds": int(video_details.get('lengthSeconds', 0))
        }
        
        print(f"Response: {response_data}")
        print(f"{'='*50}\n")
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"ERROR in get_song: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/stream/<song_id>')
def stream_song(song_id):
    print(f"\nStreaming request for: {song_id}")
    
    try:
        # Get fresh URL using yt-dlp
        stream_url = get_audio_url_ytdlp(song_id)
        
        if not stream_url:
            print("No stream URL available")
            return jsonify({"error": "Stream not available"}), 404
        
        print(f"Proxying stream from: {stream_url[:60]}...")
        
        # Get range header from client
        range_header = request.headers.get('Range')
        
        # Headers for YouTube
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Referer': 'https://music.youtube.com/',
        }
        
        if range_header:
            headers['Range'] = range_header
            print(f"Range request: {range_header}")
        
        # Request from YouTube
        resp = requests.get(stream_url, headers=headers, stream=True, timeout=30)
        
        print(f"YouTube response status: {resp.status_code}")
        print(f"Content-Type: {resp.headers.get('Content-Type')}")
        
        # Prepare response
        response_headers = {
            'Content-Type': resp.headers.get('Content-Type', 'audio/webm'),
            'Accept-Ranges': 'bytes',
        }
        
        if 'Content-Length' in resp.headers:
            response_headers['Content-Length'] = resp.headers['Content-Length']
        if 'Content-Range' in resp.headers:
            response_headers['Content-Range'] = resp.headers['Content-Range']
        
        def generate():
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        
        status = 206 if 'Content-Range' in resp.headers else 200
        return Response(generate(), status=status, headers=response_headers)
        
    except Exception as e:
        print(f"Streaming error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/lyrics/<song_id>')
def get_lyrics(song_id):
    try:
        lyrics = yt.get_lyrics(song_id)
        return jsonify({"lyrics": lyrics.get('lyrics', 'No lyrics available')})
    except:
        return jsonify({"lyrics": "Lyrics not available"})

if __name__ == '__main__':
    print("=" * 60)
    print("Echo Music Web Backend")
    print("=" * 60)
    print("\nInstall required packages:")
    print("  pip install flask flask-cors ytmusicapi yt-dlp requests")
    print("\nStarting server on http://localhost:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)