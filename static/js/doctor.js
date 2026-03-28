const token = localStorage.getItem('access_token');
if (!token) window.location.href = '/login';

function parseJwt(token) {
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        return null;
    }
}

// Initialize Real-Time WebSocket Notifications
const socket = typeof io !== 'undefined' ? io() : null;
if (socket) {
    socket.on('connect', () => {
        const decoded = parseJwt(token);
        if (decoded && decoded.sub) {
            try {
                const identity = typeof decoded.sub === 'string' ? JSON.parse(decoded.sub) : decoded.sub;
                socket.emit('join', { user_id: identity.id });
                console.log("Socket authenticated and connected.");
            } catch (err) { console.error("Socket join err", err); }
        }
    });

    // Real-Time Notification: Push new assigned reports instantly to dashboard without refresh
    socket.on('new_patient_report', (data) => {
        // Automatically fetch new reports silently
        loadReports();
        
        // Show lightweight toast notification natively (creates a quick visual ping)
        const toastDiv = document.createElement('div');
        toastDiv.className = 'position-fixed bottom-0 end-0 p-3 fade-in';
        toastDiv.style.zIndex = '9999';
        toastDiv.innerHTML = `
            <div class="toast show align-items-center text-white bg-success border-0 saas-shadow rounded-3" role="alert">
              <div class="d-flex p-2">
                <div class="toast-body fw-bold">
                   <i class="fas fa-file-medical-alt me-2"></i> New Patient Report Assigned! (ID: #${data.reportId})
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.parentElement.parentElement.remove()"></button>
              </div>
            </div>`;
        document.body.appendChild(toastDiv);
        setTimeout(() => toastDiv.remove(), 8000); // Clean up after 8s
    });
    
    // Real-Time Incoming Call handler replacing the old REST loop
    socket.on('incoming_call', (data) => {
        // If a call triggers, process it natively assuming exact structure returned natively by REST previously
        if (data.callId) {
            handleIncomingCall({
                call_id: data.callId,
                patient_name: data.patientName || "A waiting patient",
                symptoms: data.symptoms || "Review history",
                is_emergency: data.isEmergency
            });
        }
    });

    // When patient accepts a doctor-initiated call, launch Jitsi on doctor side too
    socket.on('call_answered', (data) => {
        if (data.status === 'accepted' && data.callId === currentDoctorCallId) {
            document.getElementById('doctorCallWaiting')?.remove();
            startDoctorJitsi('MedAI-Room-' + data.callId);
        } else if (data.status === 'rejected' && data.callId === currentDoctorCallId) {
            document.getElementById('doctorCallWaiting')?.remove();
            currentDoctorCallId = null;
            // Show brief rejection toast
            const t = document.createElement('div');
            t.className = 'position-fixed bottom-0 end-0 p-3';
            t.style.zIndex = '9999';
            t.innerHTML = `<div class="toast show align-items-center text-white bg-danger border-0 rounded-3"><div class="d-flex p-2"><div class="toast-body fw-bold"><i class="fas fa-times me-1"></i> Patient declined the video call.</div></div></div>`;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 5000);
        }
    });
}


