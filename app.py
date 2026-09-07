import sqlite3
from flask import Flask, jsonify, request, render_template

app = Flask(__name__)
DATABASE = 'yatra_suraksha.db'

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
    
    # Placeholder for SMS gateway integration (e.g., Twilio)
    print(f"[EMERGENCY SOS ALERT] Triggered at coordinates: {lat}, {lng}")
    
    return jsonify({
        "status": "alert_sent",
        "message": "Emergency broadcast dispatched to contacts and local authorities."
    })
    
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)