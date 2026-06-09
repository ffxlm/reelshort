from flask import Flask, render_template, request, jsonify
import urllib.request
import json

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/fetch-episodes', methods=['POST'])
def fetch_episodes():
    data = request.json
    token = data.get('token')
    series_id = data.get('series_id')
    
    if not token or not series_id:
        return jsonify({"error": "Missing token or series_id"}), 400

    url = f"https://api.seriesjeen.online/api/platform/reelshort/allepisodes/{series_id}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "curl/8.4.0"
    })
    
    try:
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read())
            
        episodes = []
        for ep in data["episodes"]:
            for stream in ep["streams"]:
                if "vod-112094" in stream["url"]:
                    episodes.append({
                        "ep-name": f'EP{ep["episode"]}',
                        "m3u8-url": stream["url"]
                    })
        
        # Create a JSON response object
        response = jsonify(episodes)
        response.headers.set('Content-Disposition', f'attachment; filename={series_id}.json')
        response.headers.set('Content-Type', 'application/json')
        return response
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