async function loadReports() {
    const list = document.getElementById('reportsList');
    list.innerHTML = '<div class="text-center w-100 my-5"><i class="fas fa-spinner fa-spin fa-3x text-success"></i></div>';
    try {
        const res = await fetch('/doctor/reports', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        if(!res.ok) throw new Error("Failed to load");
        const reports = await res.json();
        
        if (reports.length === 0) {
            list.innerHTML = `<div class="col-12 text-center text-muted py-5"><i class="fas fa-check-circle fa-4x mb-3 text-success opacity-50"></i><h4>All Caught Up!</h4><p>You have no pending reports to review.</p></div>`;
            return;
        }
        
        let html = '';
        reports.forEach(r => {
            html += `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100 shadow-sm border-0" style="border-radius:12px; overflow:hidden;">
                    <div class="card-header bg-success text-white border-0 py-3">
                        <div class="d-flex justify-content-between align-items-center">
                            <strong><i class="fas fa-file-medical-alt me-2"></i> Report #${r.report_id}</strong>
                            <span class="badge bg-light text-dark">${r.severity}</span>
                        </div>
                    </div>
                    <div class="card-body bg-light">
                        <div class="mb-3">
                            <small class="text-muted fw-bold text-uppercase d-block mb-1">Patient Symptoms</small>
                            <p class="card-text text-dark" style="font-size:0.95rem;">${r.symptoms}</p>
                        </div>
                        ${r.image ? `<div class="mb-3"><img src="/static/uploads/${r.image}" class="img-fluid rounded shadow-sm border" alt="Symptom Image"></div>` : ''}
                        ${r.ai_report ? `<div class="p-2 mb-2 bg-white rounded border-start border-3 border-success small"><strong class="text-success"><i class="fas fa-robot me-1"></i> AI Triage:</strong><br>${r.ai_report.substring(0, 100)}...</div>` : ''}
                    </div>
                    <div class="card-footer bg-white border-0 py-3">
                        <button class="btn btn-outline-success w-100 fw-bold mb-2" onclick='openModal(${JSON.stringify(r).replace(/'/g, "&#39;")})'><i class="fas fa-stethoscope me-2"></i> Review & Diagnose</button>
                        <div class="p-2 rounded-3 border" style="background: linear-gradient(135deg,#f0fdf4,#eff6ff);">
                            <small class="text-muted fw-bold d-block mb-2"><i class="fas fa-user me-1"></i>${r.patient_name || 'Patient'} — Contact directly:</small>
                            <div class="d-flex flex-wrap gap-2">
                                <button class="btn btn-sm btn-primary fw-bold" onclick="startVideoCallToPatient(${r.patient_id}, '${(r.patient_name||'Patient').replace(/'/g,'&#39;')}')">
                                    <i class="fas fa-video me-1"></i> Video Call
                                </button>
                                ${r.patient_phone ? `<a href="tel:${r.patient_phone}" class="btn btn-sm btn-success fw-bold"><i class="fas fa-phone me-1"></i> Audio Call</a>` : ''}
                                ${r.patient_email ? `<a href="mailto:${r.patient_email}?subject=Regarding your Report #${r.report_id}" class="btn btn-sm btn-secondary fw-bold" target="_blank"><i class="fas fa-envelope me-1"></i> Email</a>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch(err) {
        list.innerHTML = '<div class="alert alert-danger mx-3">Error loading reports.</div>'; 
    }
}

async function loadAppointments() {
    const list = document.getElementById('appointmentsList');
    list.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin text-success fa-2x"></i></div>';
    try {
        const res = await fetch('/doctor/appointments', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const apps = await res.json();
        if(apps.length === 0) {
            list.innerHTML = '<div class="p-4 text-center text-muted">No appointments found.</div>';
            return;
        }
        let html = '';
        apps.forEach(a => {
            let appointmentDate = new Date(a.date);
            let now = new Date();
            let isPast = now >= appointmentDate;
            let statusBadge = a.status === 'requested' ? 'warning text-dark' : a.status === 'confirmed' ? 'primary' : a.status === 'done' ? 'success' : 'secondary';
            
            let actionHtml = '';
            if (a.status !== 'done' && a.status !== 'cancelled') {
                actionHtml = `<div class="dropdown">
                    <button class="btn btn-sm btn-light border dropdown-toggle" type="button" data-bs-toggle="dropdown">Action</button>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm border-0">
                        <li><a class="dropdown-item text-success" href="#" onclick="updateAppointmentStatus(${a.appointment_id}, 'confirmed')"><i class="fas fa-check me-2"></i> Confirm</a></li>
                        ${(isPast && a.status === 'confirmed') ? 
                            `<li><a class="dropdown-item text-primary" href="#" onclick="updateAppointmentStatus(${a.appointment_id}, 'done')"><i class="fas fa-check-double me-2"></i> Mark as Done</a></li>` : ''}
                        <li><a class="dropdown-item text-danger" href="#" onclick="updateAppointmentStatus(${a.appointment_id}, 'cancelled')"><i class="fas fa-times me-2"></i> Cancel</a></li>
                    </ul>
                </div>`;
            }
            
            html += `
            <div class="list-group-item d-flex justify-content-between align-items-center p-3 border-start-0 border-end-0">
                <div>
                    <h5 class="mb-1">${a.patient_name}</h5>
                    <small class="text-muted"><i class="fas fa-calendar-alt me-1"></i> ${appointmentDate.toLocaleString()}</small>
                </div>
                <div class="d-flex align-items-center gap-3">
                    <span class="badge bg-${statusBadge} px-3 py-2 rounded-pill text-uppercase">${a.status}</span>
                    ${actionHtml}
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch(e) {
        list.innerHTML = '<div class="p-4 text-danger">Failed to load appointments</div>';
    }
}

let responseModal;
function openModal(report) {
    document.getElementById('currentReportId').value = report.report_id;
    document.getElementById('reportDetails').innerHTML = `
        <h6 class="text-dark"><i class="fas fa-user-injured me-2 text-success"></i> Patient Details</h6>
        <p class="mb-2"><strong>Symptoms:</strong> ${report.symptoms}</p>
        <p class="mb-0"><strong>AI Observation:</strong><br><small class="text-muted">${report.ai_report}</small></p>
    `;
    document.getElementById('doctorResponse').value = '';
    
    if(!responseModal) responseModal = new bootstrap.Modal(document.getElementById('responseModal'));
    responseModal.show();
}

async function submitResponse() {
    const id = document.getElementById('currentReportId').value;
    const responseText = document.getElementById('doctorResponse').value;
    if(!responseText.trim()) {
        alert("Please write a diagnosis response"); return;
    }
    
    try {
        const res = await fetch(`/doctor/report/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ response: responseText })
        });
        if(res.ok) {
            responseModal.hide();
            alert("Diagnosis submitted successfully!");
            loadReports();
        } else {
            alert("Failed to submit response.");
        }
    } catch(err) {
        alert("Network error occurred");
    }
}

async function updateAvailability() {
    const isAvail = document.getElementById('availabilitySwitch').checked;
    try {
        const res = await fetch('/doctor/availability', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ available: isAvail })
        });
        if(res.ok) {
            alert("Availability Updated!");
            const badge = document.getElementById('availabilityBadge');
            if(isAvail) {
                badge.className = "badge bg-success me-3 py-2 px-3 shadow-sm";
                badge.innerHTML = '<i class="fas fa-circle ms-1 me-1 text-white" style="font-size:8px; vertical-align:middle;"></i> Available';
            } else {
                badge.className = "badge bg-secondary me-3 py-2 px-3 shadow-sm";
                badge.innerHTML = '<i class="fas fa-circle ms-1 me-1 text-white" style="font-size:8px; vertical-align:middle;"></i> Unavailable';
            }
        }
    } catch(e) {
        alert('Failed to update availability');
    }
}

