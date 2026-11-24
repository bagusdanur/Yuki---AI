import { useState } from 'react'
import { Download, Flame, Lock, X } from 'lucide-react'
import type { Milestone, PinnedMessage, ProactivePushSettings, RelationshipJournalResponse } from '../types'

interface Props {
  username: string
  bond: string
  bondValue: number
  milestones: Milestone[]
  journal: RelationshipJournalResponse | null
  tab: 'timeline' | 'memory' | 'pins'
  onTabChange: (tab: 'timeline' | 'memory' | 'pins') => void
  nicknameInput: string
  onNicknameChange: (value: string) => void
  nicknameSaving: boolean
  nicknameNotice: string
  onSaveNickname: (event: React.FormEvent) => void
  proactivePush: ProactivePushSettings | null
  proactiveSaving: boolean
  onToggleProactivePush: (next: Partial<ProactivePushSettings>) => void
  pins: PinnedMessage[]
  onUnpin: (pinId: number) => void
  onClose: () => void
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
      if (lines.length >= maxLines) break
    } else {
      line = test
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'
  }
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export default function RelationshipJournalModal({
  username, bond, bondValue, milestones, journal, tab, onTabChange,
  nicknameInput, onNicknameChange, nicknameSaving, nicknameNotice, onSaveNickname,
  proactivePush, proactiveSaving, onToggleProactivePush, pins, onUnpin, onClose
}: Props) {
  const [exporting, setExporting] = useState(false)
  const streakCurrent = journal?.streak?.current ?? journal?.stats?.streakDays ?? 0
  const streakLongest = journal?.streak?.longest ?? journal?.stats?.longestStreak ?? 0

  async function handleDownloadBondCard() {
    if (exporting) return
    setExporting(true)
    try {
      const W = 1080, H = 1350
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Latar belakang gradien malam gelap + glow ungu-pink
      const bg = ctx.createLinearGradient(0, 0, W, H)
      bg.addColorStop(0, '#0e101c')
      bg.addColorStop(0.55, '#13162a')
      bg.addColorStop(1, '#0b0c14')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      const glow1 = ctx.createRadialGradient(220, 200, 30, 220, 200, 480)
      glow1.addColorStop(0, 'rgba(139, 125, 255, 0.28)')
      glow1.addColorStop(1, 'rgba(139, 125, 255, 0)')
      ctx.fillStyle = glow1
      ctx.fillRect(0, 0, W, H)

      const glow2 = ctx.createRadialGradient(880, 1080, 30, 880, 1080, 440)
      glow2.addColorStop(0, 'rgba(244, 114, 182, 0.22)')
      glow2.addColorStop(1, 'rgba(244, 114, 182, 0)')
      ctx.fillStyle = glow2
      ctx.fillRect(0, 0, W, H)

      // Frame kartu utama
      roundRect(ctx, 56, 56, W - 112, H - 112, 36)
      ctx.fillStyle = 'rgba(18, 22, 36, 0.88)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.34)'
      ctx.stroke()

      // Header brand
      ctx.fillStyle = '#a78bfa'
      ctx.font = '700 24px ui-monospace, Menlo, monospace'
      ctx.fillText('YUKI AI × RYUKOMIK', 112, 146)

      ctx.fillStyle = 'rgba(167, 139, 250, 0.16)'
      roundRect(ctx, W - 310, 110, 198, 52, 26)
      ctx.fill()
      ctx.fillStyle = '#d8ccff'
      ctx.font = '700 22px system-ui, sans-serif'
      ctx.fillText('KARTU KEDEKATAN', W - 288, 143)

      // Nama user & panggilan khusus
      ctx.fillStyle = '#f4f4fb'
      ctx.font = '800 66px system-ui, -apple-system, sans-serif'
      ctx.fillText(username || 'Kamu', 112, 258)

      const subLine = journal?.nickname
        ? `Panggilan Yuki: "${journal.nickname}"`
        : 'Teman ngobrol Yuki di Ryukomik'
      ctx.fillStyle = '#a4aac2'
      ctx.font = '500 30px system-ui, sans-serif'
      ctx.fillText(subLine, 112, 308)

      // Box Bond Level + progress bar
      roundRect(ctx, 112, 360, W - 224, 184, 24)
      ctx.fillStyle = 'rgba(139, 125, 255, 0.12)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(139, 125, 255, 0.36)'
      ctx.stroke()

      ctx.fillStyle = '#c5bcff'
      ctx.font = '700 22px ui-monospace, monospace'
      ctx.fillText('LEVEL KEDEKATAN', 148, 412)

      ctx.fillStyle = '#ffffff'
      ctx.font = '800 50px system-ui, sans-serif'
      ctx.fillText(bond, 148, 474)

      const scoreText = `${Math.round(bondValue)} / 100`
      ctx.fillStyle = '#f472b6'
      ctx.font = '800 44px ui-monospace, monospace'
      const sw = ctx.measureText(scoreText).width
      ctx.fillText(scoreText, W - 148 - sw, 472)

      // Progress bar
      const barX = 148, barY = 502, barW = W - 296, barH = 16
      roundRect(ctx, barX, barY, barW, barH, 8)
      ctx.fillStyle = 'rgba(255,255,255,0.1)'
      ctx.fill()
      const fillW = Math.max(20, Math.round((Math.min(100, Math.max(0, bondValue)) / 100) * barW))
      roundRect(ctx, barX, barY, fillW, barH, 8)
      const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0)
      barGrad.addColorStop(0, '#8b7dff')
      barGrad.addColorStop(1, '#f472b6')
      ctx.fillStyle = barGrad
      ctx.fill()

      // Grid 4 statistik
      const stats = [
        { label: 'TOTAL OBROLAN', val: String(journal?.stats?.totalMessages ?? 0), color: '#c4b5fd' },
        { label: 'STREAK HARIAN', val: `${streakCurrent} hari`, color: '#fbbf24' },
        { label: 'FAKTA DIINGAT', val: String(journal?.stats?.factsCount ?? 0), color: '#38bdf8' },
        { label: 'PESAN DIPIN', val: String(pins.length), color: '#34d399' },
      ]
      const tileW = (W - 224 - 24) / 2
      const tileH = 146
      stats.forEach((st, idx) => {
        const col = idx % 2
        const row = Math.floor(idx / 2)
        const tx = 112 + col * (tileW + 24)
        const ty = 580 + row * (tileH + 22)
        roundRect(ctx, tx, ty, tileW, tileH, 22)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)'
        ctx.stroke()

        ctx.fillStyle = '#8b92ab'
        ctx.font = '700 20px ui-monospace, monospace'
        ctx.fillText(st.label, tx + 30, ty + 48)

        ctx.fillStyle = st.color
        ctx.font = '800 46px system-ui, sans-serif'
        ctx.fillText(st.val, tx + 30, ty + 112)
      })

      // Kutipan favorit Yuki
      const favPin = pins.find(p => p.role === 'assistant') || pins[0]
      const quote = favPin?.content
        ? favPin.content
        : bondValue >= 78
          ? 'Bukan berarti aku selalu nungguin kamu chat ya… tapi kalau kamu nggak muncul, rasanya agak sepi aja.'
          : bondValue >= 50
            ? 'Yaudah sih, aku ingat kok cerita-cerita kamu. Jangan kepedean dulu.'
            : 'Kalau lagi gabut atau mau cari komik seru, mampir aja ke sini lagi.'

      roundRect(ctx, 112, 932, W - 224, 240, 24)
      ctx.fillStyle = 'rgba(244, 114, 182, 0.07)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.25)'
      ctx.stroke()

      ctx.fillStyle = '#f9a8d4'
      ctx.font = '700 20px ui-monospace, monospace'
      ctx.fillText(favPin ? 'KUTIPAN FAVORIT DIPIN' : 'CATATAN DARI YUKI', 148, 982)

      ctx.fillStyle = '#eef0f8'
      ctx.font = '500 28px system-ui, sans-serif'
      const lines = wrapCanvasText(ctx, `“${quote}”`, W - 296, 4)
      lines.forEach((ln, i) => ctx.fillText(ln, 148, 1034 + i * 38))

      // Footer
      const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      ctx.fillStyle = '#7e859e'
      ctx.font = '600 22px ui-monospace, monospace'
      ctx.fillText('yuki.ryukomik.com', 112, H - 104)
      const dw = ctx.measureText(todayStr).width
      ctx.fillText(todayStr, W - 112 - dw, H - 104)

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const safeName = (username || 'user').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 24)
      const filename = `yuki-kedekatan-${safeName}.png`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="timeline-overlay" onClick={onClose}>
      <section className="timeline-card journal-modal" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <small>Buku Kenangan · {bond} ({Math.round(bondValue)}/100)</small>
            <h2>Hubungan Kalian</h2>
          </div>
          <button onClick={onClose} aria-label="Tutup buku kenangan"><X size={17} /></button>
        </header>

        <div className="memory-tabs journal-tabs">
          <button type="button" className={tab === 'timeline' ? 'active' : ''} onClick={() => onTabChange('timeline')}>Perjalanan</button>
          <button type="button" className={tab === 'memory' ? 'active' : ''} onClick={() => onTabChange('memory')}>Kenangan & Panggilan</button>
          <button type="button" className={tab === 'pins' ? 'active' : ''} onClick={() => onTabChange('pins')}>Dipin ({pins.length})</button>
        </div>

        {tab === 'timeline' && <>
          <div className="journal-streak-row">
            <div className={`journal-streak-pill ${streakCurrent > 0 ? 'active' : ''}`}>
              <Flame size={15} />
              <span>
                <b>{streakCurrent} hari</b> streak
                {streakLongest > streakCurrent ? ` · rekor ${streakLongest} hari` : ''}
              </span>
            </div>
            <button type="button" className="bond-card-btn" onClick={handleDownloadBondCard} disabled={exporting}>
              <Download size={14} />
              <span>{exporting ? 'Menyiapkan…' : 'Kartu Kedekatan'}</span>
            </button>
          </div>
          {journal?.stats && (
            <div className="journal-stats">
              <div><b>{journal.stats.totalMessages}</b><span>Obrolan</span></div>
              <div><b>{journal.stats.factsCount}</b><span>Fakta diingat</span></div>
              <div><b>{pins.length}</b><span>Pesan dipin</span></div>
            </div>
          )}
          <div className="timeline-list">
            {milestones.length === 0
              ? <div className="agenda-empty">Mulai mengobrol dengan Yuki untuk membuka momen pertama kalian.</div>
              : milestones.map((item, index) => (
                <article key={`${item.kind}-${index}`}>
                  <i />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail || `Terbuka pada bond ${Math.round(item.bondValue)}`}</span>
                  </div>
                </article>
              ))}
          </div>
        </>}

        {tab === 'memory' && (
          <div className="journal-body">
            <div className="journal-section">
              <div className="journal-section-head">
                <strong>Panggilan Khusus</strong>
                {!journal?.nicknameUnlocked && <span className="journal-lock"><Lock size={12} /> Terbuka di bond 50+ (Luluh)</span>}
              </div>
              {journal?.nicknameUnlocked ? (
                <form className="nickname-form" onSubmit={onSaveNickname}>
                  <input
                    type="text"
                    maxLength={24}
                    value={nicknameInput}
                    onChange={e => onNicknameChange(e.target.value)}
                    placeholder="Contoh: Kakak, Sayang, atau namamu…"
                  />
                  <button type="submit" disabled={nicknameSaving}>{nicknameSaving ? 'Menyimpan…' : 'Simpan'}</button>
                </form>
              ) : (
                <p className="journal-hint">Terus ngobrol dengan Yuki sampai mencapai level Luluh (bond 50) untuk mengatur panggilan khusus.</p>
              )}
              {nicknameNotice && <small className="journal-notice">{nicknameNotice}</small>}
            </div>

            <div className="journal-section">
              <div className="journal-section-head">
                <strong>Follow-Up Proaktif (Web Push)</strong>
                <label className="journal-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(proactivePush?.enabled)}
                    disabled={proactiveSaving}
                    onChange={e => onToggleProactivePush({ enabled: e.target.checked })}
                  />
                  <span>{proactivePush?.enabled ? 'Aktif' : 'Nonaktif'}</span>
                </label>
              </div>
              <p className="journal-hint">
                Yuki sesekali menanyakan kabar rencanamu yang belum selesai (maks 1× per 12 jam, menghormati jam tenang {String(proactivePush?.quietStart ?? 22).padStart(2, '0')}:00–{String(proactivePush?.quietEnd ?? 7).padStart(2, '0')}:00 WIB).
              </p>
            </div>

            <div className="journal-section">
              <strong>Momen Emosional Terbaru</strong>
              <div className="journal-events">
                {(!journal?.recentEvents || journal.recentEvents.length === 0) && <p className="journal-hint">Belum ada momen emosional yang tercatat.</p>}
                {journal?.recentEvents?.map(ev => (
                  <div className="journal-event-item" key={ev.id}>
                    {ev.mood && <span className="journal-mood-tag">{ev.mood}</span>}
                    <p>{ev.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'pins' && (
          <div className="journal-pins">
            {pins.length === 0 && <div className="agenda-empty">Belum ada pesan yang dipin. Klik ikon pin di balasan Yuki untuk menyimpannya di sini.</div>}
            {pins.map(pin => (
              <article className="journal-pin-item" key={pin.id}>
                <div className="journal-pin-head">
                  <strong>{pin.role === 'user' ? 'Kamu' : 'Yuki'}</strong>
                  <button type="button" onClick={() => onUnpin(pin.id)} aria-label="Hapus pin"><X size={13} /></button>
                </div>
                <p>{pin.content}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
