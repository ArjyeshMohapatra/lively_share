import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { ExpressPeerServer } from 'peer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import logger from './logger.js';
import RoomAuditor from './room-auditor.js';
import rateLimit from 'express-rate-limit';
import { body, param, validationResult } from 'express-validator';
import compression from 'compression';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 9000;

// CORS with better error handling
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(compression());

// Increase payload limits for better performance
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create HTTP server with better timeouts
const server = http.createServer(app);
server.timeout = 120000; // 2 minutes (increased from default 2 minutes)
server.keepAliveTimeout = 65000; // Longer than load balancer timeout
server.headersTimeout = 66000; // Slightly longer than keepAliveTimeout

// PeerJS server
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/myapp',
    allow_discovery: true
});

peerServer.on('connection', (client) => {
    logger.info(`Peer ${client.getId()} connected to PeerJS server`);
});

peerServer.on('disconnect', (client) => {
    logger.info(`Peer ${client.getId()} disconnected from PeerJS server`);
});

app.use('/peerjs', peerServer);
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const createRoomLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many room creation attempts, try again later.'
});

// Room creation with better error handling and connection pooling
app.get('/create-room', createRoomLimiter, async (request, response) => {
    const client = await pool.connect(); // Get dedicated client

    try {
        let roomId;
        let isUnique = false;
        let attempts = 0;
        const MAX_ATTEMPTS = 10;

        while (!isUnique && attempts < MAX_ATTEMPTS) {
            attempts++;
            roomId = Math.random().toString(36).substring(2, 10).toUpperCase();
            while (roomId.length < 8) {
                roomId += Math.random().toString(36).substring(2, 3).toUpperCase();
            }
            roomId = roomId.substring(0, 8);

            try {
                await client.query(
                    'INSERT INTO active_rooms (room_id, created_at, last_activity) VALUES ($1, NOW(), NOW())',
                    [roomId]
                );
                isUnique = true;
            } catch (error) {
                if (error.code !== '23505') throw error;
            }
        }

        if (!isUnique) {
            logger.error('Failed to generate unique room ID after max attempts');
            return response.status(500).json({ error: 'Server busy, try again.' });
        }

        // Initialize audit tracking for new room
        await RoomAuditor.initializeRoom(roomId);

        logger.info(`Created persistent room: ${roomId}`);
        response.json({ roomId });
    } catch (error) {
        logger.error('Failed to create room:', error);
        response.status(500).json({ error: 'Could not create room.' });
    } finally {
        client.release(); // Always release the client
    }
});

// Check if room exists - optimized
app.get('/check-room/:id',
    param('id').isLength({ min: 8, max: 8 }).isAlphanumeric(),
    async (request, response) => {
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response.status(400).json({ errors: errors.array() });
        }

        const { id } = request.params;

        try {
            const { rows } = await pool.query(
                'SELECT room_id FROM active_rooms WHERE room_id = $1',
                [id.toUpperCase()]
            );
            const roomExists = rows.length > 0;
            logger.info(`Room check: ${id} - ${roomExists ? 'EXISTS' : 'NOT FOUND'}`);
            response.json({ roomExists });
        } catch (error) {
            logger.error(`Failed to check room ${id}:`, error);
            response.status(500).json({ error: 'Could not check room.' });
        }
    }
);

// Room heartbeat tracking
const roomHeartbeats = new Map();
const roomParticipantsTracked = new Map(); // Track which participants have been logged
const ROOM_TIMEOUT = 2 * 60 * 1000; // Increased to 2 minutes