async function updateAppointmentStatus(id, newStatus) {
    try {
        const res = await fetch(`/doctor/appointment/${id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if(res.ok) {
            loadAppointments();
        }
    } catch(e) { alert("Failed to update status"); }
}

function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

// Initial loads
loadReports();
loadAppointments();

// ==========================================
// EMERGENCY VIDEO CALL BACKGROUND SCANNER
// ==========================================
// Removed REST-based interval loop (Replaced entirely by WebSockets natively)
// setInterval(checkIncomingCalls, 3000);
let currentDoctorCallId = null;
let doctorJitsiApi = null;

// ======================================================
// DOCTOR → PATIENT Video Call (Doctor initiates)
// ======================================================
async function startVideoCallToPatient(patientId, patientName) {
    try {
        const res = await fetch('/doctor/initiate_call', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ patient_id: patientId })
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();
        currentDoctorCallId = data.call_id;

        // Show awaiting modal in the report area
        const toastDiv = document.createElement('div');
        toastDiv.className = 'position-fixed bottom-0 end-0 p-3';
        toastDiv.style.zIndex = '9998';
        toastDiv.id = 'doctorCallWaiting';
        toastDiv.innerHTML = `
            <div class="toast show align-items-center text-white bg-primary border-0 rounded-3 shadow-lg" role="alert">
              <div class="d-flex p-2">
                <div class="toast-body fw-bold">
                   <i class="fas fa-video me-2"></i> Calling ${patientName}... Waiting for answer.
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="cancelDoctorCall(${data.call_id})"></button>
              </div>
            </div>`;
        document.body.appendChild(toastDiv);
    } catch(e) {
        alert('Failed to initiate call to patient.');
    }
}

async function cancelDoctorCall(callId) {
    document.getElementById('doctorCallWaiting')?.remove();
    // No dedicated cancel endpoint needed — socket will clean up
}

async function checkIncomingCalls() {
    // This function is still securely available if manual checks are needed,
    // but the main automatic triggering is now handled optimally by the Socket.IO listener.
    try {
        const res = await fetch('/doctor/incoming_call', { headers: { 'Authorization': `Bearer ${token}` } });
        if(!res.ok) return;
        const data = await res.json();
        
        if (data.status === 'ringing' && currentRingingCall !== data.call_id) {
            currentRingingCall = data.call_id;
            showIncomingCallModal(data.call_id, data.patient_name);
        } else if (data.status === 'none' && currentRingingCall !== null) {
            hideIncomingCallModal();
            currentRingingCall = null;
        }
    } catch(e) { }
}

function showIncomingCallModal(callId, patientName) {
    let modal = document.getElementById('incomingCallModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'incomingCallModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="bg-white p-5 text-center shadow-lg" style="max-width: 500px; width: 90%; border-radius: 12px; border-top: 6px solid #dc3545;">
            <div class="spinner-grow text-danger mb-4" style="width: 4rem; height: 4rem;" role="status"></div>
            <h2 class="text-danger fw-bold mb-3">Incoming Video Call!</h2>
            <p class="text-muted fs-5 mb-4">Patient <strong>${patientName}</strong> is requesting an immediate emergency video consultation.</p>
            <div class="d-flex justify-content-center gap-3">
                <button class="btn btn-success btn-lg px-4 shadow-sm fw-bold" style="border-radius: 8px;" onclick="acceptCall(${callId})"><i class="fas fa-video me-2"></i> Accept</button>
                <button class="btn btn-danger btn-lg px-4 shadow-sm fw-bold" style="border-radius: 8px;" onclick="rejectCall(${callId})"><i class="fas fa-phone-slash me-2"></i> Decline</button>
            </div>
        </div>
    `;
}

function hideIncomingCallModal() {
    const modal = document.getElementById('incomingCallModal');
    if (modal) modal.remove();
}

async function acceptCall(callId) {
    hideIncomingCallModal();
    try {
        await fetch(`/doctor/accept_call/${callId}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        startDoctorJitsi('MedAI-Room-' + callId);
    } catch(e) { alert("Error accepting call"); }
}

async function rejectCall(callId) {
    hideIncomingCallModal();
    currentRingingCall = null;
    try {
        await fetch(`/doctor/reject_call/${callId}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    } catch(e) { }
}

function startDoctorJitsi(roomName) {
    const list = document.getElementById('reportsList');
    list.innerHTML = `
        <div class="card shadow-lg border-0 mb-4 bg-dark text-white rounded">
            <div class="card-header border-0 bg-danger d-flex justify-content-between align-items-center py-3">
                <h5 class="mb-0 fw-bold text-white"><i class="fas fa-video me-2"></i> Live Emergency Consultation</h5>
                <button class="btn btn-light btn-sm shadow-sm fw-bold text-danger px-3 py-2" style="border-radius: 8px;" onclick="endDoctorJitsi()">
                    <i class="fas fa-phone-slash me-1"></i> End Call
                </button>
            </div>
            <div id="jitsi-container" style="width: 100%; height: 70vh; background: #000;"></div>
        </div>
    `;
    const domain = 'meet.jit.si';
    const options = {
        roomName: roomName,
        width: '100%',
        height: '100%',
        parentNode: document.getElementById('jitsi-container'),
        userInfo: { displayName: 'MedAI Doctor' }
    };
    doctorJitsiApi = new JitsiMeetExternalAPI(domain, options);
}

function endDoctorJitsi() {
    if(doctorJitsiApi) doctorJitsiApi.dispose();
    currentRingingCall = null;
    loadReports();
}

async function loadProfileStats() {
    const list = document.getElementById('analyticsContent');
    list.innerHTML = '<div class="text-center w-100 py-5"><i class="fas fa-spinner fa-spin fa-3x text-success"></i></div>';
    
    try {
        const res = await fetch('/doctor/profile_stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();
        
        let html = `
            <div class="row g-4 mb-4">
                <div class="col-md-3">
                    <div class="card bg-success text-white text-center h-100 border-0 shadow-sm" style="border-radius:15px;">
                        <div class="card-body py-4">
                            <i class="fas fa-wallet fa-3x mb-3 opacity-75"></i>
                            <h5 class="fw-bold mb-1">Total Earnings</h5>
                            <h2 class="display-6 fw-bold mb-0">₹${data.total_earnings}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card bg-primary text-white text-center h-100 border-0 shadow-sm" style="border-radius:15px;">
                        <div class="card-body py-4">
                            <i class="fas fa-notes-medical fa-3x mb-3 opacity-75"></i>
                            <h5 class="fw-bold mb-1">Solved Cases</h5>
                            <h2 class="display-6 fw-bold mb-0">${data.total_cases_solved}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card bg-warning text-dark text-center h-100 border-0 shadow-sm" style="border-radius:15px;">
                        <div class="card-body py-4">
                            <i class="fas fa-clock fa-3x mb-3 opacity-75"></i>
                            <h5 class="fw-bold mb-1">Pending Cases</h5>
                            <h2 class="display-6 fw-bold mb-0">${data.total_cases_pending}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card bg-info text-white text-center h-100 border-0 shadow-sm" style="border-radius:15px;">
                        <div class="card-body py-4">
                            <i class="fas fa-star fa-3x mb-3 text-warning"></i>
                            <h5 class="fw-bold mb-1">Average Rating</h5>
                            <h2 class="display-6 fw-bold mb-0">${data.average_rating} <span style="font-size:1.5rem">/ 5</span></h2>
                        </div>
                    </div>
                </div>
            </div>
            
            <h4 class="mb-3 text-dark fw-bold border-bottom pb-2 mt-5"><i class="fas fa-comments me-2 text-success"></i> Patient Feedback</h4>
            <div class="row">
        `;
        
        if (!data.feedbacks || data.feedbacks.length === 0) {
            html += `<div class="col-12 text-muted fst-italic border rounded p-4 text-center glass-card"><i class="fas fa-comment-slash fa-2x mb-3 text-muted"></i><br>No patient feedback received yet.</div>`;
        } else {
            data.feedbacks.forEach(f => {
                html += `
                <div class="col-md-6 mb-4 fade-in">
                    <div class="p-4 bg-white rounded shadow-sm border h-100 text-start">
                        <div class="d-flex justify-content-between mb-2">
                            <span class="text-warning fs-5">
                                ${Array(f.rating).fill('<i class="fas fa-star"></i>').join('')}${Array(5-f.rating).fill('<i class="far fa-star"></i>').join('')}
                            </span>
                            <div class="text-end">
                                <span class="d-block text-muted fw-bold mb-1"><i class="far fa-user me-1"></i> ${f.patient_name || 'Anonymous'}</span>
                                <small class="text-muted"><i class="far fa-clock me-1"></i> ${f.date}</small>
                            </div>
                        </div>
                        <p class="mb-0 text-dark fst-italic" style="font-size: 1.1rem;">"${f.comment}"</p>
                    </div>
                </div>`;
            });
        }
        html += `</div>`;
        
        list.innerHTML = html;
        
    } catch(e) {
        list.innerHTML = '<div class="alert alert-danger mx-3"><i class="fas fa-exclamation-triangle me-2"></i> Failed to load profile statistics. Please try refreshing.</div>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const profileTab = document.getElementById('profile-tab');
    if(profileTab) {
        profileTab.addEventListener('shown.bs.tab', function (e) {
            loadProfileStats();
        });
    }
});
