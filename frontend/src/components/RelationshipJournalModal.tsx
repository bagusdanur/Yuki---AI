import { Lock, X } from 'lucide-react'
import type { Milestone, PinnedMessage, ProactivePushSettings, RelationshipJournalResponse } from '../types'

interface Props {
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

export default function RelationshipJournalModal({
  bond, bondValue, milestones, journal, tab, onTabChange,
  nicknameInput, onNicknameChange, nicknameSaving, nicknameNotice, onSaveNickname,
  proactivePush, proactiveSaving, onToggleProactivePush, pins, onUnpin, onClose
}: Props) {
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
