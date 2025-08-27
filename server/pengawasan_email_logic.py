# Logika untuk menentukan URL form berikutnya
FORM_LINKS = {
    "input_pic": {
        "non_ruko_non_urugan_30hr": "/Pengawasan/h2_30hr.html",
        "non_ruko_non_urugan_35hr": "/Pengawasan/h2_35hr.html",
        "non_ruko_non_urugan_40hr": "/Pengawasan/h2_40hr.html",
        "non_ruko_urugan_48hr": "/Pengawasan/h2_48hr.html",
        "ruko_10hr": "/Pengawasan/h2_10hr.html",
        "ruko_14hr": "/Pengawasan/h2_14hr.html",
        "ruko_20hr": "/Pengawasan/h2_20hr.html",
    },
    "h2": {
        "non_ruko_non_urugan_30hr": "/Pengawasan/h7_30hr.html",
        "non_ruko_non_urugan_35hr": "/Pengawasan/h7_35hr.html",
        "non_ruko_non_urugan_40hr": "/Pengawasan/h7_40hr.html",
        "non_ruko_urugan_48hr": "/Pengawasan/h10_48hr.html",
        "ruko_10hr": "/Pengawasan/h5_10hr.html",
        "ruko_14hr": "/Pengawasan/h7_14hr.html",
        "ruko_20hr": "/Pengawasan/h12_20hr.html",
    },
    "h5": {"ruko_10hr": "/Pengawasan/h8_10hr.html"},
    "h7": {
        "non_ruko_non_urugan_30hr": "/Pengawasan/h14_30hr.html",
        "non_ruko_non_urugan_35hr": "/Pengawasan/h17_35hr.html",
        "non_ruko_non_urugan_40hr": "/Pengawasan/h17_40hr.html",
        "ruko_14hr": "/Pengawasan/h10_14hr.html",
    },
    "h8": {"ruko_10hr": "/Pengawasan/serah_terima.html"},
    "h10": {
        "non_ruko_urugan_48hr": "/Pengawasan/h25_48hr.html",
        "ruko_14hr": "/Pengawasan/serah_terima.html",
    },
    "h12": {"ruko_20hr": "/Pengawasan/h16_20hr.html"},
    "h14": {"non_ruko_non_urugan_30hr": "/Pengawasan/h18_30hr.html"},
    "h16": {"ruko_20hr": "/Pengawasan/serah_terima.html"},
    "h17": {
        "non_ruko_non_urugan_35hr": "/Pengawasan/h22_35hr.html",
        "non_ruko_non_urugan_40hr": "/Pengawasan/h25_40hr.html",
    },
    "h18": {"non_ruko_non_urugan_30hr": "/Pengawasan/h23_30hr.html"},
    "h22": {"non_ruko_non_urugan_35hr": "/Pengawasan/h28_35hr.html"},
    "h23": {"non_ruko_non_urugan_30hr": "/Pengawasan/serah_terima.html"},
    "h25": {
        "non_ruko_non_urugan_40hr": "/Pengawasan/h33_40hr.html",
        "non_ruko_urugan_48hr": "/Pengawasan/h32_48hr.html",
    },
    "h28": {"non_ruko_non_urugan_35hr": "/Pengawasan/serah_terima.html"},
    "h32": {"non_ruko_urugan_48hr": "/Pengawasan/h41_48hr.html"},
    "h33": {"non_ruko_non_urugan_40hr": "/Pengawasan/serah_terima.html"},
    "h41": {"non_ruko_urugan_48hr": "/Pengawasan/serah_terima.html"},
}

def get_email_details(form_type, data, user_info):
    kategori = data.get('kategori_lokasi', '')
    pic_email = data.get('pic_building_support')
    pic_nama = next((p['nama'] for p in user_info['pic_list'] if p['email'] == pic_email), pic_email)
    
    koordinator_email = user_info['koordinator_info'].get('email')
    koordinator_nama = user_info['koordinator_info'].get('nama')
    manager_email = user_info['manager_info'].get('email')
    manager_nama = user_info['manager_info'].get('nama')

    # Default values
    subject = f"Informasi Pengawasan untuk Toko: {data.get('kode_ulok')}"
    recipients = []
    
    # Menentukan penerima email berdasarkan logika dari Vercel
    if form_type == 'input_pic':
        recipients.append(pic_email)
        if kategori.startswith("ruko"):
            recipients.extend([koordinator_email, manager_email])
    elif form_type == 'h2':
        if kategori.startswith("non_ruko"):
            recipients.extend([pic_email, koordinator_email, manager_email])
        else:
            recipients.append(pic_email)
    elif form_type in ['h5', 'h12', 'h18', 'h22', 'h32']:
         recipients.extend([koordinator_email, manager_email])
    elif form_type == 'h7':
        if kategori.startswith("ruko"):
            recipients.extend([koordinator_email, manager_email])
        else:
             recipients.append(pic_email)
    elif form_type == 'h10':
         recipients.append(pic_email)
    elif form_type == 'h25':
        if kategori == "non_ruko_urugan_48hr":
            recipients.append(pic_email)
        else:
            recipients.extend([koordinator_email, manager_email])
    elif form_type == 'serah_terima':
         subject = f"Informasi Serah Terima untuk Toko: {data.get('kode_ulok')}"
         recipients.extend([pic_email, koordinator_email, manager_email])
    else: # Default untuk H8, H14, H16, H23, H28, H33, H41
        recipients.append(pic_email)
        
    # Menghapus email kosong dan duplikat
    unique_recipients = list(filter(None, set(recipients)))

    return {
        "recipients": unique_recipients,
        "subject": subject,
    }