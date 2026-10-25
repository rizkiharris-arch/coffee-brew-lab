# Coffee Brew Lab V1.1

Jurnal eksperimen kopi pribadi berbasis HTML, CSS, dan JavaScript, dengan aset lokal dan tanpa dependency runtime eksternal. V1.1 memperbarui pengalaman mobile; fungsi dan format data V1.0 tetap dipertahankan.

## Ringkasan V1.1

- Dashboard ringkas dengan jumlah resep/versi dan koleksi kartu yang mudah disentuh.
- Palet ivory, beige, caramel, espresso, dan charcoal; tipografi lebih terbaca.
- Editor Identitas, Parameter, dan Tasting, dengan bar Simpan/Batal serta safe-area.
- Lima kelompok skor 1–5 atau “Belum dinilai”; overall tetap merupakan preferensi tersendiri.
- Detail dan riwayat versi, perbandingan 19 atribut, serta filter Semua/Berbeda.
- Navigasi bawah, Back/Forward browser, perlindungan isian belum disimpan, dan pemulihan scroll.
- Ekspor/pemulihan JSON, peringatan konflik tab, dan penyelamatan data rusak tetap tersedia.

Branch lokal: `feature/v1.1-premium-mobile`, dari baseline `develop-v1.1` yang diverifikasi pada commit `b44f998da1cbe9406139d577b77ef445fbb4e343`. Pekerjaan ini tidak mengubah `main`, `develop-v1.1`, GitHub Pages, atau konfigurasi deployment. Push, PR, dan merge memerlukan persetujuan terpisah.

## Data dan kompatibilitas

- `coffee-brew-lab:data:v1`: `{schemaVersion: 1, recipes: [{id, versions: [...]}]}`.
- `coffee-brew-lab:last-backup`: timestamp ISO saat unduhan backup dimulai; bukan bukti file berhasil disimpan.
- Backup tetap `{app: "Coffee Brew Lab", schemaVersion: 1, exportedAt, recipes}` dan kompatibel dengan V1.0.
- Semua field versi, kategori `manual | cold | other`, ID, nomor versi, satuan, dan nilai kosong tetap dipertahankan. Tidak ada migrasi storage.
- Edit mempertahankan ID/nomor; versi berikutnya menyalin versi terpilih dan menggunakan nomor tertinggi + 1.
- Skor kosong tetap `null`, bukan nol. Overall tidak dihitung dari rata-rata karakter. Rasio hanya memakai kopi dan air.
- Impor maksimum 5 MiB dan mengganti seluruh catatan setelah konfirmasi, bukan menggabungkan data.

Data melekat pada origin browser. Port, hostname, protokol, profil, atau browser yang berbeda dapat memiliki storage berbeda. Gunakan salinan backup untuk uji; jangan menghapus data situs produksi. Simpan backup pribadi di luar direktori yang disajikan server dan jangan masukkan ke repository. Fixture pengujian dalam `tests/` tidak berisi jurnal pribadi.

## Preview lokal yang aman

Jalankan dari worktree yang sudah ada, tanpa checkout atau membuat worktree baru:

```bash
cd /workspace/coffee-brew-lab-v1.1
python3 -m http.server 8080 --bind 127.0.0.1
```

Buka `http://127.0.0.1:8080` menggunakan profil browser khusus pengujian dan impor salinan JSON bila perlu. Server ini hanya mendengarkan localhost. Hentikan dengan `Ctrl+C` setelah review. Tidak perlu mengubah Pages atau melakukan deployment.

Untuk UAT Chrome Android pada perangkat fisik, jalankan secara manual pada komputer di LAN privat tepercaya:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Hubungkan HP ke LAN yang sama, lalu buka `http://<IP-LAN-komputer>:8080`. Binding ini dapat diakses perangkat lain di jaringan; jangan gunakan jaringan publik, port forwarding, atau data produksi. Hentikan server setelah pengujian. Alamat LAN memiliki origin berbeda dari localhost maupun situs produksi.

## Pemeriksaan otomatis

Gunakan Node.js 24 untuk perintah berikut, dari direktori worktree:

```bash
node --check app.js
node --test --test-isolation=none tests/compatibility.test.js tests/navigation.test.js
git diff --check
```

Suite kompatibilitas berisi 16 tes untuk format storage/backup dua arah terhadap core V1.0 yang dipatok, identitas versi, skor, angka, durasi, 19 atribut perbandingan, validasi, dan teks panjang. Suite navigasi menguji regresi pemulihan route menggunakan lingkungan DOM/history simulasi. Tes simulasi tidak menggantikan pengujian browser atau perangkat Android.

