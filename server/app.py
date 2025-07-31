import datetime
import os
import traceback
from flask import Flask, request, jsonify, render_template, url_for
from dotenv import load_dotenv
from flask_cors import CORS
from datetime import timezone, timedelta

import config
from google_services import GoogleServiceProvider
from pdf_generator import create_pdf_from_data

# Import blueprint dari file data_api.py
from data_api import data_bp

# Inisialisasi Aplikasi
load_dotenv()
app = Flask(__name__)

# Daftarkan Blueprint agar endpoint /get-data aktif
app.register_blueprint(data_bp)

# Konfigurasi CORS dengan URL Vercel Anda yang benar
cors = CORS(app, resources={
  r"/*": {
    "origins": [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://alfamart-one.vercel.app"
    ]
  }
})

google_provider = GoogleServiceProvider()

@app.route('/')
def index():
    return "Backend server is running and healthy.", 200

@app.route('/api/check_status', methods=['GET'])
def check_status():
    email = request.args.get('email')
    if not email:
        return jsonify({"error": "Email parameter is missing"}), 400
    try:
        status_data = google_provider.check_user_submissions(email)
        return jsonify(status_data), 200
    except Exception as e:
        traceback.print_exc()
        try:
            error_message = str(e)
            if "RecursionError" in traceback.format_exc():
                 error_message = "A critical communication error occurred with Google APIs."
        except Exception:
            error_message = "An unreportable error occurred."
        return jsonify({"error": error_message}), 500

@app.route('/api/submit', methods=['POST'])
def submit_form():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON data"}), 400
    new_row_index = None
    try:
        WIB = timezone(timedelta(hours=7))
        data[config.COLUMN_NAMES.STATUS] = config.STATUS.WAITING_FOR_COORDINATOR
        data[config.COLUMN_NAMES.TIMESTAMP] = datetime.datetime.now(WIB).isoformat()
        
        jenis_toko = data.get('Proyek', 'N/A')
        kode_toko = data.get('Lokasi', 'N/A')
        pdf_filename = f"RAB_ALFAMART({jenis_toko})_({kode_toko}).pdf"
        
        pdf_bytes = create_pdf_from_data(google_provider, data)
        pdf_link = google_provider.upload_pdf_to_drive(pdf_bytes, pdf_filename)
        data[config.COLUMN_NAMES.LINK_PDF] = pdf_link
        
        new_row_index = google_provider.append_to_sheet(data, config.DATA_ENTRY_SHEET_NAME)
        
        cabang = data.get('Cabang')
        if not cabang:
             raise Exception("Field 'Cabang' is empty. Cannot find Coordinator.")

        coordinator_email = google_provider.get_email_by_jabatan(cabang, config.JABATAN.KOORDINATOR)
        if not coordinator_email:
            raise Exception(f"Coordinator email for branch '{cabang}' not found. Please check the 'Cabang' sheet.")

        base_url = "https://alfamart.onrender.com"
        approval_url = f"{base_url}/api/handle_approval?action=approve&row={new_row_index}&level=coordinator&approver={coordinator_email}"
        rejection_url = f"{base_url}/api/handle_approval?action=reject&row={new_row_index}&level=coordinator&approver={coordinator_email}"
        
        email_html = render_template('email_template.html', level='Koordinator', form_data=data, approval_url=approval_url, rejection_url=rejection_url)
        
        google_provider.send_email(to=coordinator_email, subject=f"[TAHAP 1: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", html_body=email_html, pdf_attachment_bytes=pdf_bytes, pdf_filename=pdf_filename)
        
        return jsonify({"status": "success", "message": "Data successfully submitted and approval email sent."}), 200

    except Exception as e:
        if new_row_index:
            google_provider.delete_row(config.DATA_ENTRY_SHEET_NAME, new_row_index)
        traceback.print_exc()
        try:
            error_message = str(e)
            if "RecursionError" in traceback.format_exc():
                 error_message = "A critical communication error occurred with Google APIs during submission."
        except Exception:
            error_message = "An unreportable error occurred during submission."
        return jsonify({"status": "error", "message": error_message}), 500

