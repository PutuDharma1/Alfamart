// ==============
// KONFIGURASI
// ==============
const SPREADSHEET_ID = "1LA1TlhgltT2bqSN3H-LYasq9PtInVlqq98VPru8txoo";
const DATA_ENTRY_SHEET_NAME = "Form2";
const APPROVED_DATA_SHEET_NAME = "Form3";
const CABANG_SHEET_NAME = "Cabang";
const LOGIN_LOG_SHEET_NAME = "Log Login";

// --- PUSAT KONFIGURASI NAMA KOLOM ---
const COLUMN_NAMES = {
  STATUS: "Status",
  TIMESTAMP: "Timestamp",
  EMAIL_PEMBUAT: "Email_Pembuat",
  TANGGAL: "Tanggal",
  KOORDINATOR_APPROVER: "Persetujuan Koordinator",
  KOORDINATOR_APPROVAL_TIME: "Waktu Persetujuan Koordinator",
  MANAGER_APPROVER: "Pemberi Persetujuan",
  MANAGER_APPROVAL_TIME: "Waktu Persetujuan",
};

// --- PUSAT KONFIGURASI JABATAN & STATUS ---
const JABATAN = {
    SUPPORT: "BRANCH BUILDING SUPPORT",
    KOORDINATOR: "BRANCH BUILDING COORDINATOR",
    MANAGER: "BRANCH BUILDING & MAINTENANCE MANAGER"
};
const STATUS = {
    WAITING_FOR_COORDINATOR: "Menunggu Persetujuan Koordinator",
    REJECTED_BY_COORDINATOR: "Ditolak oleh Koordinator",
    WAITING_FOR_MANAGER: "Menunggu Persetujuan Manajer",
    REJECTED_BY_MANAGER: "Ditolak oleh Manajer",
    APPROVED: "Disetujui"
};
// -----------------------------------------

const DEBUG_EMAIL_RECIPIENT = ""; 

// ==================
// VARIABEL GLOBAL & VALIDASI
// ==================
const SPREADSHEET = SpreadsheetApp.openById(SPREADSHEET_ID);
const SHEET = SPREADSHEET.getSheetByName(DATA_ENTRY_SHEET_NAME);
const APPROVED_SHEET = SPREADSHEET.getSheetByName(APPROVED_DATA_SHEET_NAME);
const CABANG_SHEET = SPREADSHEET.getSheetByName(CABANG_SHEET_NAME);

if (!SHEET) throw new Error(`Sheet dengan nama "${DATA_ENTRY_SHEET_NAME}" tidak ditemukan.`);
if (!APPROVED_SHEET) throw new Error(`Sheet dengan nama "${APPROVED_DATA_SHEET_NAME}" tidak ditemukan.`);
if (!CABANG_SHEET) throw new Error(`Sheet dengan nama "${CABANG_SHEET_NAME}" tidak ditemukan.`);

// =========================================================================
// FUNGSI UTAMA (doGet & doPost)
// =========================================================================

const doPost = (request = {}) => {
    try {
        const { postData: { contents } = {} } = request;
        if (!contents) { throw new Error("Request tidak memiliki konten."); }
        const data = JSON.parse(contents);

        if (data.requestType === 'loginAttempt') {
            return logLoginAttempt(data);
        } else {
            const newRowIndex = appendToGoogleSheet(data);
            sendCoordinatorApprovalEmail(data, newRowIndex);
            return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Data submitted!" })).setMimeType(ContentService.MimeType.JSON);
        }
    } catch (error) {
        console.error(`Error in doPost:`, error.toString(), error.stack);
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: `Kesalahan pada server: ${error.message}` })).setMimeType(ContentService.MimeType.JSON);
    }
};

