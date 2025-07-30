// login_script.js

let loginUsers = []; // Variabel global untuk menyimpan data pengguna yang diambil

// ▼▼▼ GANTI DENGAN URL WEB APP DARI HASIL DEPLOY ULANG APPS SCRIPT ANDA ▼▼▼
const APPS_SCRIPT_POST_URL = "https://script.google.com/macros/s/AKfycbzPubDTa7E2gT5HeVLv9edAcn1xaTiT3J4BtAVYqaqiFAvFtp1qovTXpqpm-VuNOxQJ/exec"; 

/**
 * [FUNGSI BARU] Mengirim data percobaan login ke Google Apps Script.
 * @param {string} username - Username yang dimasukkan.
 * @param {string} cabang - Password/Cabang yang dimasukkan.
 * @param {string} status - Status login ('Success' atau 'Failed').
 */
async function logLoginAttempt(username, cabang, status) {
    const logData = {
        requestType: 'loginAttempt', // Penanda ini penting untuk backend
        username: username,
        cabang: cabang,
        status: status
    };

    try {
        await fetch(APPS_SCRIPT_POST_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(logData)
        });
        console.log(`Login attempt logged: ${status}`);
    } catch (error) {
        console.error('Failed to log login attempt:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const loginForm = document.getElementById('login-form');
    const loginMessage = document.getElementById('login-message');

    // URL ini HANYA untuk mengambil daftar user, JANGAN diubah.
    const APPS_SCRIPT_LOGIN_DATA_URL = "https://script.google.com/macros/s/AKfycbzdl_VfkasiwPqTj7gHw_TDHnBpN30ia_LzEvC3yIa-RoWHDAgjUUqRuddBi9NGKFB7Dw/exec";

    // Fungsi untuk mengambil data login dari Google Apps Script
    async function fetchLoginData() {
        try {
            loginMessage.textContent = 'Memuat data login...';
            loginMessage.className = 'login-message';
            loginMessage.style.display = 'block';

            const response = await fetch(APPS_SCRIPT_LOGIN_DATA_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            loginUsers = await response.json();
            console.log("Data login berhasil dimuat:", loginUsers);
            loginMessage.style.display = 'none';
            return true;
        } catch (error) {
            console.error('Gagal memuat data login:', error);
            loginMessage.textContent = 'Kesalahan memuat data login. Silakan coba lagi nanti.';
            loginMessage.className = 'login-message error';
            loginMessage.style.display = 'block';
            return false;
        }
    }

    const dataLoaded = await fetchLoginData();
    if (!dataLoaded) {
        loginForm.querySelector('button[type="submit"]').disabled = true;
    }

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const username = loginForm.username.value;
        const password = loginForm.password.value;

        const foundUser = loginUsers.find(user =>
            user.Email === username && user.Cabang === password
        );

        if (foundUser) {
            // Panggil fungsi log untuk status BERHASIL
            logLoginAttempt(username, password, 'Success');

            loginMessage.textContent = 'Login berhasil! Mengarahkan...';
            loginMessage.className = 'login-message success';
            loginMessage.style.display = 'block';

            sessionStorage.setItem('authenticated', 'true');
            sessionStorage.setItem('loggedInUserEmail', username);
            sessionStorage.setItem('loggedInUserCabang', password);

            setTimeout(() => {
                window.location.href = "/Homepage";
            }, 1500);
        } else {
            // Panggil fungsi log untuk status GAGAL
            logLoginAttempt(username, password, 'Failed');

            loginMessage.textContent = 'Username atau password salah.';
            loginMessage.className = 'login-message error';
            loginMessage.style.display = 'block';
        }
    });
});