// Uji aturan batu-kertas-gunting tanpa server/model.
import assert from 'node:assert/strict'
import { hasilRonde, normalisasi, pilihanValid, catatRonde, stateBaru, PILIHAN } from '../lib/games/rps.js'

let lulus = 0
const uji = (nama, fn) => { fn(); lulus++; console.log('ok  ' + nama) }

uji('batu mengalahkan gunting', () => assert.equal(hasilRonde('batu', 'gunting'), 'user_win'))
uji('gunting mengalahkan kertas', () => assert.equal(hasilRonde('gunting', 'kertas'), 'user_win'))
uji('kertas mengalahkan batu', () => assert.equal(hasilRonde('kertas', 'batu'), 'user_win'))
uji('kebalikannya kalah', () => {
  assert.equal(hasilRonde('gunting', 'batu'), 'yuki_win')
  assert.equal(hasilRonde('kertas', 'gunting'), 'yuki_win')
  assert.equal(hasilRonde('batu', 'kertas'), 'yuki_win')
})
uji('sama = seri', () => PILIHAN.forEach((p) => assert.equal(hasilRonde(p, p), 'draw')))
uji('normalisasi bahasa model', () => {
  assert.equal(normalisasi('Gunting'), 'gunting')
  assert.equal(normalisasi('scissors'), 'gunting')
  assert.equal(normalisasi('kertas ya'), 'kertas')
  assert.equal(normalisasi('xyz'), '')
})
uji('pilihan tak dikenal ditolak', () => {
  assert.equal(pilihanValid('pisau'), false)
  assert.equal(hasilRonde('batu', 'pisau'), '')
})
uji('skor bertambah benar', () => {
  let s = stateBaru()
  s = catatRonde(s, 'batu', 'gunting', 'user_win')
  s = catatRonde(s, 'batu', 'kertas', 'yuki_win')
  s = catatRonde(s, 'batu', 'batu', 'draw')
  assert.deepEqual(s.score, { you: 1, yuki: 1 })
  assert.equal(s.round, 3)
  assert.deepEqual(s.history.at(-1), { you: 'batu', yuki: 'batu', hasil: 'draw' })
})
uji('riwayat dibatasi 5', () => {
  let s = stateBaru()
  for (let i = 0; i < 9; i++) s = catatRonde(s, 'batu', 'kertas', 'yuki_win')
  assert.equal(s.history.length, 5)
  assert.deepEqual(s.score, { you: 0, yuki: 9 })
})
console.log(`\n${lulus}/9 lulus`)
