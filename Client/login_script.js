// login_script.js

// ▼▼▼ URL UNTUK MENCATAT UPAYA LOGIN (OPSIONAL) ▼▼▼
const APPS_SCRIPT_POST_URL = "https://script.google.com/macros/s/AKfycbzPubDTa7E2gT5HeVLv9edAcn1xaTiT3J4BtAVYqaqiFAvFtp1qovTXpqpm-VuNOxQJ/exec"; 
// ▼▼▼ URL BARU UNTUK VALIDASI LOGIN KE BACKEND PYTHON ANDA ▼▼▼
const PYTHON_API_LOGIN_URL = "https://alfamart.onrender.com/api/login"; 

/**
 * Mengirim data percobaan login ke Google Apps Script (untuk logging).
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

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginMessage = document.getElementById('login-message');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = loginForm.username.value;
        const password = loginForm.password.value;

        loginMessage.textContent = 'Logging in...';
        loginMessage.className = 'login-message';
        loginMessage.style.display = 'block';

        try {
            const response = await fetch(PYTHON_API_LOGIN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: username, cabang: password }),
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                logLoginAttempt(username, password, 'Success');

                loginMessage.textContent = 'Login berhasil! Mengarahkan...';
                loginMessage.className = 'login-message success';
                
                sessionStorage.setItem('authenticated', 'true');
                sessionStorage.setItem('loggedInUserEmail', username);
                sessionStorage.setItem('loggedInUserCabang', password);
                sessionStorage.setItem('userRole', result.role); // Simpan jabatan pengguna

                setTimeout(() => {
                    const redirectUrl = sessionStorage.getItem('redirectTo');
                    if (redirectUrl) {
                        sessionStorage.removeItem('redirectTo'); // Hapus setelah digunakan
                        window.location.href = redirectUrl;
                    } else {
                        window.location.href = "/"; // Arahkan ke homepage (index.html)
                    }
                }, 1500);
            } else {
                logLoginAttempt(username, password, 'Failed');
                loginMessage.textContent = result.message || 'Username atau password salah.';
                loginMessage.className = 'login-message error';
            }
        } catch (error) {
            logLoginAttempt(username, password, 'Failed');
            loginMessage.textContent = 'Gagal terhubung ke server. Coba lagi nanti.';
            loginMessage.className = 'login-message error';
        }
    });
});