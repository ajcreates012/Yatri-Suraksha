import sqlite3
import os
import requests
import math

from flask import Flask, jsonify, request, render_template
from dotenv import load_dotenv


app = Flask(__name__)
load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

def send_telegram_alert(message_text):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    data = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message_text
    }

    response = requests.post(url, json=data)

    return response.json()

DATABASE = 'yatra_suraksha.db'

def calculate_distance(lat1, lng1, lat2, lng2):
    R = 6371000  # Earth radius in meters

    lat1 = math.radians(lat1)
    lat2 = math.radians(lat2)

    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(dlng / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    with open('schema.sql', 'r') as f:
        conn.executescript(f.read())
    
    # Seed initial danger zones matching frontend mock data
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM danger_zones")
    if cursor.fetchone()[0] == 0:
        zones = [
            ("Isolated Trail Segment", 28.6139, 77.2090, 800, "high", "Low lighting and limited cell reception reported."),
            ("Crowded Transit Node", 28.6250, 77.2180, 500, "medium", "Exercise increased awareness during peak transit hours.")
        ]
        cursor.executemany(
            "INSERT INTO danger_zones (name, lat, lng, radius, risk, description) VALUES (?, ?, ?, ?, ?, ?)",
            zones
        )
        conn.commit()
    conn.close()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/danger-zones', methods=['GET'])
def get_danger_zones():
    conn = get_db_connection()
    zones = conn.execute('SELECT * FROM danger_zones').fetchall()
    conn.close()
    return jsonify([dict(zone) for zone in zones])

@app.route('/api/check-danger-zone', methods=['POST'])
def check_danger_zone():

    data = request.get_json()

    lat = data.get('lat')
    lng = data.get('lng')

    if lat is None or lng is None:
        return jsonify({
            "status": "error",
            "message": "Location is required"
        }), 400

    conn = get_db_connection()

    zones = conn.execute(
        'SELECT * FROM danger_zones'
    ).fetchall()

    conn.close()

    for zone in zones:

        distance = calculate_distance(
            float(lat),
            float(lng),
            float(zone['lat']),
            float(zone['lng'])
        )

        if distance <= float(zone['radius']):

            telegram_message = (
                "🚨 YATRA SURAKSHA ALERT 🚨\n\n"
                f"⚠️ Danger Zone: {zone['name']}\n"
                f"🔴 Risk Level: {zone['risk'].upper()}\n\n"
                f"📍 Your Location:\n"
                f"https://maps.google.com/?q={lat},{lng}\n\n"
                f"ℹ️ {zone['description']}\n\n"
                "Please move towards a safer location."
            )

            try:
                result = send_telegram_alert(telegram_message)

                if result.get("ok"):
                    print("Danger zone Telegram alert sent successfully")
                else:
                    print("Telegram error:", result)

            except Exception as e:
                print("Telegram error:", e)

            return jsonify({
                "status": "danger",
                "danger_zone": {
                    "name": zone['name'],
                    "risk": zone['risk'],
                    "description": zone['description'],
                    "distance": round(distance, 2)
                }
            })

    return jsonify({
        "status": "safe",
        "message": "You are not currently inside a danger zone."
    })

@app.route('/api/contacts', methods=['GET', 'POST'])
def handle_contacts():
    conn = get_db_connection()
    if request.method == 'POST':
        data = request.get_json()
        conn.execute(
            'INSERT INTO contacts (name, phone, relation) VALUES (?, ?, ?)',
            (data['name'], data['phone'], data['relation'])
        )
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "Contact added"}), 201
    
    contacts = conn.execute('SELECT * FROM contacts').fetchall()
    conn.close()
    return jsonify([dict(c) for c in contacts])

@app.route('/api/sos', methods=['POST'])
def send_sos():

    data = request.get_json()

    lat = data.get('lat')
    lng = data.get('lng')

    if lat is None or lng is None:
        return jsonify({
            "status": "error",
            "message": "Location is required"
        }), 400

    message_body = (
        "🚨 YATRA SURAKSHA SOS 🚨\n\n"
        "Emergency assistance is required.\n\n"
        f"📍 Current location:\n"
        f"https://maps.google.com/?q={lat},{lng}"
    )

    try:

        result = send_telegram_alert(message_body)

        if not result.get("ok"):
            print("Telegram error:", result)

            return jsonify({
                "status": "error",
                "message": "Failed to send Telegram alert."
            }), 500

        print("Telegram SOS sent successfully")

        return jsonify({
            "status": "alert_sent",
            "message": "Emergency Telegram alert sent successfully."
        })

    except Exception as e:

        print("Telegram error:", e)

        return jsonify({
            "status": "error",
            "message": "Failed to send emergency Telegram alert."
        }), 500
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)