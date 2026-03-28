from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from datetime import datetime

db = SQLAlchemy()
bcrypt = Bcrypt()

class Patient(db.Model):
    __tablename__ = 'patients'
    patient_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    age = db.Column(db.Integer)
    gender = db.Column(db.String(10))
    email = db.Column(db.String(100), unique=True)
    phone = db.Column(db.String(15), unique=True)
    password_hash = db.Column(db.String(200), nullable=False)
    wallet_balance = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

class Doctor(db.Model):
    __tablename__ = 'doctors'
    doctor_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    age = db.Column(db.Integer)
    gender = db.Column(db.String(10))
    education = db.Column(db.String(200))
    experience_years = db.Column(db.Integer)
    specialization = db.Column(db.String(50), nullable=False)  # Must be from allowed list
    online_treatment_fee = db.Column(db.Integer, default=500)
    email = db.Column(db.String(100), unique=True)
    phone = db.Column(db.String(15), unique=True)
    password_hash = db.Column(db.String(200), nullable=False)
    total_earnings = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    available = db.Column(db.Boolean, default=True)  # For availability status

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

class Admin(db.Model):
    __tablename__ = 'admins'
    admin_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    gender = db.Column(db.String(10))
    email = db.Column(db.String(100), unique=True)
    phone = db.Column(db.String(15), unique=True)
    password_hash = db.Column(db.String(200), nullable=False)
    is_super_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

class DoctorRequest(db.Model):
    __tablename__ = 'doctor_requests'
    request_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    phone = db.Column(db.String(15), unique=True, nullable=False)
    education = db.Column(db.String(200), nullable=False)
    experience_years = db.Column(db.Integer, nullable=False)
    specialization = db.Column(db.String(50), nullable=False)
    online_treatment_fee = db.Column(db.Integer, default=500)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class PatientReport(db.Model):
    __tablename__ = 'patient_reports'
    report_id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.patient_id'), nullable=False)
    patient = db.relationship('Patient', foreign_keys=[patient_id])
    symptoms_text = db.Column(db.Text, nullable=False)
    symptoms_english = db.Column(db.Text, nullable=True)
    uploaded_image = db.Column(db.String(200))  # filename
    ai_generated_report = db.Column(db.Text)    # structured report from agent 1
    ai_report_english = db.Column(db.Text)      # English equivalent for doctor view
    severity_level = db.Column(db.String(20))   # Normal, Moderate, Critical
    recommended_specialization = db.Column(db.String(50))
    assigned_doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.doctor_id'), nullable=True)
    assigned_doctor = db.relationship('Doctor', foreign_keys=[assigned_doctor_id])
    doctor_response = db.Column(db.Text)         # doctor's diagnosis & treatment
    status = db.Column(db.String(20), default='pending')  # pending, reviewed
    audio_file = db.Column(db.String(200))       # generated mp3 filename
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Appointment(db.Model):
    __tablename__ = 'appointments'
    appointment_id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.patient_id'), nullable=False)
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.doctor_id'), nullable=False)
    appointment_date = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), default='requested')  # requested, confirmed, cancelled

    doctor = db.relationship('Doctor', backref='appointments')
    patient = db.relationship('Patient', backref='appointments')

class EmergencyCall(db.Model):
    __tablename__ = 'emergency_calls'
    call_id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.patient_id'), nullable=False)
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.doctor_id'), nullable=False)
    status = db.Column(db.String(20), default='ringing') # 'ringing', 'accepted', 'rejected', 'ended'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    patient = db.relationship('Patient', backref='emergency_calls')
    doctor = db.relationship('Doctor', backref='emergency_calls')

class Feedback(db.Model):
    __tablename__ = 'feedbacks'
    feedback_id = db.Column(db.Integer, primary_key=True)
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.doctor_id'), nullable=False)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.patient_id'), nullable=False)
    appointment_id = db.Column(db.Integer, db.ForeignKey('appointments.appointment_id'), nullable=True, unique=True)
    report_id = db.Column(db.Integer, db.ForeignKey('patient_reports.report_id'), nullable=True, unique=True)
    rating = db.Column(db.Integer, nullable=False) # 1-5
    comment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    doctor = db.relationship('Doctor', backref=db.backref('feedbacks', lazy=True))
    patient = db.relationship('Patient', backref=db.backref('feedbacks', lazy=True))
    appointment = db.relationship('Appointment', backref=db.backref('feedback', uselist=False))
    report = db.relationship('PatientReport', backref=db.backref('feedback', uselist=False))

class Transaction(db.Model):
    __tablename__ = 'transactions'
    transaction_id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patients.patient_id'), nullable=True)
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.doctor_id'), nullable=True)
    amount = db.Column(db.Float, nullable=False)
    transaction_type = db.Column(db.String(20), nullable=False) # 'CREDIT', 'DEBIT'
    description = db.Column(db.String(255))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('Patient', backref='transactions')
    doctor = db.relationship('Doctor', backref='transactions')