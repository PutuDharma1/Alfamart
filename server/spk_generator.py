import os
import locale
from weasyprint import HTML
from flask import render_template
from datetime import datetime, timedelta
from num2words import num2words
import config

# --- PERBAIKAN LOGIKA LOCALE ---
# Blok ini akan mencoba mengatur locale ke Bahasa Indonesia.
# Jika gagal, ia akan mencetak peringatan tetapi tidak akan menghentikan aplikasi.
try:
    locale.setlocale(locale.LC_TIME, 'id_ID.UTF-8')
except locale.Error:
    try:
        locale.setlocale(locale.LC_TIME, 'Indonesian_Indonesia.1252')
    except locale.Error:
        print("Peringatan: Locale Bahasa Indonesia tidak ditemukan. Nama bulan akan dalam Bahasa Inggris.")

def get_nama_lengkap_by_email(google_provider, email):
    if not email: return ""
    try:
        cabang_sheet = google_provider.sheet.worksheet(config.CABANG_SHEET_NAME)
        records = cabang_sheet.get_all_records()
        for record in records:
            if str(record.get('EMAIL_SAT', '')).strip().lower() == str(email).strip().lower():
                return record.get('NAMA LENGKAP', '').strip()
    except Exception as e:
        print(f"Error getting name for email {email}: {e}")
    return email # Fallback to email if name not found

def create_spk_pdf(google_provider, spk_data):
    # Mengambil data dari dictionary
    initiator_email = spk_data.get('Dibuat Oleh')
    approver_email = spk_data.get('Disetujui Oleh')

    # Mendapatkan nama lengkap
    initiator_name = get_nama_lengkap_by_email(google_provider, initiator_email)
    approver_name = get_nama_lengkap_by_email(google_provider, approver_email) if approver_email else "_________________"

    # Konversi tanggal
    start_date_obj = datetime.fromisoformat(spk_data.get('Waktu Mulai'))
    duration = int(spk_data.get('Durasi'))
    end_date_obj = start_date_obj + timedelta(days=duration)

    # Format tanggal ke Bahasa Indonesia (e.g., 13 Agustus 2025)
    start_date_formatted = start_date_obj.strftime('%d %B %Y')
    end_date_formatted = end_date_obj.strftime('%d %B %Y')

    # Format biaya
    total_cost = float(spk_data.get('Grand Total', 0))
    total_cost_formatted = f"{total_cost:,.0f}".replace(",", ".")
    terbilang = num2words(total_cost, lang='id').title()

    # Data untuk template
    template_context = {
        "logo_path": 'file:///' + os.path.abspath(os.path.join('static', 'Alfamart-Emblem.png')),
        "spk_location": spk_data.get('Cabang'),
        "spk_date": datetime.now().strftime('%d %B %Y'),
        "spk_number": spk_data.get('Nomor SPK', '____/PROPNDEV-____/____/____'),
        "par_number": "____/PROPNDEV-____/____/____",
        "contractor_name": spk_data.get('Nama Kontraktor'),
        "lingkup_pekerjaan": spk_data.get('Lingkup Pekerjaan'),
        "proyek": spk_data.get('Proyek'),
        "project_address": spk_data.get('Alamat'),
        "total_cost_formatted": total_cost_formatted,
        "terbilang": terbilang,
        "start_date": start_date_formatted,
        "end_date": end_date_formatted,
        "duration": duration,
        "initiator_name": initiator_name,
        "approver_name": approver_name
    }
    
    html_string = render_template('spk_template.html', **template_context)
    return HTML(string=html_string).write_pdf()