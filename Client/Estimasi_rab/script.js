// --- Global Variable Declarations ---
let form;
let submitButton;
let messageDiv;
let grandTotalAmount;
let lingkupPekerjaanSelect;
let cabangSelect;
let sipilTablesWrapper;
let meTablesWrapper;
let currentResetButton;
let categorizedPrices = {};
let pendingStoreCodes = [];
let approvedStoreCodes = [];
let rejectedSubmissionsList = [];
let originalFormData = null; // Variabel baru untuk menyimpan data asli saat revisi

const sipilCategories = ["PEKERJAAN PERSIAPAN", "PEKERJAAN BOBOKAN / BONGKARAN", "PEKERJAAN TANAH", "PEKERJAAN PONDASI & BETON", "PEKERJAAN PASANGAN", "PEKERJAAN BESI", "PEKERJAAN KERAMIK", "PEKERJAAN PLUMBING", "PEKERJAAN SANITARY & ACECORIES", "PEKERJAAN ATAP", "PEKERJAAN KUSEN, PINTU & KACA", "PEKERJAAN FINISHING", "PEKERJAAN TAMBAHAN"];
const meCategories = ["INSTALASI", "FIXTURE", "PEKERJAAN TAMBAH DAYA LISTRIK"];
const PYTHON_API_BASE_URL = "https://alfamart.onrender.com";