const doGet = (e) => {
    try {
        const { parameter } = e;
        if (parameter.action === 'checkUserStatus') {
            if (!parameter.email) return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Parameter email tidak ditemukan." })).setMimeType(ContentService.MimeType.JSON);
            return checkUserLastSubmission(parameter.email);
        }

        const { action, row, approver, level } = parameter;
        if (!action || !row || !approver || !level) {
            return createResponsePage({ title: 'Parameter Tidak Lengkap', message: 'Parameter URL tidak lengkap atau tidak valid.', themeColor: '#dc3545', icon: '⚠' });
        }

        const lock = LockService.getScriptLock();
        lock.waitLock(30000);

        try {
            const headers = SHEET.getRange(1, 1, 1, SHEET.getLastColumn()).getValues()[0];
            if (parseInt(row) > SHEET.getLastRow()) {
                return createResponsePage({ title: 'Data Tidak Ditemukan', message: 'Permintaan ini sepertinya sudah tidak ada atau telah dihapus.', themeColor: '#ffc107', icon: 'ⓘ' });
            }
            const dataRowValues = SHEET.getRange(parseInt(row), 1, 1, headers.length).getValues()[0];
            const data = headers.reduce((obj, header, i) => (obj[header] = dataRowValues[i], obj), {});

            const statusColIndex = headers.indexOf(COLUMN_NAMES.STATUS) + 1;
            const currentStatus = data[COLUMN_NAMES.STATUS];
            
            if (level === 'coordinator') {
                if (currentStatus !== STATUS.WAITING_FOR_COORDINATOR) {
                    return createResponsePage({ title: 'Tindakan Sudah Diproses', message: `Permintaan ini sudah ditindaklanjuti sebelumnya. Status saat ini: <strong>${currentStatus}</strong>.`, themeColor: '#ffc107', icon: 'ⓘ' });
                }
                
                if (action === 'approve') {
                    SHEET.getRange(parseInt(row), statusColIndex).setValue(STATUS.WAITING_FOR_MANAGER);
                    updateSheetCell(headers, row, COLUMN_NAMES.KOORDINATOR_APPROVER, approver);
                    updateSheetCell(headers, row, COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME, new Date());
                    
                    sendManagerApprovalEmail(data, row, approver);
                    return createResponsePage({ title: 'Persetujuan Diteruskan', message: 'Terima kasih. Persetujuan Anda telah dicatat dan permintaan diteruskan ke Manajer.', themeColor: '#28a745', icon: '✔' });

                } else if (action === 'reject') {
                    SHEET.getRange(parseInt(row), statusColIndex).setValue(STATUS.REJECTED_BY_COORDINATOR);
                    updateSheetCell(headers, row, COLUMN_NAMES.KOORDINATOR_APPROVER, approver);
                    updateSheetCell(headers, row, COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME, new Date());

                    sendRejectionNotificationEmail(data, approver, 'Koordinator');
                    return createResponsePage({ title: 'Permintaan Ditolak', message: 'Status permintaan telah diperbarui menjadi ditolak.', themeColor: '#dc3545', icon: '✖' });
                }
            }

            else if (level === 'manager') {
                 if (currentStatus !== STATUS.WAITING_FOR_MANAGER) {
                    return createResponsePage({ title: 'Tindakan Sudah Diproses', message: `Permintaan ini sudah ditindaklanjuti sebelumnya. Status saat ini: <strong>${currentStatus}</strong>.`, themeColor: '#ffc107', icon: 'ⓘ' });
                }

                if (action === 'approve') {
                    const approvalTime = new Date();
                    SHEET.getRange(parseInt(row), statusColIndex).setValue(STATUS.APPROVED);
                    updateSheetCell(headers, row, COLUMN_NAMES.MANAGER_APPROVER, approver);
                    updateSheetCell(headers, row, COLUMN_NAMES.MANAGER_APPROVAL_TIME, approvalTime);
                    
                    data[COLUMN_NAMES.STATUS] = STATUS.APPROVED;
                    data[COLUMN_NAMES.MANAGER_APPROVER] = approver;
                    data[COLUMN_NAMES.MANAGER_APPROVAL_TIME] = approvalTime;
                    data[COLUMN_NAMES.KOORDINATOR_APPROVER] = data[COLUMN_NAMES.KOORDINATOR_APPROVER];
                    data[COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME] = data[COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME];
                    copyToApprovedSheet(data);

                    sendFinalApprovalEmail(data);
                    return createResponsePage({ title: 'Persetujuan Berhasil', message: 'Tindakan Anda telah berhasil diproses. Notifikasi final telah dikirim.', themeColor: '#28a745', icon: '✔' });

                } else if (action === 'reject') {
                    SHEET.getRange(parseInt(row), statusColIndex).setValue(STATUS.REJECTED_BY_MANAGER);
                    updateSheetCell(headers, row, COLUMN_NAMES.MANAGER_APPROVER, approver);
                    updateSheetCell(headers, row, COLUMN_NAMES.MANAGER_APPROVAL_TIME, new Date());
                    
                    sendRejectionNotificationEmail(data, approver, 'Manajer');
                    return createResponsePage({ title: 'Permintaan Ditolak', message: 'Status permintaan telah diperbarui menjadi ditolak.', themeColor: '#dc3545', icon: '✖' });
                }
            }
            
            else {
                 return createResponsePage({ title: 'Level Tidak Valid', message: `Level persetujuan "${level}" tidak dikenali.`, themeColor: '#dc3545', icon: '⚠' });
            }

        } finally {
            lock.releaseLock();
        }
    } catch (error) {
        console.error("Error in doGet:", error.toString(), error.stack);
        return createResponsePage({ title: 'Terjadi Kesalahan Internal', message: `Maaf, terjadi kesalahan.<br><small>Detail: ${error.message}</small>`, themeColor: '#dc3545', icon: '⚠' });
    }
};

