import pg from 'pg';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Maximum 20 connections
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 5000, // INCREASED from 2 seconds to 5 seconds
    statement_timeout: 10000, // NEW: Kill queries that run longer than 10 seconds
    host: 'db.lfhmtefshjxglmgcrvfu.supabase.co',
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => {
    logger.error('Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
    logger.info('New client connected to database pool');
});

pool.on('acquire', (client) => {
    logger.debug('Client acquired from pool');
});

pool.on('remove', (client) => {
    logger.info('Client removed from pool');
});

async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as now');
        logger.info(`✅ Successfully connected to PostgreSQL at ${result.rows[0].now}`);
        client.release();
    } catch (error) {
        logger.error('❌ Error connecting to the PostgreSQL database : ', error);
    }
}

testConnection();

export default pool;