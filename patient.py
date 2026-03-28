from flask import Blueprint, request, jsonify, current_app, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
import os
import json
from datetime import datetime
from models import db, PatientReport, Appointment, Doctor, Feedback, Transaction, Patient
from agents import process_patient_input, chat_agent  # Our multi-agent workflow

patient_bp = Blueprint('patient', __name__)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

@patient_bp.route('/submit_report', methods=['POST'])
@jwt_required()
def submit_report():
    try:
        identity = json.loads(get_jwt_identity())
        if identity['role'] != 'patient':
            return jsonify({'msg': 'Unauthorized'}), 403
        patient_id = identity['id']
        
        symptoms = request.form.get('symptoms')
        language = request.form.get('language', 'English')
        image_file = request.files.get('image')
        
        if not symptoms:
            return jsonify({'msg': 'Symptoms text required'}), 400
        
        image_filename = None
        if image_file and allowed_file(image_file.filename):
            filename = secure_filename(image_file.filename)
            image_filename = f"patient_{patient_id}_{datetime.utcnow().timestamp()}_{filename}"
            image_file.save(os.path.join(current_app.config['UPLOAD_FOLDER'], image_filename))
        
        result = process_patient_input(patient_id, symptoms, image_filename, language)
        
        report = PatientReport(
            patient_id=patient_id,
            symptoms_text=symptoms,
            uploaded_image=image_filename,
            ai_generated_report=result.get('ai_report'),
            severity_level=result.get('severity'),
            recommended_specialization=result.get('recommended_specialization'),
            assigned_doctor_id=None,
            status=result.get('status', 'Completed'),
            audio_file=result.get('audio_file')
        )
        db.session.add(report)
        db.session.commit()
        
        report.doctor_response = result.get('final_output')
        db.session.commit()
        
        return jsonify({
            'report_id': report.report_id,
            'severity': result.get('severity'),
            'message': 'Report submitted successfully',
            'result': result.get('final_output')
        }), 201
    except Exception as e:
        import traceback
        return jsonify({'msg': f"Internal Server Error: {str(e)}", 'trace': traceback.format_exc()}), 500

@patient_bp.route('/history', methods=['GET'])
@jwt_required()
def get_history():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
    patient_id = identity['id']
    reports = PatientReport.query.filter_by(patient_id=patient_id).order_by(PatientReport.created_at.desc()).all()
    return jsonify([{
        'report_id': r.report_id,
        'date': r.created_at.isoformat() + 'Z',
        'symptoms': r.symptoms_text,
        'severity': r.severity_level,
        'doctor_response': r.doctor_response,
        'status': r.status,
        'audio_file': r.audio_file,
        'assigned_doctor_id': r.assigned_doctor_id,
        'doctor_name': r.assigned_doctor.name if r.assigned_doctor else None,
        'doctor_email': r.assigned_doctor.email if r.assigned_doctor else None,
        'doctor_phone': r.assigned_doctor.phone if r.assigned_doctor else None,
        'has_feedback': r.feedback is not None
    } for r in reports]), 200

