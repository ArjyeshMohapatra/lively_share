let db;
let pendingWrites = new Map(); // Track pending writes to avoid duplicates
let writeQueue = [];
let isProcessing = false;

// Open IndexedDB connection
const request = indexedDB.open('fileStorageDB', 1);

request.onerror = (event) => {
    console.error('IndexedDB failed to open:', event.target.error);
};

request.onsuccess = (event) => {
    db = event.target.result;
    console.log('Worker: IndexedDB opened successfully');
};

request.onupgradeneeded = (event) => {
    db = event.target.result;
    if (!db.objectStoreNames.contains('fileChunks')) {
        const store = db.createObjectStore('fileChunks', { keyPath: ['fileId', 'index'] });
        store.createIndex('by_fileId', 'fileId', { unique: false });
    }
};

// Listen for incoming chunks
self.onmessage = async (event) => {
    const { fileId, chunkData, index, isLastChunk } = event.data;

    if (!db) {
        console.warn('Worker: DB not ready, retrying...');
        setTimeout(() => self.onmessage(event), 100);
        return;
    }

    // Check for duplicate
    const chunkKey = `${fileId}_${index}`;
    if (pendingWrites.has(chunkKey)) {
        console.log(`%cWORKER: Ignoring duplicate chunk ${index} for ${fileId}`, 'color: orange;');
        return;
    }

    pendingWrites.set(chunkKey, true);

    // Add to queue
    writeQueue.push({ fileId, index, chunkData, chunkKey });

    // Process queue if not already processing
    if (!isProcessing) {
        processQueue();
    }
};

// Process write queue in batches
async function processQueue() {
    if (isProcessing || writeQueue.length === 0) return;

    isProcessing = true;

    while (writeQueue.length > 0) {
        // Process in batches of 10
        const batch = writeQueue.splice(0, 10);
        await writeBatch(batch);
    }

    isProcessing = false;
}

// Write batch of chunks
async function writeBatch(batch) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['fileChunks'], 'readwrite');
        const store = transaction.objectStore('fileChunks');

        for (const { fileId, index, chunkData } of batch) {
            const chunk = { fileId, index, chunkData };
            store.put(chunk);
        }

        transaction.oncomplete = () => {
            // Send confirmations for all chunks in batch
            for (const { fileId, index, chunkKey } of batch) {
                console.log(`%cWORKER: Wrote chunk ${index} for ${fileId}`, 'color: green;');

                // Send confirmation
                self.postMessage({
                    type: 'chunk-stored',
                    fileId: fileId,
                    index: index
                });

                // Remove from pending
                pendingWrites.delete(chunkKey);
            }
            resolve();
        };

        transaction.onerror = (event) => {
            console.error('Worker: Batch write failed:', event.target.error);
            // Clear pending writes for failed chunks
            for (const { chunkKey } of batch) {
                pendingWrites.delete(chunkKey);
            }
            reject(event.target.error);
        };
    });
}