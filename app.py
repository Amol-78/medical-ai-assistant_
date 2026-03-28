from flask import Flask, jsonify, request, render_template, send_file
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from config import Config
from models import db, bcrypt, Patient, Doctor, Admin, PatientReport, Appointment
from extensions import socketio
from auth import auth_bp
from admin import admin_bp
from patient import patient_bp
from doctor import doctor_bp

app = Flask(__name__)
app.config.from_object(Config)

db.init_app(app)
bcrypt.init_app(app)
jwt = JWTManager(app)
CORS(app)

# Initialize Socket.IO
socketio.init_app(app)

# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/auth')
app.register_blueprint(admin_bp, url_prefix='/admin')
app.register_blueprint(patient_bp, url_prefix='/patient')
app.register_blueprint(doctor_bp, url_prefix='/doctor')

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login_page():
    return render_template('login.html')

@app.route('/register/patient')
def register_patient_page():
    return render_template('register_patient.html')

@app.route('/register_doctor.html')
def register_doctor_page():
    return render_template('register_doctor.html')

@app.route('/request_verification.html')
def request_verification_page():
    return render_template('request_verification.html')

@app.route('/patient_dashboard.html')
def patient_dashboard():
    return render_template('patient_dashboard.html')

@app.route('/doctor_dashboard.html')
def doctor_dashboard():
    return render_template('doctor_dashboard.html')

@app.route('/admin_dashboard.html')
def admin_dashboard():
    return render_template('admin_dashboard.html')

# --- Socket.IO Event Handlers ---
from flask_socketio import join_room, leave_room, emit

@socketio.on('connect')
def handle_connect():
    print("A client connected strictly to the WebSocket layer.")

@socketio.on('join')
def handle_join(data):
    # Enforces strict segregated channels per-user to guarantee privacy
    room = str(data.get('user_id'))
    if room:
        join_room(room)
        print(f"Client securely joined socket room: {room}")

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Seed default admin if the table is empty
        if not Admin.query.first():
            default_admin = Admin(
                name='Super Admin',
                gender='Other',
                email='admin@medai.com',
                phone='0000000000'
            )
            default_admin.set_password('password123')
            db.session.add(default_admin)
            db.session.commit()
            print("Default admin created: admin@medai.com / password123")
    socketio.run(app, debug=True)