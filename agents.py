import os
import json
import uuid
import time
import base64
from gtts import gTTS
from groq import Groq
from google import genai
from google.genai import types
from models import db, Doctor, PatientReport

try:
    client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    GROQ_ENABLED = True
except Exception as e:
    print(f"Groq Client initialization failed: {e}")
    GROQ_ENABLED = False

try:
    gemini_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    GEMINI_ENABLED = True
except Exception as e:
    print(f"Gemini Client initialization failed: {e}")
    GEMINI_ENABLED = False

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

SPECIALIZATION_KEYWORDS = {
     'Cardiologist': [
        'heart', 'chest pain', 'chest tightness', 'palpitations', 'irregular heartbeat',
        'high blood pressure', 'low blood pressure', 'hypertension', 'heart attack',
        'shortness of breath', 'angina', 'arrhythmia', 'heart failure', 'congestive heart failure',
        'coronary artery', 'elevated cholesterol', 'edema', 'swollen ankles', 'cardiovascular',
        'atherosclerosis', 'pericarditis', 'myocarditis', 'heart pounding'
    ],
    'Neurologist': [
        'headache', 'severe headache', 'migraine', 'brain', 'seizure', 'epilepsy',
        'dizziness', 'vertigo', 'numbness', 'tingling', 'memory loss', 'confusion',
        'tremor', 'shaking', 'weakness in limbs', 'stroke', 'paralysis', 'fainting',
        'loss of consciousness', 'cognitive decline', 'dementia', 'parkinson', 'multiple sclerosis',
        'nerve pain', 'neuropathy', 'slurred speech', 'balance problems', 'head injury',
        'concussion', 'twitching', 'restless legs'
    ],
    'Dermatologist': [
        'skin', 'rash', 'acne', 'pimples', 'eczema', 'psoriasis', 'hair loss', 'alopecia',
        'itching', 'hives', 'urticaria', 'dry skin', 'oily skin', 'dandruff', 'fungal infection',
        'ringworm', 'warts', 'moles', 'birthmark', 'skin discoloration', 'pigmentation',
        'sunburn', 'blisters', 'boils', 'abscess', 'skin lesion', 'dermatitis', 'redness',
        'peeling skin', 'nail infection', 'nail fungus', 'vitiligo', 'scabies', 'skin allergy',
        'chickenpox', 'cold sore', 'herpes', 'skin tag', 'cellulitis', 'wound not healing'
    ],
    'Orthopedic': [
        'bone', 'joint', 'fracture', 'broken bone', 'sprain', 'strain', 'back pain',
        'lower back pain', 'upper back pain', 'knee pain', 'knee swelling', 'hip pain',
        'shoulder pain', 'elbow pain', 'wrist pain', 'ankle pain', 'foot pain', 'neck pain',
        'stiff neck', 'arthritis', 'osteoporosis', 'scoliosis', 'slipped disc', 'herniated disc',
        'sciatica', 'muscle cramps', 'muscle weakness', 'tennis elbow', 'carpal tunnel',
        'plantar fasciitis', 'tendonitis', 'ligament tear', 'dislocation', 'bone pain',
        'joint stiffness', 'difficulty walking', 'limping', 'sports injury'
    ],
    'General Physician': [
        'fever', 'high temperature', 'cold', 'common cold', 'cough', 'flu', 'influenza',
        'fatigue', 'tiredness', 'weakness', 'body ache', 'mild pain', 'general checkup',
        'loss of appetite', 'weight loss', 'weight gain', 'dehydration', 'vomiting', 'nausea',
        'diarrhea', 'loose stools', 'constipation', 'bloating', 'indigestion', 'heartburn',
        'acid reflux', 'night sweats', 'chills', 'malaise', 'sore throat', 'runny nose',
        'sneezing', 'allergies', 'food poisoning', 'typhoid', 'malaria', 'dengue', 'jaundice'
    ],
    'Pediatrician': [
        'child', 'infant', 'baby', 'newborn', 'toddler', 'adolescent', 'vaccination',
        'immunization', 'growth delay', 'developmental delay', 'childhood fever', 'teething',
        'colic', 'bed wetting', 'attention deficit', 'adhd', 'autism', 'learning disability',
        'school performance', 'childhood asthma', 'childhood allergies', 'pediatric rash',
        'diaper rash', 'cradle cap', 'ear infection in child', 'tonsillitis in child',
        'feeding problems', 'weight in child', 'height in child', 'measles', 'mumps', 'rubella'
    ],
    'ENT Specialist': [
        'ear', 'ear pain', 'earache', 'ear infection', 'hearing loss', 'ringing in ears',
        'tinnitus', 'nose', 'nasal congestion', 'runny nose', 'nosebleed', 'loss of smell',
        'throat', 'sore throat', 'throat pain', 'difficulty swallowing', 'hoarseness',
        'voice change', 'tonsils', 'tonsillitis', 'adenoids', 'sinusitis', 'sinus pain',
        'sinus pressure', 'nasal polyp', 'snoring', 'sleep apnea', 'blocked nose',
        'postnasal drip', 'laryngitis', 'swollen glands', 'neck lump'
    ],
    'Gastroenterologist': [
        'stomach pain', 'abdominal pain', 'stomach cramps', 'nausea', 'vomiting', 'diarrhea',
        'constipation', 'blood in stool', 'black stool', 'rectal bleeding', 'irritable bowel',
        'ibs', 'crohns disease', 'ulcerative colitis', 'stomach ulcer', 'peptic ulcer',
        'gerd', 'gastrointestinal', 'liver pain', 'liver disease', 'fatty liver', 'hepatitis',
        'cirrhosis', 'jaundice', 'gallbladder', 'gallstones', 'pancreatitis', 'bloating',
        'gas', 'acidity', 'colon', 'colonoscopy', 'endoscopy', 'food intolerance',
        'celiac', 'swallowing difficulty', 'abdominal swelling', 'ascites'
    ],
    'Pulmonologist': [
        'breathing difficulty', 'shortness of breath', 'breathlessness', 'wheezing', 'asthma',
        'chronic cough', 'cough with blood', 'hemoptysis', 'lung pain', 'chest congestion',
        'bronchitis', 'pneumonia', 'copd', 'emphysema', 'pulmonary fibrosis', 'tuberculosis',
        'tb', 'pleural effusion', 'lung cancer', 'oxygen saturation', 'low oxygen', 'sputum',
        'phlegm', 'productive cough', 'respiratory infection', 'covid', 'post covid',
        'hyperventilation', 'sleep apnea', 'snoring', 'respiratory distress'
    ],
    'Endocrinologist': [
        'diabetes', 'high blood sugar', 'low blood sugar', 'insulin', 'thyroid', 'hypothyroidism',
        'hyperthyroidism', 'goiter', 'obesity', 'weight gain without reason', 'hormonal imbalance',
        'adrenal', 'pituitary', 'cushing syndrome', 'addisons disease', 'polycystic ovary',
        'pcos', 'insulin resistance', 'metabolic syndrome', 'growth hormone', 'excessive thirst',
        'frequent urination', 'sweating', 'heat intolerance', 'cold intolerance', 'calcium',
        'parathyroid', 'electrolyte imbalance', 'hypoglycemia', 'hyperglycemia'
    ],
    'Psychiatrist': [
        'depression', 'anxiety', 'panic attack', 'stress', 'mental health', 'suicidal thoughts',
        'self harm', 'mood swings', 'bipolar', 'schizophrenia', 'hallucinations', 'delusions',
        'obsessive compulsive', 'ocd', 'phobia', 'social anxiety', 'post traumatic stress',
        'ptsd', 'eating disorder', 'anorexia', 'bulimia', 'insomnia', 'sleep disorder',
        'nightmares', 'psychosis', 'personality disorder', 'attention deficit', 'adhd',
        'addiction', 'substance abuse', 'alcohol abuse', 'drug abuse', 'emotional instability',
        'crying spells', 'hopelessness', 'worthlessness', 'concentration problems'
    ],
    'Ophthalmologist': [
        'eye', 'eye pain', 'eye redness', 'red eye', 'itchy eyes', 'watery eyes', 'dry eyes',
        'blurred vision', 'double vision', 'vision loss', 'partial vision loss', 'floaters',
        'flashes of light', 'glaucoma', 'cataract', 'conjunctivitis', 'pink eye',
        'retinal detachment', 'macular degeneration', 'night blindness', 'light sensitivity',
        'photophobia', 'eye discharge', 'eye infection', 'stye', 'chalazion', 'squint',
        'crossed eyes', 'glasses', 'lens', 'pupil', 'corneal ulcer', 'uveitis', 'eye strain'
    ],
    'Nephrologist': [
        'kidney', 'kidney pain', 'kidney stone', 'kidney failure', 'renal', 'dialysis',
        'blood in urine', 'hematuria', 'protein in urine', 'swollen legs', 'urinary tract infection',
        'uti', 'cloudy urine', 'dark urine', 'reduced urine output', 'frequent urination at night',
        'nocturia', 'hypertension related to kidney', 'creatinine', 'elevated creatinine',
        'glomerulonephritis', 'nephritis', 'cysts in kidney', 'polycystic kidney', 'foamy urine'
    ],
    'Urologist': [
        'urinary', 'urine', 'painful urination', 'burning urination', 'frequent urination',
        'difficulty urinating', 'weak urine stream', 'bladder', 'bladder pain', 'bladder infection',
        'prostate', 'enlarged prostate', 'prostate cancer', 'erectile dysfunction', 'testicular pain',
        'testicular swelling', 'male infertility', 'vasectomy', 'kidney stone passing',
        'urinary incontinence', 'overactive bladder', 'urethral discharge', 'penile discharge'
    ],
    'Gynecologist': [
        'menstruation', 'irregular periods', 'missed period', 'heavy bleeding', 'painful periods',
        'dysmenorrhea', 'pcos', 'polycystic ovary', 'vaginal discharge', 'vaginal itching',
        'vaginal infection', 'pregnancy', 'pregnancy test', 'fertility', 'infertility',
        'contraception', 'birth control', 'menopause', 'hot flashes', 'ovarian cyst',
        'fibroid', 'endometriosis', 'pelvic pain', 'cervical cancer', 'ovarian cancer',
        'uterine cancer', 'breast lump', 'breast pain', 'nipple discharge', 'abnormal pap smear',
        'sexually transmitted infection', 'sti', 'vulvar itching', 'premature menopause'
    ],
    'Rheumatologist': [
        'rheumatoid arthritis', 'autoimmune', 'lupus', 'sle', 'joint inflammation',
        'joint swelling', 'stiff joints in morning', 'morning stiffness', 'gout', 'uric acid',
        'fibromyalgia', 'chronic pain all over', 'ankylosing spondylitis', 'sjogrens syndrome',
        'vasculitis', 'polymyalgia', 'scleroderma', 'myositis', 'muscle inflammation',
        'raynaud phenomenon', 'blue fingers in cold', 'dry eyes dry mouth', 'positive ana test'
    ],
    'Oncologist': [
        'cancer', 'tumor', 'malignant', 'lump', 'unexplained weight loss', 'night sweats cancer',
        'lymph node swelling', 'blood cancer', 'leukemia', 'lymphoma', 'chemotherapy',
        'radiation therapy', 'biopsy', 'metastasis', 'stage cancer', 'carcinoma', 'sarcoma',
        'melanoma', 'bone marrow', 'abnormal growth', 'unexplained fatigue', 'anemia cancer',
        'prostate cancer', 'breast cancer', 'cervical cancer', 'colon cancer', 'lung cancer'
    ],
    'Hematologist': [
        'anemia', 'low hemoglobin', 'low rbc', 'pale skin', 'fatigue anemia', 'sickle cell',
        'thalassemia', 'blood clot', 'deep vein thrombosis', 'dvt', 'pulmonary embolism',
        'bleeding disorder', 'hemophilia', 'low platelets', 'thrombocytopenia', 'high wbc',
        'leukocytosis', 'polycythemia', 'blood transfusion', 'easy bruising', 'prolonged bleeding',
        'iron deficiency', 'vitamin b12', 'folate deficiency', 'bone marrow failure'
    ],
    'Dentist': [
        'tooth pain', 'toothache', 'cavity', 'dental caries', 'gum pain', 'gum swelling',
        'bleeding gums', 'bad breath', 'halitosis', 'tooth sensitivity', 'broken tooth',
        'cracked tooth', 'missing tooth', 'wisdom tooth', 'jaw pain', 'mouth ulcer',
        'canker sore', 'teeth grinding', 'bruxism', 'tooth abscess', 'dental infection',
        'loose tooth', 'white spots on teeth', 'mouth sores', 'oral thrush'
    ]

}


