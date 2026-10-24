import { useEffect, useRef, useState } from 'react'
import { AVATAR_LQIP } from './avatarLqip'

/**
 * Panggung avatar PNG Yuki.
 *
 * Riwayat desain:
 *  - dulu satu <img> yang di-remount tiap ganti ekspresi → terasa "patah",
 *  - lalu diberi crossfade + gerak per emosi + gerak bicara (v3.2),
 *  - v3.3: placeholder buram (LQIP) supaya tidak ada kedip putih, pemuatan
 *    gambar dibuat hemat (hanya yang perlu di awal), dan mode hemat data.
 */

const EXPRESSIONS = ['tenang', 'senang', 'malu', 'sedih', 'kesal', 'lesu']
const BLINKABLE = new Set(['tenang', 'senang'])
const CROSSFADE_MS = 380

const webp = (name: string) => `/expressions/${name}.webp`

// Hormati mode hemat data / koneksi lambat: jangan memanaskan semua gambar.
const koneksi = (typeof navigator !== 'undefined'
  ? (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  : undefined)
const hematData = Boolean(koneksi?.saveData) || /(^|-)2g$/.test(koneksi?.effectiveType || '')

let prewarmed = false

/** Panaskan ekspresi lain saat browser senggang (bukan di awal, bukan semua sekaligus). */
function prewarmRest(currentExpr: string) {
  if (prewarmed || hematData || typeof window === 'undefined') return
  prewarmed = true
  const run = () => {
    for (const expr of EXPRESSIONS) {
      if (expr === currentExpr) continue
      const img = new Image()
      img.src = webp(expr)
      if (BLINKABLE.has(expr)) {
        const blink = new Image()
        blink.src = webp(`${expr}_blink`)
      }
    }
  }
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 3_000 })
  else window.setTimeout(run, 1_500)
}

interface AvatarStageProps {
  expression: string
  blinking: boolean
  talking: boolean
}

export default function AvatarStage({ expression, blinking, talking }: AvatarStageProps) {
  const [current, setCurrent] = useState(expression)
  const [previous, setPrevious] = useState<string | null>(null)
  const [reacting, setReacting] = useState(false)
  const fadeTimer = useRef<number | undefined>(undefined)
  const reactTimer = useRef<number | undefined>(undefined)
  const wasTalking = useRef(false)
  const stageRef = useRef<HTMLDivElement | null>(null)

  // Reaksi singkat ketika balasan selesai mengalir: seperti mengangguk sekali.
  useEffect(() => {
    if (talking) {
      wasTalking.current = true
      setReacting(false)
      window.clearTimeout(reactTimer.current)
      return
    }
    if (!wasTalking.current) return // jangan bereaksi saat mount pertama
    wasTalking.current = false
    setReacting(true)
    window.clearTimeout(reactTimer.current)
    reactTimer.current = window.setTimeout(() => setReacting(false), 560)
    return () => window.clearTimeout(reactTimer.current)
  }, [talking])

  // Crossfade: ekspresi lama tetap tampil di lapis bawah sampai lapis baru siap.
  useEffect(() => {
    if (expression === current) return
    setPrevious(current)
    setCurrent(expression)
    window.clearTimeout(fadeTimer.current)
    fadeTimer.current = window.setTimeout(() => setPrevious(null), CROSSFADE_MS)
  }, [expression, current])

  useEffect(() => {
    // Yang dipanaskan lebih dulu hanya ekspresi aktif + satu emosi paling sering
    // muncul berikutnya; sisanya menyusul saat browser senggang.
    const pertama = new Image()
    pertama.src = webp(expression)
    prewarmRest(expression)
    return () => {
      window.clearTimeout(fadeTimer.current)
      window.clearTimeout(reactTimer.current)
    }
  }, [])

  // Parallax halus mengikuti kursor (desktop saja). Ditulis ke CSS variable pada
  // pembungkus, supaya tidak bertabrakan dengan animasi transform di dalamnya.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || hematData) return
    const kurangiGerak = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const kursorHalus = window.matchMedia?.('(pointer: fine)')
    if (kurangiGerak?.matches || !kursorHalus?.matches) return

    let frame = 0
    const onMove = (event: PointerEvent) => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const x = (event.clientX / window.innerWidth - 0.5) * 2
        const y = (event.clientY / window.innerHeight - 0.5) * 2
        stage.style.setProperty('--look-x', `${(x * -5).toFixed(2)}px`)
        stage.style.setProperty('--look-y', `${(y * -3).toFixed(2)}px`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const sourceFor = (expr: string, isBlinking: boolean) =>
    isBlinking && BLINKABLE.has(expr) ? webp(`${expr}_blink`) : webp(expr)

  const layer = (expr: string, isBlinking: boolean, front: boolean) => (
    <img
      key={`${expr}-${front ? 'front' : 'back'}`}
      className={`character-layer${front ? ' is-front' : ''}`}
      src={sourceFor(expr, isBlinking)}
      alt=""
      draggable={false}
      decoding="async"
      onError={(event) => {
        const target = event.currentTarget
        // Jangan biarkan gambar kosong: jatuh ke ekspresi netral sekali saja.
        if (!target.dataset.fallback && !target.src.endsWith('/tenang.webp')) {
          target.dataset.fallback = '1'
          target.src = webp('tenang')
        }
      }}
    />
  )

  const className = [
    'character',
    `mood-${current}`,
    talking ? 'is-talking' : '',
    reacting ? 'is-react' : '',
    blinking && BLINKABLE.has(current) ? 'is-blinking' : '',
    hematData ? 'is-static' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={`character-parallax tint-${current}${hematData ? ' is-static' : ''}`} ref={stageRef}>
      {/* Aura di belakang karakter: warnanya mengikuti emosi aktif. */}
      <div className="avatar-aura" aria-hidden="true" />
      <div className={className} aria-hidden="true">
        {/* Placeholder buram: muncul seketika, jadi tidak ada kedip putih. */}
        {AVATAR_LQIP[current] ? (
          <div className="avatar-lqip" style={{ backgroundImage: `url(${AVATAR_LQIP[current]})` }} />
        ) : null}
        {previous && previous !== current ? layer(previous, false, false) : null}
        {layer(current, blinking, true)}
      </div>
    </div>
  )
}
