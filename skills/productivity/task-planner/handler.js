// skills/productivity/task-planner/handler.js
import { saveUserNote, getUserNoteById, getUserNotes, deleteUserNote } from '../../../lib/memory.js'
import { formatInTimezone } from '../../../lib/time.js'

export async function executeAddUserNote({ title, content, category = 'general', idempotency_key = '', timezone = 'Asia/Jakarta' }, context = {}) {
  const userId = context.userId || 'default_user'
  try {
    const saved = saveUserNote(userId, { title, content, category, idempotencyKey: idempotency_key })
    const verified = getUserNoteById(userId, saved.id)
    if (!verified) throw new Error('Read-after-write catatan gagal.')
    const created = formatInTimezone(verified.createdAt, timezone)
    return {
      success: true,
      message: `Catatan "${saved.title}" berhasil disimpan ke kategori [${saved.category}].`,
      note: { ...verified, createdAtUtc: created?.isoUtc, createdAtLocal: created?.label, timezone: created?.timezone },
      idempotent: Boolean(saved.idempotent),
      verified: true
    }
  } catch (err) {
    return { error: `Gagal menyimpan catatan: ${err.message}` }
  }
}

export async function executeListUserNotes({ category = null }, context = {}) {
  const userId = context.userId || 'default_user'
  try {
    const notes = getUserNotes(userId, category)
    return {
      total: notes.length,
      category: category || 'semua',
      notes: notes.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        category: n.category,
        updatedAt: n.updatedAt,
        updatedAtUtc: formatInTimezone(n.updatedAt, 'UTC')?.isoUtc
      }))
    }
  } catch (err) {
    return { error: `Gagal mengambil catatan: ${err.message}` }
  }
}

export async function executeDeleteUserNote({ note_id }, context = {}) {
  const userId = context.userId || 'default_user'
  try {
    deleteUserNote(userId, note_id)
    return {
      success: true,
      message: `Catatan dengan ID ${note_id} berhasil dihapus.`
    }
  } catch (err) {
    return { error: `Gagal menghapus catatan: ${err.message}` }
  }
}

export default {
  add_user_note: executeAddUserNote,
  list_user_notes: executeListUserNotes,
  delete_user_note: executeDeleteUserNote
}
