from gevent import monkey
monkey.patch_all()

import datetime
import os
import traceback
import json
import base64
from flask import Flask, request, jsonify, render_template, url_for
from dotenv import load_dotenv
from flask_cors import CORS
from datetime import timezone, timedelta

import config
from google_services import GoogleServiceProvider
from pdf_generator import create_pdf_from_data
from spk_generator import create_spk_pdf
from pengawasan_email_logic import get_email_details, FORM_LINKS

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

def get_tanggal_h(start_date, jumlah_hari_kerja):
    """Menghitung tanggal H+ sekian hari kerja (lewati Sabtu & Minggu)."""
    tanggal = start_date
    count = 0
    if not jumlah_hari_kerja: return tanggal
    while count < jumlah_hari_kerja:
        tanggal += timedelta(days=1)
        if tanggal.weekday() < 5: # Senin=0, ..., Jumat=4
            count += 1
    return tanggal

@app.route('/')
def index():
    return "Backend server is running and healthy.", 200

# --- ENDPOINTS OTENTIKASI & DATA UMUM ---
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

# --- ENDPOINTS UNTUK ALUR KERJA RAB ---
@app.route('/api/submit_rab', methods=['POST'])
def submit_rab():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON data"}), 400
    new_row_index = None
    try:
        nomor_ulok_raw = data.get(config.COLUMN_NAMES.LOKASI, '')
        if not nomor_ulok_raw:
             return jsonify({"status": "error", "message": "Nomor Ulok tidak boleh kosong."}), 400
        
        is_revising = google_provider.is_revision(nomor_ulok_raw, data.get('Email_Pembuat'))

        if not is_revising and google_provider.check_ulok_exists(nomor_ulok_raw):
            return jsonify({
                "status": "error", 
                "message": f"Nomor Ulok {nomor_ulok_raw} sudah pernah diajukan dan sedang diproses atau sudah disetujui."
            }), 409

        WIB = timezone(timedelta(hours=7))
        data[config.COLUMN_NAMES.STATUS] = config.STATUS.WAITING_FOR_COORDINATOR
        data[config.COLUMN_NAMES.TIMESTAMP] = datetime.datetime.now(WIB).isoformat()

        item_keys_to_archive = (
            'Kategori_Pekerjaan_', 'Jenis_Pekerjaan_', 'Satuan_Item_', 
            'Volume_Item_', 'Harga_Material_Item_', 'Harga_Upah_Item_',
            'Total_Material_Item_', 'Total_Upah_Item_', 'Total_Harga_Item_'
        )
        item_details = {k: v for k, v in data.items() if k.startswith(item_keys_to_archive)}
        data['Item_Details_JSON'] = json.dumps(item_details)

        pdf_bytes = create_pdf_from_data(google_provider, data, exclude_sbo=False)
        
        jenis_toko = data.get('Proyek', 'N/A')
        
        nomor_ulok_formatted = nomor_ulok_raw
        if isinstance(nomor_ulok_raw, str) and len(nomor_ulok_raw) == 12:
            nomor_ulok_formatted = f"{nomor_ulok_raw[:4]}-{nomor_ulok_raw[4:8]}-{nomor_ulok_raw[8:]}"
        
        pdf_filename = f"RAB_ALFAMART({jenis_toko})_({nomor_ulok_formatted}).pdf"
        
        pdf_link = google_provider.upload_file_to_drive(pdf_bytes, pdf_filename, 'application/pdf', config.PDF_STORAGE_FOLDER_ID)
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
        
        google_provider.send_email(
            to=coordinator_email, 
            subject=f"[TAHAP 1: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", 
            html_body=email_html, 
            attachments=[(pdf_filename, pdf_bytes, 'application/pdf')]
        )
        
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
                google_provider.send_email(manager_email, f"[TAHAP 2: PERLU PERSETUJUAN] RAB Proyek: {jenis_toko}", email_html_manager, attachments=[(pdf_filename, pdf_bytes, 'application/pdf')])
            return render_template('response_page.html', title='Persetujuan Diteruskan', message='Terima kasih. Persetujuan Anda telah dicatat.', logo_url=logo_url)
        
        elif level == 'manager' and action == 'approve':
            google_provider.update_cell(row, config.COLUMN_NAMES.STATUS, config.STATUS.APPROVED)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVER, approver)
            google_provider.update_cell(row, config.COLUMN_NAMES.MANAGER_APPROVAL_TIME, current_time)
            
            row_data[config.COLUMN_NAMES.STATUS] = config.STATUS.APPROVED
            row_data[config.COLUMN_NAMES.MANAGER_APPROVER] = approver
            row_data[config.COLUMN_NAMES.MANAGER_APPROVAL_TIME] = current_time
            
            pdf_lengkap_bytes = create_pdf_from_data(google_provider, row_data, exclude_sbo=False)
            pdf_lengkap_filename = f"DISETUJUI_RAB_LENGKAP_{jenis_toko}_{row_data.get('Nomor Ulok')}.pdf"
            
            pdf_nonsbo_bytes = create_pdf_from_data(google_provider, row_data, exclude_sbo=True)
            pdf_nonsbo_filename = f"DISETUJUI_RAB_NON-SBO_{jenis_toko}_{row_data.get('Nomor Ulok')}.pdf"

            link_pdf_lengkap = google_provider.upload_file_to_drive(pdf_lengkap_bytes, pdf_lengkap_filename, 'application/pdf', config.PDF_STORAGE_FOLDER_ID)
            link_pdf_nonsbo = google_provider.upload_file_to_drive(pdf_nonsbo_bytes, pdf_nonsbo_filename, 'application/pdf', config.PDF_STORAGE_FOLDER_ID)

            google_provider.update_cell(row, config.COLUMN_NAMES.LINK_PDF, link_pdf_lengkap)
            google_provider.update_cell(row, config.COLUMN_NAMES.LINK_PDF_NONSBO, link_pdf_nonsbo)
            
            row_data[config.COLUMN_NAMES.LINK_PDF] = link_pdf_lengkap
            row_data[config.COLUMN_NAMES.LINK_PDF_NONSBO] = link_pdf_nonsbo
            
            google_provider.copy_to_approved_sheet(row_data)

            if creator_email:
                support_emails = google_provider.get_emails_by_jabatan(cabang, config.JABATAN.SUPPORT)
                manager_email = approver
                coordinator_email = row_data.get(config.COLUMN_NAMES.KOORDINATOR_APPROVER)
                cc_list = list(filter(None, set(support_emails + [manager_email, coordinator_email])))
                if creator_email in cc_list:
                    cc_list.remove(creator_email)
                
                subject = f"[FINAL - DISETUJUI] Pengajuan RAB Proyek: {jenis_toko}"
                email_body_html = (f"<p>Pengajuan RAB untuk proyek <b>{jenis_toko}</b> di cabang <b>{cabang}</b> telah disetujui sepenuhnya.</p>"
                                   f"<p>Dua versi file PDF RAB telah dilampirkan:</p>"
                                   f"<ul>"
                                   f"<li><b>{pdf_lengkap_filename}</b>: Berisi semua item pekerjaan.</li>"
                                   f"<li><b>{pdf_nonsbo_filename}</b>: Hanya berisi item pekerjaan di luar SBO.</li>"
                                   f"</ul>"
                                   f"<p>Link Google Drive:</p>"
                                   f"<ul>"
                                   f"<li><a href='{link_pdf_lengkap}'>Link PDF Lengkap</a></li>"
                                   f"<li><a href='{link_pdf_nonsbo}'>Link PDF Non-SBO</a></li>"
                                   f"</ul>")

                email_attachments = [
                    (pdf_lengkap_filename, pdf_lengkap_bytes, 'application/pdf'),
                    (pdf_nonsbo_filename, pdf_nonsbo_bytes, 'application/pdf')
                ]
                
                google_provider.send_email(
                    to=creator_email,
                    cc=cc_list,
                    subject=subject,
                    html_body=email_body_html,
                    attachments=email_attachments
                )
            return render_template('response_page.html', title='Persetujuan Berhasil', message='Tindakan Anda telah berhasil diproses.', logo_url=logo_url)

    except Exception as e:
        traceback.print_exc()
        return render_template('response_page.html', title='Internal Error', message=f'An internal error occurred: {str(e)}', logo_url=logo_url), 500

