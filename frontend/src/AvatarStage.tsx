import { useEffect, useRef, useState } from 'react'

/**
 * Panggung avatar PNG Yuki.
 *
 * Dulu avatar cuma satu <img> yang di-remount tiap ekspresi berganti, jadi:
 *  - ganti ekspresi terlihat "patah" (masuk animasi blur lalu muncul lagi),
 *  - tiap ganti memuat ulang PNG 620-750 KB (paling terasa di HP),
 *  - tidak ada gerakan bicara, dan gerak idle-nya sama untuk semua emosi.
 *
 * Sekarang:
 *  - dua lapis gambar di-crossfade (ganti ekspresi terasa menyambung),
 *  - format WebP (~40-55 KB, 93% lebih ringan) dengan fallback PNG otomatis,
 *  - semua ekspresi dipanaskan di latar belakang saat browser senggang,
 *  - gerak idle dibedakan per emosi, plus gerak "bicara" saat balasan mengalir,
 *  - sedikit parallax mengikuti kursor (dimatikan bila user minta gerak minimal).
 */

const EXPRESSIONS = ['tenang', 'senang', 'malu', 'sedih', 'kesal', 'lesu']
const BLINKABLE = new Set(['tenang', 'senang'])
const CROSSFADE_MS = 380

const webp = (name: string) => `/expressions/${name}.webp`
const png = (name: string) => `/expressions/${name}.png`

let prewarmed = false

/** Panaskan semua ekspresi saat browser senggang supaya ganti emosi tidak berkedip. */
function prewarmAll() {
  if (prewarmed || typeof window === 'undefined') return
  prewarmed = true
  const run = () => {
    for (const expr of EXPRESSIONS) {
      const img = new Image()
      img.src = webp(expr)
      if (BLINKABLE.has(expr)) {
        const blink = new Image()
        blink.src = webp(`${expr}_blink`)
      }
    }
  }
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 2_500 })
  else window.setTimeout(run, 1_200)
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

  // "Reaksi" singkat saat balasan selesai mengalir: Yuki seperti baru selesai
  // bicara lalu mengangguk — memberi penutup gerak, bukan berhenti mendadak.
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
    prewarmAll()
    return () => {
      window.clearTimeout(fadeTimer.current)
      window.clearTimeout(reactTimer.current)
    }
  }, [])

  // Parallax halus mengikuti kursor (desktop saja). Ditulis ke CSS variable pada
  // pembungkus, supaya tidak bertabrakan dengan animasi transform di dalamnya.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
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
        // WebP gagal (browser sangat lama) → pakai PNG yang lama.
        const target = event.currentTarget
        if (!target.dataset.fallback) {
          target.dataset.fallback = '1'
          target.src = sourceFor(expr, isBlinking).replace(/\.webp$/, '.png')
        }
      }}
    />
  )

  const className = [
    'character',
    `mood-${current}`,
    talking ? 'is-talking' : '',
    reacting ? 'is-react' : '',
    blinking && BLINKABLE.has(current) ? 'is-blinking' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={`character-parallax tint-${current}`} ref={stageRef}>
      {/* Aura di belakang karakter: warnanya mengikuti emosi aktif. */}
      <div className="avatar-aura" aria-hidden="true" />
      <div className={className} aria-hidden="true">
        {previous && previous !== current ? layer(previous, false, false) : null}
        {layer(current, blinking, true)}
      </div>
    </div>
  )
}
