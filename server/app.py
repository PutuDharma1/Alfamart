from gevent import monkey
monkey.patch_all()

import datetime
import os
import traceback
import json
from flask import Flask, request, jsonify, render_template, url_for
from dotenv import load_dotenv
from flask_cors import CORS
from datetime import timezone, timedelta

import config
from google_services import GoogleServiceProvider
from pdf_generator import create_pdf_from_data
from spk_generator import create_spk_pdf

load_dotenv()
app = Flask(__name__)

CORS(app, 
     origins=[
         "http://127.0.0.1:5500", 
         "http://localhost:5500", 
         "https://alfamart-one.vercel.app"
     ], 
     methods=["GET", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"], 
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True
)

google_provider = GoogleServiceProvider()

from data_api import data_bp
app.register_blueprint(data_bp)

@app.route('/')
def index():
    return "Backend server is running and healthy.", 200

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    cabang = data.get('cabang')
    if not email or not cabang:
        return jsonify({"status": "error", "message": "Email and cabang are required"}), 400
    try:
        is_valid = google_provider.validate_user(email, cabang)
        if is_valid:
            return jsonify({"status": "success", "message": "Login successful"}), 200
        else:
            return jsonify({"status": "error", "message": "Invalid credentials"}), 401
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": "An internal server error occurred"}), 500

@app.route('/api/check_status', methods=['GET'])
def check_status():
    email = request.args.get('email')
    cabang = request.args.get('cabang')
    if not email or not cabang:
        return jsonify({"error": "Email and cabang parameters are missing"}), 400
    try:
        status_data = google_provider.check_user_submissions(email, cabang)
        return jsonify(status_data), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/submit_rab', methods=['POST'])
def submit_rab():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON data"}), 400
    new_row_index = None
    try:
        WIB = timezone(timedelta(hours=7))
        data[config.COLUMN_NAMES.STATUS] = config.STATUS.WAITING_FOR_COORDINATOR
        data[config.COLUMN_NAMES.TIMESTAMP] = datetime.datetime.now(WIB).isoformat()
        
        item_keys_to_archive = ('Jenis_Pekerjaan_', 'Kategori_Pekerjaan_', 'Satuan_Item_', 'Volume_Item_', 'Harga_Material_Item_', 'Harga_Upah_Item_')
        item_details = {k: v for k, v in data.items() if k.startswith(item_keys_to_archive)}
        data['Item_Details_JSON'] = json.dumps(item_details)
        
        pdf_bytes = create_pdf_from_data(google_provider, data)
        
        jenis_toko = data.get('Proyek', 'N/A')
        nomor_ulok_raw = data.get(config.COLUMN_NAMES.LOKASI, 'N/A')
        
        nomor_ulok_formatted = nomor_ulok_raw
        if isinstance(nomor_ulok_raw, str) and len(nomor_ulok_raw) == 12:
            nomor_ulok_formatted = f"{nomor_ulok_raw[:4]}-{nomor_ulok_raw[4:8]}-{nomor_ulok_raw[8:]}"
        
        pdf_filename = f"RAB_ALFAMART({jenis_toko})_({nomor_ulok_formatted}).pdf"
        
        pdf_link = google_provider.upload_pdf_to_drive(pdf_bytes, pdf_filename)
        data[config.COLUMN_NAMES.LINK_PDF] = pdf_link
        data[config.COLUMN_NAMES.LOKASI] = nomor_ulok_formatted
        
        new_row_index = google_provider.append_to_sheet(data, config.DATA_ENTRY_SHEET_NAME)
        
        cabang = data.get('Cabang')
        if not cabang:
             raise Exception("Field 'Cabang' is empty. Cannot find Coordinator.")

        coordinator_email = google_provider.get_email_by_jabatan(cabang, config.JABATAN.KOORDINATOR)
        if not coordinator_email:
            raise Exception(f"Coordinator email for branch '{cabang}' not found.")

        base_url = "https://alfamart.onrender.com"
        approval_url = f"{base_url}/api/handle_rab_approval?action=approve&row={new_row_index}&level=coordinator&approver={coordinator_email}"
        rejection_url = f"{base_url}/api/handle_rab_approval?action=reject&row={new_row_index}&level=coordinator&approver={coordinator_email}"
        
        email_html = render_template('email_template.html', level='Koordinator', form_data=data, approval_url=approval_url, rejection_url=rejection_url)
        
        google_provider.send_email(to=coordinator_email, subject=f"[TAHAP 1: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", html_body=email_html, pdf_attachment_bytes=pdf_bytes, pdf_filename=pdf_filename)
        
        return jsonify({"status": "success", "message": "Data successfully submitted and approval email sent."}), 200

    except Exception as e:
        if new_row_index:
            google_provider.delete_row(config.DATA_ENTRY_SHEET_NAME, new_row_index)
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/handle_rab_approval', methods=['GET'])
def handle_rab_approval():
    action = request.args.get('action')
    row_str = request.args.get('row')
    level = request.args.get('level')
    approver = request.args.get('approver')
    
    logo_url = url_for('static', filename='Alfamart-Emblem.png', _external=True)

    if not all([action, row_str, level, approver]):
        return render_template('response_page.html', title='Incomplete Parameters', message='URL parameters are incomplete.', logo_url=logo_url), 400
    try:
        row = int(row_str)
        row_data = google_provider.get_row_data(row)
        if not row_data:
            return render_template('response_page.html', title='Data Not Found', message='This request may have been deleted.', logo_url=logo_url)
        
        item_details_json = row_data.get('Item_Details_JSON', '{}')
        if item_details_json:
            try:
                item_details = json.loads(item_details_json)
                row_data.update(item_details)
            except json.JSONDecodeError:
                print(f"Warning: Could not decode Item_Details_JSON for row {row}")
        
        current_status = row_data.get(config.COLUMN_NAMES.STATUS, "").strip()
        expected_status_map = {'coordinator': config.STATUS.WAITING_FOR_COORDINATOR, 'manager': config.STATUS.WAITING_FOR_MANAGER}
        
        if current_status != expected_status_map.get(level):
            msg = f'This action has already been processed. Current status: <strong>{current_status}</strong>.'
            return render_template('response_page.html', title='Action Already Processed', message=msg, logo_url=logo_url)
        
        WIB = timezone(timedelta(hours=7))
        current_time = datetime.datetime.now(WIB).isoformat()
        
        cabang = row_data.get(config.COLUMN_NAMES.CABANG)
        jenis_toko = row_data.get(config.COLUMN_NAMES.PROYEK, 'N/A')
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
                body = f"<p>Pengajuan RAB untuk proyek <b>{jenis_toko}</b> telah <b>DITOLAK</b>.</p>"
                google_provider.send_email(to=creator_email, subject=subject, html_body=body)
            return render_template('response_page.html', title='Permintaan Ditolak', message='Status permintaan telah diperbarui.', logo_url=logo_url)

        elif level == 'coordinator' and action == 'approve':
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, config.STATUS.WAITING_FOR_MANAGER)
            google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVER, approver)
            google_provider.update_cell(row, config.COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME, current_time)
            manager_email = google_provider.get_email_by_jabatan(cabang, config.JABATAN.MANAGER)
            if manager_email:
                row_data[config.COLUMN_NAMES.KOORDINATOR_APPROVER] = approver
                row_data[config.COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME] = current_time
                base_url = "https://alfamart.onrender.com"
                approval_url_manager = f"{base_url}/api/handle_rab_approval?action=approve&row={row}&level=manager&approver={manager_email}"
                rejection_url_manager = f"{base_url}/api/handle_rab_approval?action=reject&row={row}&level=manager&approver={manager_email}"
                email_html_manager = render_template('email_template.html', level='Manajer', form_data=row_data, approval_url=approval_url_manager, rejection_url=rejection_url_manager, additional_info=f"Telah disetujui oleh Koordinator: {approver}")
                pdf_bytes = create_pdf_from_data(google_provider, row_data)
                pdf_filename = f"RAB_ALFAMART({jenis_toko}).pdf"
                google_provider.send_email(manager_email, f"[TAHAP 2: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", email_html_manager, pdf_bytes, pdf_filename)
            return render_template('response_page.html', title='Persetujuan Diteruskan', message='Terima kasih. Persetujuan Anda telah dicatat.', logo_url=logo_url)
        
        elif level == 'manager' and action == 'approve':
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, config.STATUS.APPROVED)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVER, approver)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVAL_TIME, current_time)
            
            row_data[config.COLUMN_NAMES.STATUS] = config.STATUS.APPROVED
            row_data[config.COLUMN_NAMES.MANAGER_APPROVER] = approver
            row_data[config.COLUMN_NAMES.MANAGER_APPROVAL_TIME] = current_time
            
            final_pdf_bytes = create_pdf_from_data(google_provider, row_data)
            final_pdf_filename = f"DISETUJUI_RAB_ALFAMART({jenis_toko}).pdf"
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
            return render_template('response_page.html', title='Persetujuan Berhasil', message='Tindakan Anda telah berhasil diproses.', logo_url=logo_url)

    except Exception as e:
        traceback.print_exc()
        return render_template('response_page.html', title='Internal Error', message=f'An internal error occurred: {str(e)}', logo_url=logo_url), 500