// =========================================================================
// FUNGSI INTI & PEMBANTU
// =========================================================================

function appendToGoogleSheet(data) {
    data[COLUMN_NAMES.TIMESTAMP] = new Date();
    
    const headers = SHEET.getRange(1, 1, 1, SHEET.getLastColumn()).getValues()[0];
    if (headers.indexOf(COLUMN_NAMES.STATUS) === -1) throw new Error(`Kolom status "${COLUMN_NAMES.STATUS}" tidak ditemukan.`);
    
    const rowData = headers.map(header => {
        if (header === COLUMN_NAMES.STATUS) return STATUS.WAITING_FOR_COORDINATOR;
        if (header === COLUMN_NAMES.TANGGAL) return data[COLUMN_NAMES.TIMESTAMP];
        return data[header] !== undefined ? data[header] : "";
    });
    
    SHEET.appendRow(rowData);
    return SHEET.getLastRow();
}

function copyToApprovedSheet(data) {
    const headers = APPROVED_SHEET.getRange(1, 1, 1, APPROVED_SHEET.getLastColumn()).getValues()[0];
    const rowData = headers.map(header => data[header] !== undefined ? data[header] : "");
    APPROVED_SHEET.appendRow(rowData);
}

function updateSheetCell(headers, row, columnName, value) {
    const colIndex = headers.indexOf(columnName);
    if (colIndex > -1) {
        SHEET.getRange(parseInt(row), colIndex + 1).setValue(value);
    }
}

// =========================================================================
// FUNGSI PENGIRIMAN EMAIL
// =========================================================================

function sendCoordinatorApprovalEmail(formData, rowIndex) {
    const recipient = DEBUG_EMAIL_RECIPIENT || getEmailByJabatan(formData.Cabang, JABATAN.KOORDINATOR);
    if (!recipient) {
        console.error(`Email Koordinator untuk cabang ${formData.Cabang} tidak ditemukan.`);
        return;
    }
    
    const webAppUrl = ScriptApp.getService().getUrl();
    const approvalUrl = `${webAppUrl}?action=approve&row=${rowIndex}&approver=${encodeURIComponent(recipient)}&level=coordinator`;
    const rejectionUrl = `${webAppUrl}?action=reject&row=${rowIndex}&approver=${encodeURIComponent(recipient)}&level=coordinator`;
    
    const subject = `[TAHAP 1: PERLU PERSETUJUAN] RAB Proyek: ${formData.Proyek || 'N/A'} (${formData.Lokasi || 'N/A'})`;
    const emailBodyHtml = createApprovalEmailBody('Koordinator', formData, approvalUrl, rejectionUrl);
    const pdfBlob = createPdfBlob(formData);

    GmailApp.sendEmail(recipient, subject, "", { htmlBody: emailBodyHtml, attachments: [pdfBlob] });
    console.log(`Approval email sent to Coordinator: ${recipient}`);
}

function sendManagerApprovalEmail(formData, rowIndex, coordinatorEmail) {
    const recipient = DEBUG_EMAIL_RECIPIENT || getEmailByJabatan(formData.Cabang, JABATAN.MANAGER);
    if (!recipient) {
        console.error(`Email Manajer untuk cabang ${formData.Cabang} tidak ditemukan.`);
        return;
    }

    const webAppUrl = ScriptApp.getService().getUrl();
    const approvalUrl = `${webAppUrl}?action=approve&row=${rowIndex}&approver=${encodeURIComponent(recipient)}&level=manager`;
    const rejectionUrl = `${webAppUrl}?action=reject&row=${rowIndex}&approver=${encodeURIComponent(recipient)}&level=manager`;

    const subject = `[TAHAP 2: PERLU PERSETUJUAN] RAB Proyek: ${formData.Proyek || 'N/A'} (${formData.Lokasi || 'N/A'})`;
    const emailBodyHtml = createApprovalEmailBody('Manajer', formData, approvalUrl, rejectionUrl, `Permintaan ini telah disetujui sebelumnya oleh Koordinator: ${coordinatorEmail}.`);
    
    const approvalDetails = {
        coordinator: { email: coordinatorEmail, time: new Date() }
    };
    const pdfBlob = createPdfBlob(formData, approvalDetails);
    
    GmailApp.sendEmail(recipient, subject, "", { htmlBody: emailBodyHtml, attachments: [pdfBlob] });
    console.log(`Approval email sent to Manager: ${recipient}`);
}

