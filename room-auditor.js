import pool from './db.js';
import logger from './logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory for storing room snapshots
const AUDIT_DIR = path.join(__dirname, 'room-audit-logs');

// Ensure audit directory exists
if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    logger.info(`Created audit directory: ${AUDIT_DIR}`);
}

// In-memory tracking of active room sessions
const activeRoomSessions = new Map();

class RoomAuditor {
    /**
     * Initialize a new room session for auditing
     */
    static async initializeRoom(roomId) {
        try {
            const session = {
                roomId,
                startTime: new Date(),
                participants: new Map(), // peerId -> participant info
                fileTransfers: [],
                events: [],
                totalDataTransferred: 0
            };

            activeRoomSessions.set(roomId, session);

            // Log room creation event
            await this.logEvent(roomId, null, 'room_created', {
                timestamp: session.startTime
            });

            logger.info(`Initialized audit tracking for room: ${roomId}`);
            return session;
        } catch (error) {
            logger.error(`Failed to initialize room audit for ${roomId}:`, error);
        }
    }

    /**
     * Track participant joining a room
     */
    static async trackParticipantJoin(roomId, peerId, userName, ipAddress, userAgent) {
        try {
            const session = activeRoomSessions.get(roomId) || await this.initializeRoom(roomId);

            const participant = {
                peerId,
                userName: userName || 'Anonymous',
                joinedAt: new Date(),
                ipAddress,
                userAgent,
                leftAt: null
            };

            session.participants.set(peerId, participant);

            // Insert into database
            await pool.query(
                `INSERT INTO room_participants 
                (room_id, peer_id, user_name, joined_at, ip_address, user_agent) 
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [roomId, peerId, userName, participant.joinedAt, ipAddress, userAgent]
            );

            // Log event
            await this.logEvent(roomId, peerId, 'participant_join', {
                userName,
                timestamp: participant.joinedAt
            });

            logger.info(`Tracked participant join: ${peerId} in room ${roomId}`);
        } catch (error) {
            logger.error(`Failed to track participant join:`, error);
        }
    }

    /**
     * Track participant leaving a room
     */
    static async trackParticipantLeave(roomId, peerId) {
        try {
            const session = activeRoomSessions.get(roomId);
            if (!session) return;

            const participant = session.participants.get(peerId);
            if (!participant) return;

            const leftAt = new Date();
            participant.leftAt = leftAt;

            const durationSeconds = Math.floor((leftAt - participant.joinedAt) / 1000);

            // Update database
            await pool.query(
                `UPDATE room_participants 
                SET left_at = $1, session_duration_seconds = $2 
                WHERE room_id = $3 AND peer_id = $4`,
                [leftAt, durationSeconds, roomId, peerId]
            );

            // Log event
            await this.logEvent(roomId, peerId, 'participant_leave', {
                duration: durationSeconds,
                timestamp: leftAt
            });

            logger.info(`Tracked participant leave: ${peerId} from room ${roomId}`);
        } catch (error) {
            logger.error(`Failed to track participant leave:`, error);
        }
    }

    /**
     * Track file transfer initiation
     */
    static async trackFileTransfer(roomId, senderPeerId, receiverPeerId, fileName, fileSize, fileType) {
        try {
            const session = activeRoomSessions.get(roomId);
            if (!session) return;

            const transfer = {
                senderPeerId,
                receiverPeerId,
                fileName,
                fileSize,
                fileType,
                startedAt: new Date(),
                status: 'started'
            };

            session.fileTransfers.push(transfer);
            session.totalDataTransferred += fileSize;

            // Insert into database
            const result = await pool.query(
                `INSERT INTO room_file_transfers 
                (room_id, sender_peer_id, receiver_peer_id, file_name, file_size_bytes, 
                file_type, transfer_started_at, transfer_status) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                RETURNING transfer_id`,
                [roomId, senderPeerId, receiverPeerId, fileName, fileSize,
                    fileType, transfer.startedAt, 'started']
            );

            transfer.transferId = result.rows[0].transfer_id;

            // Log event
            await this.logEvent(roomId, senderPeerId, 'file_transfer_start', {
                fileName,
                fileSize,
                receiver: receiverPeerId,
                timestamp: transfer.startedAt
            });

            logger.info(`Tracked file transfer: ${fileName} (${fileSize} bytes) in room ${roomId}`);
            return transfer.transferId;
        } catch (error) {
            logger.error(`Failed to track file transfer:`, error);
        }
    }

    /**
     * Update file transfer status
     */
    static async updateFileTransferStatus(transferId, status) {
        try {
            const completedAt = status === 'completed' ? new Date() : null;

            await pool.query(
                `UPDATE room_file_transfers 
                SET transfer_status = $1, transfer_completed_at = $2 
                WHERE transfer_id = $3`,
                [status, completedAt, transferId]
            );

            logger.info(`Updated file transfer ${transferId} status to: ${status}`);
        } catch (error) {
            logger.error(`Failed to update file transfer status:`, error);
        }
    }

    /**
     * Log any room event
     */
    static async logEvent(roomId, peerId, eventType, eventData) {
        try {
            const session = activeRoomSessions.get(roomId);
            if (session) {
                session.events.push({
                    peerId,
                    eventType,
                    eventData,
                    timestamp: new Date()
                });
            }

            // Insert into database
            await pool.query(
                `INSERT INTO room_events 
                (room_id, peer_id, event_type, event_data, occurred_at) 
                VALUES ($1, $2, $3, $4, NOW())`,
                [roomId, peerId, eventType, JSON.stringify(eventData)]
            );
        } catch (error) {
            logger.error(`Failed to log event:`, error);
        }
    }

    /**
     * Create a complete snapshot when room closes
     */
    static async createRoomSnapshot(roomId) {
        try {
            const session = activeRoomSessions.get(roomId);
            if (!session) {
                logger.warn(`No active session found for room ${roomId} during snapshot`);
                return;
            }

            // Check if snapshot already exists to prevent duplicates
            const existingSnapshot = await pool.query(
                'SELECT log_id FROM room_audit_logs WHERE room_id = $1',
                [roomId]
            );

            if (existingSnapshot.rows.length > 0) {
                logger.info(`Snapshot for room ${roomId} already exists, skipping duplicate creation`);
                activeRoomSessions.delete(roomId);
                return;
            }

            const endTime = new Date();
            const durationSeconds = Math.floor((endTime - session.startTime) / 1000);

            // Gather all data from database
            const [participants, fileTransfers, events] = await Promise.all([
                pool.query('SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at', [roomId]),
                pool.query('SELECT * FROM room_file_transfers WHERE room_id = $1 ORDER BY transfer_started_at', [roomId]),
                pool.query('SELECT * FROM room_events WHERE room_id = $1 ORDER BY occurred_at', [roomId])
            ]);

            // Create comprehensive snapshot
            const snapshot = {
                roomId,
                sessionSummary: {
                    startTime: session.startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    durationSeconds,
                    totalParticipants: session.participants.size,
                    totalFileTransfers: session.fileTransfers.length,
                    totalDataTransferredBytes: session.totalDataTransferred
                },
                participants: participants.rows.map(p => ({
                    peerId: p.peer_id,
                    userName: p.user_name,
                    joinedAt: p.joined_at,
                    leftAt: p.left_at,
                    sessionDurationSeconds: p.session_duration_seconds,
                    ipAddress: p.ip_address,
                    userAgent: p.user_agent
                })),
                fileTransfers: fileTransfers.rows.map(ft => ({
                    transferId: ft.transfer_id,
                    sender: ft.sender_peer_id,
                    receiver: ft.receiver_peer_id,
                    fileName: ft.file_name,
                    fileSizeBytes: ft.file_size_bytes,
                    fileType: ft.file_type,
                    startedAt: ft.transfer_started_at,
                    completedAt: ft.transfer_completed_at,
                    status: ft.transfer_status
                })),
                events: events.rows.map(e => ({
                    eventId: e.event_id,
                    peerId: e.peer_id,
                    eventType: e.event_type,
                    eventData: e.event_data,
                    occurredAt: e.occurred_at
                })),
                generatedAt: endTime.toISOString()
            };

            // Save snapshot to file
            const fileName = `room_${roomId}_${endTime.toISOString().replace(/[:.]/g, '-')}.json`;
            const filePath = path.join(AUDIT_DIR, fileName);

            fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
            logger.info(`Saved room snapshot: ${filePath}`);

            // Insert summary into audit log
            await pool.query(
                `INSERT INTO room_audit_logs 
                (room_id, room_created_at, room_closed_at, total_duration_seconds, 
                total_participants, total_files_transferred, total_data_transferred_bytes, 
                snapshot_file_path) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    roomId,
                    session.startTime,
                    endTime,
                    durationSeconds,
                    session.participants.size,
                    session.fileTransfers.length,
                    session.totalDataTransferred,
                    filePath
                ]
            );

            // Clean up in-memory session
            activeRoomSessions.delete(roomId);

            logger.info(`Room ${roomId} audit complete. Duration: ${durationSeconds}s, ` +
                `Participants: ${session.participants.size}, ` +
                `Files: ${session.fileTransfers.length}, ` +
                `Data: ${session.totalDataTransferred} bytes`);

            return snapshot;
        } catch (error) {
            logger.error(`Failed to create room snapshot for ${roomId}:`, error);
        }
    }

    /**
     * Get audit statistics
     */
    static async getAuditStats(daysBack = 30) {
        try {
            const stats = await pool.query(
                `SELECT 
                    COUNT(*) as total_rooms,
                    SUM(total_participants) as total_participants,
                    SUM(total_files_transferred) as total_files,
                    SUM(total_data_transferred_bytes) as total_data,
                    AVG(total_duration_seconds) as avg_duration
                FROM room_audit_logs 
                WHERE room_closed_at > NOW() - INTERVAL '${daysBack} days'`
            );

            return stats.rows[0];
        } catch (error) {
            logger.error('Failed to get audit stats:', error);
            return null;
        }
    }

    /**
     * Search audit logs
     */
    static async searchAuditLogs(filters = {}) {
        try {
            let query = 'SELECT * FROM room_audit_logs WHERE 1=1';
            const params = [];
            let paramCount = 1;

            if (filters.roomId) {
                query += ` AND room_id = $${paramCount++}`;
                params.push(filters.roomId);
            }

            if (filters.startDate) {
                query += ` AND room_created_at >= $${paramCount++}`;
                params.push(filters.startDate);
            }

            if (filters.endDate) {
                query += ` AND room_closed_at <= $${paramCount++}`;
                params.push(filters.endDate);
            }

            query += ' ORDER BY room_closed_at DESC LIMIT 100';

            const result = await pool.query(query, params);
            return result.rows;
        } catch (error) {
            logger.error('Failed to search audit logs:', error);
            return [];
        }
    }
}

export default RoomAuditor;