@app.route('/api/get_approved_rab', methods=['GET'])
def get_approved_rab():
    user_cabang = request.args.get('cabang')
    if not user_cabang:
        return jsonify({"error": "Cabang parameter is missing"}), 400
    try:
        approved_rabs = google_provider.get_approved_rab_by_cabang(user_cabang)
        return jsonify(approved_rabs), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/submit_spk', methods=['POST'])
def submit_spk():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON data"}), 400
    
    new_row_index = None
    try:
        WIB = timezone(timedelta(hours=7))
        data['Timestamp'] = datetime.datetime.now(WIB).isoformat()
        data['Status'] = config.STATUS.WAITING_FOR_BM_APPROVAL
        
        start_date = datetime.datetime.fromisoformat(data['Waktu Mulai']) 
        duration = int(data['Durasi'])
        end_date = start_date + timedelta(days=duration)
        data['Waktu Selesai'] = end_date.isoformat()

        pdf_bytes = create_spk_pdf(google_provider, data)
        pdf_filename = f"SPK_{data.get('Proyek')}_{data.get('Nomor Ulok')}.pdf"
        
        pdf_link = google_provider.upload_pdf_to_drive(pdf_bytes, pdf_filename)
        data['Link PDF'] = pdf_link
        
        new_row_index = google_provider.append_to_sheet(data, config.SPK_DATA_SHEET_NAME)

        cabang = data.get('Cabang')
        branch_manager_email = google_provider.get_email_by_jabatan(cabang, config.JABATAN.BRANCH_MANAGER)
        if not branch_manager_email:
            raise Exception(f"Branch Manager email for branch '{cabang}' not found.")

        base_url = "https://alfamart.onrender.com"
        approval_url = f"{base_url}/api/handle_spk_approval?action=approve&row={new_row_index}&approver={branch_manager_email}"
        rejection_url = f"{base_url}/api/handle_spk_approval?action=reject&row={new_row_index}&approver={branch_manager_email}"

        email_html = render_template('email_template.html', 
                                     level='Branch Manager', 
                                     form_data=data, 
                                     approval_url=approval_url, 
                                     rejection_url=rejection_url)
        
        google_provider.send_email(to=branch_manager_email, 
                                   subject=f"[PERLU PERSETUJUAN SPK] Proyek: {data.get('Proyek')}", 
                                   html_body=email_html, 
                                   pdf_attachment_bytes=pdf_bytes, 
                                   pdf_filename=pdf_filename)
        
        return jsonify({"status": "success", "message": "SPK successfully submitted for approval."}), 200

    except Exception as e:
        if new_row_index:
            google_provider.delete_row(config.SPK_DATA_SHEET_NAME, new_row_index)
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/handle_spk_approval', methods=['GET'])
def handle_spk_approval():
    action = request.args.get('action')
    row_str = request.args.get('row')
    approver = request.args.get('approver')
    
    logo_url = url_for('static', filename='Alfamart-Emblem.png', _external=True)

    if not all([action, row_str, approver]):
        return render_template('response_page.html', title='Parameter Tidak Lengkap', message='URL tidak lengkap.', logo_url=logo_url), 400
    
    try:
        row_index = int(row_str)
        spk_sheet = google_provider.sheet.worksheet(config.SPK_DATA_SHEET_NAME)
        row_data = google_provider.get_row_data_by_sheet(spk_sheet, row_index)

        if not row_data:
            return render_template('response_page.html', title='Data Tidak Ditemukan', message='Permintaan ini mungkin sudah dihapus.', logo_url=logo_url)
        
        current_status = row_data.get('Status', '').strip()
        if current_status != config.STATUS.WAITING_FOR_BM_APPROVAL:
            msg = f'Tindakan ini sudah diproses. Status saat ini: <strong>{current_status}</strong>.'
            return render_template('response_page.html', title='Tindakan Sudah Diproses', message=msg, logo_url=logo_url)

        WIB = timezone(timedelta(hours=7))
        current_time = datetime.datetime.now(WIB).isoformat()
        
        initiator_email = row_data.get('Dibuat Oleh')
        
        if action == 'approve':
            new_status = config.STATUS.SPK_APPROVED
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Status', new_status)
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Disetujui Oleh', approver)
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Waktu Persetujuan', current_time)
            
            row_data['Status'] = new_status
            row_data['Disetujui Oleh'] = approver
            final_pdf_bytes = create_spk_pdf(google_provider, row_data)
            final_pdf_filename = f"SPK_DISETUJUI_{row_data.get('Proyek')}_{row_data.get('Nomor Ulok')}.pdf"
            final_pdf_link = google_provider.upload_pdf_to_drive(final_pdf_bytes, final_pdf_filename)
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Link PDF', final_pdf_link)
            
            if initiator_email:
                subject = f"[DISETUJUI] SPK untuk Proyek: {row_data.get('Proyek')}"
                body = f"<p>SPK yang Anda ajukan untuk proyek <b>{row_data.get('Proyek')}</b> ({row_data.get('Nomor Ulok')}) telah disetujui oleh Branch Manager.</p><p>File PDF final terlampir.</p>"
                google_provider.send_email(to=initiator_email, subject=subject, html_body=body, pdf_attachment_bytes=final_pdf_bytes, pdf_filename=final_pdf_filename)

            return render_template('response_page.html', title='Persetujuan Berhasil', message='Terima kasih. Persetujuan Anda telah dicatat.', logo_url=logo_url)

        elif action == 'reject':
            new_status = config.STATUS.SPK_REJECTED
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Status', new_status)
            
            if initiator_email:
                subject = f"[DITOLAK] SPK untuk Proyek: {row_data.get('Proyek')}"
                body = f"<p>SPK yang Anda ajukan untuk proyek <b>{row_data.get('Proyek')}</b> ({row_data.get('Nomor Ulok')}) telah ditolak oleh Branch Manager.</p>"
                google_provider.send_email(to=initiator_email, subject=subject, html_body=body)

            return render_template('response_page.html', title='Permintaan Ditolak', message='Status permintaan telah diperbarui menjadi ditolak.', logo_url=logo_url)

    except Exception as e:
        traceback.print_exc()
        return render_template('response_page.html', title='Error Internal', message=f'Terjadi kesalahan: {str(e)}', logo_url=logo_url), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port)