@patient_bp.route('/download_report/<int:report_id>', methods=['GET'])
@jwt_required()
def download_report(report_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
    patient_id = identity['id']
    target_lang = request.args.get('lang', 'English')
    
    report = PatientReport.query.filter_by(report_id=report_id, patient_id=patient_id).first_or_404()
    # Generate PDF using utils.py
    from utils import generate_pdf_report
    pdf_path = generate_pdf_report(report, target_lang)
    return send_file(pdf_path, as_attachment=True, download_name=f"report_{report_id}.pdf")

@patient_bp.route('/translate_report/<int:report_id>', methods=['POST'])
@jwt_required()
def translate_report(report_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
        
    data = request.get_json()
    target_lang = data.get('language')
    if not target_lang:
        return jsonify({'msg': 'Language required'}), 400
        
    report = PatientReport.query.filter_by(report_id=report_id, patient_id=identity['id']).first_or_404()
    
    # Needs translating
    if not report.doctor_response:
        return jsonify({'msg': 'No report text to translate'}), 400
        
    from agents import agent5_translate_and_tts
    # If it was translated previously, translating already translated text might be slightly lower quality than translating English original,
    # but we only save the final_output in doctor_response, so we translate that.
    # To be extremely robust, we can translate `ai_generated_report` if it's the AI response, but wait, `doctor_response` contains the actual actionable advice.
    text_to_translate = report.doctor_response
    
    new_text, new_audio = agent5_translate_and_tts(text_to_translate, target_lang)
    report.doctor_response = new_text
    report.audio_file = new_audio
    db.session.commit()
    
    return jsonify({
        'msg': 'Translated successfully',
        'text': new_text,
        'audio_file': new_audio
    }), 200

@patient_bp.route('/appointments', methods=['GET', 'POST'])
@jwt_required()
def appointments():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
    patient_id = identity['id']
    if request.method == 'POST':
        data = request.get_json()
        doctor_id = data['doctor_id']
        raw_date = data['appointment_date'].replace('Z', '+00:00')
        appointment_date = datetime.fromisoformat(raw_date)
        # Check doctor availability
        doctor = Doctor.query.get(doctor_id)
        if not doctor or not doctor.available:
            return jsonify({'msg': 'Doctor not available'}), 400
            
        patient = Patient.query.get(patient_id)
        if patient.wallet_balance < doctor.online_treatment_fee:
            return jsonify({'msg': 'Insufficient balance. Please add money to your account.'}), 400
            
        patient.wallet_balance -= doctor.online_treatment_fee
        
        tx = Transaction(
            patient_id=patient_id,
            amount=doctor.online_treatment_fee,
            transaction_type='DEBIT',
            description=f"Paid consultation fee for Dr. {doctor.name}"
        )
        db.session.add(tx)
        
        doctor.total_earnings = (doctor.total_earnings or 0) + doctor.online_treatment_fee
        doc_tx = Transaction(
            doctor_id=doctor_id,
            amount=doctor.online_treatment_fee,
            transaction_type='CREDIT',
            description=f"Earnings from Appt booking by {patient.name}"
        )
        db.session.add(doc_tx)
        
        appointment = Appointment(
            patient_id=patient_id,
            doctor_id=doctor_id,
            appointment_date=appointment_date
        )
        db.session.add(appointment)
        db.session.commit()
        return jsonify({'msg': 'Appointment requested successfully'}), 201
    else:
        apps = Appointment.query.filter_by(patient_id=patient_id).all()
        return jsonify([{
            'appointment_id': a.appointment_id,
            'doctor_name': a.doctor.name,
            'date': a.appointment_date.isoformat() + 'Z',
            'status': a.status,
            'has_feedback': a.feedback is not None
        } for a in apps]), 200

@patient_bp.route('/appointment/<int:appointment_id>', methods=['PUT'])
@jwt_required()
def update_appointment(appointment_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
    patient_id = identity['id']
    appointment = Appointment.query.filter_by(appointment_id=appointment_id, patient_id=patient_id).first_or_404()
    data = request.get_json()
    appointment.status = data.get('status', appointment.status)
    db.session.commit()
    return jsonify({'msg': 'Appointment updated'}), 200

@patient_bp.route('/chat', methods=['POST'])
@jwt_required()
def chat():
    identity = json.loads(get_jwt_identity())
    data = request.get_json()
    query = data.get('query')
    history = data.get('history', [])
    language = data.get('language', 'English')
    
    response_data = chat_agent(query, history, language)
    raw_text = response_data.get('raw', '')
    
    import re
    # Check if the output contains our hidden JSON trigger block
    if '{' in raw_text and '}' in raw_text:
        try:
            start_idx = raw_text.find('{')
            end_idx = raw_text.rfind('}')
            text_before_json = raw_text[:start_idx].strip()
            
            json_str = raw_text[start_idx:end_idx+1]
            payload = json.loads(json_str)
            
            if payload.get('_TRIGGER_REPORT'):
                symptoms_eng = payload.get('symptoms', 'General symptoms')
                severity = payload.get('severity', 'Normal')
                diagnosis_eng = payload.get('diagnosis', '')
                
                # Extract image if provided in history
                image_filename = None
                if history:
                    for msg in reversed(history):
                        if msg.get('role') == 'user' and msg.get('image'):
                            import uuid, base64, os
                            from werkzeug.utils import secure_filename
                            img_data = msg['image']
                            if ',' in img_data:
                                img_data = img_data.split(',')[1]
                            image_filename = f"{uuid.uuid4().hex}.jpg"
                            filepath = os.path.join(os.getcwd(), 'static', 'uploads', image_filename)
                            with open(filepath, 'wb') as f:
                                f.write(base64.b64decode(img_data))
                            break

                # Perform native translations only on the ACK text for now to keep chat real-time
                from agents import agent5_translate_and_tts
                if not text_before_json:
                    text_before_json = "I have collected enough information to generate your medical report."
                    
                if language != 'English':
                    ack_text, ack_audio = agent5_translate_and_tts(text_before_json, language)
                else:
                    ack_text = text_before_json
                    _, ack_audio = agent5_translate_and_tts(text_before_json, 'English')

                return jsonify({
                    'type': 'report_ready',
                    'report_data': {
                        'symptoms_eng': symptoms_eng,
                        'severity': severity,
                        'diagnosis_eng': diagnosis_eng,
                        'language': language,
                        'image_filename': image_filename
                    },
                    'response': ack_text,
                    'audio_file': ack_audio
                }), 200
        except Exception as e:
            print("Failed to map JSON report trigger correctly", e)

    # Base conversational reply
    return jsonify({
        'type': 'chat',
        'response': response_data['text'],
        'audio_file': response_data['audio']
    }), 200

@patient_bp.route('/generate_report', methods=['POST'])
@jwt_required()
def generate_report():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json()
    report_data = data.get('report_data')
    if not report_data:
        return jsonify({'error': 'No report data provided'}), 400
        
    language = report_data.get('language', 'English')
    symptoms_eng = report_data.get('symptoms_eng')
    severity = report_data.get('severity')
    diagnosis_eng = report_data.get('diagnosis_eng')
    image_filename = report_data.get('image_filename')
    
    from agents import agent5_translate_and_tts, agent4_specialization_matcher
    
    # Perform Native Translations
    if language != 'English':
        symptoms_reg, _ = agent5_translate_and_tts(symptoms_eng, language)
        diagnosis_reg, final_audio = agent5_translate_and_tts(diagnosis_eng, language)
        symptoms_eng, _ = agent5_translate_and_tts(symptoms_eng, 'English', force_translation=True)
        diagnosis_eng, _ = agent5_translate_and_tts(diagnosis_eng, 'English', force_translation=True)
    else:
        symptoms_reg = symptoms_eng
        diagnosis_reg = diagnosis_eng
        _, final_audio = agent5_translate_and_tts(diagnosis_eng, 'English')
        
    status = 'Completed' if severity == 'Normal' else 'awaiting_selection'
    
    report = PatientReport(
        patient_id=identity['id'],
        symptoms_text=symptoms_reg,             # Regional
        symptoms_english=symptoms_eng,          # English
        ai_generated_report=diagnosis_reg,      # Regional
        ai_report_english=diagnosis_eng,        # English
        severity_level=severity,
        status=status,
        audio_file=final_audio,
        uploaded_image=image_filename
    )
    db.session.add(report)
    db.session.commit()
    
    spec = agent4_specialization_matcher(symptoms_eng, diagnosis_eng)
    report.recommended_specialization = spec
    db.session.commit()
    
    return jsonify({
        'status': 'success',
        'report_id': report.report_id,
        'severity': severity
    }), 200

@patient_bp.route('/doctors', methods=['GET'])
@jwt_required()
def get_available_doctors():
    # Only patients can access
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
    doctors = Doctor.query.filter_by(available=True).all()
    return jsonify([{
        'doctor_id': d.doctor_id,
        'name': d.name,
        'specialization': d.specialization,
        'phone': d.phone,
        'email': d.email
    } for d in doctors]), 200

@patient_bp.route('/doctors_for_report/<int:report_id>', methods=['GET'])
@jwt_required()
def doctors_for_report(report_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    
    report = PatientReport.query.filter_by(report_id=report_id, patient_id=identity['id']).first_or_404()
    spec = report.recommended_specialization
    
    if spec:
        doctors = Doctor.query.filter_by(specialization=spec, available=True).all()
    else:
        doctors = Doctor.query.filter_by(available=True).all()
        
    return jsonify([{
        'doctor_id': d.doctor_id,
        'name': d.name,
        'specialization': d.specialization,
        'experience_years': d.experience_years,
        'online_treatment_fee': d.online_treatment_fee
    } for d in doctors]), 200

@patient_bp.route('/assign_report_doctor/<int:report_id>', methods=['POST'])
@jwt_required()
def assign_report_doctor(report_id):
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    
    data = request.get_json()
    doctor_id = data.get('doctor_id')
    if not doctor_id: return jsonify({'msg': 'Doctor ID required'}), 400
    report = PatientReport.query.filter_by(report_id=report_id, patient_id=identity['id']).first_or_404()
    if report.status != 'awaiting_selection':
        return jsonify({'msg': 'Report is already assigned or completed.'}), 400
        
    doctor = Doctor.query.get(doctor_id)
    patient = Patient.query.get(identity['id'])
    
    if not doctor or not doctor.available:
        return jsonify({'msg': 'Doctor is not available currently.'}), 400
        
    if patient.wallet_balance < doctor.online_treatment_fee:
        return jsonify({'msg': 'Insufficient balance. Please add money to your account.'}), 400
        
    # Process Financial Exchange
    patient.wallet_balance -= doctor.online_treatment_fee
    db.session.add(Transaction(
        patient_id=patient.patient_id,
        amount=doctor.online_treatment_fee,
        transaction_type='DEBIT',
        description=f"Paid AI case fee for Dr. {doctor.name}"
    ))
    
    doctor.total_earnings = (doctor.total_earnings or 0) + doctor.online_treatment_fee
    db.session.add(Transaction(
        doctor_id=doctor_id,
        amount=doctor.online_treatment_fee,
        transaction_type='CREDIT',
        description=f"Earnings from AI Report assignment by {patient.name}"
    ))
        
    report.assigned_doctor_id = doctor_id
    report.status = 'pending'
    db.session.commit()
    
    from extensions import socketio
    socketio.emit('new_patient_report', {'reportId': report.report_id}, room=str(doctor_id))
    
    return jsonify({'msg': 'Doctor successfully assigned. Report passed for review.'}), 200

@patient_bp.route('/search_doctors', methods=['GET'])
@jwt_required()
def search_doctors():
    name_query = request.args.get('name', '').lower()
    spec_query = request.args.get('specialization', '')
    
    query = Doctor.query.filter_by(available=True)
    if spec_query:
        query = query.filter_by(specialization=spec_query)
        
    doctors = query.all()
    results = []
    for d in doctors:
        if name_query and name_query not in d.name.lower():
            continue
        feedbacks = d.feedbacks
        avg = float(sum(f.rating for f in feedbacks)) / len(feedbacks) if feedbacks else 0.0
        results.append({
            'doctor_id': d.doctor_id,
            'name': d.name,
            'specialization': d.specialization,
            'experience_years': d.experience_years,
            'online_treatment_fee': d.online_treatment_fee,
            'rating': round(avg, 1),
            'total_reviews': len(feedbacks)
        })
    return jsonify(results), 200

@patient_bp.route('/doctor_profile/<int:doctor_id>', methods=['GET'])
@jwt_required()
def doctor_profile(doctor_id):
    doctor = Doctor.query.get_or_404(doctor_id)
    feedbacks = doctor.feedbacks
    avg = float(sum(f.rating for f in feedbacks)) / len(feedbacks) if feedbacks else 0.0
    feedback_data = []
    for f in sorted(feedbacks, key=lambda x: x.created_at, reverse=True):
        feedback_data.append({
            'rating': f.rating,
            'comment': f.comment,
            'date': f.created_at.strftime('%B %d, %Y')
        })
    return jsonify({
        'doctor_id': doctor.doctor_id,
        'name': doctor.name,
        'specialization': doctor.specialization,
        'education': doctor.education,
        'experience_years': doctor.experience_years,
        'online_treatment_fee': doctor.online_treatment_fee,
        'available': doctor.available,
        'rating': round(avg, 1),
        'total_reviews': len(feedbacks),
        'feedbacks': feedback_data
    }), 200

@patient_bp.route('/submit_feedback', methods=['POST'])
@jwt_required()
def submit_feedback():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': 
        return jsonify({'msg': 'Unauthorized'}), 403
    patient_id = identity['id']

    data = request.get_json()
    appointment_id = data.get('appointment_id')
    report_id = data.get('report_id')
    rating = data.get('rating')
    comment = data.get('comment')

    if not rating:
        return jsonify({'msg': 'Missing rating'}), 400

    doctor_id = None
    if appointment_id:
        appt = Appointment.query.filter_by(appointment_id=appointment_id, patient_id=patient_id).first_or_404()
        if appt.status != 'done':
            return jsonify({'msg': 'Feedback can only be submitted for completed appointments.'}), 400
        if Feedback.query.filter_by(appointment_id=appointment_id).first():
            return jsonify({'msg': 'Feedback already submitted for this appointment.'}), 400
        doctor_id = appt.doctor_id
    elif report_id:
        report = PatientReport.query.filter_by(report_id=report_id, patient_id=patient_id).first_or_404()
        if report.status != 'Completed' or not report.assigned_doctor_id:
            return jsonify({'msg': 'Feedback can only be submitted for doctor-completed reports.'}), 400
        if Feedback.query.filter_by(report_id=report_id).first():
            return jsonify({'msg': 'Feedback already submitted for this report.'}), 400
        doctor_id = report.assigned_doctor_id
    else:
        return jsonify({'msg': 'Missing appointment or report reference'}), 400

    fb = Feedback(
        doctor_id=doctor_id,
        patient_id=patient_id,
        appointment_id=appointment_id if appointment_id else None,
        report_id=report_id if report_id else None,
        rating=int(rating),
        comment=comment
    )
    db.session.add(fb)
    db.session.commit()
    return jsonify({'msg': 'Feedback submitted successfully'}), 200

@patient_bp.route('/initiate_call', methods=['POST'])
@jwt_required()
def initiate_call():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    data = request.get_json()
    doctor_id = data.get('doctor_id')
    if not doctor_id: return jsonify({'msg': 'Doctor ID required'}), 400
    
    from models import EmergencyCall
    for old_call in EmergencyCall.query.filter_by(patient_id=identity['id'], status='ringing').all():
        old_call.status = 'ended'
    db.session.commit()
    
    new_call = EmergencyCall(patient_id=identity['id'], doctor_id=doctor_id)
    db.session.add(new_call)
    db.session.commit()
    
    from extensions import socketio
    from models import Patient
    pat = Patient.query.get(identity['id'])
    
    socketio.emit('incoming_call', {
        'callId': new_call.call_id,
        'patientName': pat.name if pat else "A waiting patient",
        'symptoms': "Emergency video consultation request",
        'isEmergency': True
    }, room=str(doctor_id))
    
    return jsonify({'call_id': new_call.call_id}), 200

@patient_bp.route('/call_status/<int:call_id>', methods=['GET'])
@jwt_required()
def call_status(call_id):
    from models import EmergencyCall
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    call = EmergencyCall.query.filter_by(call_id=call_id, patient_id=identity['id']).first_or_404()
    return jsonify({'status': call.status}), 200

@patient_bp.route('/accept_call/<int:call_id>', methods=['POST'])
@jwt_required()
def patient_accept_call(call_id):
    from models import EmergencyCall
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    call = EmergencyCall.query.filter_by(call_id=call_id, patient_id=identity['id']).first_or_404()
    call.status = 'accepted'
    db.session.commit()
    from extensions import socketio
    socketio.emit('call_answered', {'callId': call_id, 'status': 'accepted'}, room=str(call.doctor_id))
    return jsonify({'msg': 'Call accepted'}), 200

@patient_bp.route('/reject_call/<int:call_id>', methods=['POST'])
@jwt_required()
def patient_reject_call(call_id):
    from models import EmergencyCall
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient': return jsonify({'msg': 'Unauthorized'}), 403
    call = EmergencyCall.query.filter_by(call_id=call_id, patient_id=identity['id']).first_or_404()
    call.status = 'rejected'
    db.session.commit()
    from extensions import socketio
    socketio.emit('call_answered', {'callId': call_id, 'status': 'rejected'}, room=str(call.doctor_id))
    return jsonify({'msg': 'Call rejected'}), 200


@patient_bp.route('/wallet', methods=['GET'])
@jwt_required()
def get_wallet():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
        
    patient = Patient.query.get_or_404(identity['id'])
    
    # Get transaction history
    transactions = Transaction.query.filter_by(patient_id=patient.patient_id).order_by(Transaction.timestamp.desc()).all()
    tx_list = []
    for tx in transactions:
        tx_list.append({
            'transaction_id': tx.transaction_id,
            'amount': tx.amount,
            'type': tx.transaction_type,
            'description': tx.description,
            'date': tx.timestamp.strftime('%Y-%m-%d %H:%M')
        })
        
    return jsonify({
        'balance': patient.wallet_balance,
        'transactions': tx_list
    }), 200

@patient_bp.route('/wallet/add', methods=['POST'])
@jwt_required()
def add_wallet_funds():
    identity = json.loads(get_jwt_identity())
    if identity['role'] != 'patient':
        return jsonify({'msg': 'Unauthorized'}), 403
        
    data = request.get_json()
    amount = float(data.get('amount', 0))
    if amount <= 0:
        return jsonify({'msg': 'Invalid amount'}), 400
        
    patient = Patient.query.get_or_404(identity['id'])
    patient.wallet_balance += amount
    
    # Record transaction
    tx = Transaction(
        patient_id=patient.patient_id,
        amount=amount,
        transaction_type='CREDIT',
        description=f"Added funds to wallet via Demo Payment"
    )
    db.session.add(tx)
    db.session.commit()
    
    return jsonify({'msg': 'Funds added successfully', 'new_balance': patient.wallet_balance}), 200
