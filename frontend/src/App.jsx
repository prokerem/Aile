import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

// Linkin sonunda kesinlikle eğik çizgi (/) OLMAMALIDIR
const socket = io("https://aile.onrender.com", {
    transports: ["websocket", "polling"] // Vercel ve Render arasındaki iletişimi garantiye alır
});


function App() {
  const [sifre, setSifre] = useState("");
  const [girisYapildi, setGirisYapildi] = useState(false);
  const [secilenKisi, setSecilenKisi] = useState(""); // Babam, Annem, Selim, Kerem

  const [aktifSohbet, setAktifSohbet] = useState("Ortak Grup");
  const [metinMesaj, setMetinMesaj] = useState("");
  const [resim, setResim] = useState(null);
  const [cevrimiciListesi, setCevrimiciListesi] = useState({});

  // LocalStorage TAMAMEN KALKTI! İlk açılışta liste bomboş başlar.
  const [mesajlar, setMesajlar] = useState([]);

  const [toast, setToast] = useState({ gorun: false, mesaj: "", tip: "" });
  const [sesKaydediliyor, setSesKaydediliyor] = useState(false);
  const [sesBlob, setSesBlob] = useState(null);
  const [sesSuresi, setSesSuresi] = useState(0);

  const mediaRecorderRef = useRef(null);
  const mesajSonuRef = useRef(null);
  const sayacIntervalRef = useRef(null);

  const aileUyeleri = ["Babam", "Annem", "Selim", "Kerem"];

  // Sayfayı her yeni mesaj geldiğinde otomatik aşağı kaydırır
  useEffect(() => {
    mesajSonuRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mesajlar]);

  useEffect(() => {
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    if (girisYapildi) {
      socket.emit("aile_giris_yap", secilenKisi);
    }

    // BULUTTAN GELEN TÜM ESKİ SOHBET GEÇMİŞİNİ EKRANA BASMA
    socket.on("gecmis_mesajlari_yukle", (bulutMesajlari) => {
      setMesajlar(bulutMesajlari);
      toastGoster("Tüm mesajlar buluttan başarıyla yüklendi!", "basari");
    });

    socket.on("durum_guncelleme", (data) => {
      setCevrimiciListesi(data);
    });

    socket.on("mesajı_al", (data) => {
      const ortakMesaj = data.alici === "Ortak Grup";
      const banaOzel =
        data.alici === secilenKisi || data.gonderen === secilenKisi;

      if (ortakMesaj || banaOzel) {
        setMesajlar((eski) => {
          if (eski.some((m) => m.id === data.id)) return eski;
          return [...eski, data];
        });

        if (
          aktifSohbet === data.gonderen ||
          (data.alici === "Ortak Grup" && aktifSohbet === "Ortak Grup")
        ) {
          if (data.gonderen !== secilenKisi) {
            socket.emit("mesaj_goruldu_yap", { id: data.id, kim: secilenKisi });
          }
        }

        if (
          Notification.permission === "granted" &&
          data.gonderen !== secilenKisi
        ) {
          new Notification(`💬 ${data.gonderen}`, {
            body: data.metin || "Yeni bir medya gönderdi.",
          });
        }
      }
    });

    socket.on("mesaj_okundu_guncelle", ({ id, okuyanlar }) => {
      setMesajlar((eski) =>
        eski.map((m) =>
          m.id === id
            ? { ...m, okundu: [...new Set([...(m.okundu || []), okuyanlar])] }
            : m,
        ),
      );
    });

    return () => {
      socket.off("gecmis_mesajlari_yukle");
      socket.off("durum_guncelleme");
      socket.off("mesajı_al");
      socket.off("mesaj_okundu_guncelle");
    };
  }, [girisYapildi, secilenKisi, aktifSohbet]);

  const toastGoster = (mesaj, tip) => {
    setToast({ gorun: true, mesaj, tip });
    setTimeout(() => setToast({ gorun: false, mesaj: "", tip: "" }), 2000);
  };

  const handleGiris = (e) => {
    e.preventDefault();
    if (sifre === "aile123" && secilenKisi !== "") {
      toastGoster(
        `Hoş geldin ${secilenKisi}! Başarıyla giriş yapıldı.`,
        "basari",
      );
      setTimeout(() => setGirisYapildi(true), 800);
    } else {
      toastGoster("Hatalı şifre veya kimlik seçilmedi!", "hata");
    }
  };
  // Fotoğraf Seçildiğinde Çalışan Güvenli Fonksiyon
  const resimDegisti = (e) => {
    // Eğer kullanıcı bir dosya seçtiyse ve bu dosya gerçekten varsa işlemleri başlat
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();

      reader.onloadend = () => {
        setResim(reader.result); // Resmi Base64 formatına çevirip hafızaya kaydeder
      };

      reader.readAsDataURL(file);
    } else {
      // Kullanıcı resim seçmekten vazgeçip iptal ettiyse hafızayı temizle, çökmesini önle
      setResim(null);
    }
  };

  const sesKaydetBaslat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => setSesBlob(reader.result);
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((track) => track.stop());
      };
      setSesSuresi(0);
      mediaRecorderRef.current.start();
      setSesKaydediliyor(true);
      sayacIntervalRef.current = setInterval(
        () => setSesSuresi((eski) => eski + 1),
        1000,
      );
    } catch (err) {
      toastGoster("Mikrofon izni reddedildi!", "hata");
    }
  };

  const sesKaydetDurdur = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      clearInterval(sayacIntervalRef.current);
      setSesKaydediliyor(false);
    }
  };

  const sureFormatla = (toplamSaniye) => {
    const dk = String(Math.floor(toplamSaniye / 60)).padStart(2, "0");
    const sn = String(toplamSaniye % 60).padStart(2, "0");
    return `${dk}:${sn}`;
  };

  const mesajGonder = (e) => {
    e.preventDefault();
    if (!metinMesaj.trim() && !resim && !sesBlob) return;

    const digerleri = aileUyeleri.filter((kisi) => kisi !== secilenKisi);

    const yeniMesaj = {
      id: Math.random().toString(36).substr(2, 9),
      gonderen: secilenKisi,
      alici: aktifSohbet,
      metin: metinMesaj,
      resim: resim,
      ses: sesBlob,
      tarih: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      okundu: [],
      hedefCihazlar: digerleri,
    };

    socket.emit("yeni_mesaj", yeniMesaj);
    setMetinMesaj("");
    setResim(null);
    setSesBlob(null);
  };

  const gorunurMesajlar = mesajlar.filter((m) => {
    if (aktifSohbet === "Ortak Grup") return m.alici === "Ortak Grup";
    return (
      (m.gonderen === secilenKisi && m.alici === aktifSohbet) ||
      (m.gonderen === aktifSohbet && m.alici === secilenKisi)
    );
  });
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-2 md:p-6 text-slate-100 font-sans relative">
      {/* 2 SANİYELİK KÜRESEL TOAST UYARI PANELI */}
      {toast.gorun && (
        <div
          className={`fixed top-5 z-50 px-6 py-3 rounded-xl font-bold shadow-2xl border transition-all transform animate-bounce text-sm ${
            toast.tip === "basari"
              ? "bg-emerald-500 border-emerald-400 text-slate-950"
              : "bg-red-500 border-red-400 text-white"
          }`}
        >
          {toast.mesaj}
        </div>
      )}

      {/* GİRİŞ EKRANI */}
      {!girisYapildi ? (
        <form
          onSubmit={handleGiris}
          className="bg-slate-900 p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-slate-800 text-slate-100"
        >
          <h2 className="text-2xl font-black text-center text-emerald-400 mb-6">
            ✨ Aile İletişim Portalı
          </h2>

          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Kimsiniz?
            </label>
            <select
              value={secilenKisi}
              onChange={(e) => setSecilenKisi(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Seçiniz...</option>
              {aileUyeleri.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Aile Giriş Şifresi
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={sifre}
              onChange={(e) => setSifre(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black py-3.5 rounded-xl transition-all shadow-lg cursor-pointer"
          >
            Güvenli Giriş Yap
          </button>
        </form>
      ) : (
        // ANA SOHBET MASASI (RESPONSIVE)
        <div className="bg-slate-900 rounded-3xl shadow-2xl w-full max-w-5xl border border-slate-800 flex flex-col md:flex-row h-[90vh] md:h-[650px] overflow-hidden">
          {/* SOL PANEL: MENÜLER VE DURUMLAR */}
          <div className="w-full md:w-1/3 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col h-1/3 md:h-full">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-black text-lg text-emerald-400">
                💬 Mesajlaşma
              </h3>
              <span className="bg-slate-800 border border-slate-700 text-amber-400 text-xs font-bold px-3 py-1 rounded-full">
                {secilenKisi}
              </span>
            </div>

            <div className="flex-1 p-2 overflow-y-auto space-y-1">
              <button
                onClick={() => setAktifSohbet("Ortak Grup")}
                className={`w-full text-left px-4 py-3.5 rounded-xl flex items-center gap-3 transition-all cursor-pointer ${
                  aktifSohbet === "Ortak Grup"
                    ? "bg-emerald-500 text-slate-950 font-black shadow-md"
                    : "hover:bg-slate-800/60"
                }`}
              >
                <span className="text-xl">🌍</span>
                <div>
                  <p className="text-sm font-bold">Ortak Aile Grubu</p>
                  <p
                    className={`text-xs ${aktifSohbet === "Ortak Grup" ? "text-slate-800" : "text-slate-400"}`}
                  >
                    Genel grup sohbeti
                  </p>
                </div>
              </button>

              <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase px-4 pt-3 pb-1">
                Özel Odalar
              </div>

              {aileUyeleri
                .filter((u) => u !== secilenKisi)
                .map((kisi) => {
                  const cevrimiciMi =
                    cevrimiciListesi[kisi]?.durum === "online";
                  const sonGorulme =
                    cevrimiciListesi[kisi]?.sonGiris || "Bilinmiyor";
                  const secili = aktifSohbet === kisi;

                  return (
                    <button
                      key={kisi}
                      onClick={() => setAktifSohbet(kisi)}
                      className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all cursor-pointer ${
                        secili
                          ? "bg-slate-800 border border-slate-700 font-bold"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <span className="text-xl">👤</span>
                          <span
                            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${cevrimiciMi ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`}
                          ></span>
                        </div>
                        <div>
                          <p className="text-sm font-bold">{kisi}</p>
                          <p className="text-[10px] text-slate-400">
                            {cevrimiciMi
                              ? "Çevrim içi"
                              : `Giriş: ${sonGorulme}`}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* SAĞ PANEL: CANLI AKIŞ */}
          <div className="flex-1 flex flex-col h-2/3 md:h-full bg-slate-950/30">
            <div className="p-4 bg-slate-900/40 border-b border-slate-800 flex justify-between items-center">
              <h4 className="font-black text-sm text-slate-200">
                {aktifSohbet === "Ortak Grup"
                  ? "🌍 Ortak Aile Odası"
                  : `🔒 ${aktifSohbet} ile Özel`}
              </h4>

              <button
                onClick={() => {
                  socket.emit("aile_cikis_yap", secilenKisi);
                  setGirisYapildi(false);
                  setSifre("");
                  toastGoster("Oturum kapatıldı.", "hata");
                }}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition-all"
              >
                🚪 Çıkış Yap
              </button>
            </div>

            {/* Mesaj Akışı */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col">
              {gorunurMesajlar.map((m, index) => {
                const bendenMi = m.gonderen === secilenKisi;
                const herkesOkudu =
                  aktifSohbet === "Ortak Grup"
                    ? m.okundu?.length >= aileUyeleri.length - 1
                    : m.okundu?.includes(aktifSohbet);

                return (
                  <div
                    key={index}
                    className={`max-w-[75%] p-3 rounded-2xl border flex flex-col shadow-sm ${
                      bendenMi
                        ? "bg-emerald-600 border-emerald-500 text-slate-950 self-end rounded-tr-none"
                        : "bg-slate-900 border-slate-800 text-slate-200 self-start rounded-tl-none"
                    }`}
                  >
                    {aktifSohbet === "Ortak Grup" && !bendenMi && (
                      <span className="text-[10px] font-black text-emerald-400 mb-1">
                        {m.gonderen}
                      </span>
                    )}
                    {m.metin && (
                      <p className="text-sm font-semibold break-words whitespace-pre-wrap">
                        {m.metin}
                      </p>
                    )}
                    {m.resim && (
                      <img
                        src={m.resim}
                        alt="Medya"
                        className="rounded-xl max-h-48 w-full object-cover mt-1.5"
                      />
                    )}
                    {m.ses && (
                      <audio
                        src={m.ses}
                        controls
                        className="w-full h-8 max-w-[210px] mt-1.5 filter invert"
                      />
                    )}

                    <div className="flex justify-end items-center gap-1 mt-1 text-[9px] opacity-60 font-medium self-end">
                      <span>{m.tarih}</span>
                      {bendenMi && (
                        <span
                          className={
                            herkesOkudu
                              ? "text-blue-300 font-bold"
                              : "text-slate-400"
                          }
                        >
                          {herkesOkudu ? "✔️✔️" : "✔️"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={mesajSonuRef} />
            </div>

            {/* Alt Form Çubuğu */}
            <form
              onSubmit={mesajGonder}
              className="p-3 bg-slate-900/60 border-t border-slate-800 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                {sesKaydediliyor ? (
                  <div className="flex-1 bg-slate-950 border border-red-500/30 text-red-400 px-4 py-2.5 rounded-xl text-sm font-black flex items-center justify-between animate-pulse">
                    <span className="flex items-center gap-2">
                      🔴 Ses Kaydediliyor...
                    </span>
                    <span>{sureFormatla(sesSuresi)}</span>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder={`${aktifSohbet} odasına yazın...`}
                    value={metinMesaj}
                    onChange={(e) => setMetinMesaj(e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                )}

                <button
                  type="submit"
                  disabled={sesKaydediliyor}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 text-slate-950 font-black px-5 py-2.5 rounded-xl text-sm transition-all cursor-pointer"
                >
                  Gönder
                </button>
              </div>

              <div className="flex gap-2 items-center text-xs text-slate-400 font-semibold">
                <label className="bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-700">
                  📷 Fotoğraf
                  <input
                    type="file"
                    accept="image/*"
                    onChange={resimDegisti}
                    className="hidden"
                  />
                </label>

                {/* Akıllı Ses Kayıt Mekanizması */}
                {!sesKaydediliyor ? (
                  <button
                    type="button"
                    onClick={sesKaydetBaslat}
                    className="bg-slate-800 border border-slate-700 hover:bg-slate-700 px-3 py-1.5 rounded-lg cursor-pointer font-bold transition-all"
                  >
                    🎙️ Ses Kaydet
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={sesKaydetDurdur}
                    className="bg-red-500 text-white px-3 py-1.5 rounded-lg cursor-pointer font-black border border-red-400 animate-pulse"
                  >
                    🛑 Kaydı Durdur
                  </button>
                )}

                {/* Seçilen Medyaların Durum Göstergeleri */}
                {resim && (
                  <span className="text-emerald-400 font-black ml-2 animate-fade-in">
                    ✓ Fotoğraf Eklendi
                  </span>
                )}
                {sesBlob && (
                  <span className="text-emerald-400 font-black ml-2 animate-fade-in">
                    ✓ Ses Kaydı Hazır
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
