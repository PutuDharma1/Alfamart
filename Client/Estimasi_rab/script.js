// --- Global Variable Declarations ---
let form;
let submitButton;
let messageDiv;
let grandTotalAmount;
let lingkupPekerjaanSelect;
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
const populateJenisPekerjaanOptionsForNewRow = (rowElement) => {
    const category = rowElement.dataset.category;
    const scope = rowElement.dataset.scope;
    const selectEl = rowElement.querySelector(".jenis-pekerjaan");
    const selectedCabang = document.getElementById("cabang").value;

    if (!selectEl) return;

    if (!selectedCabang) {
        selectEl.innerHTML = '<option value="">-- Pilih Cabang Dulu --</option>';
        return;
    }

    let dataSource = (scope === "Sipil" && categorizedPrices.categorizedSipilPrices) ? categorizedPrices.categorizedSipilPrices :
                     (scope === "ME" && categorizedPrices.categorizedMePrices) ? categorizedPrices.categorizedMePrices : {};
    
    const itemsInCategory = dataSource[category] || [];
    const filteredItems = itemsInCategory.filter(item => item.Cabang === selectedCabang);

    if (filteredItems.length === 0) {
        selectEl.innerHTML = '<option value="">-- Data Harga Tidak Ditemukan --</option>';
        return;
    }

    selectEl.innerHTML = '<option value="">-- Pilih Jenis Pekerjaan --</option>';
    filteredItems.forEach(item => {
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
    const selectedCabang = document.getElementById("cabang").value;

    const volumeInput = row.querySelector(".volume");
    const materialPriceInput = row.querySelector(".harga-material");
    const upahPriceInput = row.querySelector(".harga-upah");
    const satuanInput = row.querySelector(".satuan");

    materialPriceInput.removeEventListener('input', handleCurrencyInput);
    upahPriceInput.removeEventListener('input', handleCurrencyInput);

    let selectedItem = null;
    let dataSource = (currentLingkupPekerjaan === "Sipil") ? categorizedPrices.categorizedSipilPrices : categorizedPrices.categorizedMePrices;
    
    if (dataSource?.[currentCategory]) {
        selectedItem = dataSource[currentCategory].find(item => 
            item["Jenis Pekerjaan"] === selectedJenisPekerjaan && item.Cabang === selectedCabang
        );
    }

    if (selectedItem) {
        if (selectedItem["Satuan"] === "Ls") {
            volumeInput.value = 1;
            volumeInput.readOnly = true;
        } else {
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

const populateFormWithHistory = (data) => {
    console.log("Populating form with rejected data:", data);
    form.reset();
    document.querySelectorAll(".boq-table-body").forEach(tbody => tbody.innerHTML = "");
    
    const lingkupPekerjaanValue = data['Lingkup_Pekerjaan'] || data['Lingkup Pekerjaan'];
    lingkupPekerjaanSelect.value = lingkupPekerjaanValue;
    lingkupPekerjaanSelect.dispatchEvent(new Event('change'));
    
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const elementName = key.replace(/_/g, " ");
            const element = document.getElementsByName(elementName)[0];
            if (element && key !== 'Lingkup_Pekerjaan' && key !== 'Lingkup Pekerjaan') {
                element.value = (element.type === 'date' && data[key]) ? new Date(data[key]).toISOString().split('T')[0] : data[key];
            }
        }
    }
    setTimeout(() => {
        // ▼▼▼ PERUBAHAN DI SINI ▼▼▼
        for (let i = 1; i <= 100; i++) { // Diubah dari 50 menjadi 100
            if (data[`Jenis_Pekerjaan_${i}`]) {
                const category = data[`Kategori_Pekerjaan_${i}`];
                const scope = lingkupPekerjaanValue;
                const targetTbody = document.querySelector(`.boq-table-body[data-category="${category}"][data-scope="${scope}"]`);
                if (targetTbody) {
                    const newRow = createBoQRow(category, scope);
                    targetTbody.appendChild(newRow);
                    populateJenisPekerjaanOptionsForNewRow(newRow);
                    newRow.querySelector('.jenis-pekerjaan').value = data[`Jenis_Pekerjaan_${i}`];
                    autoFillPrices(newRow.querySelector('.jenis-pekerjaan'));
                    newRow.querySelector('.volume').value = parseFloat(data[`Volume_Item_${i}`] || 0).toFixed(2);
                    if (newRow.querySelector('.harga-material').readOnly === false) {
                        newRow.querySelector('.harga-material').value = formatNumberWithSeparators(data[`Harga_Material_Item_${i}`]);
                    }
                    if (newRow.querySelector('.harga-upah').readOnly === false) {
                        newRow.querySelector('.harga-upah').value = formatNumberWithSeparators(data[`Harga_Upah_Item_${i}`]);
                    }
                }
            }
        }
        updateAllRowNumbersAndTotals();
        messageDiv.innerHTML = "Data revisi telah dimuat. Silakan lakukan perubahan dan klik 'Kirim' jika sudah selesai.";
        messageDiv.style.display = 'block';
        messageDiv.style.backgroundColor = '#007bff';
        messageDiv.style.color = 'white';
    }, 200);
};

async function handleFormSubmit() {
    const PYTHON_API_BASE_URL = "https://buildingprocess-fld9.onrender.com";
    const requiredFields = ['Lokasi', 'Proyek', 'Cabang', 'Lingkup Pekerjaan'];
    for (const fieldName of requiredFields) {
        const element = form.elements[fieldName];
        if (!element || !element.value.trim()) {
            messageDiv.textContent = `Error: Field '${fieldName.replace(/_/g, ' ')}' wajib diisi.`;
            messageDiv.style.display = "block";
            messageDiv.style.backgroundColor = "#dc3545";
            element?.focus();
            return;
        }
    }
    const currentStoreCode = String(form.elements['Lokasi'].value).toUpperCase();
    if (approvedStoreCodes.map(code => String(code).toUpperCase()).includes(currentStoreCode)) {
        messageDiv.textContent = `Error: Kode toko ${currentStoreCode} sudah pernah diajukan dan disetujui.`;
        messageDiv.style.display = "block";
        messageDiv.style.backgroundColor = "#dc3545";
        return;
    }
    if (pendingStoreCodes.map(code => String(code).toUpperCase()).includes(currentStoreCode) && (!lastRejectedSubmission || currentStoreCode !== String(lastRejectedSubmission.Lokasi).toUpperCase())) {
        messageDiv.textContent = `Error: Kode toko ${currentStoreCode} sudah memiliki pengajuan yang sedang direview.`;
        messageDiv.style.display = "block";
        messageDiv.style.backgroundColor = "#ffc107";
        messageDiv.style.color = "black";
        return;
    }
    messageDiv.textContent = "Mengirim data...";
    messageDiv.style.display = "block";
    messageDiv.style.backgroundColor = '#007bff';
    submitButton.disabled = true;
    try {
        const formDataToSend = {};
        const formData = new FormData(form);
        formData.forEach((value, key) => {
            const newKey = key === "Lingkup Pekerjaan" ? "Lingkup_Pekerjaan" : key;
            if (!newKey.includes('_Item')) formDataToSend[newKey] = value;
        });
        formDataToSend["Email_Pembuat"] = sessionStorage.getItem('loggedInUserEmail') || '';
        formDataToSend["Lokasi"] = currentStoreCode;
        let itemCounter = 0;
        document.querySelectorAll(".boq-table-body:not(.hidden) .boq-item-row").forEach(row => {
            const jenisPekerjaanInput = row.querySelector(".jenis-pekerjaan");
            if (jenisPekerjaanInput && jenisPekerjaanInput.value) {
                itemCounter++;
                formDataToSend[`Kategori_Pekerjaan_${itemCounter}`] = row.dataset.category;
                formDataToSend[`Jenis_Pekerjaan_${itemCounter}`] = jenisPekerjaanInput.value;
                formDataToSend[`Satuan_Item_${itemCounter}`] = row.querySelector(".satuan").value;
                formDataToSend[`Volume_Item_${itemCounter}`] = parseFloat(row.querySelector(".volume").value) || 0;
                formDataToSend[`Harga_Material_Item_${itemCounter}`] = parseFormattedNumber(row.querySelector(".harga-material").value);
                formDataToSend[`Harga_Upah_Item_${itemCounter}`] = parseFormattedNumber(row.querySelector(".harga-upah").value);
                formDataToSend[`Total_Material_Item_${itemCounter}`] = parseRupiah(row.querySelector(".total-material").value);
                formDataToSend[`Total_Upah_Item_${itemCounter}`] = parseRupiah(row.querySelector(".total-upah").value);
                formDataToSend[`Total_Harga_Item_${itemCounter}`] = parseRupiah(row.querySelector(".total-harga").value);
            }
        });
        if (itemCounter === 0) throw new Error("Tidak ada item pekerjaan yang ditambahkan. Formulir tidak bisa dikirim.");
        formDataToSend["Grand_Total"] = parseRupiah(grandTotalAmount.textContent);
        const response = await fetch(`${PYTHON_API_BASE_URL}/api/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formDataToSend),
        });
        const data = await response.json();
        console.log("Response from Python backend:", data);
        if (!response.ok) throw new Error(data.message || 'Submission failed.');
        messageDiv.textContent = data.message || "Data berhasil terkirim! Anda akan diarahkan ke Beranda.";
        messageDiv.style.backgroundColor = "#28a745";
        setTimeout(() => { window.location.href = '/Homepage/'; }, 2500);
    } catch (error) {
        console.error("Error submitting form:", error);
        messageDiv.textContent = "Error: " + error.message;
        messageDiv.style.backgroundColor = "#dc3545";
    } finally {
        submitButton.disabled = false;
    }
}

function createTableStructure(categoryName, scope) {
    const tableWrapper = document.createElement('div');
    tableWrapper.innerHTML = `<h2 class="section-title">${categoryName}</h2><div class="table-container"><table><thead><tr><th class="col-no" rowspan="2">No</th><th class="col-jenis-pekerjaan" rowspan="2">Jenis Pekerjaan</th><th class="col-satuan" rowspan="2">Satuan</th><th class="col-volume" rowspan="2">Volume</th><th class="col-harga" colspan="2">Harga Satuan (Rp)</th><th class="col-harga" colspan="2">Total Harga (Rp)</th><th class="col-harga" rowspan="2">Total Harga (Rp)</th><th class="col-aksi" rowspan="2">Aksi</th></tr><tr><th class="col-harga">Material</th><th class="col-harga">Upah</th><th class="col-harga">Material</th><th class="col-harga">Upah</th></tr></thead><tbody class="boq-table-body" data-category="${categoryName}" data-scope="${scope}"></tbody><tfoot><tr><td colspan="8" style="text-align: right; font-weight: bold">Sub Total:</td><td class="sub-total-amount" style="font-weight: bold; text-align: right">Rp 0</td><td></td></tr></tfoot></table></div><div class="add-row-button-container"><button type="button" class="add-row-btn" data-category="${categoryName}" data-scope="${scope}">Tambah Item</button></div>`;
    return tableWrapper;
}

async function initializePage() {
    form = document.getElementById("form");
    submitButton = document.getElementById("submit-button");
    messageDiv = document.getElementById("message");
    grandTotalAmount = document.getElementById("grand-total-amount");
    lingkupPekerjaanSelect = document.getElementById("lingkup_pekerjaan");
    sipilTablesWrapper = document.getElementById("sipil-tables-wrapper");
    meTablesWrapper = document.getElementById("me-tables-wrapper");
    currentResetButton = form.querySelector("button[type='reset']");
    const cabangSelect = document.getElementById("cabang");

    messageDiv.textContent = 'Memuat data...';
    messageDiv.style.display = 'block';
    messageDiv.style.backgroundColor = '#007bff';
    messageDiv.style.color = 'white';

    sipilTablesWrapper.innerHTML = '';
    meTablesWrapper.innerHTML = '';
    sipilCategories.forEach(category => sipilTablesWrapper.appendChild(createTableStructure(category, "Sipil")));
    meCategories.forEach(category => meTablesWrapper.appendChild(createTableStructure(category, "ME")));
    
    const PYTHON_API_BASE_URL = "https://buildingprocess-fld9.onrender.com";
    const APPS_SCRIPT_DATA_URL = "https://script.google.com/macros/s/AKfycbx2rtKmaZBb_iRBRL-DOemjVhAp3GaCwsthtwtfdtvdtuO2bRVlmONboB8wE-CZU7Hc/exec";
    const userEmail = sessionStorage.getItem('loggedInUserEmail');

    const statusPromise = userEmail ? fetch(`${PYTHON_API_BASE_URL}/api/check_status?email=${encodeURIComponent(userEmail)}`).then(res => res.json()) : Promise.resolve(null);
    const pricesPromise = fetch(APPS_SCRIPT_DATA_URL).then(res => res.json());

    try {
        const [statusResult, pricesData] = await Promise.all([statusPromise, pricesPromise]);

        categorizedPrices = pricesData;
        console.log("Data harga berhasil dimuat.");

        if (statusResult) {
            console.log("User submissions response:", statusResult);
            if (statusResult.rejected_submissions) {
                rejectedSubmissionsList = statusResult.rejected_submissions;
                if (rejectedSubmissionsList.length > 0) {
                    const rejectedCodes = rejectedSubmissionsList.map(item => item.Lokasi).join(', ');
                    messageDiv.innerHTML = `Ditemukan pengajuan yang ditolak untuk kode toko: <strong>${rejectedCodes}</strong>. Masukkan salah satu kode untuk revisi.`;
                    messageDiv.style.backgroundColor = '#ffc107';
                    messageDiv.style.color = 'black';
                } else {
                    messageDiv.style.display = 'none';
                }
            }
            if (statusResult.active_codes) {
                pendingStoreCodes = statusResult.active_codes.pending || [];
                approvedStoreCodes = statusResult.active_codes.approved || [];
            }
        } else {
            messageDiv.style.display = 'none';
        }
    } catch (error) {
        console.error("Gagal memuat data awal:", error);
        messageDiv.textContent = "Gagal memuat data. Mohon muat ulang halaman.";
        messageDiv.style.display = 'block';
        messageDiv.style.backgroundColor = '#dc3545';
    } finally {
        lingkupPekerjaanSelect.disabled = false;
    }
    
    document.getElementById('lokasi')?.addEventListener('input', function() {
        const currentStoreCode = this.value.toUpperCase();
        const rejectedData = rejectedSubmissionsList.find(sub => String(sub.Lokasi).toUpperCase() === currentStoreCode);
        if (rejectedData) {
            if (confirm("Data pengajuan yang ditolak untuk kode toko ini ditemukan. Apakah Anda ingin memuat ulang data tersebut untuk direvisi?")) {
                populateFormWithHistory(rejectedData);
            }
        }
    });

    document.querySelectorAll(".add-row-btn").forEach(button => {
        button.addEventListener("click", () => {
            const category = button.dataset.category;
            const scope = button.dataset.scope;
            const targetTbody = document.querySelector(`.boq-table-body[data-category="${category}"][data-scope="${scope}"]`);
            if (targetTbody) {
                const newRow = createBoQRow(category, scope);
                targetTbody.appendChild(newRow);
                populateJenisPekerjaanOptionsForNewRow(newRow);
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

    lingkupPekerjaanSelect.addEventListener("change", (event) => {
        const selectedScope = event.target.value;
        sipilTablesWrapper.classList.toggle("hidden", selectedScope !== 'Sipil');
        meTablesWrapper.classList.toggle("hidden", selectedScope !== 'ME');
        if (selectedScope) {
            refreshAllDropdowns();
        }
    });
    
    cabangSelect.addEventListener('change', refreshAllDropdowns);

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