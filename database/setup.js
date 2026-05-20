#!/usr/bin/env node
// database/setup.js - First-time database setup
require('dotenv').config();
const { getDB } = require('./db');

console.log('🔧 Setting up database...');
try {
  getDB(); // triggers initSchema + seed
  console.log('✅ Database ready at:', process.env.DB_PATH || './database/marketplace.db');
  process.exit(0);
} catch (err) {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
}
