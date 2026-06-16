import fs from 'node:fs';

const filePath = 'c:/Users/kanim/Desktop/Yuki - AI/public/index.html';
let content = fs.readFileSync(filePath, 'utf8');

// Definisikan target yang rusak
let target = `    function setIcon(el, name) {
      el.innerHTML = \`<i data-lucide="\${name}"></i>\`
      window.lucide && lucide.createIcons()
        // Ekstrak image URL dari query parameter ?img=...
        let imageUrl = ''
        try {
          const parsedUrl = new URL(url.trim())
          imageUrl = parsedUrl.searchParams.get('img') || ''
        } catch (e) {}

        window.comicCardsData.push({ title: title.trim(), meta: meta.trim(), url: url.trim(), image: imageUrl })
        
        const cardHtml = \`<div class="comic-card" onclick="openComicModal(\${idx})">
          \${imageUrl ? \`<img class="comic-card-thumb" src="\${escapeHtml(imageUrl)}" referrerpolicy="no-referrer" alt="Cover" />\` : ''}
          <div class="comic-card-details">
            <div class="comic-card-title">\${escapeHtml(title.trim())}</div>
            <div class="comic-card-meta">\${escapeHtml(meta.trim())}</div>
          </div>
        </div>\`

        return stash(cardHtml)
      })`;

const replacement = `    function setIcon(el, name) {
      el.innerHTML = \`<i data-lucide="\${name}"></i>\`
      window.lucide && lucide.createIcons()
    }

    // escape HTML biar aman sebelum diformat
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    // teks bersih buat dibacakan TTS (buang aksi *...* dan (...))
    function cleanForSpeech(text) {
      return text.replace(/\\*[^*]+\\*/g, ' ').replace(/\\([^)]*\\)/g, ' ').replace(/\\s{2,}/g, ' ').trim()
    }

    // format pesan Yuki: link aktif + aksi *...* jadi narasi miring
    function formatMsg(text) {
      let html = escapeHtml(text)
      const links = []
      const stash = (a) => { links.push(a); return '@@LNK' + (links.length - 1) + '@@' }

      // Deteksi & format blok kartu komik Ryukomik
      // Format: **Judul**\\nChapter · Genre\\n[Link](url)
      const comicRegex = /\\*\\*([^*]+)\\*\\*\\n([^\\n]+)\\n\\[Link\\]\\((https?:\\/\\/ryukomik\\.my\\.id\\/[^\\s)]+)\\)/gi
      html = html.replace(comicRegex, (m, title, meta, url) => {
        window.comicCardsData = window.comicCardsData || []
        const idx = window.comicCardsData.length
        
        // Ekstrak image URL dari query parameter ?img=...
        let imageUrl = ''
        try {
          const parsedUrl = new URL(url.trim())
          imageUrl = parsedUrl.searchParams.get('img') || ''
        } catch (e) {}

        window.comicCardsData.push({ title: title.trim(), meta: meta.trim(), url: url.trim(), image: imageUrl })
        
        const cardHtml = \`<div class="comic-card" onclick="openComicModal(\${idx})">
          \${imageUrl ? \`<img class="comic-card-thumb" src="\${escapeHtml(imageUrl)}" referrerpolicy="no-referrer" alt="Cover" />\` : ''}
          <div class="comic-card-details">
            <div class="comic-card-title">\${escapeHtml(title.trim())}</div>
            <div class="comic-card-meta">\${escapeHtml(meta.trim())}</div>
          </div>
        </div>\`

        return stash(cardHtml)
      })`;

// Normalisasi carriage return agar sama
content = content.replace(/\r\n/g, '\n');
target = target.replace(/\r\n/g, '\n');

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patch successfully applied!');
} else {
  console.error('Target code block not found in file even after normalization!');
  // Dump a snippet of file content around the broken area to see what it is
  const idx = content.indexOf('window.lucide && lucide.createIcons()');
  if (idx !== -1) {
    console.log('Snippet in file around the target:');
    console.log(content.slice(idx, idx + 400));
  }
}
