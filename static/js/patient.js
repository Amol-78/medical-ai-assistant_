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
                console.log("Patient Socket authenticated and connected.");
            } catch (err) { console.error("Socket join err", err); }
        }
    });

    // Directly bind to instantaneous doctor responses removing 2-second REST-ping delays
    socket.on('call_answered', (data) => {
        if (data.callId && data.callId === window.currentCallId) {
            checkCallStatus(data.callId); // Handshakes directly with backend validator upon event trigger
        }
    });

    // Doctor-initiated incoming call popup
    socket.on('incoming_call_from_doctor', (data) => {
        showDoctorCallModal(data);
    });
}

// Persistent Chat Memory
let aiChatHistory = JSON.parse(sessionStorage.getItem('medai_history')) || [];
let currentChatImageBase64 = null;

function setActive(elem) {
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    if (elem) elem.classList.add('active');
}

function clearChat() {
    if (confirm("Start a new consultation? This will clear the current chat.")) {
        aiChatHistory = [];
        sessionStorage.removeItem('medai_history');
        window.pendingReportData = null;
        loadPage('chat');
    }
}

async function loadPage(page) {
    if (!page) page = 'chat';
    localStorage.setItem('currentPatientPage', page);

    // Dynamically lock/unlock scrolling. Chat needs strict viewport lock; others scroll freely!
    const contentContainer = document.getElementById('content');
    if (contentContainer) {
        contentContainer.style.overflowY = 'auto';
    }

    // Auto-close mobile sidebar if open
    const sidebar = document.getElementById('sidebarCollapse');
    if (sidebar && sidebar.classList.contains('show') && window.innerWidth < 768) {
        try {
            const bsCollapse = bootstrap.Collapse.getInstance(sidebar) || new bootstrap.Collapse(sidebar, { toggle: false });
            bsCollapse.hide();
        } catch (e) { }
    }

    // Auto-hilight the correct sidebar link
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-link').forEach(el => {
        if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(`'${page}'`)) {
            el.classList.add('active');
        }
    });

    const content = document.getElementById('content');
    if (page === 'submit_report') {
        content.innerHTML = `
            <h3 class="mb-4 text-primary"><i class="fas fa-stethoscope me-2"></i> Submit Symptoms</h3>
            <form id="reportForm" enctype="multipart/form-data">
                <div class="mb-4">
                    <label class="form-label text-muted fw-bold">Describe your symptoms in detail</label>
                    <textarea class="form-control shadow-sm" name="symptoms" rows="5" placeholder="e.g. I have been experiencing a mild headache for 2 days..." required></textarea>
                </div>
                <div class="mb-4">
                    <label class="form-label text-muted fw-bold">Upload Image (optional, max 5MB)</label>
                    <input type="file" class="form-control shadow-sm" name="image" accept="image/*">
                </div>
                <div class="mb-4">
                    <label class="form-label text-muted fw-bold">Preferred Language for Report</label>
                    <select class="form-select form-control shadow-sm" name="language">
                        <option value="English">English</option>
                        <option value="Hindi">Hindi</option>
                        <option value="Telugu">Telugu</option>
                        <option value="Marathi">Marathi</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary px-4 py-2 w-100">Submit for AI Triage <i class="fas fa-paper-plane ms-2"></i></button>
            </form>
        `;
        document.getElementById('reportForm').addEventListener('submit', submitReport);
    } else if (page === 'emergency') {
        content.innerHTML = `
            <div class="d-flex align-items-center mb-4 text-danger border-bottom border-danger pb-2">
                <i class="fas fa-ambulance fa-2x me-3"></i>
                <h3 class="m-0 fw-bold">Emergency Assistance</h3>
            </div>
            <p class="text-muted fw-bold mb-4">Select your preferred communication method to instantly connect with an available specialist.</p>
            <div class="row text-center mb-4">
                <div class="col-md-4 mb-3">
                    <button class="btn btn-outline-danger w-100 py-4 shadow-sm fw-bold bg-white" onclick="loadEmergencyDoctors('Audio Call')" style="border-width: 2px;">
                        <i class="fas fa-phone-alt fa-2x mb-2 d-block"></i> Audio Call
                    </button>
                </div>
                <div class="col-md-4 mb-3">
                    <button class="btn btn-outline-danger w-100 py-4 shadow-sm fw-bold bg-white" onclick="loadEmergencyDoctors('Video Call')" style="border-width: 2px;">
                        <i class="fas fa-video fa-2x mb-2 d-block"></i> Video Call
                    </button>
                </div>
                <div class="col-md-4 mb-3">
                    <button class="btn btn-outline-danger w-100 py-4 shadow-sm fw-bold bg-white" onclick="loadEmergencyDoctors('Email')" style="border-width: 2px;">
                        <i class="fas fa-envelope fa-2x mb-2 d-block"></i> Email
                    </button>
                </div>
            </div>
            <div id="emergencyDoctorList"></div>
        `;
    } else if (page === 'history') {
        loadHistory();
    } else if (page === 'appointments') {
        loadAppointments();
    } else if (page === 'search') {
        content.innerHTML = `
            <h3 class="mb-4 text-primary"><i class="fas fa-search me-2"></i> Find Doctors</h3>
            <div class="glass-card mb-4 p-4">
                <div class="row g-3">
                    <div class="col-md-5">
                        <input type="text" id="searchDoctorName" class="form-control" placeholder="Search by name...">
                    </div>
                    <div class="col-md-4">
                        <select id="searchSpecialization" class="form-select">
                            <option value="">All Specializations</option>
                            <option value="Cardiologist">Cardiologist (Heart)</option>
                            <option value="Neurologist">Neurologist (Brain & Nerves)</option>
                            <option value="Dermatologist">Dermatologist (Skin)</option>
                            <option value="Orthopedic">Orthopedic (Bones & Joints)</option>
                            <option value="General Physician">General Physician (Primary Care)</option>
                            <option value="Pediatrician">Pediatrician (Children)</option>
                            <option value="ENT Specialist">ENT Specialist (Ear, Nose, Throat)</option>

                            <option value="Gastroenterologist">Gastroenterologist (Digestive System,
                                            Stomach, Liver)</option>
                            <option value="Pulmonologist">Pulmonologist (Lungs and Respiratory System)
                                        </option>
                            <option value="Endocrinologist">Endocrinologist (Hormones, Diabetes, Thyroid)
                                        </option>
                            <option value="Psychiatrist">Psychiatrist (Mental Health and Behavior)</option>
                            <option value="Ophthalmologist">Ophthalmologist (Eyes and Vision)</option>
                            <option value="Gynecologist">Gynecologist (Women's Reproductive Health)</option>
                            <option value="Urologist">Urologist (Urinary Tract and Male Reproductive System)
                                        </option>
                            <option value="Oncologist">Oncologist (Cancer and Tumors)</option>

                        </select>
                    </div>
                    <div class="col-md-3">
                        <button class="btn btn-primary w-100" onclick="searchDoctors()"><i class="fas fa-search me-1"></i> Search</button>
                    </div>
                </div>
            </div>
            <div id="searchResults" class="row">
                <!-- Search results will appear here -->
            </div>
        `;
        searchDoctors(); // Load all doctors initially
    } else if (page === 'wallet') {
        content.innerHTML = `
            <div class="row mb-4 align-items-center">
                <div class="col-md-6">
                    <h3 class="mb-0 text-primary fw-bold"><i class="fas fa-wallet me-2"></i> My Wallet</h3>
                </div>
                <div class="col-md-6 text-md-end mt-3 mt-md-0">
                    <button class="btn btn-success px-4 fw-bold shadow-sm" onclick="showAddMoneyDialog()"><i class="fas fa-plus me-2"></i> Add Money</button>
                </div>
            </div>
            
            <div class="mb-5 text-center p-5 bg-gradient text-white shadow" style="background: linear-gradient(135deg, #0d6efd 0%, #00d4ff 100%) !important; border-radius: 20px;">
                <p class="mb-2 text-white-50 text-uppercase fw-bold" style="letter-spacing: 2px;">Available Balance</p>
                <h1 class="display-3 fw-bold mb-0 text-white">₹<span id="walletBalance">0.00</span></h1>
            </div>
            
            <div class="glass-card p-4 shadow-sm">
                <h4 class="mb-4 text-dark fw-bold border-bottom pb-3"><i class="fas fa-list-ul me-2 text-primary"></i> Transaction History</h4>
                <div class="table-responsive">
                    <table class="table table-hover align-middle">
                        <thead class="table-light">
                            <tr>
                                <th>Date & Time</th>
                                <th>Description</th>
                                <th>Type</th>
                                <th class="text-end">Amount</th>
                            </tr>
                        </thead>
                        <tbody id="transactionsList">
                            <tr><td colspan="4" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i> Loading history...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        loadWallet();
    } else if (page === 'chat') {
        let langs = [
            { code: 'GB', name: 'English' },
            { code: 'IN', name: 'हिंदी', val: 'Hindi' },
            { code: 'IN', name: 'తెలుగు', val: 'Telugu' },
            { code: 'IN', name: 'मराठी', val: 'Marathi' },
            { code: 'IN', name: 'தமிழ்', val: 'Tamil' },
            { code: 'IN', name: 'বাংলা', val: 'Bengali' },
            { code: 'IN', name: 'ଓଡ଼ିଆ', val: 'Odia' }
        ];

        // Define default as English if nothing clicked
        window.tempSelectedLang = window.tempSelectedLang || 'English';

        let gridHtml = langs.map(l => {
            let actualVal = l.val || l.name;
            let isActive = (window.tempSelectedLang === actualVal) ? 'border-primary text-primary shadow bg-light' : 'border-light text-dark shadow-sm';
            return `
            <div class="col-4 col-md-3 mb-3">
                <div class="card cursor-pointer language-card h-100 ${isActive}" 
                     style="border-radius: 12px; cursor: pointer; transition: 0.2s;"
                     onclick="selectLang('${actualVal}')">
                    <div class="card-body text-center p-3">
                        <h5 class="fw-bold mb-1">${l.code}</h5>
                        <p class="mb-0 small">${l.name}</p>
                    </div>
                </div>
            </div>`;
        }).join('');

        content.innerHTML = `
            <div class="d-flex flex-column align-items-center justify-content-center py-5 fade-in">
                <div class="text-primary mb-3">
                    <i class="fas fa-stethoscope fa-3x" style="color: #6C5CE7;"></i>
                </div>
                <h3 class="fw-bold" style="color: #2D3436;">Start Your AI Consultation</h3>
                <p class="text-muted text-center mb-5" style="max-width: 500px;">
                    Please choose your preferred language. Our AI doctor will communicate with you in that language.
                </p>
                <div class="row justify-content-center mb-5 w-100 px-md-5" id="languageGrid">
                    ${gridHtml}
                </div>
                <button class="btn px-4 py-2 text-white shadow fw-bold" style="background:#4A69E2; border-radius: 8px;" onclick="openChatWindow()">
                    <i class="fas fa-comments me-2"></i> Start Consultation
                </button>
            </div>
        `;
    }
}

window.selectLang = function (langVal) {
    window.tempSelectedLang = langVal;
    loadPage('chat'); // re-render grid to update highlight
};

window.openChatWindow = function () {
    const content = document.getElementById('content');
    const selectedLang = window.tempSelectedLang || 'English';
    
    // Explicitly lock the scrolling for the Chat interface
    content.style.overflowY = 'hidden';

    // Multilingual Default Welcome Message
    if (aiChatHistory.length === 0) {
        let greeting = "Hello! I'm your AI health assistant. Please tell me about the symptoms you're experiencing today.";
        switch (selectedLang) {
            case 'Hindi': greeting = "नमस्ते! मैं आपका AI स्वास्थ्य सहायक हूँ। कृपया आज आप जो लक्षण महसूस कर रहे हैं, उनके बारे में बताएं।"; break;
            case 'Telugu': greeting = "నమస్కారం! నేను మీ AI ఆరోగ్య సహాయకుడిని. దయచేసి మీరు ఈరోజు అనుభవిస్తున్న లక్షణాల గురించి నాకు చెప్పండి."; break;
            case 'Marathi': greeting = "नमस्कार! मी तुमचा AI आरोग्य सहाय्यक आहे. कृपया आज तुम्हाला जाणवत असलेल्या लक्षणांबद्दल मला सांगा."; break;
            case 'Tamil': greeting = "வணக்கம்! நான் உங்கள் AI சுகாதார உதவியாளர். இன்று நீங்கள் சந்திக்கும் அறிகுறிகளைப் பற்றி என்னிடம் கூறுங்கள்."; break;
            case 'Bengali': greeting = "নমস্কার! আমি আপনার এআই (AI) স্বাস্থ্য সহকারী। অনুগ্রহ করে আজ আপনার যে লক্ষণগুলি অনুভব করছেন তা আমাকে বলুন।"; break;
            case 'Odia': greeting = "ନମସ୍କାର! ମୁଁ ଆପଣଙ୍କର AI ସ୍ୱାସ୍ଥ୍ୟ ସହାୟକ। ଦୟାକରି ଆପଣ ଆଜି ଅନୁଭବ କରୁଥିବା ଲକ୍ଷଣଗୁଡ଼ିକ ବିଷୟରେ ମୋତେ କୁହନ୍ତୁ।"; break;
        }
        aiChatHistory.push({ role: 'assistant', content: greeting });
        sessionStorage.setItem('medai_history', JSON.stringify(aiChatHistory));
    }

    let historyHtml = '';
    aiChatHistory.forEach(msg => {
        if (msg.role === 'system' && msg.isReportResult) {
                // Render previously generated Green/Red Box
                let rBlock = '';
                if (msg.severity === 'Normal') {
                    rBlock = `
                             <div class="d-flex justify-content-center mb-3 fade-in w-100">
                                 <div class="p-4 bg-white border-top rounded shadow-lg" style="width: 85%; border-width: 4px !important; border-top-color: var(--bs-success) !important;">
                                     <div class="text-center">
                                         <div class="bg-success text-white rounded-circle d-inline-flex align-items-center justify-content-center mb-3 shadow" style="width:50px;height:50px;font-size:1.2rem;">
                                             <i class="fas fa-check"></i>
                                         </div>
                                         <h5 class="text-success fw-bold mb-2">Auto-Diagnosis Complete</h5>
                                         <p class="text-muted mb-4 small">A clinical self-care routine has been prepared and stored safely in your medical record.</p>
                                         <button class="btn btn-success px-4 py-2 shadow-sm fw-bold border-0" style="border-radius:8px;" onclick="downloadPDF(${msg.reportId})">
                                             <i class="fas fa-download me-2"></i> Download Full Report
                                         </button>
                                     </div>
                                 </div>
                             </div>
                         `;
                } else {
                    rBlock = `
                             <div class="d-flex justify-content-center mb-3 fade-in w-100">
                                 <div class="p-4 bg-white border-top rounded shadow-lg" style="width: 85%; border-width: 4px !important; border-top-color: var(--bs-danger) !important;">
                                     <div class="text-center">
                                         <div class="bg-danger text-white rounded-circle d-inline-flex align-items-center justify-content-center mb-3 shadow" style="width:50px;height:50px;font-size:1.2rem;">
                                             <i class="fas fa-exclamation-triangle"></i>
                                         </div>
                                         <h5 class="text-danger fw-bold mb-2">Doctor Attention Required</h5>
                                         <p class="text-muted mb-4 small">Based strictly on your diagnostic markers, we strongly advise consulting a clinical specialist immediately to avoid complications.</p>
                                         <button class="btn btn-danger px-4 py-2 shadow-sm fw-bold border-0" style="border-radius:8px;" onclick="showDoctorSelection(${msg.reportId})">
                                             <i class="fas fa-user-md me-2"></i> Select Available Doctor
                                         </button>
                                     </div>
                                 </div>
                             </div>
                         `;
                }
                historyHtml += rBlock;
            } else {
                let audioHtml = msg.audio ? `<div class="mt-2 text-end"><audio controls src="/static/uploads/${msg.audio}?cb=${new Date().getTime()}" style="height:35px; border-radius:8px; outline:none;"></audio></div>` : '';
                let formattedContent = typeof marked !== 'undefined' ? marked.parse(msg.content) : msg.content.replace(/\n/g, '<br>');
                
                let timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                if (msg.role === 'user') {
                    historyHtml += `
                        <div class="d-flex justify-content-end mb-4 fade-in">
                            <div class="text-end me-3" style="max-width: 75%;">
                                <div class="p-3 chat-bubble-user text-start shadow-sm" style="display: inline-block;">
                                    ${formattedContent}
                                </div>
                                <div class="text-muted small mt-1" style="font-size:0.75rem;">${timeStr}</div>
                            </div>
                            <div class="flex-shrink-0">
                                <div class="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width: 36px; height: 36px; font-weight: 600; font-size: 0.85rem;">You</div>
                            </div>
                        </div>`;
                } else {
                    historyHtml += `
                        <div class="d-flex justify-content-start mb-4 fade-in">
                            <div class="flex-shrink-0 me-3">
                                <div class="text-white rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width: 36px; height: 36px; background-color: #6366f1;">
                                    <i class="fas fa-robot fs-6"></i>
                                </div>
                            </div>
                            <div class="flex-grow-1" style="max-width: 85%;">
                                <div class="mb-1">
                                    <strong class="text-dark" style="font-size: 0.95rem;">MedAI Assistant</strong>
                                    <small class="text-muted ms-1" style="font-size: 0.70rem;">Online · AI Health Triage</small>
                                </div>
                                <div class="p-3 chat-bubble-ai w-100 shadow-sm">
                                    ${formattedContent}
                                    ${audioHtml}
                                </div>
                                <div class="text-muted mt-1 text-start" style="font-size:0.75rem;">${timeStr}</div>
                            </div>
                        </div>`;
                }
            }
    });
    content.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-0 pb-2 flex-shrink-0">
            <div class="d-flex align-items-center">
                <i class="fas fa-comments text-primary fs-4 me-2"></i>
                <h4 class="text-dark fw-bold m-0 fs-5">AI Consultation</h4>
            </div>
            <div class="d-flex align-items-center">
                <button class="btn btn-primary px-3 py-2 shadow-sm rounded-3 fw-semibold" style="font-size: 0.9rem;" onclick="clearChat()"><i class="fas fa-plus me-1"></i> New Consultation</button>
            </div>
        </div>

        <div class="chat-container d-flex flex-column flex-grow-1 position-relative">
            <div class="d-flex justify-content-end p-3 position-absolute end-0 top-0" style="z-index: 5;">
                <span class="badge bg-light text-primary border rounded-pill px-3 py-2 shadow-sm" style="font-size:0.75rem;"><strong class="text-dark me-1 border-end border-secondary pe-2 border-opacity-25">${selectedLang.substring(0, 2).toUpperCase()}</strong> ${selectedLang}</span>
                <input type="hidden" id="chatLanguage" value="${selectedLang}">
            </div>

            <div id="chatMessages" class="flex-grow-1 p-4 w-100" style="overflow-y:auto; scroll-behavior: smooth; min-height: 0; margin-top: 10px;">
                ${historyHtml}
            </div>

            <div id="chatImagePreview" class="d-none position-absolute p-2 border rounded bg-white shadow-sm flex-shrink-0" style="bottom: 80px; left: 20px; z-index: 10;">
                <img id="chatImageImg" src="" style="max-height: 80px; border-radius: 6px;">
                <button class="btn btn-sm btn-danger position-absolute top-0 start-100 translate-middle rounded-circle shadow" style="padding: 2px 6px;" onclick="clearChatImage()"><i class="fas fa-times"></i></button>
            </div>

            <div id="floatingGenerateContainer" class="d-none position-absolute top-0 start-50 translate-middle-x mt-3" style="z-index: 10;">
                <button id="floatingGenerateBtn" class="btn text-white fw-bold shadow-lg px-4 py-2" style="background:var(--primary); border-radius:10px; border: 2px solid white;">
                    <i class="fas fa-file-medical me-2"></i> Generate Report
                </button>
            </div>

            <div class="chat-input-wrapper p-3 d-flex gap-2 align-items-center mt-auto flex-shrink-0">
                <button class="btn btn-danger text-white px-3 py-2 rounded-3 fw-bold flex-shrink-0 d-flex align-items-center" onclick="loadPage('emergency')" title="Urgent Emergency Assistance">
                    <i class="fas fa-ambulance"></i><span class="d-none d-sm-inline ms-2">Emergency</span>
                </button>
                
                <input type="text" id="chatInput" class="form-control chat-input flex-grow-1 px-4 py-3 text-dark mx-2" placeholder="Type your symptoms here..." onkeypress="if(event.key === 'Enter') sendChat()">
                
                <label class="btn-attach mb-0 shadow-sm" for="chatImage" title="Attach an image">
                    <i class="fas fa-camera"></i>
                </label>
                <input type="file" id="chatImage" class="d-none" accept="image/*" onchange="previewChatImage(this)">
                
                <button id="chatSendBtn" class="btn-send border-0 shadow-sm" onclick="sendChat()">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    setTimeout(() => {
        const cd = document.getElementById('chatMessages');
        if (cd) cd.scrollTop = cd.scrollHeight;

        // Rehydrate the button state if the latest un-resolved state had a CTA
        if (aiChatHistory.length > 0) {
            const lastMsg = aiChatHistory[aiChatHistory.length - 1];
            if (lastMsg.hasReportCTA && lastMsg.report_data) {
                window.pendingReportData = lastMsg.report_data; // Recover the pending report variables
                const floatCont = document.getElementById('floatingGenerateContainer');
                const floatBtn = document.getElementById('floatingGenerateBtn');
                if (floatCont && floatBtn) {
                    floatCont.classList.remove('d-none');
                    floatBtn.onclick = () => revealGeneratedReport();
                }
            }
        }
    }, 50);
}

function previewChatImage(input) {
    if (input.files && input.files[0]) {
        if (input.files[0].size > 5 * 1024 * 1024) {
            alert("Image must be smaller than 5MB");
            input.value = "";
            return;
        }
        const reader = new FileReader();
        reader.onload = function (e) {
            currentChatImageBase64 = e.target.result;
            document.getElementById('chatImageImg').src = e.target.result;
            document.getElementById('chatImagePreview').classList.remove('d-none');
        }
        reader.readAsDataURL(input.files[0]);
    }
}

function clearChatImage() {
    currentChatImageBase64 = null;
    document.getElementById('chatImageImg').src = "";
    document.getElementById('chatImagePreview').classList.add('d-none');
    const input = document.getElementById('chatImage');
    if (input) input.value = "";
}

async function loadHistory() {
    document.getElementById('content').innerHTML = '<div class="text-center my-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';
    try {
        const res = await fetch('/patient/history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        if (!res.ok) throw new Error("Failed to load");
        const reports = await res.json();
        let html = '<h3 class="mb-4 text-primary"><i class="fas fa-history me-2"></i> Medical History</h3>';
        if (reports.length === 0) {
            html += '<p class="text-muted">No reports found.</p>';
        } else {
            html += '<div class="row">';
            reports.forEach(r => {
                html += `
                <div class="col-12 mb-3">
                    <div class="p-3 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center flex-wrap">
                        <div>
                            <h5 class="mb-1 text-dark">Severity: <span class="badge bg-${r.severity === 'Critical' ? 'danger' : r.severity === 'Moderate' ? 'warning text-dark' : 'success'}">${r.severity}</span></h5>
                            <p class="text-muted mb-1 small">${new Date(r.date).toLocaleString()}</p>
                            <p class="mb-2 text-truncate text-muted" style="max-width:400px;">Original: ${r.symptoms}</p>
                            ${r.doctor_response ? `<div class="p-2 mb-2 bg-light border rounded"><i class="fas fa-robot text-primary me-2"></i><strong>AI Report:</strong><br>${r.doctor_response.replace(/\n/g, '<br>')}</div>` : ''}
                            ${r.audio_file ? `<div class="mt-2 text-center"><audio controls src="/static/uploads/${r.audio_file}?cb=${new Date().getTime()}" style="height:40px; border-radius:8px; outline:none;"></audio></div>` : ''}
                            
                            <div class="mt-2">
                                <select id="lang-${r.report_id}" class="form-select form-select-sm d-inline-block shadow-sm" style="width:140px;" onchange="translateReport(${r.report_id}, this.value)">
                                    <option value="" selected disabled>Translate to...</option>
                                    <option value="English">English</option>
                                    <option value="Hindi">Hindi</option>
                                    <option value="Telugu">Telugu</option>
                                    <option value="Marathi">Marathi</option>
                                </select>
                            </div>
                        </div>
                        <div class="mt-2 mt-md-0 d-flex flex-column align-items-end gap-2">
                            <div>
                                <span class="badge bg-${r.status === 'Completed' ? 'success' : (r.status === 'pending' ? 'warning text-dark' : 'secondary')} me-2">${r.status === 'awaiting_selection' ? 'Action Required' : r.status}</span>
                                ${(r.status === 'Completed') ? `<button onclick="downloadPDF(${r.report_id})" class="btn btn-sm btn-outline-primary"><i class="fas fa-download me-1"></i> PDF</button>` : ''}
                            </div>
                            ${(r.status === 'pending' && r.assigned_doctor_id) ? `
                            <div class="mt-2 p-3 rounded-3 border" style="background: linear-gradient(135deg, #eff6ff, #f0fdf4); border-color: #bfdbfe !important;">
                                <p class="mb-2 fw-bold text-primary small"><i class="fas fa-user-md me-1"></i>Dr. ${r.doctor_name || 'Your Doctor'} is reviewing your case</p>
                                <p class="mb-2 text-muted" style="font-size:0.8rem;"><i class="fas fa-hourglass-half me-1 text-warning"></i>Under review — connect directly if needed:</p>
                                <div class="d-flex flex-wrap gap-2">
                                    <button class="btn btn-sm btn-primary fw-bold shadow-sm" onclick="startVideoCallToDoctor(${r.assigned_doctor_id}, '${(r.doctor_name||'Doctor').replace(/'/g,'&apos;')}', ${r.report_id})">
                                        <i class="fas fa-video me-1"></i> Video Call
                                    </button>
                                    ${r.doctor_phone ? `<a href="tel:${r.doctor_phone}" class="btn btn-sm btn-success fw-bold shadow-sm"><i class="fas fa-phone me-1"></i> Audio Call</a>` : ''}
                                    ${r.doctor_email ? `<a href="mailto:${r.doctor_email}?subject=Query about Report #${r.report_id}&body=Hello Dr. ${r.doctor_name||''}," class="btn btn-sm btn-secondary fw-bold shadow-sm" target="_blank"><i class="fas fa-envelope me-1"></i> Email</a>` : ''}
                                </div>
                            </div>` : ''}
                            ${(r.status === 'pending' && !r.assigned_doctor_id) ? `<span class="text-warning small fst-italic"><i class="fas fa-hourglass-half me-1"></i>Under doctor review. Please wait.</span>` : ''}
                            ${(r.status === 'awaiting_selection') ? `<button class="btn btn-sm btn-danger shadow-sm" onclick="showDoctorSelection(${r.report_id})"><i class="fas fa-user-md me-1"></i> Select Doctor for Diagnosis</button>` : ''}
                            ${(r.status === 'Completed' && r.assigned_doctor_id && !r.has_feedback) ? `<button class="btn btn-sm btn-warning shadow-sm border text-dark fw-bold mt-1" onclick="openFeedbackModal(${r.report_id}, 'report')"><i class="fas fa-star me-1"></i> Leave Doctor Feedback</button>` : ''}
                        </div>
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        document.getElementById('content').innerHTML = html;
    } catch (err) {
        document.getElementById('content').innerHTML = '<p class="text-danger">Failed to load history.</p>';
    }
}