function sendRejectionNotificationEmail(formData, approver, level) {
    const creatorEmail = formData[COLUMN_NAMES.EMAIL_PEMBUAT];
    if (!creatorEmail) return;

    const subject = `[DITOLAK] Pengajuan RAB Proyek: ${formData.Proyek || 'N/A'} (${formData.Lokasi || 'N/A'})`;
    const emailBodyHtml = `
        <p>Yth. Bapak/Ibu,</p>
        <p>Pengajuan RAB untuk proyek <strong>${formData.Proyek || 'N/A'}</strong> di lokasi/toko <strong>${formData.Lokasi || 'N/A'}</strong> telah <strong>DITOLAK</strong> oleh ${level} (${approver}).</p>
        <p>Silakan periksa kembali data Anda di sistem dan ajukan kembali jika diperlukan.</p>
        <p>Terima kasih.</p><p><em>--- Email otomatis.---</em></p>`;
    
    GmailApp.sendEmail(creatorEmail, subject, "", { htmlBody: emailBodyHtml });
}

function sendFinalApprovalEmail(formData) {
    const creatorEmail = formData[COLUMN_NAMES.EMAIL_PEMBUAT];
    if (!creatorEmail) return;

    const ccList = [];
    const coordinatorEmail = formData[COLUMN_NAMES.KOORDINATOR_APPROVER];
    const managerEmail = formData[COLUMN_NAMES.MANAGER_APPROVER];

    if (coordinatorEmail) {
        ccList.push(coordinatorEmail);
    }
    if (managerEmail) {
        ccList.push(managerEmail);
    }

    const subject = `[DISETUJUI] Pengajuan RAB Proyek: ${formData.Proyek || 'N/A'} (${formData.Lokasi || 'N/A'})`;
    const emailBodyHtml = `
        <p>Yth. Bapak/Ibu,</p>
        <p>Kabar baik! Pengajuan RAB untuk proyek <strong>${formData.Proyek || 'N/A'}</strong> di lokasi/toko <strong>${formData.Lokasi || 'N/A'}</strong> telah <strong>DISETUJUI</strong> sepenuhnya.</p>
        <p>Dokumen RAB final terlampir untuk arsip Anda.</p>
        <p>Terima kasih.</p><p><em>--- Email otomatis.---</em></p>`;
    
    const approvalDetails = {
        coordinator: { email: formData[COLUMN_NAMES.KOORDINATOR_APPROVER], time: formData[COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME] },
        manager: { email: formData[COLUMN_NAMES.MANAGER_APPROVER], time: formData[COLUMN_NAMES.MANAGER_APPROVAL_TIME] }
    };
    const pdfBlob = createPdfBlob(formData, approvalDetails);
    
    const emailOptions = {
        htmlBody: emailBodyHtml,
        attachments: [pdfBlob]
    };

    if (ccList.length > 0) {
        emailOptions.cc = ccList.join(',');
    }
    
    GmailApp.sendEmail(creatorEmail, subject, "", emailOptions);
    console.log(`Final approval email sent to: ${creatorEmail}, CC: ${emailOptions.cc || 'None'}`);
}


// =========================================================================
// FUNGSI TEMPLATE & UTILITAS
// =========================================================================

function createApprovalEmailBody(level, formData, approvalUrl, rejectionUrl, additionalInfo = '') {
    return `
      <!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;font-size:14px;line-height:1.6;}.approval-section{text-align:center;margin:30px 0;padding-top:20px;border-top:1px solid #eee;}.approval-button{text-decoration:none;color:#fff!important;padding:12px 25px;border-radius:5px;font-size:16px;font-weight:bold;margin:0 10px;display:inline-block;}.approve-btn{background-color:#28a745;}.reject-btn{background-color:#dc3545;}</style></head>
      <body>
        <p>Yth. Bapak/Ibu ${level},</p>
        <p>Dokumen RAB untuk proyek <strong>${formData.Proyek || 'N/A'}</strong> di lokasi/toko <strong>${formData.Lokasi || 'N/A'}</strong> memerlukan tinjauan dan persetujuan Anda.</p>
        <p>Silakan periksa detailnya pada file PDF yang terlampir.</p>
        ${additionalInfo ? `<p style="font-style: italic; color: #555;">${additionalInfo}</p>` : ''}
        <div class="approval-section">
          <p style="font-size:16px;font-weight:bold;">TINDAKAN PERSETUJUAN</p>
          <p>Pilih salah satu tindakan di bawah ini:</p><br>
          <a href="${approvalUrl}" class="approval-button approve-btn">SETUJUI</a>
          <a href="${rejectionUrl}" class="approval-button reject-btn">TOLAK</a>
        </div>
        <p>Terima kasih.</p><p><em>--- Email ini dibuat secara otomatis.---</em></p>
      </body></html>`;
}