def agent1_report_generator(symptoms, image_path=None):
    """Convert raw input to structured report using Groq"""
    if not GROQ_ENABLED:
        return (
            f"CLINICAL OBSERVATION\n"
            f"--------------------\n"
            f"Presenting Symptoms: {symptoms}\n"
            f"Duration / Onset: Not explicitly stated\n"
            f"Primary Assessment: General presentation based on provided symptoms.\n"
            f"Recommended Next Steps: Consult assigned specialist for detailed clinical evaluation.\n\n"
            f"[System Note: Groq AI API Key not configured. Using standard template.]"
        )
    
    prompt = (
        f"You are a highly experienced medical documentation specialist. Convert the following patient-reported symptoms "
        f"into a formal, structured clinical observation report.\n\n"
        f"Patient Symptoms: {symptoms}\n\n"
        f"Generate the report with the following clearly labeled sections:\n"
        f"1. PRESENTING SYMPTOMS - List all observed symptoms clearly\n"
        f"2. ONSET & DURATION - Note any time-related information if mentioned, otherwise state 'Not specified'\n"
        f"3. POSSIBLE CONDITIONS - List 2-3 potential medical conditions based on the symptoms, ordered by likelihood\n"
        f"4. RISK FACTORS - Any relevant risk factors to note\n"
        f"5. RECOMMENDED INVESTIGATIONS - Suggest relevant diagnostic tests or examinations\n"
        f"6. CLINICAL SUMMARY - A brief, professional overall assessment\n\n"
        f"Be thorough, professional, and use standard medical terminology where appropriate."
    )
    
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
    model = "llama-3.3-70b-versatile"
    
    if image_path and os.path.exists(image_path):
        image_symptoms = ""
        if GEMINI_ENABLED:
            try:
                with open(image_path, "rb") as f:
                    image_bytes = f.read()
                gemini_prompt = "You are a medical expert. Please accurately describe any visible medical symptoms or physical conditions (like rashes, wounds, swelling, etc.) in this patient's image. Be professional, detailed and concise."
                gemini_response = gemini_client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[
                        gemini_prompt,
                        types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg')
                    ]
                )
                image_symptoms = gemini_response.text.strip()
                messages[0]["content"][0]["text"] += f"\n\n[System Note: A medical vision model evaluated the attached image and found: {image_symptoms}]"
            except Exception as e:
                print(f"Error processing image for Gemini: {e}")
        else:
            try:
                base64_image = encode_image(image_path)
                messages[0]["content"].append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}"
                    }
                })
                model = "llama-3.2-90b-vision-preview"
            except Exception as e:
                print(f"Error processing image for Groq: {e}")

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.2
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Error calling LLM: {e}")
        if model != "llama-3.3-70b-versatile":
            try:
                response = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2
                )
                return response.choices[0].message.content
            except Exception:
                pass
        return "Unable to analyze image, please try again."