app.post('/room-heartbeat/:roomId/:peerId',
    param('roomId').isLength({ min: 8, max: 8 }).isAlphanumeric(),
    param('peerId').isLength({ min: 1, max: 50 }).matches(/^[a-zA-Z0-9-]+$/),
    async (request, response) => {
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response.status(400).json({ errors: errors.array() });
        }

        const { roomId, peerId } = request.params;
        const upperRoomId = roomId.toUpperCase();
        const { userName } = request.body || {};

        try {
            // Use a single query to check and update
            const result = await pool.query(
                'UPDATE active_rooms SET last_activity = NOW() WHERE room_id = $1 RETURNING room_id',
                [upperRoomId]
            );

            if (result.rows.length === 0) {
                logger.warn(`Heartbeat for non-existent room: ${roomId}`);
                return response.status(404).json({ error: 'Room not found' });
            }

            // Initialize tracking structures if needed
            if (!roomHeartbeats.has(upperRoomId)) {
                roomHeartbeats.set(upperRoomId, new Set());
            }
            if (!roomParticipantsTracked.has(upperRoomId)) {
                roomParticipantsTracked.set(upperRoomId, new Set());
            }

            // Track new participant if not already tracked
            if (!roomParticipantsTracked.get(upperRoomId).has(peerId)) {
                const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
                const clientUserAgent = request.headers['user-agent'];
                await RoomAuditor.trackParticipantJoin(
                    upperRoomId,
                    peerId,
                    userName || 'Anonymous',
                    clientIp,
                    clientUserAgent
                );
                roomParticipantsTracked.get(upperRoomId).add(peerId);
                logger.info(`New participant tracked: ${peerId} (${userName || 'Anonymous'}) in room ${upperRoomId}`);
            }

            roomHeartbeats.get(upperRoomId).add(peerId);

            response.json({ success: true });
        } catch (error) {
            logger.error(`Failed to update room heartbeat for ${roomId}:`, error);
            response.status(500).json({ error: 'Failed to update heartbeat' });
        }
    }
);

// Peer leaving room
app.delete('/room-heartbeat/:roomId/:peerId',
    param('roomId').isLength({ min: 8, max: 8 }).isAlphanumeric(),
    param('peerId').isLength({ min: 1, max: 50 }).matches(/^[a-zA-Z0-9-]+$/),
    async (request, response) => {
        const { roomId, peerId } = request.params;
        const upperRoomId = roomId.toUpperCase();

        try {
            if (roomHeartbeats.has(upperRoomId)) {
                roomHeartbeats.get(upperRoomId).delete(peerId);

                // Track participant leaving
                await RoomAuditor.trackParticipantLeave(upperRoomId, peerId);

                logger.info(`Peer ${peerId} left room ${upperRoomId}`);

                // If room is now empty, create snapshot and close audit
                if (roomHeartbeats.get(upperRoomId).size === 0) {
                    logger.info(`Room ${upperRoomId} is now empty, creating audit snapshot...`);
                    await RoomAuditor.createRoomSnapshot(upperRoomId);
                    roomHeartbeats.delete(upperRoomId);
                    roomParticipantsTracked.delete(upperRoomId);
                }
            }
            response.json({ success: true });
        } catch (error) {
            logger.error('Failed to remove peer from room:', error);
            response.status(500).json({ error: 'Cleanup failed' });
        }
    }
);

// File transfer tracking endpoint
app.post('/track-file-transfer',
    body('roomId').isLength({ min: 8, max: 8 }).isAlphanumeric(),
    body('senderPeerId').isLength({ min: 1, max: 50 }),
    body('receiverPeerId').isLength({ min: 1, max: 50 }),
    body('fileName').isString(),
    body('fileSize').isInt({ min: 0 }),
    async (request, response) => {
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response.status(400).json({ errors: errors.array() });
        }

        const { roomId, senderPeerId, receiverPeerId, fileName, fileSize, fileType } = request.body;

        try {
            const transferId = await RoomAuditor.trackFileTransfer(
                roomId.toUpperCase(),
                senderPeerId,
                receiverPeerId,
                fileName,
                fileSize,
                fileType || 'unknown'
            );

            response.json({ success: true, transferId });
        } catch (error) {
            logger.error('Failed to track file transfer:', error);
            response.status(500).json({ error: 'Failed to track transfer' });
        }
    }
);

