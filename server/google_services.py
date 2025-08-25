import os.path
import io
import gspread
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime, timezone

import config

class GoogleServiceProvider:
    def __init__(self):
        self.scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/drive.file'
        ]
        self.creds = None
        
        secret_dir = '/etc/secrets/'
        token_path = os.path.join(secret_dir, 'token.json')
        client_secret_path = os.path.join(secret_dir, 'client_secret.json')

        if not os.path.exists(secret_dir):
            token_path = 'token.json'
            client_secret_path = 'client_secret.json'

        if os.path.exists(token_path):
            self.creds = Credentials.from_authorized_user_file(token_path, self.scopes)
        
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                raise Exception("CRITICAL: token.json not found or invalid. Please re-authenticate locally and upload the token file.")

        self.gspread_client = gspread.authorize(self.creds)
        self.sheet = self.gspread_client.open_by_key(config.SPREADSHEET_ID)
        self.data_entry_sheet = self.sheet.worksheet(config.DATA_ENTRY_SHEET_NAME)
        self.gmail_service = build('gmail', 'v1', credentials=self.creds)
        self.drive_service = build('drive', 'v3', credentials=self.creds)

    def validate_user(self, email, cabang):
        try:
            cabang_sheet = self.sheet.worksheet(config.CABANG_SHEET_NAME)
            for record in cabang_sheet.get_all_records():
                sheet_email = str(record.get('EMAIL_SAT', '')).strip()
                sheet_cabang = str(record.get('CABANG', '')).strip()
                if sheet_email.lower() == email.lower() and sheet_cabang.lower() == cabang.lower():
                    return True
        except gspread.exceptions.WorksheetNotFound:
            print(f"Error: Worksheet '{config.CABANG_SHEET_NAME}' not found.")
        except Exception as e:
            print(f"An error occurred during user validation: {e}")
        return False

    def upload_pdf_to_drive(self, pdf_bytes, filename):
        file_metadata = {'name': filename, 'parents': [config.PDF_STORAGE_FOLDER_ID]}
        media = MediaIoBaseUpload(io.BytesIO(pdf_bytes), mimetype='application/pdf')
        file = self.drive_service.files().create(body=file_metadata, media_body=media, fields='id, webViewLink').execute()
        return file.get('webViewLink')

    def check_user_submissions(self, email, cabang):
        try:
            all_values = self.data_entry_sheet.get_all_values()
            if len(all_values) <= 1:
                return {"active_codes": {"pending": [], "approved": []}, "rejected_submissions": []}

            headers = all_values[0]
            records = [dict(zip(headers, row)) for row in all_values[1:]]
            
            pending_codes = []
            approved_codes = []
            rejected_submissions = []
            
            processed_locations = set()
            user_cabang = str(cabang).strip().lower()

            for record in reversed(records):
                lokasi = str(record.get(config.COLUMN_NAMES.LOKASI, "")).strip().upper()
                if not lokasi or lokasi in processed_locations:
                    continue
                
                status = str(record.get(config.COLUMN_NAMES.STATUS, "")).strip()
                record_cabang = str(record.get(config.COLUMN_NAMES.CABANG, "")).strip().lower()
                
                if status in [config.STATUS.WAITING_FOR_COORDINATOR, config.STATUS.WAITING_FOR_MANAGER]:
                    pending_codes.append(lokasi)
                elif status == config.STATUS.APPROVED:
                    approved_codes.append(lokasi)
                elif status in [config.STATUS.REJECTED_BY_COORDINATOR, config.STATUS.REJECTED_BY_MANAGER] and record_cabang == user_cabang:
                    item_details_json = record.get('Item_Details_JSON', '{}')
                    if item_details_json:
                        try:
                            item_details = json.loads(item_details_json)
                            record.update(item_details)
                        except json.JSONDecodeError:
                            print(f"Warning: Could not decode Item_Details_JSON for rejected submission {lokasi}")
                    rejected_submissions.append(record)

                processed_locations.add(lokasi)

            return {
                "active_codes": { "pending": pending_codes, "approved": approved_codes },
                "rejected_submissions": rejected_submissions
            }
        except Exception as e:
            raise e

    def get_sheet_headers(self, worksheet_name):
        return self.sheet.worksheet(worksheet_name).row_values(1)

    def append_to_sheet(self, data, worksheet_name):
        worksheet = self.sheet.worksheet(worksheet_name)
        headers = self.get_sheet_headers(worksheet_name)
        row_data = [data.get(header, "") for header in headers]
        worksheet.append_row(row_data)
        return len(worksheet.get_all_values())

    def get_row_data(self, row_index):
        records = self.data_entry_sheet.get_all_records()
        if row_index > 1 and row_index <= len(records) + 1:
            return records[row_index - 2]
        return {}

    def update_cell(self, row_index, column_name, value):
        try:
            col_index = self.data_entry_sheet.row_values(1).index(column_name) + 1
            self.data_entry_sheet.update_cell(row_index, col_index, value)
            return True
        except Exception as e:
            print(f"Error updating cell [{row_index}, {column_name}]: {e}")
            return False

    def get_email_by_jabatan(self, branch_name, jabatan):
        try:
            cabang_sheet = self.sheet.worksheet(config.CABANG_SHEET_NAME)
            for record in cabang_sheet.get_all_records():
                sheet_branch = str(record.get('CABANG', '')).strip().lower()
                input_branch = str(branch_name).strip().lower()
                sheet_jabatan = str(record.get('JABATAN', '')).strip().upper()
                input_jabatan = str(jabatan).strip().upper()
                if sheet_branch == input_branch and sheet_jabatan == input_jabatan:
                    return record.get('EMAIL_SAT')
        except gspread.exceptions.WorksheetNotFound:
            print(f"Error: Worksheet '{config.CABANG_SHEET_NAME}' not found.")
        return None

    def get_emails_by_jabatan(self, branch_name, jabatan):
        emails = []
        try:
            cabang_sheet = self.sheet.worksheet(config.CABANG_SHEET_NAME)
            for record in cabang_sheet.get_all_records():
                sheet_branch = str(record.get('CABANG', '')).strip().lower()
                input_branch = str(branch_name).strip().lower()
                sheet_jabatan = str(record.get('JABATAN', '')).strip().upper()
                input_jabatan = str(jabatan).strip().upper()

                if sheet_branch == input_branch and sheet_jabatan == input_jabatan:
                    email = record.get('EMAIL_SAT')
                    if email:
                        emails.append(email)
        except gspread.exceptions.WorksheetNotFound:
            print(f"Error: Worksheet '{config.CABANG_SHEET_NAME}' not found.")
        return emails

    def send_email(self, to, subject, html_body, attachments=None, cc=None):
        try:
            message = MIMEMultipart()
            message['to'] = to
            message['subject'] = subject
            if cc: message['cc'] = ', '.join(cc)
            message.attach(MIMEText(html_body, 'html'))
            if attachments:
                for filename, file_bytes in attachments:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(file_bytes)
                    encoders.encode_base64(part)
                    part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
                    message.attach(part)
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            create_message = {'raw': raw_message}
            send_message = self.gmail_service.users().messages().send(userId='me', body=create_message).execute()
            print(f"Email sent successfully to {to}. Message ID: {send_message['id']}")
            return send_message
        except Exception as e:
            print(f"An error occurred while sending email: {e}")
            raise e
    
    def copy_to_approved_sheet(self, row_data):
        try:
            approved_sheet = self.sheet.worksheet(config.APPROVED_DATA_SHEET_NAME)
            headers = self.get_sheet_headers(config.APPROVED_DATA_SHEET_NAME)
            data_to_append = [row_data.get(header, "") for header in headers]
            approved_sheet.append_row(data_to_append)
            return True
        except Exception as e:
            print(f"Failed to copy data to approved sheet: {e}")
            return False

    def delete_row(self, worksheet_name, row_index):
        try:
            worksheet = self.sheet.worksheet(worksheet_name)
            worksheet.delete_rows(row_index)
            return True
        except Exception as e:
            print(f"Failed to delete row {row_index} from {worksheet_name}: {e}")
            return False
            
    def get_sheet_data_by_id(self, spreadsheet_id):
        try:
            spreadsheet = self.gspread_client.open_by_key(spreadsheet_id)
            worksheet = spreadsheet.get_worksheet(0)
            return worksheet.get_all_values()
        except gspread.exceptions.SpreadsheetNotFound:
            raise Exception(f"Spreadsheet with ID {spreadsheet_id} not found or permission denied.")
        except Exception as e:
            raise e
    
    def check_ulok_exists(self, nomor_ulok_to_check):
        try:
            normalized_ulok_to_check = str(nomor_ulok_to_check).replace("-", "")
            all_records = self.data_entry_sheet.get_all_records()
            for record in all_records:
                status = record.get(config.COLUMN_NAMES.STATUS, "").strip()
                active_statuses = [config.STATUS.WAITING_FOR_COORDINATOR, config.STATUS.WAITING_FOR_MANAGER, config.STATUS.APPROVED]
                if status in active_statuses:
                    existing_ulok = record.get(config.COLUMN_NAMES.LOKASI, "")
                    normalized_existing_ulok = str(existing_ulok).replace("-", "")
                    if normalized_existing_ulok == normalized_ulok_to_check: return True
            return False
        except Exception as e:
            print(f"Error checking for existing ulok: {e}")
            return False

    def is_revision(self, nomor_ulok, email_pembuat):
        try:
            normalized_ulok = str(nomor_ulok).replace("-", "")
            all_records = self.data_entry_sheet.get_all_records()
            for record in reversed(all_records):
                existing_ulok = str(record.get(config.COLUMN_NAMES.LOKASI, "")).replace("-", "")
                status = record.get(config.COLUMN_NAMES.STATUS, "")
                pembuat = record.get(config.COLUMN_NAMES.EMAIL_PEMBUAT, "")
                if existing_ulok == normalized_ulok and pembuat == email_pembuat:
                    if status in [config.STATUS.REJECTED_BY_COORDINATOR, config.STATUS.REJECTED_BY_MANAGER]: return True
                    else: return False
            return False
        except Exception:
            return False

    def get_approved_rab_by_cabang(self, user_cabang):
        try:
            approved_sheet = self.sheet.worksheet(config.APPROVED_DATA_SHEET_NAME)
            all_records = approved_sheet.get_all_records()
            
            branch_groups = {
                "BANDUNG 1": ["BANDUNG 1", "BANDUNG 2"], "BANDUNG 2": ["BANDUNG 1", "BANDUNG 2"],
                "LOMBOK": ["LOMBOK", "SUMBAWA"], "SUMBAWA": ["LOMBOK", "SUMBAWA"],
                "MEDAN": ["MEDAN", "ACEH"], "ACEH": ["MEDAN", "ACEH"],
                "PALEMBANG": ["PALEMBANG", "BENGKULU", "BANGKA", "BELITUNG"], "BENGKULU": ["PALEMBANG", "BENGKULU", "BANGKA", "BELITUNG"],
                "BANGKA": ["PALEMBANG", "BENGKULU", "BANGKA", "BELITUNG"], "BELITUNG": ["PALEMBANG", "BENGKULU", "BANGKA", "BELITUNG"],
                "SIDOARJO": ["SIDOARJO", "SIDOARJO BPN_SMD", "MANOKWARI", "NTT", "SORONG"], "SIDOARJO BPN_SMD": ["SIDOARJO", "SIDOARJO BPN_SMD", "MANOKWARI", "NTT", "SORONG"],
                "MANOKWARI": ["SIDOARJO", "SIDOARJO BPN_SMD", "MANOKWARI", "NTT", "SORONG"], "NTT": ["SIDOARJO", "SIDOARJO BPN_SMD", "MANOKWARI", "NTT", "SORONG"],
                "SORONG": ["SIDOARJO", "SIDOARJO BPN_SMD", "MANOKWARI", "NTT", "SORONG"]
            }
            
            allowed_branches = branch_groups.get(user_cabang.upper(), [user_cabang.upper()])
            allowed_branches_lower = [b.lower() for b in allowed_branches]

            filtered_rabs = [rec for rec in all_records if str(rec.get('Cabang', '')).strip().lower() in allowed_branches_lower]

            for rab in filtered_rabs:
                try:
                    grand_total_from_sheet = float(str(rab.get(config.COLUMN_NAMES.GRAND_TOTAL, 0)).replace(",", ""))
                except (ValueError, TypeError):
                    grand_total_from_sheet = 0
                rab[config.COLUMN_NAMES.GRAND_TOTAL] = grand_total_from_sheet

                total_non_sbo = 0
                item_details_json = rab.get('Item_Details_JSON', '{}')
                if item_details_json:
                    try:
                        item_details = json.loads(item_details_json)
                        has_item_data = any(key.startswith('Total_Harga_Item_') for key in item_details.keys())
                        if has_item_data:
                            for i in range(1, 201):
                                if item_details.get(f'Kategori_Pekerjaan_{i}') != 'PEKERJAAN SBO':
                                    total_non_sbo += float(item_details.get(f'Total_Harga_Item_{i}', 0))
                    except (json.JSONDecodeError, ValueError) as e:
                        print(f"Could not process item details for RAB {rab.get('Nomor Ulok')}: {e}")
                        total_non_sbo = 0

                final_total_non_sbo = total_non_sbo * 1.11

                if final_total_non_sbo == 0 and grand_total_from_sheet > 0:
                    rab['Grand Total Non-SBO'] = grand_total_from_sheet
                else:
                    rab['Grand Total Non-SBO'] = final_total_non_sbo

            return filtered_rabs
        except Exception as e:
            print(f"Error getting approved RABs: {e}")
            raise e

    def get_row_data_by_sheet(self, worksheet, row_index):
        try:
            records = worksheet.get_all_records()
            # Perbaikan krusial: ganti row_index - 1 menjadi row_index - 2
            # karena get_all_records() memulai dari baris 2, sedangkan row_index adalah nomor baris absolut
            if row_index > 1 and row_index <= len(records) + 1:
                return records[row_index - 2] 
            return {}
        except Exception as e:
            print(f"Error getting row data from {worksheet.title}: {e}")
            return {}

    def update_cell_by_sheet(self, worksheet, row_index, column_name, value):
        try:
            headers = worksheet.row_values(1)
            col_index = headers.index(column_name) + 1
            worksheet.update_cell(row_index, col_index, value)
            return True
        except Exception as e:
            print(f"Error updating cell [{row_index}, {column_name}] in {worksheet.title}: {e}")
            return False