from flask import Flask, jsonify, request
import gspread
from google.oauth2.credentials import Credentials
import re

# --- Konfigurasi Aplikasi Flask ---
app = Flask(__name__)

# --- Struktur ID Spreadsheet untuk Setiap Cabang ---
SPREADSHEET_IDS = {
    "ACEH": {"ME": "1KZyh0VVn7dZRyvEm6q7RV4iA5jzg7u2oRTIvSHxeFu0", "SIPIL": "11b_oUEmsjqFkB8CX8uOg8SUjlUpfgjZQq6qN1BtVBm4"},
    "BALARAJA": {"ME": "1FVRlRK1Qop1Q7OlHKsIc14BhRSHn9XH2gLWarxWMON4", "SIPIL": "1nBPJjM17vwO1tTsC2m8VRnnhQQKC_bUEpfFebfib_g0"},
    "BALI": {"ME": "1ih2kuwqcCa7EiMTbJX6qiNsrv7vpmPE825a_9qAz2Ng", "SIPIL": "1gD_z66c4zPBXMXcKGxIFs8C2h2uiDXwO3J7r_e1BxJc"},
    "BANDUNG 1": {"ME": "13xo-gjJnXlCWXKNfW3ZugEYxK6qz1jvUq2ScSBJF1cw", "SIPIL": "11Weq3EIPCo-_bOPvTrSBQPcpXNPu5VTIoWHPA4ZJfHw"},
    "BANDUNG 2": {"ME": "15kOWwgAQTZKZ-Ofm_jrlaKHJbbU_wDkYTptefCVOTCY", "SIPIL": "1LsIBm2829RqC7Tu9fdNnWTgDKLT9gCz4zWCCHjMbmzI"},
    "BANGKA": {"ME": "1nhjwDMrG8fWUXu-4tTdcfgbLpEfOfEh90SSqOVhaaPc", "SIPIL": "1SmZJ5hNYAQba5byj-cduo4yRRNl74LEwHvayt_Wj27g"},
    "BANJARMASIN": {"ME": "1_1alrg4qaA2HeI_FpKqCczP-S8iasQ6P93jUDUISfgw", "SIPIL": "13PEkDV55bcV3SRU1gEvaU2EIDRUYfAREXLAkIYIX660"},
    "BATAM": {"ME": "1pUf7XBVN-eR7ptaeCqjHIokeRyu2xrE-_Y4b0KK0Uz8", "SIPIL": "1sl-1CfcEerMzpU-Boc-p7ePSZWbj53kq4DXjrC145R4"},
    "BEKASI": {"ME": "1TV8OqBBvHG93tuBe__aYm6Yo-tfRvlASoRe87qTD5WI", "SIPIL": "1rwdlpE0G_NP3zAsRECtALgXFh1g6Fp5-XC-bxdwvXhw"},
    "BELITUNG": {"ME": "1nhjwDMrG8fWUXu-4tTdcfgbLpEfOfEh90SSqOVhaaPc", "SIPIL": "1bLyVM6OEMHzR6LHyNlatDePmDOKE7UtHGXPfU-CqQsY"},
    "BENGKULU": {"ME": "1nhjwDMrG8fWUXu-4tTdcfgbLpEfOfEh90SSqOVhaaPc", "SIPIL": "1ZE69uEhHuG8hVTPqGge53wQBh4uy2j_UTXi0q8gHQNE"},
    "BOGOR": {"ME": "1ESn1O-gHsjJFoBYZGhzMxkI4IHO-L82aESTRWO_n26Y", "SIPIL": "1DMUZYn8ElI5j7yFn1Eeu_d7n4CIzYWbvLcdyjIsOrUI"},
    "CIANJUR": {"ME": "14MwcXFxSAkWAYf0CFSADNkBaONgcNjJBs9BsluMHAKU", "SIPIL": "1yrDQzOjYlg7YxI0E9clBZRG_Iz8KHoo9FA6abYxgDRs"},
    "CIKOKOL": {"ME": "1oEX2bmyi40u09LLfjsL-A6ec7Iw7hAXKVfk0SJDnnBw", "SIPIL": "1aSpjDMumbtEa0BrrK2T7qaGd2AIep09qSX14BwzI5gY"},
    "CILACAP": {"ME": "1nm9L7rNKnexO06dW0YkmfXO9hhlKN7Ai88iEWIC8Olw", "SIPIL": "1Lgjo4WB1cXNF9Howneisr-PdJLCjrJSE60C9JtxNIYI"},
    "CILEUNGSI": {"ME": "1JVtRGj9LxkYrBMCBfK1Tc4IMZLqiXyzhQBgQw0FBsj8", "SIPIL": "1yhAK38hk_pSzCII_rF329j8ebNOUbxDHju5EbG7L1t0"},
    "GORONTALO": {"ME": "1sYssoeMYr2iA0n-XLFLJTHo5Hr0ogOrAwIUnO8JKwro", "SIPIL": "1ZGsW7uzggEhvT77Kd8bqr-VokwPFlIjg6VOY_tntBN4"},
    "JAMBI": {"ME": "1SjIkwq9jLRKPeK3YXdBpEMJdCOlnIxaQ496mWG-aqWQ", "SIPIL": "1G_B08N-XSUqrVtcvizvUoZITPzST7pIiYbLouRFcfMc"},
    "JEMBER": {"ME": "1VjYiZ0C-h-ADIbhrJ4fAlr_oynqQabtASOTv5bc_JxY", "SIPIL": "1BBikMALwiAKam5Odz1e01Vb1aWtToCjRb2KNP4Zq-uE"},
    "KARAWANG": {"ME": "1pyhKAeNerRsOhok9VQ0Phb4h67W136ftaF7nJTXomXI", "SIPIL": "1W5nob_MXaCQCO90tdFO002irPBOTQZVNr_NMeoNjzf0"},
    "KLATEN": {"ME": "1qDUOB2xtNYEp3Kc_HbYaznc6cSfp4pa5vI9ZZZc3Hhk", "SIPIL": "1xA5qqKWlniFE8FCn0YTAnIpVfI7HKjPrFTOwUIv-7KI"},
    "KOTABUMI": {"ME": "14s6kC8qvAEjYW9E5-T1_cj_pXIkk82BZTrQd-UmPdmg", "SIPIL": "1TYCSAQ1Vu_K7KnfEfKdXTJnFuk-t6ZtKFktieXt199w"},
    "LAMPUNG": {"ME": "1Imw8469Od3dHiomBxPXgVQmn5_JOJkTT0iH-EJA6w0Y", "SIPIL": "1zY8SbebteKSb4OOGqQxDBFxJXlZHfCRz3AbmePY-4Mk"},
    "LOMBOK": {"ME": "1QeicLcNbNK7D0aYsVrM9klr273tiFZa2y9i1A3uK7Wc", "SIPIL": "17iy_6ONzglPDhOk4pm3KQpV4AIT53pZLgmERTMSrE5c"},
    "LUWU": {"ME": "1_2-ZXbpSoQN9uuHEkyFVVUjugx2n-QW3Qi0cfDeh_qM", "SIPIL": "1TDZCEUZC6TKeOWwX7I5VCDTInqy-nEVjNHYMr5ZiAbM"},
    "MADIUN": {"ME": "1UPv6sdqv5TtsL4UC3v0EOqY0MnvAB3Et-aTt2KMOrmI", "SIPIL": "1vJGFwQj92f9Mxs8dKT4dHDDCXer0DyFOPlUh__C956c"},
    "MAKASSAR": {"ME": "1XnFay1yEsQfUJ-fdccCCY8jfVuDks2sTUTgpuFrAj_k", "SIPIL": "1uUEIU7Ieqs7Nm68HBaRo4MHwob4RLTPUEtI_0LI6X28"},
    "MALANG": {"ME": "1FLZ-faMU1Cyp6OOVS5oQXdZNc4nDCvMs5rIzRvlEY0s", "SIPIL": "1EdKp2Yxz4GkEb7fyx8dLzIVNG7mSemZN_CnN3qQN_lI"},
    "MANADO": {"ME": "1kJBHqvxmvb8Kw4UvyxD_ecZsrjGGgtkCql2EAab5xfw", "SIPIL": "1sbt6Fu-OvH5qXf-LN0MpQaBnLF3tn1QcCUTNBgrVVIU"},
    "MANOKWARI": {"ME": "1O9tKmAojv42gRsNn6lryZ6Npo_kSt_J1LDOT9ZCNVMs", "SIPIL": "1DXvR6m9gZ4K_1m0hJwyJnSRAXtzy8y8uEyk68_yqziE"},
    "MEDAN": {"ME": "1TaEaBMTAXxXRS73VB8Ijnp53pZI6F6odweCBQV4vaFo", "SIPIL": "1ty-YLmkZqGAmVu7UGxjdtyBkmoYRhGibTk7ZkUt2dPs"},
    "NTT": {"ME": "1anZZF1ptwE-j_DroCLep6yfRC0A8jrFXp8v9cZ5gh7k", "SIPIL": "1dCfRyTOgMayV-m7y647X0Gqm_FPbBVl4rwJ8SPrav9o"},
    "PALEMBANG": {"ME": "1nhjwDMrG8fWUXu-4tTdcfgbLpEfOfEh90SSqOVhaaPc", "SIPIL": "1xfqITP8OOBTS7JdxBbc49U4H1IlA0qbBsXZjuEuh_g4"},
    "PARUNG": {"ME": "1BTkXU0aVovA2p4zYUok3dPq57aqTiHwj_RboQUh6-54", "SIPIL": "1w7aBoRFAvt2kkuezHoPeKYxUx2FPgHCJ8eNWA7AvvCw"},
    "PEKANBARU": {"ME": "18x4TJ751pGnSeCtGXBWbbuKTJ68oK8MHYMQaCF-nQ_8", "SIPIL": "14vFw1rx4wDCCw2pKDIWKvnNqA4aAvnwrD0eRjNtguzo"},
    "PLUMBON": {"ME": "1mHnA9lQE5ymjUL4bc51MmdwTOkCO_okXhqdg3-XmuMY", "SIPIL": "1CPQcKkJrlvvyt4SSRbcu5_ee4tjFpS7upwxcVYRIZAQ"},
    "PONTIANAK": {"ME": "1o7RgfXKoS1FLok68SrSETBO0TQy1-yI0OtM0LtHriHo", "SIPIL": "1bzjdA0DJZqtTR3W0OdYU-J85Jipwk64WtYt_3TPwnAk"},
    "REMBANG": {"ME": "1KF5HvMQoNu9dk1lmaitc_I19nofgaiLPMzulHAXanJs", "SIPIL": "18eIGamo7yGhLKu16V5n4AceIIbMW1KxQ4PJfpZGl9D8"},
    "SEMARANG": {"ME": "1EAvelezXOEj06yiHeYxsf8R9H9wuUJImG0fLlLlfaA4", "SIPIL": "1a3aPYLepwr4u5lR0MmTO_0N-wb8XTmOld8flJCgRX30"},
    "SERANG": {"ME": "1hyjjNHkHZLJo3Z-n5c-Vik6SZCc1Sd2FbnjpnvrFz7A", "SIPIL": "12y3OZxSwPlrXFgiIA_6ediJ9DK6hJ_GKVznOsm1KBok"},
    "SIDOARJO": {"ME": "1BcUs28NrcsqPk9FA3oRrVmBBmlWyGjRspZ9dJ217kAQ", "SIPIL": "1k2eBX4vZaAHL30SZcAX3kXNastEuscirr-2RuiTKIRw"},
    "SIDOARJO BPN_SMD": {"ME": "1j1B7Yvgz5X02VcCuNSJC7btZv_tumFFmeMvxNEaS0ec", "SIPIL": "18BT0u4sHuNZA-NKxdcDeNTkxT35Mag4zOW9RjduRE8A"},
    "SORONG": {"ME": "1BfAWqaN-7fk5kZMWhK0SOKousSYM6pis6jVEplQLnYs", "SIPIL": "1NbG4HOt_Zl1auzR_kw-e8mG0ajrP9P-FFLfjNCD6Oyg"},
    "SUMBAWA": {"ME": "1WB6KA2sFD11Ol81IYbM3ugH34Sg1JU1Aw6Ny8zUgCpg", "SIPIL": "1Y3AqDtyXUyJhyrvT0slbQRlW14VUd9zA8P_1vPqqI8A"},
    "TEGAL": {"ME": "13qXfMnPrOYB-fJEf_7FGgL-UENA3KWBj5uTiY4PLoAQ", "SIPIL": "1i_2TLKswkCUoNm1Z6hDmc3j9k0qNcF38MZoC-z2-PNM"},
    "HEAD OFFICE": {"ME": "1oQfZkWSP-TWQmQMY-gM1qVcLP_i47REBmJj1IfDNzkg", "SIPIL": "1Jf_qTHOMpmyLWp9zR_5CiwjyzWWtD8cH99qt4kJvLOw"}
}