// Update file transfer status endpoint
app.patch('/track-file-transfer/:transferId',
    param('transferId').isInt(),
    body('status').isIn(['completed', 'failed', 'cancelled']),
    async (request, response) => {
        const errors = validationResult(request);
        if (!errors.isEmpty()) {
            return response.status(400).json({ errors: errors.array() });
        }

        const { transferId } = request.params;
        const { status } = request.body;

        try {
            await RoomAuditor.updateFileTransferStatus(parseInt(transferId), status);
            response.json({ success: true });
        } catch (error) {
            logger.error('Failed to update file transfer status:', error);
            response.status(500).json({ error: 'Failed to update transfer status' });
        }
    }
);

// Get audit statistics endpoint (protected - you might want to add authentication)
app.get('/audit/stats', async (request, response) => {
    try {
        const daysBack = parseInt(request.query.days) || 30;
        const stats = await RoomAuditor.getAuditStats(daysBack);
        response.json(stats);
    } catch (error) {
        logger.error('Failed to get audit stats:', error);
        response.status(500).json({ error: 'Failed to retrieve stats' });
    }
});

// Search audit logs endpoint (protected - you might want to add authentication)
app.get('/audit/logs', async (request, response) => {
    try {
        const filters = {
            roomId: request.query.roomId,
            startDate: request.query.startDate,
            endDate: request.query.endDate
        };
        const logs = await RoomAuditor.searchAuditLogs(filters);
        response.json(logs);
    } catch (error) {
        logger.error('Failed to search audit logs:', error);
        response.status(500).json({ error: 'Failed to search logs' });
    }
});

// Auto-cleanup - Run less frequently for truly inactive rooms
setInterval(async () => {
    try {
        // Only delete rooms inactive for 5 minutes (not 2)
        const result = await pool.query(
            "DELETE FROM active_rooms WHERE last_activity < NOW() - INTERVAL '5 minutes' RETURNING room_id"
        );

        if (result.rows.length > 0) {
            logger.info(`Auto-cleanup: Removed ${result.rows.length} inactive rooms`);
            // Create snapshots for inactive rooms before cleanup
            for (const row of result.rows) {
                const roomId = row.room_id;
                await RoomAuditor.createRoomSnapshot(roomId);
                roomHeartbeats.delete(roomId);
                roomParticipantsTracked.delete(roomId);
            }
        }

        // Clean up empty rooms from memory
        for (const [roomId, peers] of roomHeartbeats.entries()) {
            if (peers.size === 0) {
                roomHeartbeats.delete(roomId);
                roomParticipantsTracked.delete(roomId);
            }
        }
    } catch (error) {
        logger.error('Auto-cleanup failed:', error);
    }
}, 2 * 60 * 1000); // Every 2 minutes (less aggressive)

// Default root endpoint
app.get('/', (request, response) => {
    response.sendFile(path.join(__dirname, 'public', 'transfer.html'));
});

// Health check with connection pooling info
app.get('/health', async (request, response) => {
    try {
        const result = await pool.query('SELECT NOW() as now, version() as version');
        const poolInfo = {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount
        };

        logger.info(`Health check OK. Pool: ${JSON.stringify(poolInfo)}`);

        response.status(200).json({
            status: 'healthy',
            time: result.rows[0].now,
            database: 'connected',
            pool: poolInfo
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        response.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Global error handler
app.use((error, request, response, next) => {
    logger.error('Unhandled error:', error.stack);
    response.status(500).json({ error: "Something went wrong on our end!" });
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
    logger.info('Shutdown signal received, closing server gracefully.');

    server.close(async () => {
        logger.info('HTTP server closed');

        try {
            await pool.end();
            logger.info('Database pool closed');
        } catch (error) {
            logger.error('Error closing database pool:', error);
        }

        logger.info('All connections closed. Exiting process.');
        process.exit(0);
    });

    // Force close after 30 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
}

server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 PeerJS server is running on port ${PORT}`);
    logger.info(`📊 Database pool: max ${pool.options.max} connections`);
});