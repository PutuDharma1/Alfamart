import os
from dotenv import load_dotenv

load_dotenv()

# --- Google & Spreadsheet Configuration ---
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "1LA1TlhgltT2bqSN3H-LYasq9PtInVlqq98VPru8txoo")
PDF_STORAGE_FOLDER_ID = "1lvPxOwNILXHmagVfPGkVlNEtfv3U4Emj" # Ganti dengan ID Folder Google Drive Anda

# Nama-nama sheet
DATA_ENTRY_SHEET_NAME = "Form2"
APPROVED_DATA_SHEET_NAME = "Form3"
CABANG_SHEET_NAME = "Cabang"
SPK_DATA_SHEET_NAME = "SPK_Data" # BARU

# --- Nama Kolom ---
class COLUMN_NAMES:
    STATUS = "Status"
    TIMESTAMP = "Timestamp"
    EMAIL_PEMBUAT = "Email_Pembuat"
    LOKASI = "Nomor Ulok"
    PROYEK = "Proyek"
    CABANG = "Cabang"
    LINGKUP_PEKERJAAN = "Lingkup_Pekerjaan"
    KOORDINATOR_APPROVER = "Pemberi Persetujuan Koordinator"
    KOORDINATOR_APPROVAL_TIME = "Waktu Persetujuan Koordinator"
    MANAGER_APPROVER = "Pemberi Persetujuan Manager"
    MANAGER_APPROVAL_TIME = "Waktu Persetujuan Manager"
    LINK_PDF = "Link PDF"
    LINK_PDF_NONSBO = "Link PDF Non-SBO"  # <-- TAMBAHKAN BARIS INI
    GRAND_TOTAL = "Grand Total"
    ALAMAT = "Alamat"


# --- Jabatan & Status ---
class JABATAN:
    SUPPORT = "BRANCH BUILDING SUPPORT"
    KOORDINATOR = "BRANCH BUILDING COORDINATOR"
    MANAGER = "BRANCH BUILDING & MAINTENANCE MANAGER"
    BRANCH_MANAGER = "BRANCH MANAGER" # BARU

class STATUS:
    # Status RAB
    WAITING_FOR_COORDINATOR = "Menunggu Persetujuan Koordinator"
    REJECTED_BY_COORDINATOR = "Ditolak oleh Koordinator"
    WAITING_FOR_MANAGER = "Menunggu Persetujuan Manajer"
    REJECTED_BY_MANAGER = "Ditolak oleh Manajer"
    APPROVED = "Disetujui"
    # Status SPK (BARU)
    WAITING_FOR_BM_APPROVAL = "Menunggu Persetujuan Branch Manager"
    SPK_APPROVED = "SPK Disetujui"
    SPK_REJECTED = "SPK Ditolak"