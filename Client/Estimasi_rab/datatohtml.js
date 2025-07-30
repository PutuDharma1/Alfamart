// ==============
// KONFIGURASI
// ==============
const SPREADSHEET_ID = '1LA1TlhgltT2bqSN3H-LYasq9PtInVlqq98VPru8txoo';
const DATA_SHEET_NAME = 'Data_Jenis_Pekerjaan';

function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const dataSheet = ss.getSheetByName(DATA_SHEET_NAME);

    if (!dataSheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: `Sheet '${DATA_SHEET_NAME}' not found.` }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const allData = processDataSheet(dataSheet);

    const responseData = {
      categorizedSipilPrices: allData.sipil,
      categorizedMePrices: allData.me
    };

    return ContentService.createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error("Error in doGet:", error.toString(), error.stack);
    return ContentService.createTextOutput(JSON.stringify({ error: `Server error: ${error.message}` }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

function processDataSheet(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length < 2) {
    return { sipil: {}, me: {} }; // Kembalikan objek kosong jika tidak ada baris data
  }

  const headers = values[0].map(header => header.trim());
  const dataRows = values.slice(1);

  // Cari index untuk setiap kolom yang dibutuhkan, TERMASUK CABANG
  const colIndices = {
    'Lingkup_Pekerjaan': headers.indexOf('Lingkup_Pekerjaan'),
    'Category': headers.indexOf('Category'),
    'Jenis_Pekerjaan': headers.indexOf('Jenis_Pekerjaan'),
    'Satuan': headers.indexOf('Satuan'),
    'Harga_material': headers.indexOf('Harga_material'),
    'Harga_Upah': headers.indexOf('Harga_Upah'),
    'Cabang': headers.indexOf('Cabang') // <<< KOLOM BARU YANG SANGAT PENTING
  };
  
  // Validasi jika ada kolom penting yang hilang
  for (const key in colIndices) {
    if (colIndices[key] === -1) {
      // Lemparkan error agar lebih jelas saat debugging
      throw new Error(`Kolom wajib '${key}' tidak ditemukan di sheet '${sheet.getName()}'. Periksa kembali nama header Anda.`);
    }
  }

  const sipilResult = {};
  const meResult = {};

  dataRows.forEach(row => {
    const lingkupPekerjaan = row[colIndices['Lingkup_Pekerjaan']];
    const category = row[colIndices['Category']];
    const jenisPekerjaan = row[colIndices['Jenis_Pekerjaan']];
    
    // Lewati baris jika data penting kosong
    if (!lingkupPekerjaan || !category || !jenisPekerjaan) {
      return; 
    }

    // Buat objek item dengan semua data yang diperlukan
    const itemData = {
      "Jenis Pekerjaan": jenisPekerjaan,
      "Satuan": row[colIndices['Satuan']],
      "Harga Material": parseFloat(row[colIndices['Harga_material']]) || 0,
      "Harga Upah": parseFloat(row[colIndices['Harga_Upah']]) || 0,
      "Cabang": row[colIndices['Cabang']] // <<< TAMBAHKAN DATA CABANG KE SETIAP ITEM
    };

    if (lingkupPekerjaan === "Sipil") {
      if (!sipilResult[category]) {
        sipilResult[category] = [];
      }
      sipilResult[category].push(itemData);
    } else if (lingkupPekerjaan === "ME") {
      if (!meResult[category]) {
        meResult[category] = [];
      }
      meResult[category].push(itemData);
    }
  });
  
  return { sipil: sipilResult, me: meResult };
}

// Fungsi ini tetap bisa Anda gunakan untuk menguji dari editor Apps Script
function testDataProcessing() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dataSheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (dataSheet) {
    const processedData = processDataSheet(dataSheet);
    console.log(JSON.stringify(processedData, null, 2));
  } else {
    console.error(`Sheet '${DATA_SHEET_NAME}' not found for testing.`);
  }
}