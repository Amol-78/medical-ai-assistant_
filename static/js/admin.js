const token = localStorage.getItem('access_token');
if (!token) window.location.href = '/login';

async function loadDoctors() {
    try {
        const res = await fetch('/admin/doctors', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const doctors = await res.json();
        const tbody = document.getElementById('doctorTableBody');
        if(doctors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No doctors registered.</td></tr>';
            return;
        }
        tbody.innerHTML = doctors.map(d => `
            <tr>
                <td class="fw-bold">#${d.doctor_id}</td>
                <td><a href="#" class="text-primary text-decoration-none fw-bold" onclick="showDoctorProfile(${d.doctor_id}); return false;">${d.name}</a></td>
                <td><span class="badge bg-light text-dark border">${d.specialization}</span></td>
                <td>${d.email}</td>
                <td>${d.phone}</td>
                <td><i class="fas fa-circle ${d.available ? 'text-success' : 'text-danger'} me-2" style="font-size: 10px;"></i>${d.available ? 'Active' : 'Offline'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-info shadow-sm me-1" onclick="showDoctorProfile(${d.doctor_id})"><i class="fas fa-eye"></i></button>
                    <button class="btn btn-sm btn-outline-primary shadow-sm me-1" onclick="editDoctor(${d.doctor_id}, '${d.name.replace(/'/g,"\\'")}', '${d.specialization}', '${d.email}', '${d.phone}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger shadow-sm" onclick="deleteDoctor(${d.doctor_id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch(e) { console.error(e); }
}

// Super Admin functionality checks
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('is_super_admin') === 'true') {
        const addAdminBtn = document.getElementById('addAdminBtn');
        if (addAdminBtn) addAdminBtn.classList.remove('d-none');
    }
});

function editDoctor(id, name, specialization, email, phone) {
    document.getElementById('editDoctorId').value = id;
    document.getElementById('editName').value = name;
    document.getElementById('editSpecialization').value = specialization;
    document.getElementById('editEmail').value = email;
    document.getElementById('editPhone').value = phone;
    new bootstrap.Modal(document.getElementById('editDoctorModal')).show();
}

async function updateDoctor() {
    const id = document.getElementById('editDoctorId').value;
    const data = {
        name: document.getElementById('editName').value,
        specialization: document.getElementById('editSpecialization').value,
        email: document.getElementById('editEmail').value,
        phone: document.getElementById('editPhone').value
    };
    const btn = document.querySelector("#editDoctorModal .btn-primary");
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    const res = await fetch(`/admin/doctor/${id}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('editDoctorModal')).hide();
        loadDoctors();
    } else {
        alert('Update failed');
    }
    btn.innerHTML = '<i class="fas fa-save me-2"></i> Save Changes';
    btn.disabled = false;
}

async function deleteDoctor(id) {
    if (!confirm('Are you absolutely sure you want to delete this doctor?')) return;
    const res = await fetch(`/admin/doctor/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        loadDoctors();
    } else {
        alert('Delete failed');
    }
}

async function loadReports() {
    try {
        const res = await fetch('/admin/reports', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const reports = await res.json();
        const tbody = document.getElementById('reportsTableBody');
        if(reports.length === 0) {
             tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No reports in system.</td></tr>';
             return;
        }
        tbody.innerHTML = reports.map(r => `
            <tr>
                <td class="fw-bold">#${r.report_id}</td>
                <td>${r.patient_id}</td>
                <td class="text-truncate" style="max-width: 250px;">${r.symptoms}</td>
                <td><span class="badge bg-${r.severity==='Critical' ? 'danger' : r.severity==='Moderate' ? 'warning text-dark' : 'success'} shadow-sm">${r.severity}</span></td>
                <td><span class="badge ${r.status==='Completed'?'bg-success':'bg-secondary'}">${r.status}</span></td>
            </tr>
        `).join('');
    } catch(e) {}
}

async function loadRequests() {
    try {
        const res = await fetch('/admin/doctor_requests', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const reqs = await res.json();
        const tbody = document.getElementById('requestsTableBody');
        if(reqs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No pending requests.</td></tr>';
            return;
        }
        tbody.innerHTML = reqs.map(r => `
            <tr>
                <td class="fw-bold">#${r.request_id}</td>
                <td><i class="fas fa-user-md text-secondary me-2"></i>${r.name}</td>
                <td><span class="badge bg-light text-dark border">${r.specialization}</span></td>
                <td><small class="text-muted d-block">${r.education}</small><small>${r.experience_years} yrs exp</small></td>
                <td><small class="d-block"><i class="fas fa-envelope me-1"></i>${r.email}</small><small><i class="fas fa-phone me-1"></i>${r.phone}</small></td>
                <td><small class="text-muted">${r.created_at}</small></td>
                <td>
                    <button class="btn btn-sm btn-success shadow-sm me-1" onclick="approveRequest(${r.request_id})" title="Approve Request"><i class="fas fa-check"></i> Approve</button>
                    <button class="btn btn-sm btn-outline-danger shadow-sm" onclick="rejectRequest(${r.request_id})" title="Reject Request"><i class="fas fa-times"></i></button>
                </td>
            </tr>
        `).join('');
    } catch(e) { console.error(e); }
}

async function approveRequest(id) {
    if(!confirm("Approve this doctor for full platform access?")) return;
    const res = await fetch(`/admin/approve_request/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if(res.ok) {
        const data = await res.json();
        document.getElementById('newDocEmail').innerText = data.email;
        document.getElementById('newDocPassword').innerText = data.temp_password;
        new bootstrap.Modal(document.getElementById('approveSuccessModal')).show();
        loadRequests();
        loadDoctors(); // refresh main doctor list too
    } else {
        alert("Failed to approve doctor.");
    }
}

async function rejectRequest(id) {
    if(!confirm("Are you sure you want to reject and delete this request?")) return;
    const res = await fetch(`/admin/reject_request/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if(res.ok) {
        loadRequests();
    } else {
        alert("Failed to reject doctor.");
    }
}

loadDoctors();
loadReports();
loadRequests();

function logout() {
    localStorage.clear();
    window.location.href = '/login';
}

// ==============================
// ADD ADMIN (Super Admin)
// ==============================
function openAddAdminModal() {
    new bootstrap.Modal(document.getElementById('addAdminModal')).show();
}

async function submitAddAdmin() {
    const btn = document.querySelector('#addAdminModal .btn-warning');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Creating...';
    btn.disabled = true;

    try {
        const res = await fetch('/admin/add_admin', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.getElementById('newAdminName').value,
                email: document.getElementById('newAdminEmail').value,
                phone: document.getElementById('newAdminPhone').value,
                password: document.getElementById('newAdminPassword').value
            })
        });
        const data = await res.json();
        if(res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('addAdminModal')).hide();
            document.getElementById('addAdminForm').reset();
            alert("New Admin account created successfully!");
        } else {
            alert(data.msg || "Error creating admin");
        }
    } catch(e) {
        alert("Network error.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ==============================
// DOCTOR PROFILE
// ==============================
async function showDoctorProfile(id) {
    const modalTarget = new bootstrap.Modal(document.getElementById('doctorProfileModal'));
    modalTarget.show();
    
    const body = document.getElementById('doctorProfileBody');
    body.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';

    try {
        const res = await fetch(`/admin/doctor_profile/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if(!res.ok) {
            body.innerHTML = '<div class="alert alert-danger m-4">Failed to load doctor profile.</div>';
            return;
        }
        
        const data = await res.json();
        const info = data.doctor_info;
        const stats = data.work_summary;
        const rating = data.feedback_stats;
        
        document.getElementById('profileDocName').innerHTML = `<i class="fas fa-user-md me-2"></i>Dr. ${info.name}`;
        
        let casesHTML = data.cases.length === 0 ? '<p class="text-muted text-center py-3">No patient cases assigned yet.</p>' : data.cases.map(c => `
            <div class="card border-0 border-bottom mb-2 bg-transparent shadow-none">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong><i class="fas fa-user text-secondary me-1"></i> ${c.patient_name}</strong>
                        <span class="badge ${c.status === 'Completed' ? 'bg-success' : 'bg-secondary'}">${c.status}</span>
                    </div>
                    <small class="text-muted d-block text-truncate mb-1" style="max-width: 100%;">${c.symptoms}</small>
                    <small class="text-primary"><i class="far fa-calendar-alt me-1"></i> ${c.date}</small>
                </div>
            </div>
        `).join('');

        let feedbackHTML = data.feedbacks.length === 0 ? '<p class="text-muted text-center py-3">No patient reviews yet.</p>' : data.feedbacks.map(f => `
            <div class="card shadow-sm border-0 mb-3">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between mb-2">
                        <div class="text-warning">
                            ${Array(f.rating).fill('<i class="fas fa-star"></i>').join('')}${Array(5-f.rating).fill('<i class="far fa-star"></i>').join('')}
                        </div>
                        <small class="text-muted">${f.date}</small>
                    </div>
                    ${f.comment ? `<p class="mb-0 text-dark" style="font-size: 0.9rem;">"${f.comment}"</p>` : ''}
                </div>
            </div>
        `).join('');

        body.innerHTML = `
            <div class="container-fluid px-0">
                <!-- Top Header Cards -->
                <div class="row g-3 mb-4">
                    <div class="col-md-6">
                        <div class="card bg-primary text-white border-0 shadow-sm h-100" style="border-radius: 12px;">
                            <div class="card-body p-4">
                                <h6><i class="fas fa-stethoscope me-2"></i> ${info.specialization}</h6>
                                <p class="mb-1"><i class="fas fa-envelope me-2"></i> ${info.email}</p>
                                <p class="mb-1"><i class="fas fa-phone me-2"></i> ${info.phone}</p>
                                <hr class="border-light opacity-25">
                                <small class="d-block"><i class="fas fa-graduation-cap me-2"></i> ${info.education}</small>
                                <small class="d-block"><i class="fas fa-briefcase me-2"></i> ${info.experience} Years Experience</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="row g-3 h-100">
                            <div class="col-6">
                                <div class="card bg-success text-white border-0 shadow-sm h-100 text-center py-3" style="border-radius: 12px;">
                                    <h2 class="fw-bold mb-0">${stats.total_completed}</h2>
                                    <small>Completed Reports</small>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="card bg-warning text-dark border-0 shadow-sm h-100 text-center py-3" style="border-radius: 12px;">
                                    <h2 class="fw-bold mb-0">${stats.total_pending}</h2>
                                    <small>Pending Cases</small>
                                </div>
                            </div>
                            <div class="col-12">
                                <div class="card bg-dark text-white border-0 shadow-sm text-center py-3 d-flex align-items-center justify-content-center" style="border-radius: 12px; flex-direction: row; gap: 15px;">
                                    <div>
                                        <h2 class="text-warning mb-0"><i class="fas fa-star"></i> ${rating.average_rating}</h2>
                                    </div>
                                    <div class="text-start">
                                        <div class="fw-bold fs-5">Overall Rating</div>
                                        <small class="text-secondary">Based on ${rating.total_reviews} reviews</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Lower Tabs -->
                <ul class="nav nav-tabs border-bottom-0 mb-3" id="profileTabs">
                    <li class="nav-item">
                        <button class="nav-link active fw-bold text-dark px-4 border-0 border-bottom border-primary border-3 bg-transparent" id="cases-tab" data-bs-toggle="tab" data-bs-target="#profCases">Patient Cases</button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link fw-bold text-secondary px-4 border-0 bg-transparent" id="reviews-tab" data-bs-toggle="tab" data-bs-target="#profReviews">Patient Reviews</button>
                    </li>
                </ul>
                
                <div class="tab-content bg-white p-4 shadow-sm" style="border-radius: 12px; min-height: 300px;">
                    <div class="tab-pane fade show active" id="profCases">
                        ${casesHTML}
                    </div>
                    <div class="tab-pane fade" id="profReviews">
                        ${feedbackHTML}
                    </div>
                </div>
            </div>
        `;
        
        // Setup simple tab switching within modal specifically so Bootstrap doesn't clash with outer page tabs
        const pfModal = document.getElementById('doctorProfileModal');
        const pfTabs = pfModal.querySelectorAll('#profileTabs .nav-link');
        pfTabs.forEach(t => t.addEventListener('click', (e) => {
            pfTabs.forEach(x => {
                x.classList.remove('active', 'border-bottom', 'border-primary', 'border-3', 'text-dark');
                x.classList.add('text-secondary');
            });
            e.target.classList.add('active', 'border-bottom', 'border-primary', 'border-3', 'text-dark');
            e.target.classList.remove('text-secondary');
            
            pfModal.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
            pfModal.querySelector(e.target.getAttribute('data-bs-target')).classList.add('show', 'active');
        }));

    } catch(e) {
        body.innerHTML = '<div class="alert alert-danger m-4">Network error loading profile.</div>';
    }
}
