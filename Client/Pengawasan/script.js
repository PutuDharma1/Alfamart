document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    const PYTHON_API_BASE_URL = "https://alfamart.onrender.com"; // Sesuaikan jika URL backend Anda berbeda

    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    // Fungsi untuk mengisi dropdown
    async function populateDropdown(elementId, dataList, valueKey, textKey) {
        const select = document.getElementById(elementId);
        if (!select) return;
        select.innerHTML = `<option value="">-- Pilih ${elementId.replace(/_/g, ' ')} --</option>`;
        dataList.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = item[textKey] || item[valueKey];
            select.appendChild(option);
        });
    }
    
    // Inisialisasi form Input PIC
    async function initInputPICForm() {
        const cabangSelect = document.getElementById('cabang');
        const kodeUlokSelect = document.getElementById('kode_ulok');
        const picSelect = document.getElementById('pic_building_support');
        const rabLinkElement = document.getElementById('rab_link');
        const userCabang = sessionStorage.getItem('loggedInUserCabang');

        if (cabangSelect && userCabang) {
            cabangSelect.innerHTML = `<option value="${userCabang}">${userCabang}</option>`;
            cabangSelect.value = userCabang;

            // Ambil data untuk dropdown
            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/pengawasan/init_data?cabang=${encodeURIComponent(userCabang)}`);
                if (!response.ok) throw new Error('Gagal memuat data awal.');
                const data = await response.json();
                
                if(data.picList) populateDropdown('pic_building_support', data.picList, 'email', 'nama');
                if(data.kodeUlokList) {
                    const ulokData = data.kodeUlokList.map(ulok => ({ ulok: ulok }));
                    populateDropdown('kode_ulok', ulokData, 'ulok', 'ulok');
                }

            } catch (error) {
                console.error("Error initializing form:", error);
                alert("Gagal memuat data untuk form. Silakan coba lagi.");
            }
        }
        
        if(kodeUlokSelect && rabLinkElement) {
            kodeUlokSelect.addEventListener('change', async (e) => {
                const selectedUlok = e.target.value;
                if(!selectedUlok) {
                    rabLinkElement.innerHTML = '<em>Pilih Kode Ulok untuk melihat link RAB</em>';
                    return;
                }
                rabLinkElement.textContent = 'Mencari link RAB...';
                try {
                     const response = await fetch(`${PYTHON_API_BASE_URL}/api/pengawasan/get_rab_url?kode_ulok=${encodeURIComponent(selectedUlok)}`);
                     const data = await response.json();
                     if(response.ok) {
                         rabLinkElement.innerHTML = `<a href="${data.rabUrl}" target="_blank">${data.rabUrl}</a>`;
                     } else {
                         throw new Error(data.message || 'RAB tidak ditemukan');
                     }
                } catch(error) {
                    rabLinkElement.textContent = `Error: ${error.message}`;
                }
            });
        }
    }
    
    if (form) {
        // Cek apakah ini form input_pic untuk inisialisasi dropdown
        const formTypeInput = form.querySelector('input[name="form_type"]');
        if (formTypeInput && formTypeInput.value === 'input_pic') {
            initInputPICForm();
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            let messageDiv = document.getElementById('message');
            if (!messageDiv) {
                messageDiv = document.createElement('div');
                messageDiv.id = 'message';
                messageDiv.style.cssText = 'margin-top: 1rem; padding: 1rem; border-radius: 8px; text-align: center; font-weight: bold; display: none;';
                form.parentNode.insertBefore(messageDiv, form.nextSibling);
            }
            
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            messageDiv.textContent = 'Mengirim data...';
            messageDiv.style.backgroundColor = '#007bff';
            messageDiv.style.color = 'white';
            messageDiv.style.display = 'block';

            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            // Handle file upload jika ada (khusus form input_pic)
            const spkFileInput = form.querySelector('input[name="spk_file"]');
            if (spkFileInput && spkFileInput.files[0]) {
                data.spk_base64 = await toBase64(spkFileInput.files[0]);
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
                    messageDiv.style.backgroundColor = '#28a745';
                    form.reset();
                    setTimeout(() => { window.location.href = '/Homepage/index.html'; }, 2000);
                } else {
                    throw new Error(result.message || 'Terjadi kesalahan di server.');
                }
            } catch (error) {
                messageDiv.textContent = `Error: ${error.message}`;
                messageDiv.style.backgroundColor = '#dc3545';
                submitButton.disabled = false;
            }
        });
    }
});