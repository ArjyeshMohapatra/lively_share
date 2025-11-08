#!/usr/bin/env node

/**
 * Initialize Room Audit System
 * This script sets up the database tables for the audit system
 */

import pool from './db.js';
import logger from './logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeAuditSystem() {
    console.log('🔧 Initializing Room Audit System...\n');

    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('📂 Creating all database tables...');

        // Execute the SQL
        await pool.query(sql);

        console.log('✅ All tables created successfully!\n');

        // Verify tables were created
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('room_audit_logs', 'room_participants', 'room_file_transfers', 'room_events')
            ORDER BY table_name
        `);

        console.log('📊 Verified tables:');
        tables.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });

        // Create audit logs directory
        const auditDir = path.join(__dirname, 'room-audit-logs');
        if (!fs.existsSync(auditDir)) {
            fs.mkdirSync(auditDir, { recursive: true });
            console.log('\n📁 Created audit logs directory:', auditDir);
        } else {
            console.log('\n📁 Audit logs directory already exists:', auditDir);
        }

        // Check current audit statistics
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_logs
            FROM room_audit_logs
        `);

        console.log('\n📈 Current audit statistics:');
        console.log(`   Total audit logs: ${stats.rows[0].total_logs}`);

        console.log('\n✨ Room Audit System initialized successfully!');
        console.log('\n📝 Next steps:');
        console.log('   1. Start your server: npm run dev');
        console.log('   2. Access audit dashboard: http://localhost:9000/audit-dashboard.html');
        console.log('   3. Review AUDIT_SYSTEM_README.md for usage details\n');

    } catch (error) {
        console.error('❌ Failed to initialize audit system:', error.message);
        console.error('\nTroubleshooting:');
        console.error('   1. Ensure PostgreSQL is running');
        console.error('   2. Check database connection in .env file');
        console.error('   3. Verify database user has CREATE TABLE permissions');
        console.error('   4. Run: npm install (if dependencies are missing)\n');
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run initialization
initializeAuditSystem();