def agent2_decision_agent(symptoms, ai_report):
    """Classify severity using Groq"""
    if not GROQ_ENABLED:
        symptoms_lower = symptoms.lower()
        if 'chest pain' in symptoms_lower or 'unconscious' in symptoms_lower: return 'Critical'
        if 'pain' in symptoms_lower: return 'Moderate'
        return 'Normal'
        
    prompt = f"Analyze these symptoms and the AI report, and classify the case strictly as exactly one of: 'Normal', 'Moderate', or 'Critical'.\nSymptoms: {symptoms}\nReport: {ai_report}\nRespond with ONLY the word Normal, Moderate, or Critical."
    
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        text = response.choices[0].message.content.strip().capitalize()
        text = text.strip('.,;!"\'-')
        if 'Normal' in text: return 'Normal'
        if 'Critical' in text: return 'Critical'
        return 'Moderate'
    except Exception:
        return 'Moderate'

def agent3_ai_doctor(symptoms, ai_report):
    """Provide basic guidance for normal cases"""
    if not GROQ_ENABLED:
        return "Rest and stay hydrated. Consult a doctor if symptoms persist."
        
   
    prompt = (
        f"You are a compassionate and knowledgeable AI health assistant helping a patient with minor symptoms. "
        f"Based on the reported symptoms and clinical report, provide clear, structured, and practical health guidance.\n\n"
        f"Patient Symptoms: {symptoms}\n"
        f"Clinical Report Summary:\n{ai_report}\n\n"
        f"Please provide your response in the following format:\n"
        f"**IMMEDIATE CARE TIPS**\n"
        f"- List 3-4 immediate self-care steps the patient can take right now\n\n"
        f"**SUGGESTED OTC REMEDIES**\n"
        f"- Suggest safe, commonly available over-the-counter medications or remedies (avoid brand names, use generic names)\n\n"
        f"**LIFESTYLE RECOMMENDATIONS**\n"
        f"- List 2-3 lifestyle tips such as rest, diet, or activity modifications\n\n"
        f"**WHEN TO SEE A DOCTOR**\n"
        f"- Clearly state warning signs that should prompt the patient to seek professional help\n\n"
        f"End your response with this exact disclaimer:\n"
        f"⚕️ DISCLAIMER: This AI guidance is for general informational purposes only and does not constitute professional medical advice. Please consult a qualified healthcare professional for personalized medical care."

     )

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )
        return response.choices[0].message.content
    except Exception:
        return "Rest and stay hydrated. Consult a doctor if symptoms persist."

