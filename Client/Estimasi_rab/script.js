// --- Global Variable Declarations ---
let form;
let submitButton;
let messageDiv;
let grandTotalAmount;
let lingkupPekerjaanSelect;
let cabangSelect; // Variabel baru untuk dropdown cabang
let sipilTablesWrapper;
let meTablesWrapper;
let currentResetButton;
let categorizedPrices = {};
let pendingStoreCodes = [];
let approvedStoreCodes = [];
let rejectedSubmissionsList = [];

const sipilCategories = ["PEKERJAAN PERSIAPAN", "PEKERJAAN BOBOKAN / BONGKARAN", "PEKERJAAN TANAH", "PEKERJAAN PONDASI & BETON", "PEKERJAAN PASANGAN", "PEKERJAAN BESI", "PEKERJAAN KERAMIK", "PEKERJAAN PLUMBING", "PEKERJAAN SANITARY & ACECORIES", "PEKERJAAN ATAP", "PEKERJAAN KUSEN, PINTU & KACA", "PEKERJAAN FINISHING", "PEKERJAAN TAMBAHAN"];
const meCategories = ["INSTALASI", "FIXTURE", "PEKERJAAN TAMBAH DAYA LISTRIK"];

// --- Helper Functions ---
const formatRupiah = (number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(number);
const parseRupiah = (formattedString) => parseFloat(String(formattedString).replace(/Rp\s?|\./g, "").replace(/,/g, ".")) || 0;
const formatNumberWithSeparators = (num) => (num === null || isNaN(num)) ? '0' : new Intl.NumberFormat('id-ID').format(num);
const parseFormattedNumber = (str) => typeof str !== 'string' ? (Number(str) || 0) : (parseFloat(String(str).replace(/\./g, '')) || 0);

const handleCurrencyInput = (event) => {
    const input = event.target;
    let numericValue = input.value.replace(/[^0-9]/g, '');
    if (numericValue === '') {
        input.value = '';
        calculateTotalPrice(input);
        return;
    }
    const number = parseInt(numericValue, 10);
    input.value = formatNumberWithSeparators(number);
    calculateTotalPrice(input);
};


// --- Core Functions ---

/**
 * [MODIFIED] Mengambil data harga dari backend Python berdasarkan cabang dan lingkup pekerjaan.
 */
async function fetchAndPopulatePrices() {
    const selectedCabang = cabangSelect.value;
    const selectedScope = lingkupPekerjaanSelect.value;

    // Hapus semua baris yang ada dan reset total
    document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");
    updateAllRowNumbersAndTotals();

    if (!selectedCabang || !selectedScope) {
        messageDiv.style.display = 'none';
        return;
    }

    messageDiv.textContent = `Memuat data harga untuk Cabang ${selectedCabang} - ${selectedScope}...`;
    messageDiv.style.display = 'block';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';

    try {
        // Ganti URL ini jika server Flask Anda berjalan di alamat yang berbeda
        const response = await fetch(`http://127.0.0.1:5000/get-data?cabang=${selectedCabang}&lingkup=${selectedScope}`);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Gagal mengambil data: ${response.statusText}`);
        }

        const data = await response.json();

        // Simpan data ke variabel global berdasarkan lingkup
        if (selectedScope === 'Sipil') {
            categorizedPrices.categorizedSipilPrices = data;
        } else if (selectedScope === 'ME') {
            categorizedPrices.categorizedMePrices = data;
        }
        
        console.log(`Data harga untuk ${selectedScope} berhasil dimuat:`, data);
        messageDiv.style.display = 'none';
        
        // Perbarui opsi dropdown untuk baris yang mungkin sudah ada (seharusnya tidak ada, tapi untuk keamanan)
        refreshAllDropdowns();

    } catch (error) {
        console.error("Error fetching price data:", error);
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.style.backgroundColor = "#dc3545";
    }
}


const populateJenisPekerjaanOptionsForNewRow = (rowElement) => {
    const category = rowElement.dataset.category;
    const scope = rowElement.dataset.scope;
    const selectEl = rowElement.querySelector(".jenis-pekerjaan");

    if (!selectEl) return;

    if (!cabangSelect.value || !lingkupPekerjaanSelect.value) {
        selectEl.innerHTML = '<option value="">-- Pilih Cabang & Lingkup Pekerjaan Dulu --</option>';
        return;
    }
    
    // Pilih sumber data berdasarkan lingkup saat ini
    let dataSource = (scope === "Sipil") ? categorizedPrices.categorizedSipilPrices :
                     (scope === "ME") ? categorizedPrices.categorizedMePrices : {};

    // Ambil item dari kategori yang sesuai
    const itemsInCategory = dataSource ? (dataSource[category] || []) : [];

    if (itemsInCategory.length === 0) {
        selectEl.innerHTML = '<option value="">-- Tidak ada item pekerjaan --</option>';
        return;
    }

    selectEl.innerHTML = '<option value="">-- Pilih Jenis Pekerjaan --</option>';
    itemsInCategory.forEach(item => {
        const option = document.createElement("option");
        option.value = item["Jenis Pekerjaan"];
        option.textContent = item["Jenis Pekerjaan"];
        selectEl.appendChild(option);
    });
};

const autoFillPrices = (selectElement) => {
    const row = selectElement.closest("tr");
    if (!row) return;

    const selectedJenisPekerjaan = selectElement.value;
    const currentLingkupPekerjaan = lingkupPekerjaanSelect.value;
    const currentCategory = row.dataset.category;

    const volumeInput = row.querySelector(".volume");
    const materialPriceInput = row.querySelector(".harga-material");
    const upahPriceInput = row.querySelector(".harga-upah");
    const satuanInput = row.querySelector(".satuan");

    materialPriceInput.removeEventListener('input', handleCurrencyInput);
    upahPriceInput.removeEventListener('input', handleCurrencyInput);

    let selectedItem = null;
    let dataSource = (currentLingkupPekerjaan === "Sipil") ? categorizedPrices.categorizedSipilPrices : categorizedPrices.categorizedMePrices;
    
    // Temukan item yang dipilih dari data yang sudah dimuat
    if (dataSource && dataSource[currentCategory]) {
        selectedItem = dataSource[currentCategory].find(item => item["Jenis Pekerjaan"] === selectedJenisPekerjaan);
    }

    if (selectedItem) {
        if (selectedItem["Satuan"] === "Ls") {
            volumeInput.value = 1;
            volumeInput.readOnly = true;
        } else {
            volumeInput.value = "0.00";
            volumeInput.readOnly = false;
        }

        if (selectedItem["Harga Material"] === "Kondisional") {
            materialPriceInput.value = "0";
            materialPriceInput.readOnly = false;
            materialPriceInput.style.backgroundColor = "#fffde7";
            materialPriceInput.addEventListener('input', handleCurrencyInput);
        } else {
            materialPriceInput.value = formatNumberWithSeparators(selectedItem["Harga Material"]);
            materialPriceInput.readOnly = true;
            materialPriceInput.style.backgroundColor = "";
        }

        if (selectedItem["Harga Upah"] === "Kondisional") {
            upahPriceInput.value = "0";
            upahPriceInput.readOnly = false;
            upahPriceInput.style.backgroundColor = "#fffde7";
            upahPriceInput.addEventListener('input', handleCurrencyInput);
        } else {
            upahPriceInput.value = formatNumberWithSeparators(selectedItem["Harga Upah"]);
            upahPriceInput.readOnly = true;
            upahPriceInput.style.backgroundColor = "";
        }
        
        satuanInput.value = selectedItem["Satuan"];

    } else {
        volumeInput.value = 0;
        volumeInput.readOnly = false;
        materialPriceInput.value = "0";
        materialPriceInput.readOnly = true;
        materialPriceInput.style.backgroundColor = "";
        upahPriceInput.value = "0";
        upahPriceInput.readOnly = true;
        upahPriceInput.style.backgroundColor = "";
        satuanInput.value = "";
    }
    calculateTotalPrice(volumeInput);
};

const createBoQRow = (category, scope) => {
    const row = document.createElement("tr");
    row.classList.add("boq-item-row");
    row.dataset.category = category;
    row.dataset.scope = scope;
    row.innerHTML = `<td class="col-no"><span class="row-number"></span></td><td class="col-jenis-pekerjaan"><select class="jenis-pekerjaan form-control" name="Jenis_Pekerjaan_Item" required><option value="">-- Pilih --</option></select></td><td class="col-satuan"><input type="text" class="satuan form-control" name="Satuan_Item" required readonly /></td><td class="col-volume"><input type="text" class="volume form-control" name="Volume_Item" value="0.00" inputmode="decimal" oninput="this.value = this.value.replace(/[^0-9.]/g, '').replace(/(\\..*?)\\..*/g, '$1').replace(/(\\.\\d{2})\\d+/, '$1')" /></td><td class="col-harga"><input type="text" class="harga-material form-control" name="Harga_Material_Item" inputmode="numeric" required readonly /></td><td class="col-harga"><input type="text" class="harga-upah form-control" name="Harga_Upah_Item" inputmode="numeric" required readonly /></td><td class="col-harga"><input type="text" class="total-material form-control" disabled /></td><td class="col-harga"><input type="text" class="total-upah form-control" disabled /></td><td class="col-harga"><input type="text" class="total-harga form-control" disabled /></td><td class="col-aksi"><button type="button" class="delete-row-btn">Hapus</button></td>`;
    
    row.querySelector(".volume").addEventListener("input", (e) => calculateTotalPrice(e.target));
    row.querySelector(".delete-row-btn").addEventListener("click", () => { row.remove(); updateAllRowNumbersAndTotals(); });
    row.querySelector('.jenis-pekerjaan').addEventListener('change', (e) => autoFillPrices(e.target));
    return row;
};

const updateAllRowNumbersAndTotals = () => {
    document.querySelectorAll(".boq-table-body:not(.hidden)").forEach(tbody => {
        tbody.querySelectorAll(".boq-item-row").forEach((row, index) => {
            row.querySelector(".row-number").textContent = index + 1;
            calculateTotalPrice(row.querySelector(".volume"));
        });
        calculateSubTotal(tbody);
    });
    calculateGrandTotal();
};

const calculateSubTotal = (tbodyElement) => {
    let subTotal = 0;
    tbodyElement.querySelectorAll(".boq-item-row .total-harga").forEach(input => subTotal += parseRupiah(input.value));
    const subTotalAmountElement = tbodyElement.closest("table").querySelector(".sub-total-amount");
    if (subTotalAmountElement) subTotalAmountElement.textContent = formatRupiah(subTotal);
};

function calculateTotalPrice(inputElement) {
    const row = inputElement.closest("tr");
    if (!row) return;
    const volume = parseFloat(row.querySelector("input.volume").value) || 0;
    const material = parseFormattedNumber(row.querySelector("input.harga-material").value);
    const upah = parseFormattedNumber(row.querySelector("input.harga-upah").value);
    const totalMaterial = volume * material;
    const totalUpah = volume * upah;
    row.querySelector("input.total-material").value = formatRupiah(totalMaterial);
    row.querySelector("input.total-upah").value = formatRupiah(totalUpah);
    row.querySelector("input.total-harga").value = formatRupiah(totalMaterial + totalUpah);
    calculateSubTotal(row.closest(".boq-table-body"));
    calculateGrandTotal();
}

const calculateGrandTotal = () => {
    let total = 0;
    document.querySelectorAll(".boq-table-body:not(.hidden) .total-harga").forEach(input => total += parseRupiah(input.value));
    if (grandTotalAmount) grandTotalAmount.textContent = formatRupiah(total);
};

// Fungsi ini mungkin perlu penyesuaian besar tergantung bagaimana data revisi disimpan
const populateFormWithHistory = (data) => {
    console.log("Populating form with rejected data:", data);
    form.reset();
    document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");
    
    const lingkupPekerjaanValue = data['Lingkup_Pekerjaan'] || data['Lingkup Pekerjaan'];
    lingkupPekerjaanSelect.value = lingkupPekerjaanValue;
    lingkupPekerjaanSelect.dispatchEvent(new Event('change'));
    
    // ... (kode untuk mengisi field lain tetap sama)
};

// Fungsi submit form tidak perlu diubah, karena ia mengirim data, bukan mengambil
async function handleFormSubmit() {
    // ... (kode handleFormSubmit tetap sama)
}

function createTableStructure(categoryName, scope) {
    const tableWrapper = document.createElement('div');
    // ... (kode createTableStructure tetap sama)
    return tableWrapper;
}


/**
 * [MODIFIED] Fungsi inisialisasi utama
 */
async function initializePage() {
    form = document.getElementById("form");
    submitButton = document.getElementById("submit-button");
    messageDiv = document.getElementById("message");
    grandTotalAmount = document.getElementById("grand-total-amount");
    lingkupPekerjaanSelect = document.getElementById("lingkup_pekerjaan");
    cabangSelect = document.getElementById("cabang"); // Inisialisasi variabel
    sipilTablesWrapper = document.getElementById("sipil-tables-wrapper");
    meTablesWrapper = document.getElementById("me-tables-wrapper");
    currentResetButton = form.querySelector("button[type='reset']");

    messageDiv.textContent = 'Memuat data status...';
    messageDiv.style.display = 'block';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';

    // Buat struktur tabel kosong terlebih dahulu
    sipilTablesWrapper.innerHTML = '';
    meTablesWrapper.innerHTML = '';
    sipilCategories.forEach(category => sipilTablesWrapper.appendChild(createTableStructure(category, "Sipil")));
    meCategories.forEach(category => meTablesWrapper.appendChild(createTableStructure(category, "ME")));
    
    const PYTHON_API_BASE_URL = "https://buildingprocess-fld9.onrender.com";
    const userEmail = sessionStorage.getItem('loggedInUserEmail');

    // Hanya ambil data status pengajuan saat halaman dimuat
    try {
        if (userEmail) {
            const statusResponse = await fetch(`${PYTHON_API_BASE_URL}/api/check_status?email=${encodeURIComponent(userEmail)}`);
            const statusResult = await statusResponse.json();

            console.log("User submissions response:", statusResult);
            if (statusResult.rejected_submissions && statusResult.rejected_submissions.length > 0) {
                rejectedSubmissionsList = statusResult.rejected_submissions;
                const rejectedCodes = rejectedSubmissionsList.map(item => item.Lokasi).join(', ');
                messageDiv.innerHTML = `Ditemukan pengajuan yang ditolak untuk kode toko: <strong>${rejectedCodes}</strong>. Masukkan salah satu kode untuk revisi.`;
                messageDiv.style.backgroundColor = '#ffc107';
                messageDiv.style.color = 'black';
            } else {
                messageDiv.style.display = 'none';
            }
            if (statusResult.active_codes) {
                pendingStoreCodes = statusResult.active_codes.pending || [];
                approvedStoreCodes = statusResult.active_codes.approved || [];
            }
        } else {
             messageDiv.style.display = 'none';
        }
    } catch (error) {
        console.error("Gagal memuat data status awal:", error);
        messageDiv.textContent = "Gagal memuat data status. Mohon muat ulang halaman.";
        messageDiv.style.display = 'block';
        messageDiv.style.backgroundColor = '#dc3545';
    } finally {
        // Aktifkan dropdown setelah selesai
        lingkupPekerjaanSelect.disabled = false;
        cabangSelect.disabled = false;
    }
    
    // Event listener untuk memuat data revisi
    document.getElementById('lokasi')?.addEventListener('input', function() {
       // ... (kode ini tetap sama)
    });

    // Event listener untuk tombol tambah baris
    document.querySelectorAll(".add-row-btn").forEach(button => {
        button.addEventListener("click", () => {
            const category = button.dataset.category;
            const scope = button.dataset.scope;
            const targetTbody = document.querySelector(`.boq-table-body[data-category="${category}"][data-scope="${scope}"]`);
            if (targetTbody) {
                const newRow = createBoQRow(category, scope);
                targetTbody.appendChild(newRow);
                populateJenisPekerjaanOptionsForNewRow(newRow); // Isi opsi untuk baris baru
                updateAllRowNumbersAndTotals();
            }
        });
    });
    
    const refreshAllDropdowns = () => {
        document.querySelectorAll(".boq-table-body:not(.hidden) .boq-item-row").forEach(row => {
            populateJenisPekerjaanOptionsForNewRow(row);
            const jenisPekerjaanSelect = row.querySelector('.jenis-pekerjaan');
            jenisPekerjaanSelect.value = '';
            autoFillPrices(jenisPekerjaanSelect);
        });
    };
    
    // [MODIFIED] Event listener untuk dropdown lingkup pekerjaan
    lingkupPekerjaanSelect.addEventListener("change", () => {
        const selectedScope = lingkupPekerjaanSelect.value;
        sipilTablesWrapper.classList.toggle("hidden", selectedScope !== 'Sipil');
        meTablesWrapper.classList.toggle("hidden", selectedScope !== 'ME');
        fetchAndPopulatePrices(); // Panggil fungsi untuk mengambil data
    });
    
    // [MODIFIED] Event listener untuk dropdown cabang
    cabangSelect.addEventListener('change', fetchAndPopulatePrices);

    currentResetButton.addEventListener("click", () => {
        if (confirm("Apakah Anda yakin ingin mengulang dan mengosongkan semua isian form?")) {
            window.location.reload();
        }
    });

    submitButton.addEventListener("click", function(e) {
        e.preventDefault();
        handleFormSubmit();
    });
}

document.addEventListener("DOMContentLoaded", initializePage);