#!/usr/bin/env node
// scripts/create-admin.js
// الاستخدام: node scripts/create-admin.js <email> <password> <name>
// مثال: node scripts/create-admin.js admin@site.com Pass123 "محمد المدير"

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../database/db');

const [,, email, password, name = 'Admin'] = process.argv;

if (!email || !password) {
  console.error('❌ الاستخدام: node scripts/create-admin.js <email> <password> [name]');
  process.exit(1);
}

if (password.length < 6) {
  console.error('❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل');
  process.exit(1);
}

async function createAdmin() {
  const db = getDB();
  const existing = db.prepare('SELECT id, role FROM users WHERE email=?').get(email);

  if (existing) {
    // ترقية مستخدم موجود لأدمن
    db.prepare("UPDATE users SET role='admin', is_active=1 WHERE email=?").run(email);
    console.log(`✅ تم ترقية ${email} إلى Admin`);
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO users (uuid, name, email, password, role, region, is_active)
    VALUES (?, ?, ?, ?, 'admin', 'القاهرة', 1)
  `).run(uuidv4(), name, email, hashed);

  console.log(`✅ تم إنشاء حساب Admin بنجاح!`);
  console.log(`   📧 البريد: ${email}`);
  console.log(`   🔑 كلمة المرور: ${password}`);
  console.log(`   ⚠️  غيّر كلمة المرور بعد أول تسجيل دخول`);
  process.exit(0);
}

createAdmin().catch(err => {
  console.error('❌ خطأ:', err.message);
  process.exit(1);
});
