// skills/computing/code-analyzer/handler.js
import vm from 'node:vm'

export async function analyze_code_syntax({ code, language = 'javascript' }) {
  if (!code || typeof code !== 'string') {
    return { error: 'Kode yang dianalisis tidak boleh kosong.' }
  }

  const lang = String(language || 'javascript').toLowerCase().trim()
  const lines = code.split(/\r?\n/)
  const lineCount = lines.length
  const issues = []

  let isValid = true
  let summary = ''

  if (lang === 'json') {
    try {
      JSON.parse(code)
      summary = 'Format JSON valid dan terstruktur dengan benar.'
    } catch (e) {
      isValid = false
      issues.push({
        type: 'SyntaxError',
        message: e.message,
        suggestion: 'Pastikan tanda petik ganda, koma penutup, dan tanda kurung kurawal sudah seimbang.'
      })
      summary = `JSON tidak valid: ${e.message}`
    }
  } else if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
    try {
      // Periksa sintaks JavaScript tanpa mengeksekusi kode
      new vm.Script(code, { produceCachedData: false })
      summary = 'Sintaks JavaScript/TypeScript valid tanpa error kompilasi dasar.'
    } catch (e) {
      isValid = false
      const matchLine = e.stack?.match(/evalmachine\.<anonymous>:(\d+)/)
      const lineNum = matchLine ? parseInt(matchLine[1], 10) : undefined
      issues.push({
        type: 'SyntaxError',
        line: lineNum,
        message: e.message,
        snippet: lineNum && lines[lineNum - 1] ? lines[lineNum - 1].trim() : undefined,
        suggestion: 'Periksa tanda kurung, titik koma, kurung kurawal yang belum tertutup, atau penamaan variabel.'
      })
      summary = `Terdeteksi kesalahan sintaks pada baris ${lineNum || '?'}: ${e.message}`
    }
  } else {
    // Analisis umum untuk bahasa lain (Python, SQL, HTML, CSS)
    const openBraces = (code.match(/\{/g) || []).length
    const closeBraces = (code.match(/\}/g) || []).length
    const openParens = (code.match(/\(/g) || []).length
    const closeParens = (code.match(/\)/g) || []).length
    const openBrackets = (code.match(/\[/g) || []).length
    const closeBrackets = (code.match(/\]/g) || []).length

    if (openBraces !== closeBraces) {
      issues.push({ type: 'BracketMismatch', message: `Jumlah tanda kurung kurawal '{' (${openBraces}) tidak seimbang dengan '}' (${closeBraces}).` })
    }
    if (openParens !== closeParens) {
      issues.push({ type: 'ParenMismatch', message: `Jumlah tanda kurung '(' (${openParens}) tidak seimbang dengan ')' (${closeParens}).` })
    }
    if (openBrackets !== closeBrackets) {
      issues.push({ type: 'BracketMismatch', message: `Jumlah tanda kurung siku '[' (${openBrackets}) tidak seimbang dengan ']' (${closeBrackets}).` })
    }

    isValid = issues.length === 0
    summary = isValid ? `Kode ${lang.toUpperCase()} memiliki keseimbangan struktur yang baik.` : `Ditemukan ${issues.length} potensi masalah struktur pada kode ${lang.toUpperCase()}.`
  }

  // Deteksi pola mencurigakan / anti-pattern
  if (code.includes('var ') && (lang.includes('js') || lang.includes('javascript') || lang.includes('ts'))) {
    issues.push({ type: 'BestPracticeWarning', message: 'Ditemukan penggunaan "var". Disarankan memakai "const" atau "let" untuk scope yang lebih aman.' })
  }
  if (code.includes('== ') && !code.includes('=== ')) {
    issues.push({ type: 'StyleWarning', message: 'Ditemukan operator perbandingan longgar "==". Disarankan menggunakan strict equality "===". ' })
  }

  return {
    language: lang,
    valid: isValid,
    lineCount,
    charCount: code.length,
    summary,
    issues: issues.length > 0 ? issues : undefined
  }
}

export default {
  analyze_code_syntax
}
