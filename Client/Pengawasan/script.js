document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    const PYTHON_API_BASE_URL = "https://alfamart.onrender.com"; 

    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    async function populateDropdown(elementId, dataList, valueKey, textKey) {
        const select = document.getElementById(elementId);
        if (!select) return;
        const currentSelection = select.value; 
        select.innerHTML = `<option value="">-- Pilih ${elementId.replace(/_/g, ' ')} --</option>`;
        dataList.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = item[textKey] || item[valueKey];
            select.appendChild(option);
        });
        if (currentSelection) {
            select.value = currentSelection;
        }
    }

    async function initInputPICForm() {
        const cabangSelect = document.getElementById('cabang');
        const kodeUlokSelect = document.getElementById('kode_ulok');
        const picSelect = document.getElementById('pic_building_support');
        const rabUrlInput = document.getElementById('rab_url'); 
        const userCabang = sessionStorage.getItem('loggedInUserCabang');

        if (!cabangSelect || !kodeUlokSelect || !picSelect || !rabUrlInput) {
            console.error("Elemen form penting tidak ditemukan!");
            return;
        }

        if (userCabang) {
            cabangSelect.innerHTML = `<option value="${userCabang}">${userCabang}</option>`;
            cabangSelect.value = userCabang;
            cabangSelect.disabled = true;

            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/pengawasan/init_data?cabang=${encodeURIComponent(userCabang)}`);
                if (!response.ok) throw new Error('Gagal memuat data awal untuk form.');
                const data = await response.json();

                if(data.picList) populateDropdown('pic_building_support', data.picList, 'email', 'nama');
                if(data.kodeUlokList && data.kodeUlokList.length > 0) {
                    const ulokData = data.kodeUlokList.map(ulok => ({ ulok: ulok }));
                    populateDropdown('kode_ulok', ulokData, 'ulok', 'ulok');
                } else {
                     kodeUlokSelect.innerHTML = '<option value="">-- Tidak ada RAB disetujui di cabang ini --</option>';
                }

            } catch (error) {
                console.error("Error saat inisialisasi form:", error);
                alert("Gagal memuat data untuk form. Silakan coba muat ulang halaman.");
            }
        } else {
            alert("Informasi cabang tidak ditemukan. Silakan login kembali.");
            cabangSelect.disabled = true;
            kodeUlokSelect.disabled = true;
            picSelect.disabled = true;
        }
        
        kodeUlokSelect.addEventListener('change', async (e) => {
            const selectedUlok = e.target.value;
            rabUrlInput.value = '';
            if(!selectedUlok) return;

            rabUrlInput.placeholder = 'Mencari link RAB...';
            try {
                 const response = await fetch(`${PYTHON_API_BASE_URL}/api/pengawasan/get_rab_url?kode_ulok=${encodeURIComponent(selectedUlok)}`);
                 const data = await response.json();
                 if(response.ok && data.rabUrl) {
                     rabUrlInput.value = data.rabUrl;
                 } else {
                     throw new Error(data.message || 'RAB tidak ditemukan');
                 }
            } catch(error) {
                rabUrlInput.placeholder = `Error: ${error.message}`;
            }
        });
    }

    if (form) {
        const formTypeInput = form.querySelector('input[name="form_type"]');
        if (formTypeInput && formTypeInput.value === 'input_pic') {
            initInputPICForm();
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            let messageDiv = document.getElementById('popup-message');
            const popup = document.getElementById('popup');
            
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            messageDiv.textContent = 'Mengirim data...';
            popup.classList.add('show');

            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            const spkFileInput = form.querySelector('input[name="spk_file"]');
            if (spkFileInput && spkFileInput.files[0]) {
                try {
                    data.spk_base64 = (await toBase64(spkFileInput.files[0])).split(',')[1];
                } catch (error) {
                    messageDiv.textContent = 'Error: Gagal membaca file SPK.';
                    submitButton.disabled = false;
                    return;
                }
            }

            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/pengawasan/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });
                const result = await response.json();

                if (response.ok && result.status === 'success') {
                    messageDiv.textContent = 'Data berhasil dikirim!';
                    form.reset();
                    initInputPICForm(); // Re-initialize the form
                } else {
                    throw new Error(result.message || 'Terjadi kesalahan di server.');
                }
            } catch (error) {
                messageDiv.textContent = `Error: ${error.message}`;
            } finally {
                submitButton.disabled = false;
            }
        });
    }
});

function closePopup() {
    const popup = document.getElementById('popup');
    if (popup) {
        popup.classList.remove('show');
    }
}