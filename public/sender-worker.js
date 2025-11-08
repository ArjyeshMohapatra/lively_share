// sender-worker.js
const fileQueue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || fileQueue.length === 0) return;
    isProcessing = true;
    const { file, fileId } = fileQueue.shift();
    const chunkSize = 256 * 1024;
    let offset = 0;
    console.log('[Sender Worker] The chunk size is:', chunkSize, 'bytes');

    while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        self.postMessage({ type: 'chunk', fileId: fileId, chunk: buffer }, [buffer]);
        offset += buffer.byteLength;
    }

    self.postMessage({ type: 'complete', fileId: fileId });
    isProcessing = false;
    processQueue();
}

self.onmessage = function (event) {
    const { file, fileId } = event.data;
    fileQueue.push({ file, fileId });
    processQueue();
};