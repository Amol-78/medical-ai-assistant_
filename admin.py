from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import json
import string, random
from models import db, Doctor, PatientReport, DoctorRequest, Admin, Appointment, Feedback, Patient

admin_bp = Blueprint('admin', __name__)

ALLOWED_SPECIALIZATIONS = [
"Cardiologist", "Neurologist", "Dermatologist", "Orthopedic",
"General Physician", "Pediatrician", "ENT Specialist","Gastroenterologist", 
"Pulmonologist","Endocrinologist", "Psychiatrist","opthalmologist" ,"Oncologist",
"Rheumatologist", "Nephrologist", "Urologist", "Gynecologist", "Hematologist",
"Infectious Disease Specialist", "Allergist/Immunologist", "Geriatrician", 
"Physical Medicine & Rehabilitation Specialist", "Anesthesiologist","Dentist", 
"Ophthalmologist", "Radiologist", "Pathologist", "Surgeon", "Other"

]

@admin_bp.route('/doctors', methods=['GET'])
@jwt_required()
def get_doctors():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctors = Doctor.query.all()
    return jsonify([{
        'doctor_id': d.doctor_id,
        'name': d.name,
        'specialization': d.specialization,
        'email': d.email,
        'phone': d.phone,
        'available': d.available
    } for d in doctors]), 200

@admin_bp.route('/doctor', methods=['POST'])
@jwt_required()
def add_doctor():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    data = request.get_json()
    if data['specialization'] not in ALLOWED_SPECIALIZATIONS:
        return jsonify({'msg': 'Invalid specialization'}), 400
    if Doctor.query.filter_by(email=data['email']).first() or Doctor.query.filter_by(phone=data['phone']).first():
        return jsonify({'msg': 'Doctor with this email/phone already exists'}), 400
    doctor = Doctor(
        name=data['name'],
        age=data['age'],
        gender=data['gender'],
        education=data['education'],
        experience_years=data['experience_years'],
        specialization=data['specialization'],
        email=data['email'],
        phone=data['phone']
    )
    doctor.set_password(data['password'])  # default password, can be changed later
    db.session.add(doctor)
    db.session.commit()
    return jsonify({'msg': 'Doctor added successfully'}), 201

