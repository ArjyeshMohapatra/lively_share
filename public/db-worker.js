let db;

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

    // Write chunk immediately
    writeChunk(fileId, index, chunkData);
};

// Write individual chunk
function writeChunk(fileId, index, chunkData) {
    const transaction = db.transaction(['fileChunks'], 'readwrite');
    const store = transaction.objectStore('fileChunks');

    const chunk = { fileId, index, chunkData };
    store.put(chunk);

    transaction.oncomplete = () => {
        console.log(`%cWORKER: Wrote chunk ${index} for ${fileId} (${chunkData.byteLength} bytes)`, 'color: green;');

        // Send confirmation
        self.postMessage({
            type: 'chunk-stored',
            fileId: fileId,
            index: index
        });
    };

    transaction.onerror = (event) => {
        console.error(`Worker: Failed to write chunk ${index} for ${fileId}:`, event.target.error);
    };
}