async function translateReport(reportId, lang) {
    if (!lang) return;

    const content = document.getElementById('content');
    const oldHtml = content.innerHTML;
    content.innerHTML = '<div class="text-center my-5"><i class="fas fa-language fa-3x text-primary mb-3"></i><br><h5>Translating...</h5><i class="fas fa-spinner fa-spin fa-2x text-muted mt-2"></i></div>';

    try {
        const res = await fetch(`/patient/translate_report/${reportId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: lang })
        });

        if (res.ok) {
            loadHistory();
        } else {
            alert("Failed to translate report.");
            content.innerHTML = oldHtml;
        }
    } catch (e) {
        alert("Network error.");
        content.innerHTML = oldHtml;
    }
}

async function loadAppointments() {
    document.getElementById('content').innerHTML = '<div class="text-center my-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';
    try {
        const res = await fetch('/patient/appointments', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        if (!res.ok) throw new Error("Failed");
        const apps = await res.json();
        let html = '<h3 class="mb-4 text-primary"><i class="fas fa-calendar-check me-2"></i> Appointments</h3>';
        if (apps.length === 0) {
            html += '<p class="text-muted">No appointments scheduled.</p>';
        } else {
            html += '<ul class="list-group shadow-sm mb-4">';
            apps.forEach(a => {
                let appointmentDate = new Date(a.date);
                let now = new Date();
                let actionBtn = '';
                let statusDisplay = a.status;

                if (a.status === 'confirmed' && now >= appointmentDate) {
                    actionBtn = `<button class="btn btn-sm btn-success ms-3 shadow-sm py-1" onclick="markAppointmentDone(${a.appointment_id})"><i class="fas fa-check-double me-1"></i> Appointment is done</button>`;
                }
                if (a.status === 'done' && !a.has_feedback) {
                    actionBtn = `<button class="btn btn-sm btn-warning ms-3 shadow-sm py-1 text-dark fw-bold" onclick="openFeedbackModal(${a.appointment_id})"><i class="fas fa-star me-1"></i> Leave Feedback</button>`;
                }

                html += `<li class="list-group-item d-flex justify-content-between align-items-center p-3">
                    <div>
                        <h6 class="mb-0">Dr. ${a.doctor_name}</h6>
                        <small class="text-muted"><i class="fas fa-calendar-alt me-1"></i> ${appointmentDate.toLocaleString()}</small>
                    </div>
                    <div class="d-flex align-items-center">
                        <span class="badge bg-${a.status === 'done' ? 'success' : (a.status === 'confirmed' ? 'primary' : 'warning text-dark')} rounded-pill px-3 py-2 text-uppercase">${statusDisplay}</span>
                        ${actionBtn}
                    </div>
                </li>`;
            });
            html += '</ul>';
        }
        html += '<button class="btn btn-primary px-4 shadow-sm" onclick="showBookAppointment()"><i class="fas fa-plus me-2"></i> Book New Appointment</button>';
        document.getElementById('content').innerHTML = html;
    } catch (err) {
        document.getElementById('content').innerHTML = '<p class="text-danger">Failed to load appointments.</p>';
    }
}

async function showDoctorSelection(reportId) {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="text-center my-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';

    try {
        const res = await fetch(`/patient/doctors_for_report/${reportId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const doctors = await res.json();

        let html = `
        <h3 class="mb-4 text-primary"><i class="fas fa-user-md me-2"></i> Select Specialized Doctor</h3>
        `;

        if (doctors.length === 0) {
            html += `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-2"></i>Currently, no doctors are available for your condition. Please try again after some time.</div>`;
        } else {
            html += `<div class="row">`;
            doctors.forEach(d => {
                html += `
                <div class="col-md-6 col-lg-4 mb-4">
                    <div class="card h-100 shadow-sm border-0 glass-card transition-hover">
                        <div class="card-body d-flex flex-column text-start">
                            <h5 class="card-title text-dark fw-bold mb-1">Dr. ${d.name}</h5>
                            <p class="card-text text-primary fw-bold small mb-3"><i class="fas fa-stethoscope me-1"></i> ${d.specialization}</p>
                            <hr class="mt-0 mb-3 opacity-25">
                            <div class="mb-3">
                                <p class="card-text text-muted small fw-medium mb-2"><i class="fas fa-briefcase me-2 text-secondary"></i> ${d.experience_years} Years Experience</p>
                                <p class="card-text text-success small fw-bold mb-0"><i class="fas fa-rupee-sign me-2"></i> ${d.online_treatment_fee} Online Fee</p>
                            </div>
                            <div class="mt-auto">
                                <button class="btn btn-primary w-100 fw-bold py-2 shadow-sm rounded-3" onclick="assignReportToDoctor(${reportId}, ${d.doctor_id})"><i class="fas fa-check-circle me-2"></i> Select Doctor</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        html += `<button class="btn btn-outline-secondary mt-3" onclick="loadPage('history')"><i class="fas fa-arrow-left me-2"></i> Back to History</button>`;
        content.innerHTML = html;

    } catch (e) {
        content.innerHTML = '<p class="text-danger">Failed to load matching doctors.</p>';
    }
}

async function searchDoctors() {
    const list = document.getElementById('searchResults');
    list.innerHTML = '<div class="text-center w-100 py-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i></div>';

    const name = document.getElementById('searchDoctorName').value;
    const spec = document.getElementById('searchSpecialization').value;

    try {
        const res = await fetch(`/patient/search_doctors?name=${encodeURIComponent(name)}&specialization=${encodeURIComponent(spec)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const doctors = await res.json();

        if (doctors.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted"><p>No doctors found matching your criteria.</p></div>';
            return;
        }

        let html = '';
        doctors.forEach(d => {
            html += `
            <div class="col-md-6 col-lg-4 mb-4 fade-in">
                <div class="card h-100 shadow-sm border-0 glass-card transition-hover">
                    <div class="card-body d-flex flex-column text-start">
                        <div class="d-flex justify-content-between align-items-start mb-1">
                            <h5 class="card-title text-dark fw-bold mb-0">Dr. ${d.name}</h5>
                            <span class="badge bg-warning text-dark shadow-sm"><i class="fas fa-star text-dark"></i> ${d.rating}</span>
                        </div>
                        <p class="text-primary fw-bold small mb-3"><i class="fas fa-stethoscope me-1"></i> ${d.specialization}</p>
                        <hr class="mt-0 mb-3 opacity-25">
                        <div class="mb-3">
                            <p class="text-muted small fw-medium mb-2"><i class="fas fa-briefcase me-2 text-secondary"></i> ${d.experience_years} Years Experience</p>
                            <p class="text-success small fw-bold mb-0"><i class="fas fa-rupee-sign me-1"></i> ${d.online_treatment_fee} Consultation Fee</p>
                        </div>
                        <div class="mt-auto">
                            <button class="btn btn-outline-primary btn-sm w-100 fw-bold py-2 rounded-3 shadow-sm" onclick="viewDoctorProfile(${d.doctor_id})"><i class="fas fa-user-md me-2"></i> View Full Profile</button>
                        </div>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch (err) {
        list.innerHTML = '<div class="col-12 text-danger">Failed to search doctors.</div>';
    }
}

let docModalObj;
async function viewDoctorProfile(id) {
    if (!docModalObj) docModalObj = new bootstrap.Modal(document.getElementById('doctorProfileModal'));
    docModalObj.show();

    const content = document.getElementById('doctorProfileContent');
    content.innerHTML = '<div class="text-center py-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';

    try {
        const res = await fetch(`/patient/doctor_profile/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const d = await res.json();

        let reviewsHtml = '';
        if (d.feedbacks.length === 0) {
            reviewsHtml = '<p class="text-muted fst-italic">No reviews yet.</p>';
        } else {
            d.feedbacks.forEach(f => {
                reviewsHtml += `
                <div class="p-3 mb-2 bg-white rounded shadow-sm border">
                    <div class="d-flex justify-content-between mb-1">
                        <span class="text-warning" style="letter-spacing: 2px;">
                            ${Array(f.rating).fill('<i class="fas fa-star"></i>').join('')}${Array(5 - f.rating).fill('<i class="far fa-star"></i>').join('')}
                        </span>
                        <small class="text-muted">${f.date}</small>
                    </div>
                    <p class="mb-0 text-dark small fst-italic">"${f.comment}"</p>
                </div>`;
            });
        }

        content.innerHTML = `
        <div class="row">
            <div class="col-md-5 border-end">
                <div class="text-center mb-3">
                    <div class="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center mb-2 shadow" style="width:80px;height:80px;font-size:2rem;">
                        <i class="fas fa-user-md"></i>
                    </div>
                    <h4 class="mb-0 text-dark">Dr. ${d.name}</h4>
                    <span class="text-primary fw-bold">${d.specialization}</span>
                </div>
                <hr>
                <p class="mb-2"><small class="text-muted d-block text-uppercase fw-bold" style="font-size:0.75rem;"><i class="fas fa-graduation-cap me-1"></i> Education</small><strong>${d.education}</strong></p>
                <p class="mb-2"><small class="text-muted d-block text-uppercase fw-bold" style="font-size:0.75rem;"><i class="fas fa-briefcase me-1"></i> Experience</small><strong>${d.experience_years} Years</strong></p>
                <p class="mb-2"><small class="text-muted d-block text-uppercase fw-bold" style="font-size:0.75rem;"><i class="fas fa-rupee-sign me-1"></i> Fee</small><strong class="text-success">₹${d.online_treatment_fee}</strong></p>
                
                <div class="mt-4 p-3 bg-light rounded text-center border">
                    <h4 class="text-warning mb-0"><i class="fas fa-star me-1"></i> ${d.rating} <small class="text-muted" style="font-size:0.9rem;">/ 5.0</small></h4>
                    <p class="text-muted small mb-0 mt-1">Based on ${d.total_reviews} verified reviews</p>
                </div>
            </div>
            <div class="col-md-7 px-4 pt-3 pt-md-0" style="max-height:450px; overflow-y:auto;">
                <h5 class="mb-3 text-primary border-bottom pb-2"><i class="fas fa-comments me-2"></i> Patient Feedback</h5>
                ${reviewsHtml}
            </div>
        </div>`;
    } catch (err) {
        content.innerHTML = '<p class="text-danger text-center">Failed to load profile parameters.</p>';
    }
}

async function assignReportToDoctor(reportId, doctorId) {
    if (!confirm("Are you sure you want to assign your report to this doctor?")) return;
    try {
        const res = await fetch(`/patient/assign_report_doctor/${reportId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ doctor_id: doctorId })
        });
        const result = await res.json();
        if (res.ok) {
            alert(result.msg);
            loadPage('history');
        } else {
            alert(result.msg || "Failed to assign doctor");
        }
    } catch (e) {
        alert("An error occurred");
    }
}

async function markAppointmentDone(id) {
    if (!confirm("Are you sure this appointment is completed?")) return;
    try {
        const res = await fetch(`/patient/appointment/${id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'done' })
        });
        if (res.ok) {
            alert("Your appointment is done!");
            loadPage('appointments');
        }
    } catch (e) { alert("Failed to mark done"); }
}

let fbModalObj;
function openFeedbackModal(id, type = 'appointment') {
    if (type === 'report') {
        document.getElementById('feedbackApptId').value = '';
        document.getElementById('feedbackReportId').value = id;
    } else {
        document.getElementById('feedbackApptId').value = id;
        document.getElementById('feedbackReportId').value = '';
    }
    document.getElementById('feedbackRating').value = '5';
    document.getElementById('feedbackComment').value = '';
    if (!fbModalObj) fbModalObj = new bootstrap.Modal(document.getElementById('feedbackModal'));
    fbModalObj.show();
}

async function submitFeedback() {
    const apptId = document.getElementById('feedbackApptId').value;
    const repId = document.getElementById('feedbackReportId').value;
    const rating = document.getElementById('feedbackRating').value;
    const comment = document.getElementById('feedbackComment').value;

    const payload = { rating: rating, comment: comment };
    if (apptId) payload.appointment_id = apptId;
    if (repId) payload.report_id = repId;

    try {
        const res = await fetch('/patient/submit_feedback', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            fbModalObj.hide();
            alert("Thank you for your feedback!");
            if (apptId) loadPage('appointments');
            else loadPage('history');
        } else {
            alert(result.msg || "Failed to submit feedback");
        }
    } catch (e) {
        alert("An error occurred");
    }
}

async function showBookAppointment() {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="text-center my-5"><i class="fas fa-spinner fa-spin fa-3x text-primary"></i></div>';

    try {
        const res = await fetch('/patient/doctors', { headers: { 'Authorization': `Bearer ${token}` } });
        const doctors = await res.json();

        let html = `
        <h3 class="mb-4 text-primary"><i class="fas fa-calendar-plus me-2"></i> Book Appointment</h3>
        <div class="glass-card mb-4 p-4">
            <form id="appointmentForm" onsubmit="submitAppointment(event)">
                <div class="mb-3">
                    <label class="form-label text-muted fw-bold">Select Matching Doctor</label>
                    <select class="form-select shadow-sm" name="doctor_id" required>
                        <option value="" disabled selected>Choose a specialist...</option>
                        ${doctors.map(d => `<option value="${d.doctor_id}">Dr. ${d.name} (${d.specialization})</option>`).join('')}
                    </select>
                </div>
                <div class="mb-4">
                    <label class="form-label text-muted fw-bold">Preferred Date & Time</label>
                    <input type="datetime-local" class="form-control shadow-sm" name="appointment_date" required>
                </div>
                <button type="submit" class="btn btn-primary px-4 w-100 py-2"><i class="fas fa-check-circle me-2"></i> Confirm Booking</button>
            </form>
        </div>
        <button class="btn btn-outline-secondary" onclick="loadPage('appointments')"><i class="fas fa-arrow-left me-2"></i> Back to Appointments</button>
        `;
        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = '<p class="text-danger">Failed to load booking system.</p>';
    }
}

async function submitAppointment(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    data.appointment_date = new Date(data.appointment_date).toISOString();

    try {
        const res = await fetch('/patient/appointments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const respData = await res.json();

        if (res.ok) {
            alert(respData.msg || "Appointment booked successfully!");
            loadPage('appointments');
        } else {
            alert(respData.msg || "Failed to book appointment.");
        }
    } catch (e) {
        alert("An error occurred.");
    } finally {
        btn.innerHTML = '<i class="fas fa-check-circle me-2"></i> Confirm Booking';
        btn.disabled = false;
    }
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    const query = input.value.trim();
    if (!query && !currentChatImageBase64) return;

    input.disabled = true;
    btn.disabled = true;

    const chatDiv = document.getElementById('chatMessages');
    if (chatDiv.innerHTML.includes('Ask me a general')) chatDiv.innerHTML = '';

    let userImageHtml = currentChatImageBase64 ? `<br><img src="${currentChatImageBase64}" style="max-height:100px; border-radius:6px; margin-top:10px;">` : '';

    chatDiv.innerHTML += `
        <div class="d-flex justify-content-end mb-4 fade-in">
            <div class="text-white p-3 shadow-sm rounded-4" style="background-color: #4F46E5; border-bottom-right-radius: 4px !important; max-width: 75%;">
                ${query || "<i>[Image Attachment Only]</i>"}
                ${userImageHtml}
            </div>
        </div>`;

    const userPayload = { role: "user", content: query };
    if (currentChatImageBase64) {
        userPayload.image = currentChatImageBase64;
    }
    aiChatHistory.push(userPayload);

    input.value = '';
    clearChatImage();

    const typingId = 'typing-' + Date.now();
    chatDiv.innerHTML += `
        <div id="${typingId}" class="d-flex justify-content-start mb-4 fade-in">
            <div class="d-flex align-items-end w-100">
                <div class="bg-primary text-white rounded-circle shadow-sm d-flex justify-content-center align-items-center me-2" style="width: 32px; height: 32px; flex-shrink: 0; margin-bottom: 4px;">
                    <i class="fas fa-robot fs-6"></i>
                </div>
                <div class="text-dark p-3 shadow-sm rounded-4" style="background-color: #F3F4F6; border-bottom-left-radius: 4px !important; max-width: 85%;">
                    <i class="fas fa-circle-notch fa-spin text-primary me-2"></i> Analyzing your query...
                </div>
            </div>
        </div>`;
    chatDiv.scrollTop = chatDiv.scrollHeight;

    try {
        const selectedLang = document.getElementById('chatLanguage').value;
        const res = await fetch('/patient/chat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query, history: aiChatHistory, language: selectedLang })
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();

        document.getElementById(typingId).remove();

        if (data.type === 'report_ready') {
            // Memory State update: Register that a report payload has become available!
            window.pendingReportData = data.report_data;

            const aiMessage = data.response;
            aiChatHistory.push({ role: "assistant", content: aiMessage, audio: data.audio_file, hasReportCTA: true, report_data: data.report_data });
            sessionStorage.setItem('medai_history', JSON.stringify(aiChatHistory));

            let audioHtml = data.audio_file ? `<div class="mt-2 text-end"><audio controls src="/static/uploads/${data.audio_file}?cb=${new Date().getTime()}" style="height:35px; border-radius:8px; outline:none;"></audio></div>` : '';
            let formattedResponse = typeof marked !== 'undefined' ? marked.parse(aiMessage) : aiMessage.replace(/\n/g, '<br>');

            // Un-hide the floating Generate Report button
            const floatCont = document.getElementById('floatingGenerateContainer');
            const floatBtn = document.getElementById('floatingGenerateBtn');
            if (floatCont && floatBtn) {
                floatCont.classList.remove('d-none');
                floatCont.classList.add('fade-in');
                floatBtn.onclick = () => revealGeneratedReport();
            }

            chatDiv.innerHTML += `
                <div class="d-flex justify-content-start mb-4 fade-in">
                    <div class="d-flex align-items-end w-100">
                        <div class="bg-primary text-white rounded-circle shadow-sm d-flex justify-content-center align-items-center me-2" style="width: 32px; height: 32px; flex-shrink: 0; margin-bottom: 4px;">
                            <i class="fas fa-robot fs-6"></i>
                        </div>
                        <div class="text-dark p-3 shadow-sm markdown-body rounded-4" style="background-color: #F3F4F6; border-bottom-left-radius: 4px !important; max-width: 85%;">
                            <div class="d-flex align-items-center mb-1">
                                <strong class="text-dark fs-6" style="color: #111827 !important;">MedAI Assistant</strong>
                                <small class="text-muted ms-2" style="font-size: 0.70rem;">Online · AI Health Triage</small>
                            </div>
                            ${formattedResponse}
                            ${audioHtml}
                        </div>
                    </div>
                </div>`;
            chatDiv.scrollTop = chatDiv.scrollHeight;

        } else {
            // Standard Conversational Reply
            aiChatHistory.push({ role: "assistant", content: data.response, audio: data.audio_file });
            sessionStorage.setItem('medai_history', JSON.stringify(aiChatHistory));

            let audioHtml = data.audio_file ? `<div class="mt-2 text-end"><audio controls src="/static/uploads/${data.audio_file}?cb=${new Date().getTime()}" style="height:35px; border-radius:8px; outline:none;"></audio></div>` : '';
            let formattedResponse = typeof marked !== 'undefined' ? marked.parse(data.response) : data.response.replace(/\n/g, '<br>');

            chatDiv.innerHTML += `
                <div class="d-flex justify-content-start mb-4 fade-in">
                    <div class="d-flex align-items-end w-100">
                        <div class="bg-primary text-white rounded-circle shadow-sm d-flex justify-content-center align-items-center me-2" style="width: 32px; height: 32px; flex-shrink: 0; margin-bottom: 4px;">
                            <i class="fas fa-robot fs-6"></i>
                        </div>
                        <div class="text-dark p-3 shadow-sm markdown-body rounded-4" style="background-color: #F3F4F6; border-bottom-left-radius: 4px !important; max-width: 85%;">
                            <div class="d-flex align-items-center mb-1">
                                <strong class="text-dark fs-6" style="color: #111827 !important;">MedAI Assistant</strong>
                                <small class="text-muted ms-2" style="font-size: 0.70rem;">Online · AI Health Triage</small>
                            </div>
                            ${formattedResponse}
                            ${audioHtml}
                        </div>
                    </div>
                </div>`;
            chatDiv.scrollTop = chatDiv.scrollHeight;
        }
    } catch (err) {
        document.getElementById(typingId).remove();
        chatDiv.innerHTML += `<div class="text-danger text-center small my-2">Failed to get response</div>`;
    } finally {
        input.disabled = false;
        btn.disabled = false;
        input.focus();
    }
}

window.revealGeneratedReport = async function () {
    const floatCont = document.getElementById('floatingGenerateContainer');
    if (floatCont) {
        floatCont.classList.add('d-none');
    }

    const chatDiv = document.getElementById('chatMessages');
    const spinnerId = "generate-spinner-" + Date.now();
    chatDiv.innerHTML += `
        <div id="${spinnerId}" class="text-center my-3 fade-in">
            <i class="fas fa-spinner fa-spin text-primary fs-3"></i>
            <p class="text-muted small mt-2">Finalizing clinical report and assigning specialists...</p>
        </div>`;
    chatDiv.scrollTop = chatDiv.scrollHeight;

    try {
        const res = await fetch('/patient/generate_report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ report_data: window.pendingReportData })
        });

        const data = await res.json();
        document.getElementById(spinnerId).remove();

        if (data.status === 'success') {
            const reportId = data.report_id;
            const severity = data.severity;

            // Wipe the pending CTA link so it does not resurrect.
            if (aiChatHistory.length > 0) {
                aiChatHistory[aiChatHistory.length - 1].hasReportCTA = false;
            }

            // Persist the resulting blocks in sessionStorage!
            aiChatHistory.push({ role: 'system', isReportResult: true, reportId: reportId, severity: severity });
            sessionStorage.setItem('medai_history', JSON.stringify(aiChatHistory));

            let resultBlock = '';
            if (severity === 'Normal') {
                resultBlock = `
                    <div class="d-flex justify-content-center mb-3 fade-in w-100">
                        <div class="p-4 bg-white border-top rounded shadow-lg" style="width: 85%; border-width: 4px !important; border-top-color: var(--bs-success) !important;">
                            <div class="text-center">
                                <div class="bg-success text-white rounded-circle d-inline-flex align-items-center justify-content-center mb-3 shadow" style="width:50px;height:50px;font-size:1.2rem;">
                                    <i class="fas fa-check"></i>
                                </div>
                                <h5 class="text-success fw-bold mb-2">Auto-Diagnosis Complete</h5>
                                <p class="text-muted mb-4 small">A clinical self-care routine has been prepared and stored safely in your medical record.</p>
                                <button class="btn btn-success px-4 py-2 shadow-sm fw-bold border-0" style="border-radius:8px;" onclick="downloadPDF(${reportId})">
                                    <i class="fas fa-download me-2"></i> Download Full Report
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                resultBlock = `
                    <div class="d-flex justify-content-center mb-3 fade-in w-100">
                        <div class="p-4 bg-white border-top rounded shadow-lg" style="width: 85%; border-width: 4px !important; border-top-color: var(--bs-danger) !important;">
                            <div class="text-center">
                                <div class="bg-danger text-white rounded-circle d-inline-flex align-items-center justify-content-center mb-3 shadow" style="width:50px;height:50px;font-size:1.2rem;">
                                    <i class="fas fa-exclamation-triangle"></i>
                                </div>
                                <h5 class="text-danger fw-bold mb-2">Doctor Attention Required</h5>
                                <p class="text-muted mb-4 small">Based strictly on your diagnostic markers, we strongly advise consulting a clinical specialist immediately to avoid complications.</p>
                                <button class="btn btn-danger px-4 py-2 shadow-sm fw-bold border-0" style="border-radius:8px;" onclick="showDoctorSelection(${reportId})">
                                    <i class="fas fa-user-md me-2"></i> Select Available Doctor
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }

            chatDiv.innerHTML += resultBlock;
            chatDiv.scrollTop = chatDiv.scrollHeight;
        } else {
            chatDiv.innerHTML += `<div class="text-danger text-center small my-2">Failed to generate report.</div>`;
        }
    } catch (err) {
        document.getElementById(spinnerId).remove();
        chatDiv.innerHTML += `<div class="text-danger text-center small my-2">Error during generation.</div>`;
    }
};

function logout() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
}

async function downloadPDF(reportId) {
    try {
        const langDropdown = document.getElementById(`lang-${reportId}`);
        const chatLang = document.getElementById('chatLanguage');
        const lang = (langDropdown && langDropdown.value) ? langDropdown.value : (chatLang ? chatLang.value : 'English');
        
        const res = await fetch(`/patient/download_report/${reportId}?lang=${lang}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to download");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${reportId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (err) {
        alert("Error downloading PDF");
    }
}

// Initialize persistent route
const savedPage = localStorage.getItem('currentPatientPage') || 'history';
loadPage(savedPage);

async function loadEmergencyDoctors(method) {
    const list = document.getElementById('emergencyDoctorList');
    list.innerHTML = '<div class="text-center w-100 py-4"><i class="fas fa-spinner fa-spin fa-2x text-danger"></i><p class="mt-2 text-danger fw-bold">Searching for available emergency doctors...</p></div>';

    try {
        const res = await fetch('/patient/doctors', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const doctors = await res.json();

        let html = `
        <div class="alert alert-danger shadow-sm border-0 text-dark border-start border-danger border-4 mb-4">
            <i class="fas fa-exclamation-circle me-2 text-danger"></i> Please select a doctor below to initiate an immediate <strong>${method}</strong>
        </div>`;

        if (doctors.length === 0) {
            html += `<div class="text-center p-4 border rounded bg-light shadow-sm"><i class="fas fa-exclamation-triangle fa-2x text-danger mb-2"></i><p class="mb-0 text-muted fw-bold">No doctors are currently online. Please go to your nearest local hospital.</p></div>`;
        } else {
            let patientId = 'unknown';
            try { patientId = JSON.parse(atob(token.split('.')[1])).id; } catch(e){}

            html += `<div class="row fade-in">`;
            doctors.forEach(d => {
                let actionBtn = '';
                const roomName = `medai-${d.doctor_id}-${patientId}`;
                const jitsiBase = `https://meet.jit.si/${roomName}`;

                if (method === 'Audio Call') {
                    // Start Jitsi Meet in Audio-Only mode via config hash arguments
                    const audioUrl = `${jitsiBase}#config.startAudioOnly=true&config.startWithVideoMuted=true`;
                    actionBtn = `<a href="${audioUrl}" target="_blank" class="btn btn-danger w-100 fw-bold shadow-sm" style="border-radius:8px;"><i class="fas fa-phone-alt me-2"></i> Join Audio Call</a>`;
                } else if (method === 'Video Call') {
                    // Trigger backend routing so the Doctor Dashboard receives a Ring notification
                    actionBtn = `<button class="btn btn-danger w-100 fw-bold shadow-sm" style="border-radius:8px;" onclick="startVideoCall(${d.doctor_id}, '${d.name.replace(/'/g, "\\'")}')"><i class="fas fa-video me-2"></i> Start Video Call</button>`;
                } else {
                    const mailtoBody = encodeURIComponent(`URGENT EMERGENCY!\n\nDoctor ${d.name}, please join me immediately in this secure emergency Jitsi room:\n\n${jitsiBase}`);
                    actionBtn = `<a href="mailto:${d.email || ''}?subject=EMERGENCY Consultation Request from MedAI Patient&body=${mailtoBody}" class="btn btn-danger w-100 fw-bold shadow-sm" style="border-radius:8px;"><i class="fas fa-paper-plane me-2"></i> Send Email</a>`;
                }

                html += `
                <div class="col-md-6 col-lg-4 mb-4">
                    <div class="card h-100 shadow-sm border-danger border-2 glass-card transition-hover">
                        <div class="card-body text-center d-flex flex-column pt-4">
                            <div class="align-self-center bg-danger text-white rounded-circle d-flex align-items-center justify-content-center mb-3 shadow-sm" style="width:60px;height:60px;font-size:1.5rem;">
                                <i class="fas fa-user-md"></i>
                            </div>
                            <h5 class="card-title text-dark fw-bold mb-1">Dr. ${d.name}</h5>
                            <p class="card-text text-muted mb-3 fw-bold"><i class="fas fa-stethoscope me-2 text-danger"></i> ${d.specialization}</p>
                            <div class="mt-auto">
                                ${actionBtn}
                            </div>
                        </div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
        list.innerHTML = html;

    } catch (e) {
        list.innerHTML = '<p class="text-danger fw-bold text-center"><i class="fas fa-times-circle me-1"></i> Failed to locate emergency doctors.</p>';
    }
}

let callPollingInterval = null;

async function startVideoCall(doctorId, doctorName) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-grow text-danger mb-4" style="width: 4rem; height: 4rem;" role="status"></div>
            <h2 class="text-danger fw-bold mb-3">Dialing Dr. ${doctorName}...</h2>
            <p class="text-muted">Waiting for the doctor to accept the secure video line.</p>
            <button class="btn btn-outline-secondary mt-4 shadow-sm" onclick="cancelCall()">End Call</button>
        </div>
    `;

    try {
        const res = await fetch('/patient/initiate_call', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ doctor_id: doctorId })
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();
        // REST loop deprecated for Socket.IO pushing. Track current active call manually.
        window.currentCallId = data.call_id;
        // callPollingInterval = setInterval(() => checkCallStatus(data.call_id), 2000);
    } catch (e) {
        alert("Failed to initiate call");
    }
}

// =============================================
// PATIENT → DOCTOR Video Call (from History)
// =============================================
async function startVideoCallToDoctor(doctorId, doctorName, reportId) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-grow text-primary mb-4" style="width: 4rem; height: 4rem;" role="status"></div>
            <h2 class="text-primary fw-bold mb-3"><i class="fas fa-video me-2"></i>Calling Dr. ${doctorName}...</h2>
            <p class="text-muted">Waiting for the doctor to accept the secure video line.</p>
            <small class="text-muted d-block mb-4 fst-italic">Regarding Report #${reportId}</small>
            <button class="btn btn-outline-secondary shadow-sm" onclick="loadPage('history')">
                <i class="fas fa-times me-1"></i> Cancel
            </button>
        </div>
    `;
    try {
        const res = await fetch('/patient/initiate_call', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ doctor_id: doctorId })
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();
        window.currentCallId = data.call_id;
    } catch (e) {
        alert("Failed to initiate video call.");
        loadPage('history');
    }
}

// =============================================
// DOCTOR → PATIENT Incoming Call Modal
// =============================================
function showDoctorCallModal(data) {
    // Remove old modal if any
    const old = document.getElementById('doctorCallIncomingModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'doctorCallIncomingModal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 99999;
        background: rgba(0,0,0,0.65); display: flex; align-items: center; justify-content: center;
    `;
    modal.innerHTML = `
        <div class="text-center p-5 rounded-4 shadow-lg bg-white" style="max-width:420px; width:90%; animation: fadeIn 0.3s ease;">
            <div class="mb-3" style="width:80px; height:80px; background: linear-gradient(135deg,#4f46e5,#0ea5e9); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto;">
                <i class="fas fa-video text-white fa-2x"></i>
            </div>
            <h4 class="fw-bold text-dark mb-1">Incoming Video Call</h4>
            <p class="text-muted mb-4">Dr. <strong>${data.doctorName}</strong> is calling you for a video consultation.</p>
            <div class="d-flex gap-3 justify-content-center">
                <button class="btn btn-danger px-4 fw-bold" onclick="handleDoctorCallResponse(${data.callId}, false)">
                    <i class="fas fa-times me-1"></i> Decline
                </button>
                <button class="btn btn-success px-4 fw-bold" onclick="handleDoctorCallResponse(${data.callId}, true)">
                    <i class="fas fa-video me-1"></i> Accept
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Auto-dismiss after 45 seconds if no response
    setTimeout(() => {
        if (document.getElementById('doctorCallIncomingModal')) {
            handleDoctorCallResponse(data.callId, false);
        }
    }, 45000);
}

async function handleDoctorCallResponse(callId, accepted) {
    const modal = document.getElementById('doctorCallIncomingModal');
    if (modal) modal.remove();

    const endpoint = accepted ? `/patient/accept_call/${callId}` : `/patient/reject_call/${callId}`;
    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (accepted) {
            startJitsiCall('MedAI-Room-' + callId);
        }
    } catch(e) {
        console.error('Failed to respond to call', e);
    }
}

async function checkCallStatus(callId) {
    const res = await fetch(`/patient/call_status/${callId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();

    if (data.status === 'accepted') {
        clearInterval(callPollingInterval);
        startJitsiCall('MedAI-Room-' + callId);
    } else if (data.status === 'rejected' || data.status === 'ended') {
        clearInterval(callPollingInterval);
        document.getElementById('content').innerHTML = `
                <button class="btn btn-primary shadow-sm mt-3" onclick="loadPage('emergency')">Back to Emergency</button>
            </div>
        `;
    }
}

async function loadWallet() {
    try {
        const res = await fetch('/patient/wallet', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 422) { logout(); return; }
        const data = await res.json();

        document.getElementById('walletBalance').textContent = parseFloat(data.balance).toFixed(2);

        const list = document.getElementById('transactionsList');
        if (!data.transactions || data.transactions.length === 0) {
            list.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No transactions found.</td></tr>';
            return;
        }

        let html = '';
        data.transactions.forEach(tx => {
            let color = tx.type === 'CREDIT' ? 'success' : 'danger';
            let symbol = tx.type === 'CREDIT' ? '+' : '-';
            html += `
                <tr>
                    <td class="text-muted"><small>${tx.date}</small></td>
                    <td class="fw-bold text-dark">${tx.description}</td>
                    <td><span class="badge bg-${color} bg-opacity-10 text-${color}">${tx.type}</span></td>
                    <td class="text-end fw-bold text-${color}">${symbol}₹${parseFloat(tx.amount).toFixed(2)}</td>
                </tr>
            `;
        });
        list.innerHTML = html;

    } catch (e) {
        console.error("Failed to load wallet", e);
        document.getElementById('transactionsList').innerHTML = '<tr><td colspan="4" class="text-center text-danger">Failed to load transactions.</td></tr>';
    }
}

async function showAddMoneyDialog() {
    let amountStr = prompt("Enter amount to add in INR:", "1000");
    if (!amountStr) return;

    let amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        alert("Please enter a valid amount.");
        return;
    }

    try {
        const res = await fetch('/patient/wallet/add', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount: amount })
        });
        const data = await res.json();

        if (res.ok) {
            loadWallet(); // refresh UI
        } else {
            alert(data.msg || "Failed to add funds");
        }
    } catch (e) {
        alert("Failed to connect to the server.");
    }
}

function cancelCall() {
    if (callPollingInterval) clearInterval(callPollingInterval);
    loadPage('emergency');
}

function startJitsiCall(roomName) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="card shadow-sm border-0 mb-4 bg-dark text-white rounded">
            <div class="card-header border-0 bg-danger d-flex justify-content-between align-items-center">
                <h5 class="mb-0 fw-bold"><i class="fas fa-video me-2"></i> Live Emergency Consultation</h5>
                <button class="btn btn-light btn-sm shadow-sm fw-bold text-danger" onclick="endJitsiCall()"><i class="fas fa-phone-slash me-1"></i> End Call</button>
            </div>
            <div id="jitsi-container" style="width: 100%; height: 65vh; background: #000;"></div>
        </div>
    `;
    const domain = 'meet.jit.si';
    const options = {
        roomName: roomName,
        width: '100%',
        height: '100%',
        parentNode: document.getElementById('jitsi-container'),
        userInfo: { displayName: 'MedAI Patient' }
    };
    window.jitsiApi = new JitsiMeetExternalAPI(domain, options);
}

function endJitsiCall() {
    if (window.jitsiApi) window.jitsiApi.dispose();
    loadPage('history');
}
