import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('./data/yuki.db')
const chats = db.prepare('SELECT id, user_id, role, substr(content, 1, 200) as snippet, length(content) as len FROM chat_history ORDER BY id DESC LIMIT 10').all()
console.log('=== LATEST CHATS ===')
console.log(chats)

const arts = db.prepare('SELECT id, user_id, title, version, substr(content, 1, 200) as snippet, substr(content, -200) as end_snippet, length(content) as len FROM user_artifacts ORDER BY updated_at DESC LIMIT 3').all()
console.log('=== LATEST ARTIFACTS ===')
console.log(arts)
