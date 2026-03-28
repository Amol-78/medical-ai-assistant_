-- Medical AI Assistant MySQL Database Schema
-- Run this entire script in your MySQL Workbench or phpMyAdmin

CREATE DATABASE IF NOT EXISTS medical_ai;
USE medical_ai;

-- 1. Patients Table
CREATE TABLE IF NOT EXISTS patients (
    patient_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT,
    gender VARCHAR(10),
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(15) UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    doctor_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT,
    gender VARCHAR(10),
    education VARCHAR(200),
    experience_years INT,
    specialization VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(15) UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    available BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    gender VARCHAR(10),
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(15) UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Doctor Requests (For Admin verification logic)
CREATE TABLE IF NOT EXISTS doctor_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    education VARCHAR(200) NOT NULL,
    experience_years INT NOT NULL,
    specialization VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Patient Reports (AI Triage History)
CREATE TABLE IF NOT EXISTS patient_reports (
    report_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    symptoms_text TEXT NOT NULL,
    uploaded_image VARCHAR(200),
    ai_generated_report TEXT,
    severity_level VARCHAR(20),
    assigned_doctor_id INT,
    doctor_response TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    audio_file VARCHAR(200),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_doctor_id) REFERENCES doctors(doctor_id) ON DELETE SET NULL
);

-- 6. Appointments
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATETIME NOT NULL,
    status VARCHAR(20) DEFAULT 'requested',
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id) ON DELETE CASCADE
);

-- Let's establish one default Master Admin account you can use right away:
-- (Email: admin@medai.com | Password: password123)
-- The password_hash below corresponds to "password123" encrypted with bcrypt
INSERT INTO admins (name, gender, email, phone, password_hash)
VALUES ('Super Admin', 'Other', 'admin@medai.com', '0000000000', '$2b$12$K1H7Xp6Pqy8pDqQYZZbTZeX6eR5yv9n4x5h2mQ6w2z2q3xU6g1MZi')
ON DUPLICATE KEY UPDATE name=name;