# --- ENDPOINTS UNTUK ALUR KERJA SPK ---
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

@app.route('/api/get_kontraktor', methods=['GET'])
def get_kontraktor():
    user_cabang = request.args.get('cabang')
    if not user_cabang:
        return jsonify({"error": "Cabang parameter is missing"}), 400
    try:
        kontraktor_list = google_provider.get_kontraktor_by_cabang(user_cabang)
        return jsonify(kontraktor_list), 200
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
        
        pdf_link = google_provider.upload_file_to_drive(pdf_bytes, pdf_filename, 'application/pdf', config.PDF_STORAGE_FOLDER_ID)
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
        
        google_provider.send_email(
            to=branch_manager_email, 
            subject=f"[PERLU PERSETUJUAN SPK] Proyek: {data.get('Proyek')}", 
            html_body=email_html, 
            attachments=[(pdf_filename, pdf_bytes, 'application/pdf')]
        )
        
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
            row_data['Waktu Persetujuan'] = current_time # Tambahkan ini agar ada di PDF
            final_pdf_bytes = create_spk_pdf(google_provider, row_data)
            final_pdf_filename = f"SPK_DISETUJUI_{row_data.get('Proyek')}_{row_data.get('Nomor Ulok')}.pdf"
            final_pdf_link = google_provider.upload_file_to_drive(final_pdf_bytes, final_pdf_filename, 'application/pdf', config.PDF_STORAGE_FOLDER_ID)
            google_provider.update_cell_by_sheet(spk_sheet, row_index, 'Link PDF', final_pdf_link)
            
            if initiator_email:
                subject = f"[DISETUJUI] SPK untuk Proyek: {row_data.get('Proyek')}"
                body = f"<p>SPK yang Anda ajukan untuk proyek <b>{row_data.get('Proyek')}</b> ({row_data.get('Nomor Ulok')}) telah disetujui oleh Branch Manager.</p><p>File PDF final terlampir.</p>"
                google_provider.send_email(to=initiator_email, subject=subject, html_body=body, attachments=[(final_pdf_filename, final_pdf_bytes, 'application/pdf')])

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