function createPdfBlob(formData, approvalDetails = {}) {
    const html = populateHtmlTemplate(formData, approvalDetails);
    return HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(`RAB_${formData.Proyek || 'NoProyek'}_${new Date().getTime()}.pdf`);
}

function getEmailByJabatan(branchName, jabatan) {
    if (!branchName || !jabatan) return null;
    const data = CABANG_SHEET.getDataRange().getValues();
    const headers = data[0];
    const branchNameCol = headers.indexOf('CABANG');
    const emailPicCol = headers.indexOf('EMAIL_SAT');
    const jabatanCol = headers.indexOf('JABATAN');

    if (branchNameCol === -1 || emailPicCol === -1 || jabatanCol === -1) {
      console.error("Kolom CABANG, EMAIL_SAT, atau JABATAN tidak ditemukan di sheet 'Cabang'");
      return null;
    }

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const currentBranch = (row[branchNameCol] || '').toString().trim().toLowerCase();
        const targetBranch = branchName.trim().toLowerCase();
        const currentJabatan = (row[jabatanCol] || '').toString().trim().toUpperCase();
        
        if (currentBranch === targetBranch && currentJabatan === jabatan.toUpperCase()) {
            const email = (row[emailPicCol] || '').toString().trim();
            if (email) return email;
        }
    }
    console.warn(`Email untuk Jabatan '${jabatan}' di Cabang '${branchName}' tidak ditemukan.`);
    return null;
}

// --- FUNGSI BARU UNTUK MENCARI NAMA ---
function getNamaLengkapByEmail(email) {
    if (!email) return "";
    const data = CABANG_SHEET.getDataRange().getValues();
    const headers = data[0];
    const emailCol = headers.indexOf('EMAIL_SAT');
    const namaCol = headers.indexOf('NAMA LENGKAP');

    if (emailCol === -1 || namaCol === -1) {
        console.error("Kolom 'EMAIL_SAT' atau 'NAMA LENGKAP' tidak ditemukan di sheet 'Cabang'.");
        return "";
    }
    
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const emailDiSheet = (row[emailCol] || '').toString().trim().toLowerCase();
        if (emailDiSheet === email.trim().toLowerCase()) {
            return (row[namaCol] || '').toString().trim();
        }
    }
    console.warn(`Nama lengkap untuk email ${email} tidak ditemukan.`);
    return "";
}

