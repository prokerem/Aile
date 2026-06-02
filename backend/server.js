require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

const server = http.createServer(app);
// Eski io tanımını silip yerine bunu yapıştırın:
const io = new Server(server, { 
    cors: { 
        origin: "*", // Her yerden gelen isteğe izin ver
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e7 
});


// GİZLİ ENV DOSYASINDAN MONGODB LINKINI OKUMA
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
  .then(() => console.log('🚀 MongoDB Atlas Bulut Veritabanına Başarıyla Bağlanıldı!'))
  .catch(err => console.error('❌ Veritabanı bağlantı hatası:', err));

// VERİTABANI ŞEMASI (ŞABLON)
const MesajSema = new mongoose.Schema({
    id: String,
    gonderen: String,
    alici: String,
    metin: String,
    resim: String,
    ses: String,
    tarih: String,
    okundu: [String]
});
const MesajModel = mongoose.model('Mesaj', MesajSema);

let aileDurumlari = {
    'Babam': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Annem': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Selim': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Kerem': { durum: 'offline', sonGiris: 'Bilinmiyor' }
};
let soketHaritasi = {};

io.on('connection', (socket) => {
    
    // Kullanıcı giriş yaptığında (Örn: Baban veya Selim oturum açtığında)
    socket.on('aile_giris_yap', async (isim) => {
        if (aileDurumlari[isim]) {
            aileDurumlari[isim].durum = 'online';
            aileDurumlari[isim].sonGiris = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            soketHaritasi[socket.id] = { ad: isim };
            
            io.emit('durum_guncelleme', aileDurumlari);
            console.log(`[GİRİŞ] -> ${isim} sisteme girdi.`);

            try {
                // BULUTTAN NOKTA ATIŞI ARAMA SORGUSU
                // Baban yokken yazılan grup mesajlarını ve ona gelen özel mesajları bulur
                const gecmisMesajlar = await MesajModel.find({
                    $or: [
                        { alici: 'Ortak Grup' },
                        { alici: isim },
                        { gonderen: isim }
                    ]
                });
                
                // Mesaj geçmişini sadece oturum açan bu cihaza teslim et
                socket.emit('gecmis_mesajlari_yukle', gecmisMesajlar);
            } catch (err) {
                console.error('Mesajlar buluttan çekilemedi:', err);
            }
        }
    });

    // Yeni mesaj geldiğinde
    socket.on('yeni_mesaj', async (mesajPaketi) => {
        try {
            // Kim nerede olursa olsun, mesaj anında kalıcı olarak buluta yazılır
            const yeniKayiMesaj = new MesajModel(mesajPaketi);
            await yeniKayiMesaj.save();
            
            // O an aktif olan herkese mesajı salisesinde ilet
            io.emit('mesajı_al', mesajPaketi);
        } catch (error) {
            console.error('Mesaj buluta kaydedilemedi:', error);
        }
    });

    // Mesaj okundu / görüldü bilgisi
    socket.on('mesaj_goruldu_yap', async ({ id, kim }) => {
        try {
            await MesajModel.findOneAndUpdate({ id: id }, { $addToSet: { okundu: kim } });
            io.emit('mesaj_okundu_guncelle', { id, okuyanlar: kim });
        } catch (err) {
            console.error('Okundu bilgisi güncellenemedi:', err);
        }
    });

    // Manuel çıkış yapıldığında durum kontrolü
    socket.on('aile_cikis_yap', (isim) => {
        if (aileDurumlari[isim]) {
            aileDurumlari[isim].durum = 'offline';
            aileDurumlari[isim].sonGiris = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            io.emit('durum_guncelleme', aileDurumlari);
        }
    });

    socket.on('disconnect', () => {
        const kullanici = soketHaritasi[socket.id];
        if (kullanici && aileDurumlari[kullanici.ad]) {
            aileDurumlari[kullanici.ad].durum = 'offline';
            aileDurumlari[kullanici.ad].sonGiris = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            delete soketHaritasi[socket.id];
            io.emit('durum_guncelleme', aileDurumlari);
        }
    });
});

// Render platformunun vereceği dinamik portu ayarlar
const PORT = process.env.PORT || 3001; 

server.listen(PORT, () => {
    console.log(`Bulut Senkronizasyonlu Aile Sistemi Aktif! Port: ${PORT}`);
});
