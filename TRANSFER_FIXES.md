# File Transfer Performance Fixes

## Issues Identified and Fixed

### 1. **Slow Chunk Arrival (3-5 seconds per chunk)**

**Root Cause:**
- Pipeline delays of 10ms between batches
- Conservative timeout settings (5 seconds)
- Slow adaptive pipeline growth

**Fixes Applied:**
- ✅ Reduced batch delay from 10ms to 5ms
- ✅ Increased chunk timeout from 5s to 8s (prevents false timeouts)
- ✅ Increased initial pipeline size from 32 to 64 chunks
- ✅ More aggressive pipeline growth (+8 instead of +1 on good RTT)
- ✅ Less aggressive pipeline reduction (75% instead of 50% on bad RTT)
- ✅ Increased min pipeline size from 4 to 16
- ✅ Optimized batch processing in resend operations (16 instead of 8)

### 2. **Progress Mismatch (Receiver 100%, Sender 21%)**

**Root Cause:**
- Receiver progress based on `receivedSize` (byte count)
- Sender progress based on `ackCount` (acknowledged chunks)
- Duplicate ACKs causing incorrect progress calculation
- No deduplication of ACK messages

**Fixes Applied:**
- ✅ Added `ackedChunks` Set to track unique ACKs
- ✅ Prevent duplicate ACK processing on sender side
- ✅ Better synchronization between sent/received/acked counts
- ✅ Proper tracking of `sentChunks` vs `ackCount`

### 3. **Duplicate Chunks Arriving at Receiver**

**Root Cause:**
- Duplicate check happened AFTER sending ACK
- No deduplication in database worker
- Late acceptors receiving chunks without proper dedup
- Resent chunks not being filtered

**Fixes Applied:**
- ✅ Check for duplicates BEFORE sending ACK (moved to line 1575)
- ✅ Still send ACK for duplicates to prevent retries
- ✅ Added logging for duplicate detection
- ✅ Added `pendingWrites` Map in db-worker.js to prevent duplicate writes
- ✅ Batch processing in worker to handle duplicates efficiently

### 4. **Transfer Speed Capped at 253-505 KB/s**

**Root Cause:**
- Small initial pipeline size (32 chunks)
- Conservative RTT thresholds (150ms good, 800ms bad)
- Slow pipeline growth (+1 per round)
- Aggressive pipeline reduction on timeouts

**Fixes Applied:**
- ✅ Doubled initial pipeline size: 32 → 64 chunks
- ✅ More aggressive RTT thresholds: 100ms good (was 150ms), 500ms bad (was 800ms)
- ✅ Faster pipeline growth: +8 chunks on good connections (was +1)
- ✅ Gentler pipeline reduction: -4 chunks on error (was adaptive halving)
- ✅ Higher minimum pipeline: 16 chunks (was 4)
- ✅ Reduced inter-chunk delays from 10ms to 5ms

## Performance Improvements Expected

### Speed Improvements:
- **2-4x faster transfer speeds** (from 250-500 KB/s to 1-2 MB/s on good connections)
- **50% reduction in chunk arrival time** (from 3-5s to 1.5-2.5s per chunk)
- **Better throughput** with larger pipeline (64 vs 32)

### Reliability Improvements:
- **No more duplicate chunks** being processed
- **Accurate progress tracking** on both sender and receiver
- **Better timeout handling** (8s instead of 5s prevents false positives)
- **Efficient batch processing** in database worker (10 chunks per transaction)

### Network Efficiency:
- **Reduced overhead** from duplicate chunk filtering
- **Better pipeline adaptation** to network conditions
- **Optimized resend operations** for late acceptors (16 batch size)
- **Faster catchup** for mid-transfer joins

## Testing Recommendations

1. **Small Files (< 10 MB):**
   - Should transfer in seconds, not minutes
   - Progress should match on both sides

2. **Large Files (100+ MB):**
   - Monitor transfer speed (should see 1-2 MB/s on good connections)
   - Check console for duplicate chunk warnings (should be minimal)
   - Verify progress stays in sync

3. **Multi-peer Transfers:**
   - Test late acceptor scenario
   - Verify no excessive duplicates
   - Check that catchup is fast

4. **Network Conditions:**
   - Good connection: Should see pipeline grow to 256
   - Poor connection: Should see pipeline adapt down gracefully
   - Monitor RTT values and pipeline adjustments

## Key Configuration Values

```javascript
// Pipeline Configuration
Initial Pipeline Size: 64 chunks
Min Pipeline Size: 16 chunks
Max Pipeline Size: 256 chunks

// RTT Thresholds
Good RTT: < 100ms → Grow pipeline by +8
Bad RTT: > 500ms → Reduce pipeline to 75%

// Timing
Chunk Timeout: 8000ms
Batch Delay: 5ms
Batch Size (resend): 16 chunks
DB Write Batch: 10 chunks

// Chunk Size
256 KB per chunk (unchanged)
```

## Monitoring

Watch the console for these key indicators:

### Good Signs:
- ✅ Pipeline size growing (indicates good connection)
- ✅ Few or no duplicate chunk warnings
- ✅ Progress percentages matching sender/receiver
- ✅ Transfer speeds > 1 MB/s

### Warning Signs:
- ⚠️ Many "Ignoring duplicate chunk" messages
- ⚠️ Pipeline size stuck at 16 (min)
- ⚠️ Progress percentages diverging
- ⚠️ Frequent timeout errors

### Error Signs:
- ❌ "FAILED to send chunk after 10 attempts"
- ❌ "Too many missing chunks"
- ❌ "STORAGE TIMEOUT"

## Files Modified

1. **transfer.js**
   - `sendFileInChunks()` - Pipeline optimization
   - `adaptPipelineSize()` - Better RTT adaptation
   - `handleFileChunk()` - Duplicate prevention
   - `resendChunksToNewPeer()` - Faster batch processing
   - `sendEntireFileToLateAcceptor()` - Optimized resend
   - ACK handler - Duplicate ACK filtering

2. **db-worker.js**
   - Complete rewrite with batch processing
   - Duplicate write prevention
   - Queue-based chunk storage
   - Batch transaction optimization

## Rollback Instructions

If issues occur, revert these changes:
```bash
git checkout HEAD -- public/transfer.js public/db-worker.js
```

Or restore from backup if not using git.