# --- ENDPOINTS UNTUK FORM PENGAWASAN ---
@app.route('/api/pengawasan/init_data', methods=['GET'])
def get_pengawasan_init_data():
    cabang = request.args.get('cabang')
    if not cabang:
        return jsonify({"status": "error", "message": "Parameter cabang dibutuhkan."}), 400
    try:
        pic_list, _, _ = google_provider.get_user_info_by_cabang(cabang)
        kode_ulok_list = google_provider.get_kode_ulok_by_cabang(cabang)
        
        return jsonify({
            "status": "success",
            "picList": pic_list,
            "kodeUlokList": kode_ulok_list
        }), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/pengawasan/get_rab_url', methods=['GET'])
def get_rab_url():
    kode_ulok = request.args.get('kode_ulok')
    if not kode_ulok:
        return jsonify({"status": "error", "message": "Parameter kode_ulok dibutuhkan."}), 400
    try:
        rab_url = google_provider.get_rab_url_by_ulok(kode_ulok)
        if rab_url:
            return jsonify({"status": "success", "rabUrl": rab_url}), 200
        else:
            return jsonify({"status": "error", "message": "URL RAB tidak ditemukan."}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/pengawasan/submit', methods=['POST'])
def submit_pengawasan():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Data JSON tidak valid"}), 400

    try:
        form_type = data.get('form_type')
        WIB = timezone(timedelta(hours=7))
        timestamp = datetime.datetime.now(WIB)
        data['timestamp'] = timestamp.isoformat()
        
        cabang = data.get('cabang', 'N/A')
        pic_list, koordinator_info, manager_info = google_provider.get_user_info_by_cabang(cabang)
        user_info = {
            'pic_list': pic_list,
            'koordinator_info': koordinator_info,
            'manager_info': manager_info
        }

        if form_type == 'input_pic':
            spk_base64 = data.get('spk_base64', '')
            spk_bytes = base64.b64decode(spk_base64)
            date_string = timestamp.strftime('%Y%m%d_%H%M%S')
            spk_filename = f"SPK_{data.get('kode_ulok')}_{date_string}.pdf"
            spk_url = google_provider.upload_file_to_drive(spk_bytes, spk_filename, 'application/pdf', config.INPUT_PIC_DRIVE_FOLDER_ID)
            data['spkUrl'] = spk_url

            rab_url = google_provider.get_rab_url_by_ulok(data.get('kode_ulok'))
            if not rab_url:
                return jsonify({"status": "error", "message": f"RAB untuk kode ulok {data.get('kode_ulok')} tidak ditemukan."}), 404
            data['rabUrl'] = rab_url

            google_provider.append_to_dynamic_sheet(
                config.PENGAWASAN_SPREADSHEET_ID, config.INPUT_PIC_SHEET_NAME, 
                {'timestamp': data['timestamp'], 'cabang': data.get('cabang'), 'kode_ulok': data.get('kode_ulok'), 'kategori_lokasi': data.get('kategori_lokasi'), 'tanggal_spk': data.get('tanggal_spk'), 'pic_building_support': data.get('pic_building_support'), 'spkUrl': spk_url, 'rabUrl': rab_url}
            )
            google_provider.append_to_dynamic_sheet(
                config.PENGAWASAN_SPREADSHEET_ID, config.PENUGASAN_SHEET_NAME,
                {'pic_building_support': data.get('pic_building_support'), 'kode_ulok': data.get('kode_ulok'), 'cabang': data.get('cabang')}
            )
            
            tanggal_spk_obj = datetime.datetime.fromisoformat(data.get('tanggal_spk'))
            tanggal_mengawas = get_tanggal_h(tanggal_spk_obj, 2)
            data['tanggal_mengawas'] = tanggal_mengawas.strftime('%d %B %Y')

        else:
            sheet_map = {
                'h2': 'DataH2', 'h5': 'DataH5', 'h7': 'DataH7', 'h8': 'DataH8', 'h10': 'DataH10',
                'h12': 'DataH12', 'h14': 'DataH14', 'h16': 'DataH16', 'h17': 'DataH17',
                'h18': 'DataH18', 'h22': 'DataH22', 'h23': 'DataH23', 'h25': 'DataH25',
                'h28': 'DataH28', 'h32': 'DataH32', 'h33': 'DataH33', 'h41': 'DataH41',
                'serah_terima': 'SerahTerima'
            }
            target_sheet = sheet_map.get(form_type)
            if target_sheet:
                 google_provider.append_to_dynamic_sheet(
                    config.PENGAWASAN_SPREADSHEET_ID, target_sheet, data
                )

        email_details = get_email_details(form_type, data, user_info)
        base_url = "https://alfamart-one.vercel.app"
        next_form_path = FORM_LINKS.get(form_type, {}).get(data.get('kategori_lokasi'), '#')
        
        email_html = render_template('pengawasan_email_template.html', 
                                     form_data=data,
                                     user_info=user_info,
                                     next_form_url=f"{base_url.strip('/')}{next_form_path}" if next_form_path != '#' else None,
                                     form_type=form_type
                                    )
        
        google_provider.send_email(
            to=email_details['recipients'],
            subject=email_details['subject'],
            html_body=email_html
        )
        
        if form_type == 'input_pic' and 'tanggal_mengawas' in data:
            event_date_obj = datetime.datetime.strptime(data['tanggal_mengawas'], '%d %B %Y')
            google_provider.create_calendar_event({
                'title': f"Pengawasan Proyek - {data.get('kode_ulok')} ({data.get('cabang')})",
                'description': f"Pengawasan H+2 untuk toko {data.get('kode_ulok')}",
                'date': event_date_obj.strftime('%Y-%m-%d'),
                'guests': email_details['recipients']
            })

        return jsonify({"status": "success", "message": "Laporan berhasil dikirim."}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port)