def agent4_specialization_matcher(symptoms, ai_report):
    """Map symptoms to specialization"""
    if not GROQ_ENABLED:
        return _fallback_selector(symptoms)
        
    specialties_str = ", ".join(SPECIALIZATION_KEYWORDS.keys())
    
    prompt = (
        f"A patient has reported the following symptoms. Based on your medical expertise, determine the single most "
        f"appropriate specialist from the list below who should handle this case.\n\n"
        f"Patient Symptoms: {symptoms}\n\n"
        f"Clinical Report:\n{ai_report}\n\n"
        f"Available Specializations:\n{specialties_str}\n\n"
        f"Rules:\n"
        f"1. Select the ONE specialization that best matches the primary complaint.\n"
        f"2. Your response must be ONLY the exact specialization name from the list above — nothing else.\n"
        f"3. If truly unclear, respond with: General Physician"
    )

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        chosen_specialization = response.choices[0].message.content.strip().strip('.,;!"\'-')
    except Exception:
        chosen_specialization = 'General Physician'
        
    return chosen_specialization

def _fallback_selector(symptoms):
    symptoms_lower = symptoms.lower()
    for spec, keywords in SPECIALIZATION_KEYWORDS.items():
        for kw in keywords:
            if kw in symptoms_lower:
                return spec
    return 'General Physician'

