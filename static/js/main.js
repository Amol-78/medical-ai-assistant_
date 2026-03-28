document.addEventListener('DOMContentLoaded', () => {
    
    // Login Form Handler
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                identifier: document.getElementById('identifier').value,
                password: document.getElementById('password').value,
                role: document.getElementById('role').value
            };
            const btn = e.target.querySelector('button');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
            btn.disabled = true;

            try {
                const res = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (res.ok) {
                    localStorage.setItem('access_token', result.access_token);
                    localStorage.setItem('role', result.role);
                    if (result.is_super_admin) {
                        localStorage.setItem('is_super_admin', 'true');
                    }
                    window.location.href = `/${result.role}_dashboard.html`;
                } else {
                    alert(result.msg || 'Login failed. Please verify credentials.');
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (error) {
                alert('An error occurred during login.');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Patient Registration Form Handler
    const patientRegisterForm = document.getElementById('registerForm');
    if (patientRegisterForm) {
        patientRegisterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Creating Account...';
            btn.disabled = true;

            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            try {
                const res = await fetch('/auth/register/patient', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (res.ok) {
                    alert('Registration successful! Redirecting to login...');
                    window.location.href = '/login';
                } else {
                    alert(result.msg || 'Registration failed');
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch(error) {
                alert('An error occurred during registration.');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Doctor Registration Form Handler (Admin Access Only)
    const doctorForm = document.getElementById('doctorForm');
    if (doctorForm) {
        const token = localStorage.getItem('access_token');
        if (!token) {
            window.location.href = '/login';
        }

        doctorForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Processing...';
            btn.disabled = true;

            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());

            try {
                const res = await fetch('/admin/doctor', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (res.ok) {
                    alert('Doctor registered successfully.');
                    window.location.href = '/admin_dashboard.html';
                } else {
                    alert(result.msg || 'Failed to add doctor');
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch(error) {
                alert('An error occurred. Please try again.');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
});

// Generic logout function used across multiple pages
function logout() {
    localStorage.clear();
    window.location.href = '/login';
}