@app.route('/api/handle_approval', methods=['GET'])
def handle_approval():
    action = request.args.get('action')
    row_str = request.args.get('row')
    level = request.args.get('level')
    approver = request.args.get('approver')
    
    base_render_url = "https://alfamart.onrender.com"
    logo_url = f"{base_render_url}{url_for('static', filename='Alfamart-Emblem.png')}"

    if not all([action, row_str, level, approver]):
        return render_template('response_page.html', title='Incomplete Parameters', message='URL parameters are incomplete or invalid.', theme_color='#dc3545', icon='⚠️', logo_url=logo_url), 400
    try:
        row = int(row_str)
        row_data = google_provider.get_row_data(row)
        if not row_data:
            return render_template('response_page.html', title='Data Not Found', message='This request seems to be missing or has been deleted.', theme_color='#ffc107', icon='ⓘ', logo_url=logo_url)
        
        current_status = row_data.get(config.COLUMN_NAMES.STATUS, "").strip()
        expected_status_map = {'coordinator': config.STATUS.WAITING_FOR_COORDINATOR, 'manager': config.STATUS.WAITING_FOR_MANAGER}
        
        if current_status != expected_status_map.get(level):
            msg = f'This action has already been processed. Current status: <strong>{current_status}</strong>.'
            return render_template('response_page.html', title='Action Already Processed', message=msg, theme_color='#ffc107', icon='ⓘ', logo_url=logo_url)
        
        WIB = timezone(timedelta(hours=7))
        current_time = datetime.datetime.now(WIB).isoformat()
        
        cabang = row_data.get(config.COLUMN_NAMES.CABANG)
        jenis_toko = row_data.get(config.COLUMN_NAMES.PROYEK, 'N/A')
        kode_toko = row_data.get(config.COLUMN_NAMES.LOKASI, 'N/A')
        creator_email = row_data.get(config.COLUMN_NAMES.EMAIL_PEMBUAT)

        if action == 'reject':
            new_status = ""
            if level == 'coordinator':
                new_status = config.STATUS.REJECTED_BY_COORDINATOR
                google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVER, approver)
                google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME, current_time)
            elif level == 'manager':
                new_status = config.STATUS.REJECTED_BY_MANAGER
                google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVER, approver)
                google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVAL_TIME, current_time)
            
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, new_status)
            if creator_email:
                subject = f"[DITOLAK] Pengajuan RAB Proyek: {jenis_toko}"
                body = f"<p>Pengajuan RAB untuk proyek <b>{jenis_toko}</b> di lokasi <b>{kode_toko}</b> telah <b>DITOLAK</b>.</p>"
                google_provider.send_email(to=creator_email, subject=subject, html_body=body)
            return render_template('response_page.html', title='Permintaan Ditolak', message='Status permintaan telah diperbarui.', theme_color='#dc3545', icon='✖', logo_url=logo_url)

        elif level == 'coordinator' and action == 'approve':
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, config.STATUS.WAITING_FOR_MANAGER)
            google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVER, approver)
            google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME, current_time)
            manager_email = google_provider.get_email_by_jabatan(cabang, config.JABATAN.MANAGER)
            if manager_email:
                row_data[config.COLUMN_NAMES.KOORDINATOR_APPROVER] = approver
                row_data[config.COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME] = current_time
                base_url = "https://alfamart.onrender.com"
                approval_url_manager = f"{base_url}/api/handle_approval?action=approve&row={row}&level=manager&approver={manager_email}"
                rejection_url_manager = f"{base_url}/api/handle_approval?action=reject&row={row}&level=manager&approver={manager_email}"
                email_html_manager = render_template('email_template.html', level='Manajer', form_data=row_data, approval_url=approval_url_manager, rejection_url=rejection_url_manager, additional_info=f"Telah disetujui oleh Koordinator: {approver}")
                pdf_bytes = create_pdf_from_data(google_provider, row_data)
                pdf_filename = f"RAB_ALFAMART({jenis_toko})_({kode_toko}).pdf"
                google_provider.send_email(manager_email, f"[TAHAP 2: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", email_html_manager, pdf_bytes, pdf_filename)
            return render_template('response_page.html', title='Persetujuan Diteruskan', message='Terima kasih. Persetujuan Anda telah dicatat.', theme_color='#28a745', icon='✔', logo_url=logo_url)
        
        elif level == 'manager' and action == 'approve':
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, config.STATUS.APPROVED)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVER, approver)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVAL_TIME, current_time)
            
            row_data[config.COLUMN_NAMES.STATUS] = config.STATUS.APPROVED
            row_data[config.COLUMN_NAMES.MANAGER_APPROVER] = approver
            row_data[config.COLUMN_NAMES.MANAGER_APPROVAL_TIME] = current_time
            
            final_pdf_bytes = create_pdf_from_data(google_provider, row_data)
            final_pdf_filename = f"DISETUJUI_RAB_ALFAMART({jenis_toko})_({kode_toko}).pdf"
            final_pdf_link = google_provider.upload_pdf_to_drive(final_pdf_bytes, final_pdf_filename)
            
            google_provider.update_cell(row, config.COLUMN_NAMES.LINK_PDF, final_pdf_link)
            row_data[config.COLUMN_NAMES.LINK_PDF] = final_pdf_link
            google_provider.copy_to_approved_sheet(row_data)

            if creator_email:
                support_emails = google_provider.get_emails_by_jabatan(cabang, config.JABATAN.SUPPORT)
                manager_email = approver
                coordinator_email = row_data.get(config.COLUMN_NAMES.KOORDINATOR_APPROVER)
                cc_list = list(filter(None, set(support_emails + [manager_email, coordinator_email])))
                if creator_email in cc_list:
                    cc_list.remove(creator_email)
                
                subject = f"[FINAL - DISETUJUI] Pengajuan RAB Proyek: {jenis_toko}"
                email_body_html = f"<p>Pengajuan RAB untuk proyek <b>{jenis_toko}</b> di cabang <b>{cabang}</b> telah disetujui sepenuhnya.</p>"
                
                google_provider.send_email(
                    to=creator_email,
                    cc=cc_list,
                    subject=subject,
                    html_body=email_body_html,
                    pdf_attachment_bytes=final_pdf_bytes,
                    pdf_filename=final_pdf_filename
                )
            return render_template('response_page.html', title='Persetujuan Berhasil', message='Tindakan Anda telah berhasil diproses.', theme_color='#28a745', icon='✔', logo_url=logo_url)

    except Exception as e:
        traceback.print_exc()
        try:
            error_message = str(e)
            if "RecursionError" in traceback.format_exc():
                 error_message = "A critical communication error occurred with Google APIs."
        except Exception:
            error_message = "An unreportable error occurred."
        return render_template('response_page.html', title='Internal Error', message=f'An internal error occurred.<br><small>Details: {error_message}</small>', theme_color='#dc3545', icon='⚠️', logo_url=logo_url), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port)