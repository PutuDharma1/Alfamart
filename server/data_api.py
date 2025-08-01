from flask import Blueprint, jsonify, request
import gspread
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request # <-- Import yang dibutuhkan
import re
import os # <-- Import yang dibutuhkan

# 1. Membuat Blueprint
data_bp = Blueprint('data_api', __name__)

# --- Struktur ID Spreadsheet ---
SPREADSHEET_IDS = {
    "ACEH": {"ME": "1KZyh0VVn7dZRyvEm6q7RV4iA5jzg7u2oRTIvSHxeFu0", "SIPIL": "11b_oUEmsjqFkB8CX8uOg8SUjlUpfgjZQq6qN1BtVBm4"},
    "BALARAJA": {"ME": "1FVRlRK1Qop1Q7OlHKsIc14BhRSHn9XH2gLWarxWMON4", "SIPIL": "1nBPJjM17vwO1tTsC2m8VRnnhQQKC_bUEpfFebfib_g0"},
    # ... (Salin sisa daftar ID Anda di sini) ...
    "HEAD OFFICE": {"ME": "1oQfZkWSP-TWQmQMY-gM1qVcLP_i47REBmJj1IfDNzkg", "SIPIL": "1Jf_qTHOMpmyLWp9zR_5CiwjyzWWtD8cH99qt4kJvLOw"}
}

# --- Fungsi Bantuan ---
def is_roman_numeral(s):
    return bool(re.match(r'^(?=[MDCLXVI])M*(C[MD]|D?C*)(X[CL]|L?X*)(I[XV]|V?I*)$', s.strip()))

# [PERBAIKAN UTAMA DI SINI] - Logika autentikasi disamakan dengan google_services.py
def get_google_creds():
    creds = None
    scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']
    
    # Render menyimpan secret files di '/etc/secrets/'
    secret_dir = '/etc/secrets/'
    token_path = os.path.join(secret_dir, 'token.json')

    # Jika tidak di Render (misalnya lokal), gunakan path biasa
    if not os.path.exists(secret_dir):
        token_path = 'token.json'

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, scopes)
    
    # Jika token tidak ada, tidak valid, atau kedaluwarsa, refresh
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Simpan token yang sudah di-refresh untuk penggunaan berikutnya
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
        else:
            raise Exception("Critical: token.json is missing, invalid, or expired and cannot be refreshed.")
    return creds

def process_sheet(sheet):
    # ... (Fungsi ini tidak perlu diubah) ...
    all_values = sheet.get_all_values()
    header_row_index = -1
    header = []
    for i, row in enumerate(all_values):
        if row and row[0].strip() == 'NO.':
            header_row_index = i
            header = [h.strip() for h in row]
            break

    if header_row_index == -1:
        raise ValueError("Header row starting with 'NO.' not found.")

    col_indices = {h: i for i, h in enumerate(header)}
    try:
        harga_col_start = header.index("Material")
        col_indices["Material"] = harga_col_start
        col_indices["Upah"] = header.index("Upah", harga_col_start)
    except ValueError:
         raise ValueError("Columns 'Material' or 'Upah' not found in header.")

    data_rows = all_values[header_row_index + 2:]
    categorized_prices = {}
    current_category = "Uncategorized"

    for row in data_rows:
        if len(row) <= col_indices.get('Jenis Pekerjaan', len(row)):
            continue
        no_val = row[col_indices['NO.']].strip()
        jenis_pekerjaan = row[col_indices['Jenis Pekerjaan']].strip()

        if is_roman_numeral(no_val) and jenis_pekerjaan:
            current_category = f"{no_val}. {jenis_pekerjaan}"
            categorized_prices[current_category] = []
            continue

        if jenis_pekerjaan:
            harga_material_raw = row[col_indices['Material']]
            harga_upah_raw = row[col_indices['Upah']]
            harga_material = "Kondisional" if str(harga_material_raw).lower().strip() == 'kondisional' else float(str(harga_material_raw).replace('.', '').replace(',', '.') or 0)
            harga_upah = "Kondisional" if str(harga_upah_raw).lower().strip() == 'kondisional' else float(str(harga_upah_raw).replace('.', '').replace(',', '.') or 0)
            item_data = {
                "Jenis Pekerjaan": jenis_pekerjaan,
                "Satuan": row[col_indices['Sat']],
                "Harga Material": harga_material,
                "Harga Upah": harga_upah
            }
            if current_category not in categorized_prices:
                categorized_prices[current_category] = []
            categorized_prices[current_category].append(item_data)
    return categorized_prices


# --- Endpoint API ---
@data_bp.route('/get-data', methods=['GET'])
def get_data():
    # ... (Fungsi ini tidak perlu diubah) ...
    cabang = request.args.get('cabang')
    lingkup = request.args.get('lingkup')

    if not cabang or not lingkup:
        return jsonify({"error": "Missing 'cabang' or 'lingkup' parameter"}), 400

    cabang = cabang.upper()
    lingkup = lingkup.upper()

    if cabang not in SPREADSHEET_IDS or lingkup not in SPREADSHEET_IDS[cabang]:
        return jsonify({"error": f"Invalid 'cabang' or 'lingkup'. Provided: {cabang}, {lingkup}"}), 404

    spreadsheet_id = SPREADSHEET_IDS[cabang][lingkup]

    try:
        creds = get_google_creds()
        client = gspread.authorize(creds)
        spreadsheet = client.open_by_key(spreadsheet_id)
        sheet = spreadsheet.get_worksheet(0)
        processed_data = process_sheet(sheet)
        return jsonify(processed_data)
    except gspread.exceptions.SpreadsheetNotFound:
        return jsonify({"error": f"Spreadsheet with ID {spreadsheet_id} not found or permission denied."}), 404
    except Exception as e:
        return jsonify({"error": f"An internal server error occurred: {str(e)}"}), 500