// --- FUNGSI DIPERBARUI UNTUK MENAMPILKAN NAMA, EMAIL, DAN WAKTU ---
function createSignatureBlock(approverName, approverEmail, approvalTime, jabatan) {
    const formattedTime = approvalTime ? new Date(approvalTime).toLocaleString('id-ID', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Waktu tidak tersedia';
    
    const nameDisplay = approverName ? `<strong>${approverName}</strong><br>` : '';

    return `
        <div style="margin-top: -45px; margin-bottom: 5px; font-size: 9px; line-height: 1.4;">
            <div style="color: #28a745; font-weight: bold;">Disetujui oleh:</div>
            <div style="color: #555;">
                ${nameDisplay}
                ${approverEmail}<br>
                Pada: ${formattedTime}
            </div>
        </div>
        <span style="font-weight: normal;">${jabatan}</span>`;
}


function populateHtmlTemplate(data, approvalDetails = {}) {
    const sipilCategories = ["PEKERJAAN PERSIAPAN", "PEKERJAAN BOBOKAN / BONGKARAN", "PEKERJAAN TANAH", "PEKERJAAN PONDASI & BETON", "PEKERJAAN PASANGAN", "PEKERJAAN BESI", "PEKERJAAN KERAMIK", "PEKERJAAN PLUMBING", "PEKERJAAN SANITARY & ACECORIES", "PEKERJAAN ATAP", "PEKERJAAN KUSEN, PINTU & KACA", "PEKERJAAN FINISHING", "PEKERJAAN TAMBAHAN"];
    const meCategories = ["INSTALASI", "FIXTURE"];
    const groupedItems = {};
    let grandTotalRp = 0;

    for (let i = 1; i <= 50; i++) {
        if (data[`Jenis_Pekerjaan_${i}`] && data[`Kategori_Pekerjaan_${i}`]) {
            const kategori = data[`Kategori_Pekerjaan_${i}`];
            if (!groupedItems[kategori]) groupedItems[kategori] = [];
            
            const item = {
                jenisPekerjaan: data[`Jenis_Pekerjaan_${i}`],
                satuan: data[`Satuan_Item_${i}`],
                volume: data[`Volume_Item_${i}`],
                hargaMaterial: data[`Harga_Material_Item_${i}`],
                hargaUpah: data[`Harga_Upah_Item_${i}`],
                totalMaterial: data[`Total_Material_Item_${i}`],
                totalUpah: data[`Total_Upah_Item_${i}`],
                totalHarga: data[`Total_Harga_Item_${i}`],
            };
            groupedItems[kategori].push(item);
            grandTotalRp += parseFloat(item.totalHarga) || 0;
        }
    }

    const lingkupPekerjaan = data.Lingkup_Pekerjaan;
    const categoriesToDisplay = (lingkupPekerjaan === 'Sipil') ? sipilCategories : (lingkupPekerjaan === 'ME') ? meCategories : Object.keys(groupedItems);
    
    let tablesHtml = '';
    categoriesToDisplay.forEach((category, categoryIndex) => {
        const items = groupedItems[category];
        if (items && items.length > 0) {
            let catSubTotalMaterial = 0, catSubTotalUpah = 0, catSubTotalHarga = 0;
            const itemRowsHtml = items.map((item, index) => {
                catSubTotalMaterial += parseFloat(item.totalMaterial) || 0;
                catSubTotalUpah += parseFloat(item.totalUpah) || 0;
                catSubTotalHarga += parseFloat(item.totalHarga) || 0;
                return `<tr><td>${index + 1}</td><td style="text-align: left;">${item.jenisPekerjaan || ''}</td><td>${item.satuan || ''}</td><td>${(parseFloat(item.volume) || 0).toFixed(2)}</td><td style="text-align: right;">${(parseFloat(item.hargaMaterial) || 0).toLocaleString('id-ID')}</td><td style="text-align: right;">${(parseFloat(item.hargaUpah) || 0).toLocaleString('id-ID')}</td><td style="text-align: right;">${(parseFloat(item.totalMaterial) || 0).toLocaleString('id-ID')}</td><td style="text-align: right;">${(parseFloat(item.totalUpah) || 0).toLocaleString('id-ID')}</td><td style="text-align: right; font-weight:bold;">${(parseFloat(item.totalHarga) || 0).toLocaleString('id-ID')}</td></tr>`;
            }).join('');
            const subTotalRowHtml = `<tr class="total-row"><td colspan="6" style="text-align: right; font-weight: bold;">SUB TOTAL</td><td style="text-align: right; font-weight: bold;">${catSubTotalMaterial.toLocaleString('id-ID')}</td><td style="text-align: right; font-weight: bold;">${catSubTotalUpah.toLocaleString('id-ID')}</td><td class="total-amount-cell" style="text-align: right; font-weight: bold;">${catSubTotalHarga.toLocaleString('id-ID')}</td></tr>`;
            tablesHtml += `<h2 style="font-size: 14px; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-top: 20px; margin-bottom: 10px; font-weight:bold;">${String.fromCharCode(65 + categoryIndex)}. ${category}</h2><div class="price-table-container"><table class="price-table"><thead><tr><th rowspan="2" style="width: 3%;">NO.</th><th rowspan="2">JENIS PEKERJAAN</th><th rowspan="2" style="width: 5%;">SATUAN</th><th rowspan="2" style="width: 5%;">VOLUME</th><th colspan="2">HARGA SATUAN (Rp)</th><th colspan="2">TOTAL HARGA (Rp)</th><th style="width: 12%;">TOTAL HARGA (Rp)</th></tr><tr><th>a</th><th>Material (b)</th><th>Upah (c)</th><th>Material (d=a*b)</th><th>Upah (e=a*c)</th><th>(f=d+e)</th></tr></thead><tbody>${itemRowsHtml}${subTotalRowHtml}</tbody></table></div>`;
        }
    });

    const ppn = grandTotalRp * 0.11;
    const finalGrandTotal = grandTotalRp + ppn;
    const grandTotalHtml = `<table style="margin-top: 20px; width: 50%; float: right; border: none; font-size: 10px;"><tbody><tr class="total-row"><td style="border:none; text-align: right; font-weight: bold;">TOTAL (Rp)</td><td style="background-color:#e0ffff; border:1px solid #ddd; text-align: right; font-weight: bold;">${grandTotalRp.toLocaleString('id-ID')}</td></tr><tr class="total-row"><td style="border:none; text-align: right; font-weight: bold;">PPN 11% (Rp)</td><td style="background-color:#e0ffff; border:1px solid #ddd; text-align: right; font-weight: bold;">${ppn.toLocaleString('id-ID')}</td></tr><tr class="total-row"><td style="border:none; text-align: right; font-weight: bold;">GRAND TOTAL (Rp)</td><td style="background-color:#e0ffff; border:1px solid #ddd; text-align: right; font-weight: bold;">${finalGrandTotal.toLocaleString('id-ID')}</td></tr></tbody></table><div style="clear: both;"></div>`;
    
    let template = `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4;color:#333;font-size:10px;}.container{background-color:#fff;padding:10mm 8mm;width:210mm;min-height:297mm;box-sizing:border-box;margin:0 auto;}.header-company p{margin:0;font-size:12px;font-weight:700;}.header-title h1{font-size:18px;margin:20px 0;}.section-info table{width:100%;font-size:11px;}.price-table{width:100%;border-collapse:collapse;font-size:10px;}.price-table th,.price-table td{border:1px solid #ddd;padding:5px;text-align:center;}.price-table th{background-color:#e0ffff;}.price-table td:nth-child(2){text-align:left;}.signatures{display:flex;justify-content:space-around;margin-top:50px;text-align:center;page-break-inside:avoid;}.signature-box p{margin:0;padding-top:5px;font-size:11px;}.signature-line{width:80%;height:1px;background-color:#333;margin-top:60px;margin-bottom:5px;}</style></head><body>
      <div class="container">
        <div class="header-company"><p>PT. SUMBER ALFARIA TRIJAYA, Tbk</p><p>BUILDING & MAINTENANCE DEPT</p><p>CABANG: ${data.Cabang || ''}</p></div>
        <div class="header-title" style="text-align:center;"><h1>REKAPITULASI RENCANA ANGGARAN BIAYA</h1></div>
        <div class="section-info">
          <table style="width:100%; border-collapse:collapse;">
             <tr><td style="width:30%;">LOKASI</td><td style="width:2%;">:</td><td>${data.Lokasi || ''}</td></tr>
             <tr><td>PROYEK</td><td>:</td><td>${data.Proyek || ''}</td></tr>
             <tr><td>LINGKUP PEKERJAAN</td><td>:</td><td>${data.Lingkup_Pekerjaan || ''}</td></tr>
             <tr><td>LUAS BANGUNAN</td><td>:</td><td>${data.Luas_Bangunan || ''} m²</td></tr>
             <tr><td>LUAS TERBANGUNAN</td><td>:</td><td>${data.Luas_Terbangunan || ''} m²</td></tr>
             <tr><td>LUAS AREA TERBUKA/AREA PARKIR</td><td>:</td><td>${data.Luas_Area_Terbuka_Area_Parkir || ''} m²</td></tr>
             <tr><td>LUAS AREA SALES</td><td>:</td><td>${data.Luas_Area_Sales || ''} m²</td></tr>
             <tr><td>LUAS GUDANG</td><td>:</td><td>${data.Luas_Gudang || ''} m²</td></tr>
             <tr><td>TANGGAL PENGAJUAN</td><td>:</td><td>${data.Timestamp ? new Date(data.Timestamp).toLocaleDateString('id-ID', {day:'2-digit',month:'long',year:'numeric'}) : ''}</td></tr>
          </table>
        </div>
        ${tablesHtml}${grandTotalHtml}
        <div class="signatures">
          <div class="signature-box"><p>Dibuat</p><div class="signature-line"></div><p><span id="dibuatSignature"></span></p></div>
          <div class="signature-box"><p>Mengetahui</p><div class="signature-line"></div><p><span id="mengetahuiSignature"></span></p></div>
          <div class="signature-box"><p>Menyetujui</p><div class="signature-line"></div><p><span id="menyetujuiSignature"></span></p></div>
        </div>
      </div>
    </body></html>`;

    const replaceContentById = (html, id, value) => html.replace(new RegExp(`(<span\\s+id="${id}">)[^<]*(<\\/span>)`), `$1${value || ''}$2`);

    template = replaceContentById(template, 'dibuatSignature', JABATAN.SUPPORT);

    // --- PERUBAHAN LOGIKA: Memanggil getNamaLengkapByEmail ---
    const coordinatorApproverEmail = approvalDetails.coordinator?.email || data[COLUMN_NAMES.KOORDINATOR_APPROVER];
    if (coordinatorApproverEmail) {
        const time = approvalDetails.coordinator?.time || data[COLUMN_NAMES.KOORDINATOR_APPROVAL_TIME];
        const name = getNamaLengkapByEmail(coordinatorApproverEmail);
        template = replaceContentById(template, 'mengetahuiSignature', createSignatureBlock(name, coordinatorApproverEmail, time, JABATAN.KOORDINATOR));
    } else {
        template = replaceContentById(template, 'mengetahuiSignature', JABATAN.KOORDINATOR);
    }

    const managerApproverEmail = approvalDetails.manager?.email || data[COLUMN_NAMES.MANAGER_APPROVER];
    if (managerApproverEmail) {
        const time = approvalDetails.manager?.time || data[COLUMN_NAMES.MANAGER_APPROVAL_TIME];
        const name = getNamaLengkapByEmail(managerApproverEmail);
        template = replaceContentById(template, 'menyetujuiSignature', createSignatureBlock(name, managerApproverEmail, time, JABATAN.MANAGER));
    } else {
        template = replaceContentById(template, 'menyetujuiSignature', JABATAN.MANAGER);
    }
    
    return template;
}

function logLoginAttempt(data) {
    try {
        let logSheet = SPREADSHEET.getSheetByName(LOGIN_LOG_SHEET_NAME);
        if (!logSheet) {
            logSheet = SPREADSHEET.insertSheet(LOGIN_LOG_SHEET_NAME);
            logSheet.appendRow(['Timestamp', 'Username (Email)', 'Password (Cabang)', 'Status Login']);
        }
        const newRow = [new Date(), data.username || '', data.cabang || '', data.status || 'Unknown'];
        logSheet.appendRow(newRow);
        return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Login attempt logged." })).setMimeType(ContentService.MimeType.JSON);
    } catch (e) {
        console.error("Gagal mencatat log login:", e.toString());
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: `Gagal mencatat log: ${e.message}` })).setMimeType(ContentService.MimeType.JSON);
    }
}

