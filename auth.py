from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from models import db, Patient, Doctor, Admin, DoctorRequest, bcrypt
from datetime import timedelta
import json

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = data.get('identifier', '').strip()  # email or phone
    password = data.get('password')
    role = data.get('role')  # 'patient', 'doctor', 'admin'

    user = None
    if role == 'patient':
        user = Patient.query.filter((Patient.email == identifier) | (Patient.phone == identifier)).first()
    elif role == 'doctor':
        user = Doctor.query.filter((Doctor.email == identifier) | (Doctor.phone == identifier)).first()
    elif role == 'admin':
        user = Admin.query.filter((Admin.email == identifier) | (Admin.phone == identifier)).first()

    if user and bcrypt.check_password_hash(user.password_hash, password):
        identity_payload = {'id': getattr(user, f'{role}_id'), 'role': role}
        
        is_super = False
        # Inject Super Admin flag into JWT payload explicitly
        if role == 'admin' and getattr(user, 'is_super_admin', False):
            identity_payload['is_super_admin'] = True
            is_super = True
            
        identity_str = json.dumps(identity_payload)
        access_token = create_access_token(identity=identity_str, expires_delta=timedelta(days=1))
        return jsonify(access_token=access_token, role=role, is_super_admin=is_super), 200
    return jsonify({'msg': 'Invalid credentials'}), 401

@auth_bp.route('/register/patient', methods=['POST'])
def register_patient():
    data = request.get_json()
    # Validate required fields
    if Patient.query.filter_by(email=data['email']).first() or Patient.query.filter_by(phone=data['phone']).first():
        return jsonify({'msg': 'Email or phone already exists'}), 400
    patient = Patient(
        name=data['name'],
        age=data['age'],
        gender=data['gender'],
        email=data['email'],
        phone=data['phone']
    )
    patient.set_password(data['password'])
    db.session.add(patient)
    db.session.commit()
    return jsonify({'msg': 'Patient registered successfully'}), 201

@auth_bp.route('/request_doctor', methods=['POST'])
def request_doctor():
    data = request.get_json()
    if DoctorRequest.query.filter_by(email=data['email']).first() or Doctor.query.filter_by(email=data['email']).first():
        return jsonify({'msg': 'Email already registered or requested'}), 400
    if DoctorRequest.query.filter_by(phone=data['phone']).first() or Doctor.query.filter_by(phone=data['phone']).first():
        return jsonify({'msg': 'Phone already registered or requested'}), 400
    
    doc_req = DoctorRequest(
        name=data['name'],
        email=data['email'],
        phone=data['phone'],
        education=data['education'],
        experience_years=data['experience_years'],
        specialization=data['specialization'],
        online_treatment_fee=int(data.get('online_treatment_fee', 500))
    )
    db.session.add(doc_req)
    db.session.commit()
    return jsonify({'msg': 'Verification request submitted successfully'}), 201