def agent5_translate_and_tts(text, target_lang, force_translation=False):
    """Translate and generate TTS"""
    final_text = text
    if (target_lang != 'English' or force_translation) and GROQ_ENABLED:
        prompt = f"Translate the following medical text into {target_lang}. Keep it simple and easy to understand. ONLY return the translated text.\nText: {text}"
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2
            )
            final_text = response.choices[0].message.content.strip()
        except Exception:
            pass
            
    audio_filename = f"audio_{uuid.uuid4().hex[:8]}.mp3"
    audio_path = os.path.join('static', 'uploads', audio_filename)
    try:
        lang_code = {'English': 'en', 'Hindi': 'hi', 'Telugu': 'te', 'Marathi': 'mr','Odia': 'or'}.get(target_lang, 'en')
        tts = gTTS(text=final_text, lang=lang_code)
        tts.save(audio_path)
    except Exception as e:
        print(f"TTS error: {e}")
        audio_filename = None
        
    return final_text, audio_filename

def chat_agent(query, history=None, language='English'):
    """Smart Chatbot logic based on severity, capable of triggering reports via JSON"""
    if not GROQ_ENABLED:
        raw_response = f"AI Assistant: Please consult a doctor for accurate advice."
        final_text, audio_file = agent5_translate_and_tts(raw_response, language)
        return {'text': final_text, 'audio': audio_file, 'raw': raw_response}
        
    system_prompt = """
You are MedAI Assistant, an experienced and friendly doctor-like chatbot.
Your role is to interact with patients in a natural conversation style, ask back-and-forth questions (maximum 4-5 total), collect key health information, and then allow the user to generate a medical report.

## Conversation Style
* Talk in a friendly, caring, and simple way.
* Keep messages short.
* Ask ONE question at a time. Wait for their answer.
* Do NOT generate a report immediately.

## Conversation Flow
### Step 1 — Understand Problem
When patient gives initial message (example: "I have headache"):
Respond like a doctor: Acknowledge problem and ask the first question.
Example: "Sorry to hear that. Since how many days are you feeling this?"

### Step 2 — Ask Follow-up Questions (4–5 total)
Ask only important questions one by one across multiple turns:
* Since how many days?
* How are you feeling now (better/worse)?
* Any other symptoms?
* Is the pain mild or severe?
* Any fever or other issues?
Ask maximum 4 to 5 questions total across the whole conversation.

### Step 3 — Collect Data
While chatting, extract and mentally store:
* Symptoms, Duration, Severity, Additional symptoms.

### Step 4 — Ready for Report
When you decide you have enough gathered data (usually after 4-5 questions), YOU MUST communicate that you are ready and stop asking questions.
For your initial diagnosis closure, you should politely say something like:
"I have enough information to analyze your condition."

AND, at the very end of your response, you MUST output a RAW JSON OBJECT and nothing else.
The JSON values MUST ALWAYS BE WRITTEN ENTIRELY IN ENGLISH, even if the patient is speaking another language like Hindi, Telugu, Marathi, etc.
The format must be exactly:
{
    "_TRIGGER_REPORT": true,
    "symptoms": "A detailed, clinical summary of all symptoms gathered (IN ENGLISH).",
    "duration": "e.g. 3 days (IN ENGLISH)",
    "severity": "Normal" OR "Moderate" OR "Critical",
    "diagnosis": "Your detailed medical observation, possible condition, and safe care advice for the patient (IN ENGLISH)."
}

### Step 5 — Continuous Dialogue (IMPORTANT)
If the patient CONTINUES to talk or provide new symptoms AFTER you have already output the `_TRIGGER_REPORT` JSON block in a previous turn, DO NOT ignore them!
Acknowledge their new information naturally in conversation (Example: "I understand that your left hand is also hurting. I have updated my analysis."), and then simply re-evaluate your clinical findings and output an UPDATED `_TRIGGER_REPORT` JSON block at the bottom of your new reply containing the combined context.

## Important Rules
* Do NOT generate the JSON report before you have asked enough questions to form a clinical opinion.
* The `diagnosis` field in the JSON MUST be highly detailed and properly structured. It must explicitly include: Symptoms Summary, Duration, Severity, Possible Condition, and Specific Recommendations. Avoid short or incomplete reports.
* Until you are ready to trigger the report, simply reply with normal text questions.
* STRICT MEDICAL RULE FOR DIAGNOSIS: If your final analysis decides the severity is "Moderate" or "Critical", you MUST NOT suggest any tablets, medicines, or self-care protocols in the diagnosis text. You must ONLY state the observation and strongly command them to see a real doctor.
* If the severity is "Normal", you must act as an AI Doctor and suggest safe, common self-care over-the-counter tablets (like paracetamol) and rest in the diagnosis test.
"""
    
    messages = [{"role": "system", "content": system_prompt}]
    
    image_b64 = None
    if history:
        last_msg = history[-1]
        if last_msg.get('role') == 'user' and last_msg.get('image'):
            img_data = last_msg['image']
            if img_data.startswith('data:image'):
                image_b64 = img_data
            else:
                image_b64 = f"data:image/jpeg;base64,{img_data}"

    if history:
        for msg in history[-10:]:
            text_content = msg.get('content', '')
            if text_content == query and msg == history[-1] and image_b64:
                continue 
            messages.append({"role": msg.get('role', 'user'), "content": text_content})
            
    model = "llama-3.3-70b-versatile"
    
    model = "llama-3.3-70b-versatile"
    
    if image_b64:
        image_symptoms_description = "A medical image was attached but the vision system is offline."
        if GEMINI_ENABLED:
            try:
                raw_b64 = image_b64.split("base64,")[-1]
                image_bytes = base64.b64decode(raw_b64)
                gemini_prompt = "You are a medical expert. Describe the medical symptoms or physical conditions visible in this patient's image in one accurate, detailed sentence."
                response = gemini_client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[
                        gemini_prompt,
                        types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg')
                    ]
                )
                image_symptoms_description = response.text.strip()
            except Exception as e:
                print(f"Gemini Vision error in chat: {e}")

        img_prompt = (
            f"Patient Text: {query}\n\n"
            f"[SYSTEM NOTE: The patient attached an image. The medical vision model evaluated it and observed: {image_symptoms_description}. "
            f"Use this visual information along with their text to acknowledge their issue, agree with their text, and immediately ask 1-2 relevant follow-up questions about their symptoms.]"
        )
        messages.append({
            "role": "user",
            "content": img_prompt
        })
    else:
        messages.append({"role": "user", "content": query})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.3
        )
        raw_response = response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Chat API Error: {e}")
        raw_response = f"AI Assistant: Regarding '{query}', please consult a doctor for accurate advice."
        
    final_text, audio_file = agent5_translate_and_tts(raw_response, language)
    return {'text': final_text, 'audio': audio_file, 'raw': raw_response}

