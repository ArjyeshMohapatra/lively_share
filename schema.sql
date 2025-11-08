-- ============================================================================
-- Complete Database Schema for P2P File Transfer System
-- ============================================================================
-- This file contains all database tables for:
-- 1. Active rooms management
-- 2. Room audit logging system
--
-- Simply copy and paste this entire file into Supabase SQL Editor
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: Active Rooms Management
-- ----------------------------------------------------------------------------

-- Drop existing tables if they exist (optional - remove these lines if you want to keep existing data)
DROP TABLE IF EXISTS room_events CASCADE;
DROP TABLE IF EXISTS room_file_transfers CASCADE;
DROP TABLE IF EXISTS room_participants CASCADE;
DROP TABLE IF EXISTS room_audit_logs CASCADE;
DROP TABLE IF EXISTS active_rooms CASCADE;
DROP TABLE IF EXISTS active_ids CASCADE;

-- Active rooms table - tracks currently active file transfer rooms
CREATE TABLE active_rooms (
    room_id VARCHAR(8) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance on active rooms
CREATE INDEX idx_active_rooms_created_at ON active_rooms(created_at);
CREATE INDEX idx_active_rooms_last_activity ON active_rooms(last_activity);

-- ----------------------------------------------------------------------------
-- SECTION 2: Room Audit Logging System
-- ----------------------------------------------------------------------------
-- These tables track all room activities for compliance and security

-- Main room audit table - Master log for each room session with summary statistics
CREATE TABLE room_audit_logs (
    log_id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL,
    room_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    room_closed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_duration_seconds INTEGER,
    total_participants INTEGER DEFAULT 0,
    total_files_transferred INTEGER DEFAULT 0,
    total_data_transferred_bytes BIGINT DEFAULT 0,
    snapshot_file_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Participant tracking - Tracks all participants who joined a room
CREATE TABLE room_participants (
    participant_id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL,
    peer_id VARCHAR(50) NOT NULL,
    user_name VARCHAR(100),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    ip_address VARCHAR(45), -- IPv6 compatible
    user_agent TEXT,
    session_duration_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- File transfer tracking - Logs all file transfers that occurred in rooms
CREATE TABLE room_file_transfers (
    transfer_id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL,
    sender_peer_id VARCHAR(50) NOT NULL,
    receiver_peer_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    file_type VARCHAR(100),
    transfer_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    transfer_completed_at TIMESTAMP WITH TIME ZONE,
    transfer_status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed, cancelled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Room events tracking - Detailed event log for all room activities
CREATE TABLE room_events (
    event_id SERIAL PRIMARY KEY,
    room_id VARCHAR(8) NOT NULL,
    peer_id VARCHAR(50),
    event_type VARCHAR(50) NOT NULL, -- join, leave, file_send, file_receive, message, error
    event_data JSONB,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- SECTION 3: Indexes for Performance
-- ----------------------------------------------------------------------------

-- Indexes for room_audit_logs
CREATE INDEX idx_room_audit_logs_room_id ON room_audit_logs(room_id);
CREATE INDEX idx_room_audit_logs_created_at ON room_audit_logs(room_closed_at);

-- Indexes for room_participants
CREATE INDEX idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX idx_room_participants_peer_id ON room_participants(peer_id);

-- Indexes for room_file_transfers
CREATE INDEX idx_room_file_transfers_room_id ON room_file_transfers(room_id);
CREATE INDEX idx_room_file_transfers_sender ON room_file_transfers(sender_peer_id);
CREATE INDEX idx_room_file_transfers_receiver ON room_file_transfers(receiver_peer_id);

-- Indexes for room_events
CREATE INDEX idx_room_events_room_id ON room_events(room_id);
CREATE INDEX idx_room_events_type ON room_events(event_type);
CREATE INDEX idx_room_events_occurred_at ON room_events(occurred_at);

-- ----------------------------------------------------------------------------
-- SECTION 4: Comments (Documentation)
-- ----------------------------------------------------------------------------

COMMENT ON TABLE active_rooms IS 'Tracks currently active file transfer rooms';
COMMENT ON TABLE room_audit_logs IS 'Master audit log for each room session with summary statistics';
COMMENT ON TABLE room_participants IS 'Tracks all participants who joined a room';
COMMENT ON TABLE room_file_transfers IS 'Logs all file transfers that occurred in rooms';
COMMENT ON TABLE room_events IS 'Detailed event log for all room activities';

-- ----------------------------------------------------------------------------
-- Schema creation complete!
-- ----------------------------------------------------------------------------
-- Next steps:
-- 1. Run this SQL in Supabase SQL Editor
-- 2. Verify tables were created in the Table Editor
-- 3. Start your backend server: npm run dev
-- 4. Access audit dashboard: http://localhost:9000/audit-dashboard.html
-- ----------------------------------------------------------------------------
