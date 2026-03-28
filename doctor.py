from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import json
from models import db, PatientReport, Doctor, Appointment, Feedback, Transaction
from datetime import datetime

doctor_bp = Blueprint('doctor', __name__)

@doctor_bp.route('/reports', methods=['GET'])
@jwt_required()
def get_reports():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    reports = PatientReport.query.filter_by(assigned_doctor_id=doctor_id, status='pending').all()
    return jsonify([{
        'report_id': r.report_id,
        'patient_id': r.patient_id,
        'patient_name': r.patient.name if r.patient else None,
        'patient_email': r.patient.email if r.patient else None,
        'patient_phone': r.patient.phone if r.patient else None,
        'symptoms': r.symptoms_english or r.symptoms_text,
        'image': r.uploaded_image,
        'ai_report': r.ai_report_english or r.ai_generated_report,
        'severity': r.severity_level
    } for r in reports]), 200

@doctor_bp.route('/report/<int:report_id>', methods=['POST'])
@jwt_required()
def respond_report(report_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    report = PatientReport.query.filter_by(report_id=report_id, assigned_doctor_id=doctor_id).first_or_404()
    data = request.get_json()
    response_text = data.get('response')
    report.doctor_response = response_text
    report.status = 'Completed'
    
    # Credit doctor for completing case
    doctor = Doctor.query.get(doctor_id)
    amount = doctor.online_treatment_fee or 500
    doctor.total_earnings = (doctor.total_earnings or 0) + amount
    db.session.add(Transaction(
        doctor_id=doctor_id,
        amount=amount,
        transaction_type='CREDIT',
        description=f"Earnings from solving Case #{report_id}"
    ))
    
    # Generate new audio for the doctor's response
    from agents import agent5_translate_and_tts
    _, audio_file = agent5_translate_and_tts(response_text, "English")
    if audio_file:
        report.audio_file = audio_file
        
    db.session.commit()
    return jsonify({'msg': 'Response submitted'}), 200

@doctor_bp.route('/availability', methods=['PUT'])
@jwt_required()
def set_availability():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    data = request.get_json()
    doctor = Doctor.query.get(doctor_id)
    doctor.available = data.get('available', True)
    db.session.commit()
    return jsonify({'msg': 'Availability updated'}), 200

@doctor_bp.route('/appointments', methods=['GET'])
@jwt_required()
def view_appointments():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    appointments = Appointment.query.filter_by(doctor_id=doctor_id).all()
    return jsonify([{
        'appointment_id': a.appointment_id,
        'patient_name': a.patient.name,
        'date': a.appointment_date.isoformat() + 'Z',
        'status': a.status
    } for a in appointments]), 200

@doctor_bp.route('/appointment/<int:appointment_id>', methods=['PUT'])
@jwt_required()
def update_appointment(appointment_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    appointment = Appointment.query.filter_by(appointment_id=appointment_id, doctor_id=doctor_id).first_or_404()
    data = request.get_json()
    new_status = data.get('status', appointment.status)
    if new_status == 'Completed' and appointment.status != 'Completed':
        doctor = Doctor.query.get(doctor_id)
        amount = doctor.online_treatment_fee or 500
        doctor.total_earnings = (doctor.total_earnings or 0) + amount
        db.session.add(Transaction(
            doctor_id=doctor_id,
            amount=amount,
            transaction_type='CREDIT',
            description=f"Earnings from Appointment #{appointment_id}"
        ))
    appointment.status = new_status
    db.session.commit()
    return jsonify({'msg': 'Appointment updated'}), 200

@doctor_bp.route('/incoming_call', methods=['GET'])
@jwt_required()
def incoming_call():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor': return jsonify({'msg': 'Unauthorized'}), 403
    from models import EmergencyCall
    call = EmergencyCall.query.filter_by(doctor_id=identity['id'], status='ringing').order_by(EmergencyCall.created_at.desc()).first()
    if call:
        return jsonify({
            'call_id': call.call_id,
            'patient_name': call.patient.name,
            'status': 'ringing'
        }), 200
    return jsonify({'status': 'none'}), 200

@doctor_bp.route('/accept_call/<int:call_id>', methods=['POST'])
@jwt_required()
def accept_call(call_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor': return jsonify({'msg': 'Unauthorized'}), 403
    from models import EmergencyCall
    call = EmergencyCall.query.filter_by(call_id=call_id, doctor_id=identity['id']).first_or_404()
    call.status = 'accepted'
    db.session.commit()
    
    from extensions import socketio
    socketio.emit('call_answered', {'callId': call_id, 'status': 'accepted'}, room=str(call.patient_id))
    
    return jsonify({'msg': 'Call accepted'}), 200

@doctor_bp.route('/reject_call/<int:call_id>', methods=['POST'])
@jwt_required()
def reject_call(call_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor': return jsonify({'msg': 'Unauthorized'}), 403
    from models import EmergencyCall
    call = EmergencyCall.query.filter_by(call_id=call_id, doctor_id=identity['id']).first_or_404()
    call.status = 'rejected'
    db.session.commit()
    
    from extensions import socketio
    socketio.emit('call_answered', {'callId': call_id, 'status': 'rejected'}, room=str(call.patient_id))
    
    return jsonify({'msg': 'Call rejected'}), 200

@doctor_bp.route('/initiate_call', methods=['POST'])
@jwt_required()
def doctor_initiate_call():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor': return jsonify({'msg': 'Unauthorized'}), 403
    doctor_id = identity['id']
    data = request.get_json()
    patient_id = data.get('patient_id')
    if not patient_id: return jsonify({'msg': 'Patient ID required'}), 400

    from models import EmergencyCall, Doctor as DoctorModel
    # Cancel stale ringing calls from this doctor
    for old_call in EmergencyCall.query.filter_by(doctor_id=doctor_id, status='ringing').all():
        old_call.status = 'ended'
    db.session.commit()

    new_call = EmergencyCall(patient_id=patient_id, doctor_id=doctor_id, status='ringing')
    db.session.add(new_call)
    db.session.commit()

    doc = DoctorModel.query.get(doctor_id)
    from extensions import socketio
    socketio.emit('incoming_call_from_doctor', {
        'callId': new_call.call_id,
        'doctorName': doc.name if doc else 'Your Doctor',
        'doctorId': doctor_id
    }, room=str(patient_id))

    return jsonify({'call_id': new_call.call_id}), 200


@doctor_bp.route('/profile_stats', methods=['GET'])
@jwt_required()
def get_profile_stats():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'doctor': 
        return jsonify({'msg': 'Unauthorized'}), 403
        
    doctor_id = identity['id']
    doctor = Doctor.query.get_or_404(doctor_id)
    
    cases_assigned = PatientReport.query.filter_by(assigned_doctor_id=doctor_id).count()
    cases_solved = PatientReport.query.filter_by(assigned_doctor_id=doctor_id, status='Completed').count()
    cases_pending = cases_assigned - cases_solved
    
    feedbacks = Feedback.query.filter_by(doctor_id=doctor_id).order_by(Feedback.created_at.desc()).all()
    avg_rating = sum(f.rating for f in feedbacks) / len(feedbacks) if feedbacks else 0.0
    
    fb_list = [{
        'rating': f.rating,
        'comment': f.comment,
        'date': f.created_at.strftime('%Y-%m-%d'),
        'patient_name': f.patient.name if f.patient else 'Anonymous'
    } for f in feedbacks]
    
    return jsonify({
        'total_earnings': doctor.total_earnings or 0,
        'total_cases_assigned': cases_assigned,
        'total_cases_solved': cases_solved,
        'total_cases_pending': cases_pending,
        'average_rating': round(avg_rating, 1),
        'feedbacks': fb_list
    }), 200