def process_patient_input(patient_id, symptoms, image_filename, language):
    """Main workflow orchestrator"""
    os.makedirs(os.path.join('static', 'uploads'), exist_ok=True)
    image_path = os.path.join('static', 'uploads', image_filename) if image_filename else None
    
    ai_report = agent1_report_generator(symptoms, image_path)
    time.sleep(1) 
    severity = agent2_decision_agent(symptoms, ai_report)
    
    result = {
        'ai_report': ai_report,
        'severity': severity,
        'assigned_doctor_id': None,
        'ai_advice': None,
        'final_output': '',
        'audio_file': None,
        'recommended_specialization': None,
        'status': 'awaiting_selection'
    }
    
    if severity == 'Normal':
        advice = agent3_ai_doctor(symptoms, ai_report)
        result['ai_advice'] = advice
        final_text, audio_file = agent5_translate_and_tts(advice, language)
        result['final_output'] = final_text
        result['audio_file'] = audio_file
        result['status'] = 'Completed'
    else:
        chosen_spec = agent4_specialization_matcher(symptoms, ai_report)
        result['recommended_specialization'] = chosen_spec
        msg = f"Your condition requires attention from a {chosen_spec}. Please select a doctor from the available list."
        final_text, audio_file = agent5_translate_and_tts(msg, language)
        result['final_output'] = final_text
        result['audio_file'] = audio_file
        
    return result