# --- Fungsi Bantuan ---
def is_roman_numeral(s):
    """Memeriksa apakah string adalah angka Romawi (I, II, III, ...)."""
    return bool(re.match(r'^(?=[MDCLXVI])M*(C[MD]|D?C*)(X[CL]|L?X*)(I[XV]|V?I*)$', s.strip()))

def get_google_creds():
    """Mengambil kredensial dari file token.json."""
    # Anda perlu memastikan file token.json ada dan valid
    # Sebaiknya gunakan path absolut jika memungkinkan
    creds = Credentials.from_authorized_user_file('server/token.json', [
        'https://www.googleapis.com/auth/spreadsheets.readonly'
    ])
    return creds

def process_sheet(sheet):
    """Memproses data dari satu sheet dan mengembalikannya dalam format terstruktur."""
    all_values = sheet.get_all_values()
    
    header_row_index = -1
    header = []
    # Cari baris header yang dimulai dengan "NO."
    for i, row in enumerate(all_values):
        if row and row[0].strip() == 'NO.':
            header_row_index = i
            header = [h.strip() for h in row]
            break

    if header_row_index == -1:
        raise ValueError("Header row starting with 'NO.' not found.")

    # Cari header sekunder (untuk Material, Upah, Total)
    secondary_header = [h.strip() for h in all_values[header_row_index + 1]]

    # Map kolom berdasarkan nama
    col_indices = {h: i for i, h in enumerate(header)}
    
    # Cari posisi kolom Material, Upah, dan Total
    try:
        harga_col_start = header.index("Material")
        col_indices["Material"] = harga_col_start
        col_indices["Upah"] = header.index("Upah", harga_col_start)
        col_indices["Total"] = header.index("Total", harga_col_start)
    except ValueError:
         raise ValueError("Columns 'Material', 'Upah', or 'Total' not found in header.")

    data_rows = all_values[header_row_index + 2:] # Data dimulai 2 baris setelah header utama
    
    categorized_prices = {}
    current_category = "Uncategorized"

    for row in data_rows:
        # Jika baris tidak cukup panjang, lewati
        if len(row) <= col_indices['Jenis Pekerjaan']:
            continue
            
        no_val = row[col_indices['NO.']].strip()
        jenis_pekerjaan = row[col_indices['Jenis Pekerjaan']].strip()

        # Jika kolom NO. berisi angka romawi, itu adalah kategori baru
        if is_roman_numeral(no_val) and jenis_pekerjaan:
            current_category = f"{no_val}. {jenis_pekerjaan}"
            categorized_prices[current_category] = []
            continue

        # Jika bukan kategori dan punya jenis pekerjaan, proses sebagai item
        if jenis_pekerjaan:
            # Ambil nilai harga, cek jika "Kondisional"
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
@app.route('/get-data', methods=['GET'])
def get_data():
    """Endpoint untuk mengambil data berdasarkan cabang dan lingkup pekerjaan."""
    cabang = request.args.get('cabang')
    lingkup = request.args.get('lingkup') # 'ME' atau 'SIPIL'

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
        # Asumsi data ada di sheet pertama
        sheet = spreadsheet.get_worksheet(0) 

        processed_data = process_sheet(sheet)
        
        return jsonify(processed_data)

    except gspread.exceptions.SpreadsheetNotFound:
        return jsonify({"error": f"Spreadsheet with ID {spreadsheet_id} not found or permission denied."}), 404
    except Exception as e:
        print(f"An error occurred: {e}")
        # traceback.print_exc() # Uncomment untuk debugging detail
        return jsonify({"error": f"An internal server error occurred: {str(e)}"}), 500

if __name__ == '__main__':
    # Untuk menjalankan secara lokal: python nama_file_ini.py
    # Akses di browser: http://127.0.0.1:5000/get-data?cabang=NAMA_CABANG&lingkup=ME
    app.run(debug=True, port=5000)