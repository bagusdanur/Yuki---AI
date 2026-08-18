// skills/computing/safe-calculator/handler.js

export async function executeCalculateExpression({ expression }) {
  if (!expression || typeof expression !== 'string') {
    return { error: 'Ekspresi matematika tidak boleh kosong.' }
  }

  let clean = expression
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d+)\s*%\s*(?:dari|of|\*)\s*(\d+(?:\.\d+)?)/gi, '($1/100 * $2)')
    .replace(/(\d+)%/g, '($1/100)')
    .trim()

  // Validasi karakter aman: angka, operator, kurung, Math.*
  if (!/^[0-9+\-*/().,\s%^eMathsqrtcospowabsroundfloorceillogPIE]+$/i.test(clean)) {
    return { error: `Ekspresi mengandung karakter atau fungsi yang tidak diizinkan: "${expression}"` }
  }

  try {
    const fn = new Function('Math', `return (${clean});`)
    const result = fn(Math)

    if (typeof result !== 'number' || isNaN(result)) {
      return { error: 'Hasil bukan angka yang valid.' }
    }

    return {
      expression,
      evaluatedExpression: clean,
      result: Number.isInteger(result) ? result : Number(result.toFixed(6)),
      formatted: new Intl.NumberFormat('id-ID').format(result)
    }
  } catch (err) {
    return { error: `Gagal menghitung ekspresi: ${err.message}` }
  }
}

export default {
  calculate_expression: executeCalculateExpression
}
