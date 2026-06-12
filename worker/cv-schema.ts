// CV parsing schema — tek değiştirilen yer burası.
// Yeni field ekle → PARSE_VERSION'ı +1 yap → POST /api/admin/sync-cv çalıştır.

export const PARSE_VERSION = 1

// Claude'a gönderilen JSON şema açıklaması.
// Yeni alan eklenince buraya da ekle.
export const PARSE_SCHEMA = `{
  "resume_text": "CV'nin tüm içeriği düz metin — bölüm başlıkları korunarak",
  "total_experience_years": "toplam iş deneyimi yıl cinsinden (ondalık, örn: 3.5), bilinmiyorsa null",
  "education": [
    { "school": "okul/üniversite adı", "degree": "bölüm veya derece", "year": "mezuniyet yılı integer ya da null" }
  ],
  "work_history": [
    {
      "company": "şirket adı",
      "role": "pozisyon/unvan",
      "start": "başlangıç YYYY-MM formatında ya da null",
      "end": "bitiş YYYY-MM formatında, hâlâ çalışıyorsa null",
      "months": "bu pozisyondaki süre ay cinsinden integer ya da null"
    }
  ],
  "skills": ["teknik beceri listesi"],
  "languages": ["dil listesi"]
}`
