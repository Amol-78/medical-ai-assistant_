from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os
from datetime import datetime
from models import Patient

# Try to register Windows Nirmala font for Hindi, Marathi, Telugu
try:
    if os.path.exists('C:\\Windows\\Fonts\\Nirmala.ttc'):
        pdfmetrics.registerFont(TTFont('Nirmala', 'C:\\Windows\\Fonts\\Nirmala.ttc', subfontIndex=0))
        pdfmetrics.registerFont(TTFont('Nirmala-Bold', 'C:\\Windows\\Fonts\\Nirmala.ttc', subfontIndex=1))
        HAS_NIRMALA = True
    else:
        HAS_NIRMALA = False
except Exception:
    HAS_NIRMALA = False

def generate_pdf_report(report, target_lang='English'):
    from agents import agent5_translate_and_tts
    
    filename = f"report_{report.report_id}.pdf"
    # Store in static/uploads so it works across OS (instead of /tmp)
    upload_dir = os.path.join(os.getcwd(), 'static', 'uploads')
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)
    
    doc = SimpleDocTemplate(filepath, pagesize=letter)
    styles = getSampleStyleSheet()
    
    # Override styles to use Nirmala if available
    title_style = styles['Title']
    heading_style = styles['Heading3']
    normal_style = styles['Normal']
    
    if HAS_NIRMALA:
        title_style = ParagraphStyle('IndicTitle', parent=styles['Title'], fontName='Nirmala-Bold')
        heading_style = ParagraphStyle('IndicHeading3', parent=styles['Heading3'], fontName='Nirmala-Bold')
        normal_style = ParagraphStyle('IndicNormal', parent=styles['Normal'], fontName='Nirmala')

    story = []
    
    # Fetch Patient 
    patient = Patient.query.get(report.patient_id)
    patient_name = patient.name if patient else "Unknown Patient"
    
    # Extract English Sources Priority
    symptoms_txt = report.symptoms_english or report.symptoms_text or ""
    ai_report_txt = report.ai_report_english or report.ai_generated_report or ""
    doc_res_txt = report.doctor_response or ""
    
    # Execute Local Translations if not English natively
    if target_lang != 'English':
        symptoms_txt, _ = agent5_translate_and_tts(symptoms_txt, target_lang)
        ai_report_txt, _ = agent5_translate_and_tts(ai_report_txt, target_lang)
        if doc_res_txt:
            doc_res_txt, _ = agent5_translate_and_tts(doc_res_txt, target_lang, force_translation=True)
    elif target_lang == 'English' and doc_res_txt:
        # User explicitly requested English PDF but the doctor's payload is likely Regional
        doc_res_txt, _ = agent5_translate_and_tts(doc_res_txt, 'English', force_translation=True)
    
    # Title
    story.append(Paragraph("<b>MedAI - Official Medical Report</b>", title_style))
    story.append(Spacer(1, 12))
    
    # Metadata
    story.append(Paragraph(f"<b>Report ID:</b> {report.report_id}", normal_style))
    story.append(Paragraph(f"<b>Date:</b> {report.created_at.strftime('%Y-%m-%d %H:%M')}", normal_style))
    story.append(Paragraph(f"<b>Patient Name:</b> {patient_name}", normal_style))
    story.append(Paragraph(f"<b>Severity Level:</b> {report.severity_level}", normal_style))
    story.append(Spacer(1, 24))
    
    # Content sections
    story.append(Paragraph("<b>Patient's Reported Symptoms:</b>", heading_style))
    story.append(Paragraph(str(symptoms_txt).replace('\n', '<br/>'), normal_style))
    
    story.append(Spacer(1, 12))
    story.append(Paragraph("<b>AI Structured Analysis:</b>", heading_style))
    story.append(Paragraph(str(ai_report_txt).replace('\n', '<br/>'), normal_style))
    
    if doc_res_txt:
        story.append(Spacer(1, 12))
        story.append(Paragraph("<b>Doctor's Official Response:</b>", heading_style))
        story.append(Paragraph(str(doc_res_txt).replace('\n', '<br/>'), normal_style))
    
    # Build PDF
    doc.build(story)
    return filepath