@admin_bp.route('/doctor/<int:doctor_id>', methods=['PUT', 'DELETE'])
@jwt_required()
def manage_doctor(doctor_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor = Doctor.query.get_or_404(doctor_id)
    if request.method == 'DELETE':
        db.session.delete(doctor)
        db.session.commit()
        return jsonify({'msg': 'Doctor deleted'}), 200
    else:  # PUT
        data = request.get_json()
        if 'specialization' in data and data['specialization'] not in ALLOWED_SPECIALIZATIONS:
            return jsonify({'msg': 'Invalid specialization'}), 400
        for key, value in data.items():
            if hasattr(doctor, key) and key not in ['doctor_id', 'password_hash', 'created_at']:
                setattr(doctor, key, value)
        db.session.commit()
        return jsonify({'msg': 'Doctor updated'}), 200

@admin_bp.route('/reports', methods=['GET'])
@jwt_required()
def view_reports():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    reports = PatientReport.query.all()
    # Return reports with patient details etc.
    return jsonify([{
        'report_id': r.report_id,
        'patient_id': r.patient_id,
        'symptoms': r.symptoms_text,
        'severity': r.severity_level,
        'status': r.status
    } for r in reports]), 200

@admin_bp.route('/doctor_requests', methods=['GET'])
@jwt_required()
def get_requests():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    requests = DoctorRequest.query.filter_by(status='pending').all()
    return jsonify([{
        'request_id': r.request_id,
        'name': r.name,
        'email': r.email,
        'phone': r.phone,
        'education': r.education,
        'experience_years': r.experience_years,
        'specialization': r.specialization,
        'created_at': r.created_at.strftime('%Y-%m-%d %H:%M')
    } for r in requests]), 200

@admin_bp.route('/approve_request/<int:req_id>', methods=['POST'])
@jwt_required()
def approve_request(req_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    req = DoctorRequest.query.get_or_404(req_id)
    if req.status != 'pending':
        return jsonify({'msg': 'Request already processed'}), 400
        
    temp_password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    
    doctor = Doctor(
        name=req.name,
        age=30, # default placeholder
        gender='Other',
        education=req.education,
        experience_years=req.experience_years,
        specialization=req.specialization,
        online_treatment_fee=req.online_treatment_fee,
        email=req.email,
        phone=req.phone
    )
    doctor.set_password(temp_password)
    db.session.add(doctor)
    
    req.status = 'approved'
    db.session.commit()
    
    return jsonify({
        'msg': 'Doctor approved.',
        'temp_password': temp_password,
        'email': req.email
    }), 200

@admin_bp.route('/reject_request/<int:req_id>', methods=['POST'])
@jwt_required()
def reject_request(req_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
    req = DoctorRequest.query.get_or_404(req_id)
    req.status = 'rejected'
    db.session.commit()
    return jsonify({'msg': 'Request rejected'}), 200

@admin_bp.route('/add_admin', methods=['POST'])
@jwt_required()
def add_admin():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin' or not identity.get('is_super_admin', False):
        return jsonify({'msg': 'Unauthorized. Only Super Admin can perform this action.'}), 403
    
    data = request.get_json()
    if Admin.query.filter_by(email=data['email']).first() or Admin.query.filter_by(phone=data['phone']).first():
        return jsonify({'msg': 'Admin with this email/phone already exists'}), 400
        
    admin = Admin(
        name=data['name'],
        gender=data.get('gender', 'Other'),
        email=data['email'],
        phone=data['phone']
    )
    admin.set_password(data['password'])
    db.session.add(admin)
    db.session.commit()
    return jsonify({'msg': 'Admin successfully created'}), 201

@admin_bp.route('/doctor_profile/<int:doctor_id>', methods=['GET'])
@jwt_required()
def doctor_profile(doctor_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'admin':
        return jsonify({'msg': 'Unauthorized'}), 403
        
    doctor = Doctor.query.get_or_404(doctor_id)
    
    # Work Summary
    reports = PatientReport.query.filter_by(assigned_doctor_id=doctor_id).all()
    total_assigned = len(reports)
    total_completed = sum(1 for r in reports if r.status == 'Completed')
    total_pending = sum(1 for r in reports if r.status == 'pending')
    
    # Case Progress List
    cases_handled = []
    for r in reports:
        patient = Patient.query.get(r.patient_id)
        patient_name = patient.name if patient else "Unknown"
        cases_handled.append({
            'report_id': r.report_id,
            'patient_name': patient_name,
            'symptoms': r.symptoms_text[:100] + '...' if len(r.symptoms_text) > 100 else r.symptoms_text,
            'status': r.status,
            'date': r.created_at.strftime('%Y-%m-%d %H:%M')
        })
        
    cases_handled.sort(key=lambda x: x['date'], reverse=True)
    
    # Feedback & Ratings
    feedbacks = Feedback.query.filter_by(doctor_id=doctor_id).all()
    total_reviews = len(feedbacks)
    average_rating = round(sum(f.rating for f in feedbacks) / total_reviews, 1) if total_reviews > 0 else 0
    
    feedback_list = []
    for f in feedbacks:
        feedback_list.append({
            'rating': f.rating,
            'comment': f.comment if f.comment else "",
            'date': f.created_at.strftime('%Y-%m-%d')
        })
        
    feedback_list.sort(key=lambda x: x['date'], reverse=True)
    
    return jsonify({
        'doctor_info': {
            'name': doctor.name,
            'specialization': doctor.specialization,
            'education': doctor.education,
            'experience': doctor.experience_years,
            'email': doctor.email,
            'phone': doctor.phone
        },
        'work_summary': {
            'total_assigned': total_assigned,
            'total_completed': total_completed,
            'total_pending': total_pending
        },
        'cases': cases_handled,
        'feedback_stats': {
            'average_rating': average_rating,
            'total_reviews': total_reviews
        },
        'feedbacks': feedback_list
    }), 200