Hasil verifikasi lokal terakhir: 16 tes core dan 6 tes regresi route lulus (22 total), pemeriksaan sintaks serta `git diff --check` lulus. Satu percobaan Chromium gagal sebelum membuka halaman karena sandbox menolak operasi socket (`EPERM`). Tidak ada hasil UI/browser atau screenshot; UAT Android di bawah belum dijalankan.

Catat hasil aktual, versi browser, ukuran layar, dan langkah reproduksi. Jangan menyatakan UI/browser lulus hanya karena core dan sintaks lulus. Jika browser tidak tersedia di lingkungan eksekusi, laporkan keterbatasannya dan jalankan UAT berikut secara manual.

## UAT Chrome Android

Gunakan data uji dengan satu resep, sedikitnya dua versi, dan backup lama yang hanya menyimpan versi pertama dengan ID yang sama.

- [ ] Buka jurnal kosong: ajakan mencatat, statistik, dan navigasi bawah terbaca.
- [ ] Buat resep baru; nama/kategori wajib, parameter lain boleh kosong. Error berfokus ke field yang sesuai dan isian tetap ada.
- [ ] Isi dosis/air memakai koma dan titik desimal; periksa rasio. Uji durasi nol dan cold brew 12 jam.
- [ ] Simpan, buka kartu, edit V1, buat V2, pilih V1, lalu buat V3. Pastikan sumber salinan benar dan versi sebelumnya tidak berubah.
- [ ] Uji skor kosong, setiap angka 1–5, lalu kembalikan ke “Belum dinilai”. Periksa nilai setelah edit, duplikasi, dan reload; overall tetap independen.
- [ ] Pastikan kartu menampilkan versi terbaru, jumlah versi, rating, dan placeholder kosong secara konsisten.
- [ ] Bandingkan dua versi: semua 19 atribut tersedia, filter Berbeda bekerja, teks panjang terbaca, dan pasangan versi sama diberi penjelasan.
- [ ] Dengan V1 terpilih, buka compare lalu Cadangan. Pulihkan backup satu versi, kemudian Back/Forward ke riwayat compare lama: detail versi yang tersedia harus tampil, tanpa pilihan atau hasil compare lama.
- [ ] Ulangi dengan history yang menunjuk V2 yang sudah tidak ada: gunakan versi tersedia; bila resep tidak ada lagi, kembali ke jurnal.
- [ ] Coba impor JSON invalid, skema salah, serta file >5 MiB. Data saat ini tidak boleh tertimpa. Batalkan konfirmasi restore valid dan pastikan data tetap utuh.
- [ ] Ekspor JSON, periksa file di Downloads, lalu pulihkan salinannya pada origin/profil uji. Periksa jumlah resep, versi, dan skor.
- [ ] Uji Back/Forward, tombol kembali UI, dan perpindahan navigasi dengan form kotor. Batal harus mempertahankan isian; Buang harus meninggalkannya.
- [ ] Uji Back saat dialog terbuka, Back cepat berulang, serta kembali dari compare. Pastikan tidak ada loop atau editor tersimpan yang terbuka kembali.
- [ ] Gulir koleksi, buka detail, lalu kembali. Posisi koleksi harus pulih.
- [ ] Uji keyboard desimal, date picker, textarea, perubahan address bar, landscape, dan pinch zoom. Simpan/Batal serta field terakhir tetap terjangkau.
- [ ] Periksa lebar 320–412px, teks 200%, nama/catatan panjang, dan 20+ versi: halaman tidak overflow horizontal; pemilih versi boleh bergulir mendatar.
- [ ] Uji TalkBack dan keyboard: label, urutan fokus, pesan error, opsi skor, dialog, serta fokus setelah dialog ditutup. Informasi tidak hanya dibedakan dengan warna.
- [ ] Aktifkan reduced motion dan periksa print preview detail/compare.
- [ ] Pada profil uji, simulasikan storage ditolak/penuh/rusak dan perubahan dari tab lain. Pesan harus terlihat, isian tidak hilang, dan data lama tidak tertimpa. Periksa unduhan raw untuk data rusak.

Setelah review, pertahankan perubahan lokal dan laporkan hasil serta risiko terbuka. Jangan menjalankan push, PR, merge, atau deployment tanpa persetujuan.