function checkUserLastSubmission(email) {
    const headers = SHEET.getRange(1, 1, 1, SHEET.getLastColumn()).getValues()[0];
    const emailColIndex = headers.indexOf(COLUMN_NAMES.EMAIL_PEMBUAT);
    const statusColIndex = headers.indexOf(COLUMN_NAMES.STATUS);
    if (emailColIndex === -1 || statusColIndex === -1) { return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Kolom Email/Status tidak ditemukan." })).setMimeType(ContentService.MimeType.JSON); }
    
    const allData = SHEET.getDataRange().getValues();
    for (let i = allData.length - 1; i >= 1; i--) {
        const row = allData[i];
        if (row[emailColIndex] && row[emailColIndex].toString().trim() === email) {
            const lastStatus = row[statusColIndex] ? row[statusColIndex].toString().trim() : '';
            const responseData = { status: lastStatus, data: null };
            if (lastStatus === STATUS.REJECTED_BY_COORDINATOR || lastStatus === STATUS.REJECTED_BY_MANAGER) {
                const rowData = {};
                headers.forEach((header, index) => { rowData[header.replace(/ /g, "_")] = row[index]; });
                responseData.data = rowData;
            }
            return ContentService.createTextOutput(JSON.stringify(responseData)).setMimeType(ContentService.MimeType.JSON);
        }
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "No Data" })).setMimeType(ContentService.MimeType.JSON);
}

function createResponsePage(details) {
    const { title, message, themeColor, icon } = details;
    const logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Alfamart_logo.svg';
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; background-color: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: #4b5563; } .card { background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); padding: 40px; text-align: center; max-width: 450px; width: 90%; border-top: 5px solid ${themeColor}; } .logo { max-width: 180px; margin-bottom: 24px; } .icon { font-size: 48px; line-height: 1; color: ${themeColor}; } h1 { font-size: 24px; font-weight: 600; margin-top: 16px; margin-bottom: 8px; color: #1f2937; } p { font-size: 16px; line-height: 1.6; margin-bottom: 24px; } .footer { font-size: 12px; color: #9ca3af; } small { color: #6b7280; } </style></head><body><div class="card"><img src="${logoUrl}" alt="Logo Alfamart" class="logo"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p><div class="footer">Anda bisa menutup halaman ini.</div></div></body></html>`;
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}