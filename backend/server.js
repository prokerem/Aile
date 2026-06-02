require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e7 
});

// GİZLİ ENV DOSYASINDAN MONGODB LINKINI OKUMA
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
    console.error('❌ KRİTİK HATA: Render panelinde MONGO_URI değişkeni tanımlanmamış veya boş!');
}

// BAĞLANTI DURUMU TAKİPÇİLERİ (Gelişmiş Hata Türleri İçin)
mongoose.connection.on('connecting', () => {
    console.log('🔄 MongoDB Atlas bulutuna bağlanılmaya çalışılıyor...');
});

mongoose.connection.on('connected', () => {
    console.log('🚀 MongoDB Atlas Bulut Veritabanına Başarıyla Bağlanıldı!');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB Bağlantı Hatası Türü:', err.name);
    console.error('📝 Hata Detayı:', err.message);
    if (err.message.includes('ETIMEDOUT') || err.message.includes('MongooseError')) {
        console.error('💡 ÇÖZÜM ÖNERİSİ: IP erişim izniniz (0.0.0.0/0) MongoDB panelinde henüz aktifleşmemiş veya şifreniz hatalı.');
    }
});

mongoose.connection.on('disconnected', () => {
    console.log('🔌 MongoDB bağlantısı koptu!');
});

// Veritabanına bağlantıyı başlat
mongoose.connect(mongoURI)
  .catch(err => console.error('Initial Connection Error:', err));

// VERİTABANI ŞEMASI
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

// --- 10 SANİYEDE BİR YENİ MESAJ KONTROLÜ (İSTEDİĞİNİZ ÖZELLİK) ---
let sonKontrolZamani = new Date().toISOString();

setInterval(async () => {
    // Eğer veritabanına bağlı değilsek sorgu atmayıp loga bilgi yazalım
    if (mongoose.connection.readyState !== 1) {
        console.log('⏳ Veritabanı bağlı olmadığı için 10 saniyelik mesaj kontrolü atlandı.');
        return;
    }

    try {
        console.log('🔍 [10 Saniye Kontrolü] Yeni mesaj var mı bakılıyor...');
        // Son kontrol zamanından sonra eklenmiş mesajları bul
        const yeniMesajlar = await MesajModel.find({
            tarih: { $gt: sonKontrolZamani }
        });

        if (yeniMesajlar.length > 0) {
            console.log(`✉️ Veritabanında ${yeniMesajlar.length} adet yeni mesaj tespit edildi!`);
            // Aktif cihazlara yeni verileri gönder
            io.emit('otomatik_yeni_mesajlar', yeniMesajlar);
            // Zaman damgasını güncelle
            sonKontrolZamani = new Date().toISOString();
        } else {
            console.log('✅ Yeni mesaj yok.');
        }
    } catch (err) {
        console.error('❌ 10 saniyelik otomatik kontrol sırasında hata oluştu:', err.message);
    }
}, 10000); // 10 saniye (10000 ms)
// -------------------------------------------------------------

let aileDurumlari = {
    'Babam': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Annem': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Selim': { durum: 'offline', sonGiris: 'Bilinmiyor' },
    'Kerem': { durum: 'offline', sonGiris: 'Bilinmiyor' }
};
let soketHaritasi = {};

io.on('connection', (socket) => {
    
    socket.on('aile_giris_yap', async (isim) => {
        if (aileDurumlari[isim]) {
            aileDurumlari[isim].durum = 'online';
            aileDurumlari[isim].sonGiris = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            soketHaritasi[socket.id] = { ad: isim };
            
            io.emit('durum_guncelleme', aileDurumlari);
            console.log(`[GİRİŞ] -> ${isim} sisteme girdi.`);

            try {
                const gecmisMesajlar = await MesajModel.find({
                    $or: [
                        { alici: 'Ortak Grup' },
                        { alici: isim },
                        { gonderen: isim }
                    ]
                });
                socket.emit('gecmis_mesajlari_yukle', gecmisMesajlar);
            } catch (err) {
                console.error('Mesajlar buluttan çekilemedi:', err.message);
            }
        }
    });

    socket.on('yeni_mesaj', async (mesajPaketi) => {
        try {
            const yeniKayiMesaj = new MesajModel(mesajPaketi);
            await yeniKayiMesaj.save();
            io.emit('mesajı_al', mesajPaketi);
            // Manuel eklenen mesajların zaman damgasını da kaçırmamak için güncelleyelim
            sonKontrolZamani = new Date().toISOString();
        } catch (error) {
            console.error('❌ Mesaj buluta kaydedilemedi. Detay:', error.message);
        }
    });

    socket.on('mesaj_goruldu_yap', async ({ id, kim }) => {
        try {
            await MesajModel.findOneAndUpdate({ id: id }, { $addToSet: { okundu: kim } });
            io.emit('mesaj_okundu_guncelle', { id, okuyanlar: kim });
        } catch (err) {
            console.error('Okundu bilgisi güncellenemedi:', err.message);
        }
    });

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

const PORT = process.env.PORT || 3001; 

server.listen(PORT, () => {
    console.log(`Bulut Senkronizasyonlu Aile Sistemi Aktif! Port: ${PORT}`);
});