// --- Helper Functions ---
const formatRupiah = (number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(number);
const parseRupiah = (formattedString) => parseFloat(String(formattedString).replace(/Rp\s?|\./g, "").replace(/,/g, ".")) || 0;
const formatNumberWithSeparators = (num) => (num === null || isNaN(num)) ? '0' : new Intl.NumberFormat('id-ID').format(num);
const parseFormattedNumber = (str) => typeof str !== 'string' ? (Number(str) || 0) : (parseFloat(String(str).replace(/\./g, '').replace(/,/g, '.')) || 0);

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

// --- FUNGSI BARU UNTUK MENGUMPULKAN DATA FORM SAAT INI ---
function getCurrentFormData() {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    let itemIndex = 1;
    document.querySelectorAll(".boq-table-body:not(.hidden) .boq-item-row").forEach(row => {
        const jenisPekerjaan = row.querySelector('.jenis-pekerjaan').value;
        const volume = parseFloat(row.querySelector('.volume').value) || 0;

        if (jenisPekerjaan && volume > 0) {
            data[`Kategori_Pekerjaan_${itemIndex}`] = row.dataset.category;
            data[`Jenis_Pekerjaan_${itemIndex}`] = jenisPekerjaan;
            data[`Satuan_Item_${itemIndex}`] = row.querySelector('.satuan').value;
            data[`Volume_Item_${itemIndex}`] = volume;
            data[`Harga_Material_Item_${itemIndex}`] = parseFormattedNumber(row.querySelector('.harga-material').value);
            data[`Harga_Upah_Item_${itemIndex}`] = parseFormattedNumber(row.querySelector('.harga-upah').value);
            itemIndex++;
        }
    });
    return JSON.stringify(data); // Konversi ke string untuk perbandingan mudah
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
    
    const dataSource = (scope === "Sipil") ? categorizedPrices.categorizedSipilPrices : (scope === "ME") ? categorizedPrices.categorizedMePrices : {};
    const itemsInCategory = dataSource ? (dataSource[category] || []) : [];

    selectEl.innerHTML = '<option value="">-- Pilih Jenis Pekerjaan --</option>';

    if (itemsInCategory.length > 0) {
        itemsInCategory.forEach(item => {
            const option = document.createElement("option");
            option.value = item["Jenis Pekerjaan"];
            option.textContent = item["Jenis Pekerjaan"];
            selectEl.appendChild(option);
        });
    } else {
        selectEl.innerHTML = '<option value="">-- Tidak ada item --</option>';
    }
};

const autoFillPrices = (selectElement) => {
    const row = selectElement.closest("tr");
    if (!row) return;

    const selectedJenisPekerjaan = selectElement.value;
    const currentCategory = row.dataset.category;
    const currentLingkupPekerjaan = lingkupPekerjaanSelect.value;
    
    if (!selectedJenisPekerjaan) {
        const inputs = row.querySelectorAll('input');
        inputs.forEach(input => {
            if (input.classList.contains('volume')) input.value = "0.00";
            else if(input.type === 'text') input.value = "0";
            if (input.classList.contains('harga-material') || input.classList.contains('harga-upah')) {
                input.readOnly = true;
                input.style.backgroundColor = "";
            }
        });
        row.querySelector('.satuan').value = '';
        calculateTotalPrice(row.querySelector(".volume"));
        return;
    }

    const volumeInput = row.querySelector(".volume");
    const materialPriceInput = row.querySelector(".harga-material");
    const upahPriceInput = row.querySelector(".harga-upah");
    const satuanInput = row.querySelector(".satuan");

    materialPriceInput.removeEventListener('input', handleCurrencyInput);
    upahPriceInput.removeEventListener('input', handleCurrencyInput);

    let selectedItem = null;
    let dataSource = (currentLingkupPekerjaan === "Sipil") ? categorizedPrices.categorizedSipilPrices : categorizedPrices.categorizedMePrices;
    if (dataSource && dataSource[currentCategory]) {
        selectedItem = dataSource[currentCategory].find(item => item["Jenis Pekerjaan"] === selectedJenisPekerjaan);
    }

    if (selectedItem) {
        volumeInput.value = selectedItem["Satuan"] === "Ls" ? "1.00" : "0.00";
        satuanInput.value = selectedItem["Satuan"];

        const setupPriceInput = (input, price) => {
            input.readOnly = price !== "Kondisional";
            input.value = price === "Kondisional" ? "0" : formatNumberWithSeparators(price);
            input.style.backgroundColor = price === "Kondisional" ? "#fffde7" : "";
            if (price === "Kondisional") {
                input.addEventListener('input', handleCurrencyInput);
            }
        };
        setupPriceInput(materialPriceInput, selectedItem["Harga Material"]);
        setupPriceInput(upahPriceInput, selectedItem["Harga Upah"]);
    } else {
        volumeInput.value = "0.00"; volumeInput.readOnly = false;
        materialPriceInput.value = "0"; materialPriceInput.readOnly = true; materialPriceInput.style.backgroundColor = "";
        upahPriceInput.value = "0"; upahPriceInput.readOnly = true; upahPriceInput.style.backgroundColor = "";
        satuanInput.value = "";
    }
    calculateTotalPrice(volumeInput);
};

const createBoQRow = (category, scope) => {
    const row = document.createElement("tr");
    row.classList.add("boq-item-row");
    row.dataset.scope = scope; 
    row.dataset.category = category;
    row.innerHTML = `<td class="col-no"><span class="row-number"></span></td><td class="col-jenis-pekerjaan"><select class="jenis-pekerjaan form-control" name="Jenis_Pekerjaan_Item" required><option value="">-- Pilih --</option></select></td><td class="col-satuan"><input type="text" class="satuan form-control" name="Satuan_Item" required readonly /></td><td class="col-volume"><input type="text" class="volume form-control" name="Volume_Item" value="0.00" inputmode="decimal" oninput="this.value = this.value.replace(/[^0-9.]/g, '').replace(/(\\..*?)\\..*/g, '$1').replace(/(\\.\\d{2})\\d+/, '$1')" /></td><td class="col-harga"><input type="text" class="harga-material form-control" name="Harga_Material_Item" inputmode="numeric" required readonly /></td><td class="col-harga"><input type="text" class="harga-upah form-control" name="Harga_Upah_Item" inputmode="numeric" required readonly /></td><td class="col-harga"><input type="text" class="total-material form-control" disabled /></td><td class="col-harga"><input type="text" class="total-upah form-control" disabled /></td><td class="col-harga"><input type="text" class="total-harga form-control" disabled /></td><td class="col-aksi"><button type="button" class="delete-row-btn">Hapus</button></td>`;
    row.querySelector(".volume").addEventListener("input", (e) => calculateTotalPrice(e.target));
    row.querySelector(".delete-row-btn").addEventListener("click", () => { row.remove(); updateAllRowNumbersAndTotals(); });
    row.querySelector('.jenis-pekerjaan').addEventListener('change', (e) => autoFillPrices(e.target));
    return row;
};

async function fetchAndPopulatePrices() {
    const selectedCabang = cabangSelect.value;
    const selectedScope = lingkupPekerjaanSelect.value;

    if (!selectedCabang || !selectedScope) {
        return;
    }

    messageDiv.textContent = `Memuat data harga untuk Cabang ${selectedCabang} - ${selectedScope}...`;
    messageDiv.style.display = 'block';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/get-data?cabang=${selectedCabang}&lingkup=${selectedScope}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Gagal mengambil data: ${response.statusText}`);
        }
        const data = await response.json();
        if (selectedScope === 'Sipil') {
            categorizedPrices.categorizedSipilPrices = data;
        } else if (selectedScope === 'ME') {
            categorizedPrices.categorizedMePrices = data;
        }
        console.log(`Data harga untuk ${selectedScope} berhasil dimuat.`);
        messageDiv.style.display = 'none';
        
    } catch (error) {
        console.error("Error fetching price data:", error);
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.style.backgroundColor = "#dc3545";
    }
}

const updateAllRowNumbersAndTotals = () => {
    document.querySelectorAll(".boq-table-body").forEach(tbody => {
        tbody.querySelectorAll(".boq-item-row").forEach((row, index) => {
            row.querySelector(".row-number").textContent = index + 1;
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

// --- FUNGSI YANG DIPERBARUI ---
async function populateFormWithHistory(data) {
    form.reset();
    document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");

    for (const key in data) {
        const input = form.querySelector(`[name="${key}"]`);
        if (input) {
            input.value = data[key];
        }
    }
    
    lingkupPekerjaanSelect.dispatchEvent(new Event('change'));
    cabangSelect.dispatchEvent(new Event('change'));
    
    await new Promise(resolve => setTimeout(resolve, 2000)); 

    document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");

    for (let i = 1; i <= 200; i++) {
        if (data[`Jenis_Pekerjaan_${i}`]) {
            const category = data[`Kategori_Pekerjaan_${i}`];
            const scope = lingkupPekerjaanSelect.value;
            const targetTbody = document.querySelector(`.boq-table-body[data-category="${category}"][data-scope="${scope}"]`);
            
            if (targetTbody) {
                const newRow = createBoQRow(category, scope);
                targetTbody.appendChild(newRow);
                populateJenisPekerjaanOptionsForNewRow(newRow);
                
                newRow.querySelector('.jenis-pekerjaan').value = data[`Jenis_Pekerjaan_${i}`];
                
                autoFillPrices(newRow.querySelector('.jenis-pekerjaan'));

                newRow.querySelector('.volume').value = data[`Volume_Item_${i}`] || '0.00';
                
                const materialInput = newRow.querySelector('.harga-material');
                const upahInput = newRow.querySelector('.harga-upah');
                
                if (materialInput.readOnly === false) {
                    materialInput.value = formatNumberWithSeparators(data[`Harga_Material_Item_${i}`]);
                }
                if (upahInput.readOnly === false) {
                    upahInput.value = formatNumberWithSeparators(data[`Harga_Upah_Item_${i}`]);
                }
            }
        }
    }
    updateAllRowNumbersAndTotals();

    // Simpan data asli setelah form terisi penuh
    originalFormData = getCurrentFormData();
}

// --- FUNGSI YANG DIPERBARUI ---
async function handleFormSubmit() {
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    // Periksa jika ada perubahan
    const currentData = getCurrentFormData();
    if (originalFormData && currentData === originalFormData) {
        messageDiv.textContent = 'Tidak ada perubahan yang terdeteksi. Silakan ubah data sebelum mengirim.';
        messageDiv.style.backgroundColor = '#ffc107'; // Warna kuning untuk peringatan
        messageDiv.style.display = 'block';
        return; // Hentikan pengiriman
    }

    submitButton.disabled = true;
    messageDiv.textContent = 'Mengirim data...';
    messageDiv.style.display = 'block';
    messageDiv.style.backgroundColor = '#007bff';

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    data['Email_Pembuat'] = sessionStorage.getItem('loggedInUserEmail');

    let itemIndex = 1;
    document.querySelectorAll(".boq-table-body:not(.hidden) .boq-item-row").forEach(row => {
        const jenisPekerjaan = row.querySelector('.jenis-pekerjaan').value;
        const volume = parseFloat(row.querySelector('.volume').value) || 0;

        if (jenisPekerjaan && volume > 0) {
            data[`Kategori_Pekerjaan_${itemIndex}`] = row.dataset.category;
            data[`Jenis_Pekerjaan_${itemIndex}`] = jenisPekerjaan;
            data[`Satuan_Item_${itemIndex}`] = row.querySelector('.satuan').value;
            data[`Volume_Item_${itemIndex}`] = volume;
            data[`Harga_Material_Item_${itemIndex}`] = parseFormattedNumber(row.querySelector('.harga-material').value);
            data[`Harga_Upah_Item_${itemIndex}`] = parseFormattedNumber(row.querySelector('.harga-upah').value);
            data[`Total_Material_Item_${itemIndex}`] = parseRupiah(row.querySelector('.total-material').value);
            data[`Total_Upah_Item_${itemIndex}`] = parseRupiah(row.querySelector('.total-upah').value);
            data[`Total_Harga_Item_${itemIndex}`] = parseRupiah(row.querySelector('.total-harga').value);
            itemIndex++;
        }
    });

    try {
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            messageDiv.textContent = 'Data berhasil dikirim! Halaman akan dimuat ulang.';
            messageDiv.style.backgroundColor = '#28a745';
            setTimeout(() => window.location.reload(), 2000);
        } else {
            throw new Error(result.message || 'Terjadi kesalahan di server.');
        }
    } catch (error) {
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.style.backgroundColor = '#dc3545';
        submitButton.disabled = false;
    }
}

function createTableStructure(categoryName, scope) {
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    
    const sectionTitle = document.createElement('h2');
    sectionTitle.className = 'text-lg font-semibold mt-6 mb-2 section-title';
    sectionTitle.textContent = categoryName;

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th rowspan="2">No</th><th rowspan="2">Jenis Pekerjaan</th><th rowspan="2">Satuan</th><th colspan="1">Volume</th><th colspan="2">Harga Satuan (Rp)</th><th colspan="2">Total Harga Satuan (Rp)</th><th colspan="1">Total Harga (Rp)</th><th rowspan="2">Aksi</th>
            </tr>
            <tr>
                <th>a</th><th>Material<br>(b)</th><th>Upah<br>(c)</th><th>Material<br>(d = a × b)</th><th>Upah<br>(e = a × c)</th><th>(f = d + e)</th>
            </tr>
        </thead>
        <tbody class="boq-table-body" data-category="${categoryName}" data-scope="${scope}"></tbody>
        <tfoot>
            <tr>
                <td colspan="8" style="text-align: right; font-weight: bold">Sub Total:</td>
                <td class="sub-total-amount" style="font-weight: bold; text-align: center">Rp 0</td>
                <td></td>
            </tr>
        </tfoot>
    `;
    
    const addRowButton = document.createElement('button');
    addRowButton.type = 'button';
    addRowButton.className = 'add-row-btn';
    addRowButton.dataset.category = categoryName;
    addRowButton.dataset.scope = scope;
    addRowButton.textContent = `Tambah Item ${categoryName}`;

    const wrapper = document.createElement('div');
    wrapper.appendChild(sectionTitle);
    wrapper.appendChild(tableContainer).appendChild(table);
    wrapper.appendChild(addRowButton);

    return wrapper;
}

async function initializePage() {
    form = document.getElementById("form");
    submitButton = document.getElementById("submit-button");
    messageDiv = document.getElementById("message");
    grandTotalAmount = document.getElementById("grand-total-amount");
    lingkupPekerjaanSelect = document.getElementById("lingkup_pekerjaan");
    cabangSelect = document.getElementById("cabang");
    sipilTablesWrapper = document.getElementById("sipil-tables-wrapper");
    meTablesWrapper = document.getElementById("me-tables-wrapper");
    currentResetButton = form.querySelector("button[type='reset']");

    messageDiv.textContent = 'Memuat data status...';
    messageDiv.style.display = 'block';

    sipilTablesWrapper.innerHTML = '';
    meTablesWrapper.innerHTML = '';
    sipilCategories.forEach(category => sipilTablesWrapper.appendChild(createTableStructure(category, "Sipil")));
    meCategories.forEach(category => meTablesWrapper.appendChild(createTableStructure(category, "ME")));
    
    const userEmail = sessionStorage.getItem('loggedInUserEmail');
    const userCabang = sessionStorage.getItem('loggedInUserCabang');

    try {
        if (userEmail && userCabang) {
            const statusResponse = await fetch(`${PYTHON_API_BASE_URL}/api/check_status?email=${encodeURIComponent(userEmail)}&cabang=${encodeURIComponent(userCabang)}`);
            const statusResult = await statusResponse.json();
            if (statusResult.rejected_submissions && statusResult.rejected_submissions.length > 0) {
                rejectedSubmissionsList = statusResult.rejected_submissions;
                const rejectedCodes = rejectedSubmissionsList.map(item => item.Lokasi).join(', ');
                messageDiv.innerHTML = `Ditemukan pengajuan yang ditolak untuk kode toko: <strong>${rejectedCodes}</strong>. Masukkan salah satu kode untuk revisi.`;
                messageDiv.style.backgroundColor = '#ffc107';
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
        messageDiv.style.backgroundColor = '#dc3545';
    } finally {
        lingkupPekerjaanSelect.disabled = false;
        cabangSelect.disabled = false;
    }
    
    document.getElementById('lokasi')?.addEventListener('input', function(e) {
       const rejectedData = rejectedSubmissionsList.find(item => item.Lokasi === e.target.value.toUpperCase());
       if (rejectedData) {
           populateFormWithHistory(rejectedData);
       }
    });

    document.querySelectorAll(".add-row-btn").forEach(button => {
        button.addEventListener("click", async () => {
            const category = button.dataset.category;
            const scope = button.dataset.scope;

            const dataSource = scope === "Sipil" ? categorizedPrices.categorizedSipilPrices : categorizedPrices.categorizedMePrices;
            if (!dataSource || Object.keys(dataSource).length === 0) {
                await fetchAndPopulatePrices();
            }

            const targetTbody = document.querySelector(`.boq-table-body[data-category="${category}"]`);
            if (targetTbody) {
                const newRow = createBoQRow(category, scope);
                targetTbody.appendChild(newRow);
                populateJenisPekerjaanOptionsForNewRow(newRow);
                updateAllRowNumbersAndTotals();
            }
        });
    });
    
    const handleScopeChange = () => {
        const selectedScope = lingkupPekerjaanSelect.value;
        document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");
        updateAllRowNumbersAndTotals();
        sipilTablesWrapper.classList.toggle("hidden", selectedScope !== 'Sipil');
        meTablesWrapper.classList.toggle("hidden", selectedScope !== 'ME');
        if (cabangSelect.value) {
            fetchAndPopulatePrices();
        }
    };

    const handleBranchChange = () => {
        document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");
        updateAllRowNumbersAndTotals();
        fetchAndPopulatePrices();
    };

    lingkupPekerjaanSelect.addEventListener("change", handleScopeChange);
    cabangSelect.addEventListener('change', handleBranchChange);

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