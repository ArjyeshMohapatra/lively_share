document.addEventListener('DOMContentLoaded', () => {
    setInterval(updateTransferRates, 500);

    "use strict";

    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark-mode');
    }

    // Global variables
    let peer = null;
    let selectedFiles = [];
    let incomingFiles = {};
    let isTransferring = false;
    const connections = new Map();
    let currentView = 'index';
    let myPeerId = null;
    let transferStates = {};
    const fileAcceptors = {}; // NEW: Track which peers accepted each file
    let autoDownload = false;
    let keepAliveInterval = null;
    let screenWakeLock = null;
    let roomHeartbeatInterval = null;
    let originalSessionCode = null;
    let intentionalDisconnect = false;
    const outgoingTransfers = {};
    let myName = generateRandomName();
    const fileStoredResolvers = new Map();

    let nextWorker = 0;
    const NUM_WORKERS = navigator.hardwareConcurrency || 4;
    const dbWorkers = [];

    // Server configuration - adjust these based on your setup
    const SERVER_URL = ''; // Empty means same domain
    const isSecure = window.location.protocol === 'https:';
    const defaultPort = isSecure ? 443 : 80;
    const serverPort = parseInt(window.location.port) || defaultPort;
    // DOM elements
    const allViews = document.querySelectorAll('.view');
    const indexView = document.getElementById('indexView');
    const startSessionView = document.getElementById('startSessionView');
    const joinSessionView = document.getElementById('joinSessionView');
    const chatView = document.getElementById('chatView');

    const startSessionButton = document.getElementById('startSessionButton');
    const joinSessionButton = document.getElementById('joinSessionButton');
    const connectButton = document.getElementById('connectButton');
    const backToIndexButton = document.getElementById('backToIndexButton');
    const backFromStartButton = document.getElementById('backFromStartButton');
    const backFromJoinButton = document.getElementById('backFromJoinButton');

    const peerIdInput = document.getElementById('peerIdInput');
    const peerIdDisplay = document.getElementById('peerIdDisplay');
    const copyIdButton = document.getElementById('copyIdButton');
    const shareIdButton = document.getElementById('shareIdButton');
    const connectionInfo = document.getElementById('connection-info');
    const qrCodeContainer = document.getElementById('qrcode');
    const h2Connection = document.querySelector('#connection-info h2');
    const codeContainer = document.getElementById('code-container');

    const chatArea = document.getElementById('chatArea');
    const chatHeader = document.getElementById('chatHeader');
    const fileInputArea = document.getElementById('fileInputArea');
    const sendFileButton = document.getElementById('sendFilesButton');
    const messageInput = document.getElementById('messageInput');
    const hiddenFileInput = document.getElementById('hiddenFileInput');
    const hiddenFolderInput = document.getElementById('hiddenFolderInput');
    const connectionStatus = document.getElementById('connectionStatus');

    const fileDisplayArea = document.getElementById('fileDisplayArea');
    const fileChoosen = document.getElementById('fileChoosen');
    const fileSummary = document.getElementById('fileSummary');
    const clearAllButton = document.getElementById('clearAllButton');
    const downloadAllButton = document.getElementById('downloadAllButton');
    const actionButtonsContainer = document.querySelector('#fileInputArea .action-buttons');

    const modal = document.getElementById('previewModal');
    const container = document.getElementById('previewContainer');

    const infoMenuTrigger = document.getElementById('infoMenuTrigger');
    const infoMenuPopup = document.getElementById('infoMenuPopup');

    // Check URL parameters for direct connection (QR code scanning)
    const urlParams = new URLSearchParams(window.location.search);
    const directPeerId = urlParams.get('peerId');

    // document.body.classList.add('fade-in');

    const dropdownButton = document.getElementById('dropdown-button');
    const dropdownButtonText = document.getElementById('dropdown-button-text');
    const dropdownMenu = document.getElementById('dropdown-menu');
    const chooseFilesOption = document.getElementById('choose-files-option');
    const chooseFolderOption = document.getElementById('choose-folder-option');
    const caretUpIcon = document.getElementById('caret-up-icon');

    // Message input auto-expand
    messageInput.addEventListener('input', function () {
        this.style.height = '44px';

        // Only grow if scrollHeight is SIGNIFICANTLY larger (at least 10px more)
        if (this.scrollHeight > 54) {
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        }
    });

    // Send message on Enter (Shift+Enter for new line)
    messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendSelectedFiles(); // Use the same button handler
        }
    });

    function sendMessage() {
        const message = messageInput.value.trim();
        if (!message) return;

        if (connections.size === 0) {
            showMessage('No active connection', 'error');
            return;
        }

        broadcast({
            type: 'text-message',
            message: message,
            timestamp: Date.now()
        });

        addTextMessageToChat('sent', message);
        messageInput.value = '';
        messageInput.style.height = '44px';
    }

    function addTextMessageToChat(type, message, timestamp = Date.now(), senderId = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `text-message ${type}`;
        const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let senderName = myName; // Default to my own name for 'sent' messages
        if (type === 'received' && senderId) {
            // For received messages, look up the sender's name in our directory
            senderName = connections.get(senderId)?.name || 'Guest';
        }

        const senderLabel = type === 'received' ? `<div class="sender-label">${escapeHtml(senderName)}</div>` : '';

        messageDiv.innerHTML = `
        ${senderLabel}
        <div>${escapeHtml(message)}</div>
        <div class="message-time">${time}</div>
    `;
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    dropdownButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdownMenu.classList.toggle('dropdown-menu-visible');
        dropdownMenu.classList.toggle('dropdown-menu-hidden');
        caretUpIcon.classList.toggle('rotate');
    });

    chooseFilesOption.addEventListener('click', (e) => {
        e.preventDefault();
        dropdownButtonText.textContent = 'Choose Files';
        dropdownMenu.classList.remove('dropdown-menu-visible');
        dropdownMenu.classList.add('dropdown-menu-hidden');
        hiddenFileInput.click(); // This triggers the hidden file input
        caretUpIcon.classList.remove('rotate');
    });

    chooseFolderOption.addEventListener('click', (e) => {
        e.preventDefault();
        dropdownButtonText.textContent = 'Choose Folder';
        dropdownMenu.classList.remove('dropdown-menu-visible');
        dropdownMenu.classList.add('dropdown-menu-hidden');
        hiddenFolderInput.click(); // This triggers the hidden folder input
        caretUpIcon.classList.remove('rotate');
    });

    // This listener closes the dropdown if you click outside of it
    window.addEventListener('click', (event) => {
        if (!dropdownButton.contains(event.target) && !dropdownMenu.contains(event.target)) {
            dropdownMenu.classList.remove('dropdown-menu-visible');
            dropdownMenu.classList.add('dropdown-menu-hidden');
            caretUpIcon.classList.remove('rotate');
        }
    });

    infoMenuTrigger.addEventListener('click', (event) => {
        event.stopPropagation();
        const isVisible = infoMenuPopup.style.display === 'block';
        infoMenuPopup.style.display = isVisible ? 'none' : 'block';
    });

    window.addEventListener('click', (event) => {
        if (infoMenuPopup.style.display === 'block' && !infoMenuPopup.contains(event.target) && !infoMenuTrigger.contains(event.target)) {
            infoMenuPopup.style.display = 'none';
        }
    });

    // View navigation
    function showView(viewName) {
        allViews.forEach(view => view.classList.remove('active'));
        document.getElementById(viewName + 'View').classList.add('active');
        currentView = viewName;

        const globalHeader = document.querySelector('header');
        if (viewName === 'chat') {
            if (globalHeader) globalHeader.style.display = 'none';
            if (chatHeader) chatHeader.style.marginTop = '0px';
            if (chatArea) chatArea.style.paddingTop = '60px';
        } else {
            if (globalHeader) globalHeader.style.display = 'block';
            if (chatHeader) chatHeader.style.marginTop = '60px';//check this
            if (chatArea) chatArea.style.paddingTop = '120px';// check this
        }
    }

    // Generate new room ID from server (not peer ID)
    async function generateNewRoomId(retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(`${SERVER_URL}/create-room`);
                if (!response.ok) throw new Error('Server not responding');
                const data = await response.json();
                return data.roomId;
            } catch (err) {
                if (i === retries - 1) throw err;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    // Check if room exists on server (not peer ID)
    async function checkRoomExists(roomId) {
        try {
            const response = await fetch(`${SERVER_URL}/check-room/${roomId}`);
            if (!response.ok) throw new Error('Server not responding');
            const data = await response.json();
            return data.roomExists;
        } catch (error) {
            console.error('Error checking room :', error);
            throw error;
        }
    }

    function initializeDarkMode() {
        const darkModeButtons = document.querySelectorAll(".darkModeButton");
        darkModeButtons.forEach(darkModeButton => {
            if (!darkModeButton) return;

            function setDarkIcon(state) {
                darkModeButton.innerHTML = state === 'dark' ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
            }

            if (localStorage.getItem('theme') === 'dark') {
                setDarkIcon('dark');
            } else {
                setDarkIcon('light');
            }

            darkModeButton.addEventListener('click', () => {
                const isDark = document.documentElement.classList.toggle('dark-mode');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
                setDarkIcon(isDark ? 'dark' : 'light');
            });
        });
    }
    initializeDarkMode();

    function getIconByFileType(fileName) {
        // const ext = fileName.split('.').pop().toLowerCase();
        const index = fileName.lastIndexOf('.');
        const ext = index > 0 && index < fileName.length - 1 ? fileName.slice(index + 1).toLowerCase() : '';

        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'fa-file-image';
        if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'fa-file-video';
        if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'fa-file-audio';
        if (['pdf'].includes(ext)) return 'fa-file-pdf';
        if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'fa-file-word';
        if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'fa-file-excel';
        if (['ppt', 'pptx', 'odp'].includes(ext)) return 'fa-file-powerpoint';
        if (['txt', 'md', 'log'].includes(ext)) return 'fa-file-lines';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fa-file-zipper';
        if (['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'json5', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'svg'].includes(ext)) {
            return 'fa-file-code';
        }
        if (['js', 'mjs', 'cjs'].includes(ext)) return 'fa-brands fa-js';
        if (['php'].includes(ext)) return 'fa-brands fa-php';
        if (['py', 'pyw'].includes(ext)) return 'fa-brands fa-python';
        if (['swift'].includes(ext)) return 'fa-brands fa-swift';
        if (['r', 'rscript'].includes(ext)) return 'fa-brands fa-r-project';
        if (['ts', 'tsx', 'jsx', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'hh', 'hpp', 'cpp', 'cxx', 'cc', 'cs', 'go', 'rs', 'rb', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'sql'].includes(ext)) {
            return 'fa-file-code';
        }
        return 'fa-file';
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showMessage(msgText, type = 'info') {
        const message = document.getElementById('message');
        if (!message) return;
        message.textContent = msgText;
        message.className = ''; // Clear previous classes
        message.classList.add(type);
        message.classList.add('show');

        setTimeout(() => {
            message.classList.remove('show');
        }, 3000);
    }

    startSessionButton.addEventListener('click', startSession);
    joinSessionButton.addEventListener('click', () => showView('joinSession'));
    connectButton.addEventListener('click', joinSession);

    backToIndexButton.addEventListener('click', () => {
        intentionalDisconnect = true; // Mark as intentional
        closePeerConnection();
        cleanupURL();
        joinSessionButton.disabled = false;
        joinSessionButton.innerHTML = '<i class="fas fa-download"></i>Join a Session';
        showView('index');
    });
    backFromStartButton.addEventListener('click', () => {
        intentionalDisconnect = true; // Mark as intentional
        closePeerConnection();
        cleanupURL();
        joinSessionButton.disabled = false;
        joinSessionButton.innerHTML = '<i class="fas fa-download"></i>Join a Session';
        showView('index');
    });
    backFromJoinButton.addEventListener('click', () => {
        intentionalDisconnect = true; // Mark as intentional (though no connection yet)
        cleanupURL();
        joinSessionButton.disabled = false;
        joinSessionButton.innerHTML = '<i class="fas fa-download"></i>Join a Session';
        showView('index');
    });


    // Set up peer ID input
    peerIdInput.addEventListener('input', (e) => {
        // Allow alphanumeric characters and convert to uppercase
        e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    });

    peerIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinSession();
        }
    });

    // Check for direct connection via URL parameter
    if (directPeerId) {
        joinSessionButton.disabled = true;
        joinSessionButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting';
        peerIdInput.value = directPeerId;
        setTimeout(() => {
            joinSession();
        }, 500);
    }

    function cleanupURL() {
        const newURL = window.location.protocol + '//' + window.location.host;
        window.history.replaceState({ path: newURL }, '', newURL);
    }

    // Start session (sender mode)
    async function startSession() {
        showView('startSession');

        try {
            // Get persistent room ID from server
            const roomId = await generateNewRoomId(3);
            originalSessionCode = roomId; // Store room ID, not peer ID
            initializePeer(true, roomId); // Use room ID as peer ID
        } catch (error) {
            console.error('Error creating room:', error);
            showMessage('Server not running. Please try again in a moment.', 'error');
            setTimeout(() => {
                showView('index');
            }, 1500);
        }
    }

    // Join session (receiver mode)
    async function joinSession() {
        const roomId = peerIdInput.value.trim().toUpperCase();
        if (roomId.length !== 8) {
            showMessage('Please enter a valid 8-character code', 'error');
            return;
        }

        try {
            // Check if room exists on server
            const roomExists = await checkRoomExists(roomId);

            if (roomExists) {
                originalSessionCode = roomId; // Store the room ID
                initializePeer(false, null, roomId); // Connect to room creator
            } else {
                showMessage('Invalid or expired code', 'error');
            }
        } catch (error) {
            console.error('Error checking room:', error);
            showMessage('Failed to verify code', 'error');
        }
    }

    // Initialize PeerJS with proper server configuration
    function initializePeer(isSender, senderId = null, targetPeerId = null) {
        for (let i = 0; i < NUM_WORKERS; i++) {
            const worker = new Worker('db-worker.js');
            worker.onmessage = (event) => {
                console.group('%cMain Thread: Received message from DB Worker:', 'color: #9932CC; font-weight: bold;');
                console.log('Data received:', event.data);

                if (event.data && event.data.type === 'chunk-stored') {
                    // Handle individual chunk confirmation
                    const { fileId, index } = event.data;
                    const fileInfo = incomingFiles[fileId];

                    if (fileInfo) {
                        if (!fileInfo.confirmedChunks) fileInfo.confirmedChunks = new Set();
                        fileInfo.confirmedChunks.add(index);

                        console.log(`Chunk ${index} confirmed stored for ${fileId}. Total confirmed: ${fileInfo.confirmedChunks.size}/${fileInfo.totalChunks}`);

                        // Check if all chunks are confirmed
                        if (fileInfo.confirmedChunks.size >= fileInfo.totalChunks) {
                            const resolver = fileStoredResolvers.get(fileId);
                            if (resolver) {
                                console.log(`%cSUCCESS: All ${fileInfo.totalChunks} chunks confirmed stored for ${fileId}!`, 'color: green; font-weight: bold;');
                                resolver();
                                fileStoredResolvers.delete(fileId);
                            }
                        }
                    }
                }
                console.groupEnd();
            };
            dbWorkers.push(worker);
        }
        const peerOptions = {
            host: window.location.hostname,
            port: serverPort,
            path: '/peerjs/myapp',
            secure: isSecure,
            config: {
                iceServers: [
                    // Multiple STUN servers for better connectivity
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    { urls: 'stun:stun.services.mozilla.com' },

                    // TURN servers for NAT traversal (CRITICAL for cross-network)
                    {
                        urls: "turn:openrelay.metered.ca:80",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turn:openrelay.metered.ca:443",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turn:openrelay.metered.ca:443?transport=tcp",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    // Backup TURN server
                    {
                        urls: "turn:numb.viagenie.ca",
                        username: "webrtc@live.com",
                        credential: "muazkh"
                    }
                ],
                iceTransportPolicy: 'all',
                iceCandidatePoolSize: 10
            },
            debug: 2
        };

        peer = new Peer(senderId, peerOptions);

        peer.on('open', (id) => {
            console.log('Peer ID:', id);
            myPeerId = id;

            if (isSender) {
                setupSender(id);
            } else {
                const conn = peer.connect(targetPeerId, {
                    label: myPeerId,
                    metadata: { name: myName },
                    serialization: 'binary',
                    reliable: true,
                    dcInit: {
                        ordered: false
                    }
                });
                handleConnection(conn);
            }
        });

        peer.on('connection', handleConnection);

        peer.on('error', (error) => {
            console.error('Peer error:', error);

            // Better error messages
            let userMessage = 'Connection error';
            if (error.type === 'network') {
                userMessage = 'Network error - check your internet connection';
            } else if (error.type === 'peer-unavailable') {
                userMessage = 'Session not found or expired';
            } else if (error.type === 'server-error') {
                userMessage = 'Server connection failed - please retry';
            } else {
                userMessage = 'Connection error: ' + error.message;
            }

            showMessage(userMessage, 'error');

            setTimeout(() => {
                showView('index');
            }, 2000);
        });
    }

    function broadcast(data) {
        for (const connectionInfo of connections.values()) {
            const conn = connectionInfo.conn;
            if (conn && conn.open) {
                conn.send(data);
            }
        }
    }

    // Setup sender with QR code and display
    function setupSender(peerId) {
        // Update the header text
        h2Connection.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Ready! Share this code:';

        // Display the peer ID
        peerIdDisplay.textContent = peerId;
        codeContainer.style.display = 'flex';

        // Generate QR code with proper URL (like your original)
        const receiverUrl = window.location.href.split('?')[0] + '?peerId=' + peerId;
        qrCodeContainer.innerHTML = ''; // Clear any existing QR code

        new QRCode(qrCodeContainer, {
            text: receiverUrl,
            width: 160,
            height: 160,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
        qrCodeContainer.style.display = 'block';

        // Setup copy and share buttons
        copyIdButton.onclick = () => copyText(peerId);
        shareIdButton.onclick = () => shareCode(peerId, receiverUrl);

        console.log('Waiting for connection...');
        showMessage('Ready! Share the 6-digit code or QR code to receive files.', 'success');
        infoPopup(peerId);
    }

    // Connect to peer
    function connectToPeer(targetPeerId) {
        connection = peer.connect(targetPeerId, {
            serialization: 'binary',
            reliable: true,
            dcInit: {
                ordered: false
            }
        });
    }

    // Handle connection
    function handleConnection(conn) {
        console.log(`New connection from ${conn.peer}`);
        connections.set(conn.peer, { conn: conn, name: conn.metadata.name || 'Guest' });
        intentionalDisconnect = false;

        conn.on('open', () => {
            console.log(`Connection to ${conn.peer} is open.`);
            const allPeerIds = [myPeerId, ...Array.from(connections.keys())];
            conn.send({ type: 'introduction', peerIds: allPeerIds });

            if (connections.size === 1) {
                showMessage('Connected successfully!', 'success');
                showView('chat');
                askForName();
                setupFileHandling();
                updateConnectionStatus(true);
                if (originalSessionCode) infoPopup(originalSessionCode);
                addSystemMessage('You joined a file sharing session');
            } else {
                addSystemMessage(`${conn.metadata.name || 'A User'} joined the session.`);
            }

            // Start room heartbeat to keep room alive
            if (originalSessionCode && myPeerId) {
                startRoomHeartbeat(originalSessionCode, myPeerId);
            }
        });

        conn.on('data', (data) => {
            handleIncomingData(data, conn.peer);
        });

        conn.on('close', () => {
            console.log(`Connection to ${conn.peer} closed.`);
            const departingPeer = connections.get(conn.peer);
            const departingName = departingPeer ? departingPeer.name : 'A user';

            connections.delete(conn.peer);
            addSystemMessage(`${departingName} left the session.`);

            if (connections.size === 0) {
                updateConnectionStatus(false);
                if (!intentionalDisconnect) {
                    showMessage('The session has ended.', 'info');
                    closePeerConnection();
                    showView('index');
                }
            }
        });

        conn.on('error', (error) => {
            console.error(`Connection error with ${conn.peer}:`, error); // Fixed: was 'err'
            connections.delete(conn.peer);
            showMessage('Connection error: ' + error.message, 'error');
            updateConnectionStatus(false);
            stopRoomHeartbeat();
        });
    }

    // Start sending heartbeats to keep room alive
    function startRoomHeartbeat(roomId, peerId) {
        if (roomHeartbeatInterval) clearInterval(roomHeartbeatInterval);

        // Send heartbeat immediately
        sendRoomHeartbeat(roomId, peerId);

        // Then send every minute
        roomHeartbeatInterval = setInterval(() => {
            sendRoomHeartbeat(roomId, peerId);
        }, 10 * 1000); // Every 10 seconds
    }

    // Stop sending heartbeats and notify server we're leaving
    function stopRoomHeartbeat() {
        if (roomHeartbeatInterval) {
            clearInterval(roomHeartbeatInterval);
            roomHeartbeatInterval = null;
        }

        // Notify server we're leaving the room
        if (originalSessionCode && myPeerId) {
            fetch(`${SERVER_URL}/room-heartbeat/${originalSessionCode}/${myPeerId}`, {
                method: 'DELETE'
            }).catch(error => {
                console.log('Failed to notify server of room exit:', error);
            });
        }
    }

    // Send heartbeat to server
    async function sendRoomHeartbeat(roomId, peerId) {
        try {
            const response = await fetch(`${SERVER_URL}/room-heartbeat/${roomId}/${peerId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userName: myName
                })
            });

            if (!response.ok) {
                console.log('Room heartbeat failed - room may have been deleted');
                // Room might have been deleted, stop heartbeat
                stopRoomHeartbeat();
            }
        } catch (error) {
            console.log('Failed to send room heartbeat:', error);
        }
    }

    // Close peer connection
    function closePeerConnection() {
        intentionalDisconnect = true;

        stopRoomHeartbeat();

        dbWorkers.forEach(worker => worker.terminate());
        dbWorkers.length = 0;
        nextWorker = 0;

        for (const connectionInfo of connections.values()) connectionInfo.conn.close();
        connections.clear();

        if (peer) {
            peer.destroy();
            peer = null;
        }

        myPeerId = null;
        originalSessionCode = null;
        selectedFiles = [];
        incomingFiles = {};
        isTransferring = false;
        Object.keys(transferStates).forEach(id => delete window['file_' + id]);
        cleanupURL();
        joinSessionButton.disabled = false;
        joinSessionButton.innerHTML = '<i class="fas fa-download"></i>Join a Session';
    }

    // Add system message to chat
    function addSystemMessage(text) {
        const message = document.createElement('p');
        message.className = 'system-message'; // Use CSS class instead of inline styles
        message.textContent = text;
        chatArea.appendChild(message);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    function addIncomingFileOffer(fileData) {
        addFileBubbleToChat('received', fileData, fileData.fileId);

        // Store the file metadata
        incomingFiles[fileData.fileId] = {
            name: fileData.name,
            size: fileData.size,
            chunks: [],
            receivedSize: 0
        };
    }

    window.acceptFile = function (fileId) {
        const fileInfo = incomingFiles[fileId];
        if (!fileInfo || fileInfo.accepted) return;
        fileInfo.accepted = true;

        // CRITICAL FIX: Create storage promise IMMEDIATELY
        const storagePromise = new Promise(resolve => {
            fileStoredResolvers.set(fileId, resolve);
        });
        fileInfo.storagePromise = storagePromise;

        // Initialize tracking BEFORE sending acceptance
        fileInfo.lastMeasurementTime = performance.now();
        fileInfo.bytesSinceLastMeasurement = 0;

        // Initialize chunk tracking if not already done
        if (!fileInfo.receivedChunks) fileInfo.receivedChunks = new Set();
        if (!fileInfo.confirmedChunks) fileInfo.confirmedChunks = new Set();

        console.log(`%cAccepted file ${fileId}. Storage tracking initialized.`, 'color: green; font-weight: bold;');

        sendToPeer(fileInfo.senderId, { type: 'file-accepted', fileId: fileId });

        const messageDiv = document.getElementById('message_' + fileId);
        if (!messageDiv) return;

        const actionsDiv = messageDiv.querySelector('.file-actions');
        const progressInfo = document.getElementById('progress_' + fileId);

        const progressContainer = messageDiv.querySelector('.file-progress-container');
        const progressBar = messageDiv.querySelector('.file-progress-bar div');
        const progressText = messageDiv.querySelector('.file-progress-text');

        if (actionsDiv) actionsDiv.style.display = 'none';
        if (progressInfo) progressInfo.style.display = 'none';

        if (progressContainer) {
            progressContainer.style.display = 'flex';
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = '0%';
        }
        updateButtonVisibility();
    };

    // Reject file
    window.rejectFile = function (fileId, event) {
        const fileInfo = incomingFiles[fileId];
        if (!fileInfo) return;

        sendToPeer(fileInfo.senderId, { type: 'file-rejected', fileId: fileId });
        const messageDiv = event.target.closest('.message-bubble');
        messageDiv.remove();

        delete incomingFiles[fileId];
        updateButtonVisibility();
    };

    // Setup file handling
    function setupFileHandling() {
        // File input change
        hiddenFileInput.addEventListener('change', (e) => {
            handleFileSelection(Array.from(e.target.files));
            e.target.value = '';
            e.target.value = ''; // Reset input
        });

        // Folder input change
        hiddenFolderInput.addEventListener('change', (e) => {
            handleFileSelection(Array.from(e.target.files));
            e.target.value = ''; // Reset input
        });

        // Drag and drop
        fileInputArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileInputArea.classList.add('drag-over');
        });

        fileInputArea.addEventListener('dragleave', () => {
            fileInputArea.classList.remove('drag-over');
        });

        fileInputArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileInputArea.classList.remove('drag-over');
            handleFileSelection(Array.from(e.dataTransfer.files));
        });

        // Send button
        sendFileButton.addEventListener('click', sendSelectedFiles);
        clearAllButton.addEventListener('click', () => {
            selectedFiles = [];
            renderFiles();
        });
    }

    // Handle file selection
    function handleFileSelection(files) {
        console.log(`Received ${files.length} files for selection`);

        for (const file of files) {
            // Skip directories (they shouldn't appear, but just in case)
            if (file.size === 0 && file.type === '') {
                console.log(`Skipping potential directory: ${file.name}`);
                continue;
            }

            // Use webkitRelativePath if available (for folders), otherwise use name
            const uniqueKey = file.webkitRelativePath || file.name;

            // Check if file already exists
            if (!selectedFiles.some(f => {
                const existingKey = f.webkitRelativePath || f.name;
                return existingKey === uniqueKey && f.size === file.size;
            })) {
                selectedFiles.push(file);
                console.log(`Added file: ${uniqueKey} (${formatFileSize(file.size)})`);
            } else {
                console.log(`Skipped duplicate: ${uniqueKey}`);
            }
        }

        console.log(`Total selected files: ${selectedFiles.length}`);
        renderFiles();
    }

    function renderFiles() {
        fileChoosen.innerHTML = "";
        if (selectedFiles.length > 0) {
            fileDisplayArea.style.display = "block";
            fileChoosen.style.display = "block";
            selectedFiles.forEach((file, index) => {
                const fileElement = createFileElement(file);
                fileElement.style.cursor = 'pointer';
                fileElement.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        showPreview(file, 'sender');
                    }
                });
                fileChoosen.appendChild(fileElement);
            });
        } else {
            fileDisplayArea.style.display = "none";
        }
        updateSummary();
        updateButtonVisibility();
    }

    function createFileElement(file) {
        const div = document.createElement("div");
        div.className = "fileList";
        div.dataset.fileName = file.name;

        div.innerHTML = `
                    <div class="file-info">
                        <i class="file-icon fa-solid ${getIconByFileType(file.name)}"></i>
                        <div class="file-details">
                            <div class="filename-container">
                                <span class="filename" title="${file.name}">${file.name}</span>
                            </div>
                            <div class="file-meta-row">
                                <span class="file-size">${formatFileSize(file.size)}</span>
                                <button class="delete-file" title="Remove file"><i class="fa-solid fa-trash" style="color:var(--danger);"></i></button>
                                </div>
                        </div>
                    </div>
                `;

        const deleteBtn = div.querySelector(".delete-file");
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedFiles = selectedFiles.filter(f => f.name !== file.name || f.size !== file.size);
            renderFiles();
        });
        return div;
    }

    function updateSummary() {
        if (selectedFiles.length === 0) {
            fileDisplayArea.style.display = "none";
            fileSummary.textContent = "";
        } else {
            let totalSize = 0;
            for (let i = 0; i < selectedFiles.length; i++) {
                totalSize += selectedFiles[i].size;
            }
            fileSummary.textContent = `${selectedFiles.length} file(s) | Total: ${formatFileSize(totalSize)}`;
        }
    }

    // A unified function to add file bubbles to the chat
    function addFileBubbleToChat(type, file, fileId, senderId = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-bubble ${type}`;
        messageDiv.id = `message_${fileId}`;

        const time = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        let senderName = myName;
        if (type === 'received' && senderId) {
            senderName = connections.get(senderId)?.name || 'Guest';
        }

        const senderLabel = type === 'received' ? `<div class="sender-label">${escapeHtml(senderName)}</div>` : '';

        let content = `
            ${senderLabel}
            <div class="file-info">
                <i class="file-icon fa-solid ${getIconByFileType(file.name)}" style="${type === 'sent' ? 'color: rgba(255, 255, 255, 0.9);' : ''}"></i>
                <div class="file-details">
                    <h4>${file.name}</h4>
                    <p>${formatFileSize(file.size)}</p>
                </div>
            </div>
            <div class="progress-info" id="progress_${fileId}"></div>
        `;

        content += `
        <div class="file-progress-container" style="display: none;">
            <div class="file-progress-labels">
                <span class="file-progress-text">0%</span>
                <span class="file-progress-speed"></span>
            </div>
            <div class="file-progress-bar" id="progress_bar_${fileId}"><div></div></div>
        </div>
        `;

        if (type === 'received') {
            content += `
                <div class="file-actions">
                    <button class="accept-btn" onclick="acceptFile('${fileId}', event)">Accept</button>
                    <button class="reject-btn" onclick="rejectFile('${fileId}', event)">Reject</button>
                </div>
            `;
        }

        content += `<div class="message-time">${time}</div>`;

        messageDiv.innerHTML = content;
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;

        const progressInfo = document.getElementById('progress_' + fileId);
        if (type === 'sent') {
            progressInfo.textContent = 'Offering file...';
        }
    }

    function sendToPeer(peerId, data) {
        console.log(`%cSENDING private message to ${peerId}:`, 'color: #00AACC; font-weight: bold;', data);
        const connectionInfo = connections.get(peerId);
        if (connectionInfo && connectionInfo.conn.open) {
            connectionInfo.conn.send(data);
        }
    }
    function handleIncomingData(data, peerId) {
        console.log(`%cRECEIVED message from ${peerId}:`, 'color: #FFA500; font-weight: bold;', data);
        switch (data.type) {
            case 'text-message':
                addTextMessageToChat('received', data.message, data.timestamp, peerId);
                break;
            case 'file-preview':
                if (incomingFiles[data.fileId]) {
                    incomingFiles[data.fileId].preview = data.preview;
                }
                break;
            case 'file-offer':
                const fileData = { fileId: data.fileId, name: data.name, size: data.size };
                addFileBubbleToChat('received', fileData, data.fileId, peerId);
                const messageDiv = document.getElementById('message_' + data.fileId);
                messageDiv.style.cursor = 'pointer';
                messageDiv.addEventListener('click', (e) => {
                    if (!e.target.closest('button')) {
                        showPreview(incomingFiles[data.fileId], 'receiver');
                    }
                });
                incomingFiles[data.fileId] = {
                    ...fileData,
                    type: data.fileType,
                    chunks: [],
                    receivedSize: 0,
                    accepted: false,
                    senderId: peerId,
                    totalChunks: Math.ceil(fileData.size / (256 * 1024)),
                    storedChunkCount: 0,
                    confirmedChunks: new Set(),
                    receivedChunks: new Set()
                };
                updateButtonVisibility();
                break;
            case 'file-rejected':
                // Sender gets notified
                delete transferStates[data.fileId];
                const progressInfo = document.getElementById('progress_' + data.fileId);
                if (progressInfo) progressInfo.textContent = 'Receiver rejected the file.';
                delete window['file_' + data.fileId];
                break;
            case 'file-accepted':
                console.group(`--- DEBUG: 'file-accepted' received ---`);
                console.log('Received for fileId:', data.fileId);
                console.log('From peer:', peerId);
                console.log('Current transferStates object:', transferStates);
                console.log('State for this fileId:', transferStates[data.fileId]);
                console.groupEnd();

                if (transferStates[data.fileId] === 'offered') {
                    console.log(`First acceptor for ${data.fileId}. Starting transfer.`);
                    transferStates[data.fileId] = 'transferring';
                    fileAcceptors[data.fileId] = [peerId];
                    transferFile(data.fileId);
                } else if (transferStates[data.fileId] === 'transferring') {
                    console.log(`Late acceptor #${(fileAcceptors[data.fileId]?.length || 0) + 1} for ${data.fileId}: ${peerId}`);
                    if (!fileAcceptors[data.fileId]) fileAcceptors[data.fileId] = [];
                    if (!fileAcceptors[data.fileId].includes(peerId)) {
                        fileAcceptors[data.fileId].push(peerId);
                        console.log(`Now sending to ${fileAcceptors[data.fileId].length} peers`);

                        const transfer = outgoingTransfers[data.fileId];
                        if (transfer) {
                            // CRITICAL FIX: Use SENT chunks, not ACKed chunks!
                            const chunksSent = transfer.sentChunks || 0;
                            console.log(`%cTelling ${peerId} they're joining mid-transfer (${chunksSent} chunks already SENT, ${transfer.ackCount} ACKed)`, 'color: orange; font-weight: bold;');

                            sendToPeer(peerId, {
                                type: 'file-catchup',
                                fileId: data.fileId,
                                chunksToExpect: chunksSent
                            });

                            resendChunksToNewPeer(data.fileId, peerId, chunksSent);
                        }
                    }
                } else if (transferStates[data.fileId] === 'completed' || !transferStates[data.fileId]) {
                    console.log(`%cPost-transfer acceptor for ${data.fileId}: ${peerId}`, 'color: purple; font-weight: bold;');

                    const file = window[`file_${data.fileId}`];
                    if (file) {
                        if (!fileAcceptors[data.fileId]) fileAcceptors[data.fileId] = [];
                        fileAcceptors[data.fileId].push(peerId);
                        console.log(`Sending ENTIRE file to late acceptor ${peerId}`);
                        sendEntireFileToLateAcceptor(data.fileId, peerId);
                    } else {
                        console.warn(`File ${data.fileId} no longer available`);
                        sendToPeer(peerId, {
                            type: 'file-rejected',
                            fileId: data.fileId,
                            reason: 'File transfer already completed. Please ask sender to resend.'
                        });
                    }
                } else {
                    console.warn(`File ${data.fileId} is in unexpected state: ${transferStates[data.fileId]}`);
                }
                break;
            case 'file-catchup':
                // NEW: Receiver gets notified they're joining mid-transfer
                console.log(`%cRECEIVER: Received catch-up notice for ${data.fileId}. Expecting ${data.chunksToExpect} resent chunks.`, 'color: blue; font-weight: bold;');
                // This ensures fileInfo exists BEFORE chunks start arriving
                if (incomingFiles[data.fileId]) {
                    incomingFiles[data.fileId].catchingUp = true;
                    incomingFiles[data.fileId].expectedResends = data.chunksToExpect;
                }
                break;
            case 'file-chunk':
                handleFileChunk(data);
                break;
            case 'file-ack':
                const transfer = outgoingTransfers[data.fileId];
                if (transfer && transfer.ackResolvers[data.index]) {
                    // Only count ONE ack per chunk (from any acceptor)
                    transfer.bytesSinceLastMeasurement += transfer.chunkSize;
                    const rtt = performance.now() - transfer.chunkTimestamps[data.index];
                    transfer.avgRTT = (transfer.RTT_ALPHA * rtt) + (1 - transfer.RTT_ALPHA) * transfer.avgRTT;

                    transfer.pipelineSize = adaptPipelineSize(transfer.pipelineSize, transfer.avgRTT);

                    transfer.ackResolvers[data.index]();
                    delete transfer.ackResolvers[data.index];
                    delete transfer.chunkTimestamps[data.index];
                    transfer.chunksInWaiting--;
                    transfer.ackCount++;

                    const progress = Math.min(100, Math.round((transfer.ackCount / transfer.totalChunks) * 100));
                    if (transfer.progressBar) transfer.progressBar.style.width = `${progress}%`;
                    if (transfer.progressText) transfer.progressText.textContent = `${progress}%`;
                }
                break;
            case 'file-complete':
                // Receiver completes the file
                completeFileReceive(data.fileId);
                break;
            case 'ping':
                broadcast({ type: 'pong' });
                break;
            case 'introduction':
                for (const peerId of data.peerIds) {
                    if (peerId !== myPeerId && !connections.has(peerId)) {
                        console.log(`Introduced to ${peerId}, attempting to connect.`);
                        const conn = peer.connect(peerId, {
                            label: myPeerId,
                            metadata: { name: myName },
                            serialization: 'binary',
                            reliable: true,
                            dcInit: {
                                ordered: false
                            }
                        });
                        handleConnection(conn);
                    }
                }
                break;
            case 'name-update':
                if (connections.has(peerId)) {
                    connections.get(peerId).name = data.name;
                    addSystemMessage(`${data.name} is now in the session.`);
                }
                break;
        }
    }

    // NEW: Resend already-sent chunks to a peer who accepted during transfer
    async function resendChunksToNewPeer(fileId, newPeerId, chunksToResend) {
        const file = window[`file_${fileId}`];
        if (!file) {
            console.error(`Cannot resend chunks for ${fileId} - file not found`);
            return;
        }

        const chunkSize = 256 * 1024;

        console.log(`Resending chunks 0-${chunksToResend - 1} to ${newPeerId}`);

        // Send chunks in batches to avoid overwhelming the connection
        const BATCH_SIZE = 8;
        for (let i = 0; i < chunksToResend; i++) {
            const offset = i * chunkSize;
            const chunk = file.slice(offset, offset + chunkSize);
            const buffer = await chunk.arrayBuffer();

            sendToPeer(newPeerId, {
                type: 'file-chunk',
                fileId: fileId,
                data: buffer,
                index: i,
                isLastChunk: false
            });

            // Small delay every BATCH_SIZE chunks to avoid flooding
            if ((i + 1) % BATCH_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        console.log(`%cFinished resending ${chunksToResend} chunks to ${newPeerId}`, 'color: green; font-weight: bold;');
    }

    function generateRandomName() {
        const firstName = ["Brave", "Clever", "Swift", "Gentle", "Happy", "Wise", "Keen", "Bold", "Calm", "Eager",
            "Fierce", "Noble", "Bright", "Strong", "Quick", "Silent", "Proud", "Wild", "Free", "Sharp",
            "Mighty", "Graceful", "Loyal", "Fearless", "Agile", "Radiant", "Sturdy", "Brilliant", "Daring", "Serene",
            "Vigilant", "Majestic", "Cunning", "Resilient", "Spirited", "Nimble", "Valiant", "Mysterious", "Powerful", "Tranquil"];
        const lastName = ["Lion", "Eagle", "Fox", "Panda", "Tiger", "Wolf", "Hawk", "Bear", "Shark", "Whale",
            "Dragon", "Phoenix", "Falcon", "Leopard", "Raven", "Panther", "Stallion", "Viper", "Lynx", "Cobra",
            "Griffin", "Jaguar", "Condor", "Rhino", "Bison", "Cheetah", "Owl", "Moose", "Raven", "Stag",
            "Scorpion", "Wolverine", "Mustang", "Thunder", "Storm", "Glacier", "Mountain", "Ocean", "Comet", "Blaze"];

        const randomFirstName = firstName[Math.floor(Math.random() * firstName.length)];
        const randomLastName = lastName[Math.floor(Math.random() * lastName.length)];
        const randomNumber = Math.floor(Math.random() * 90) + 10;

        return `${randomFirstName}${randomLastName}${randomNumber}`;
    }

    function askForName() {
        const newName = prompt("Please enter your name : ", myName);
        if (newName && newName.trim()) {
            myName = newName.trim();
            broadcast({ type: 'name-update', name: myName });
        }
    }

    async function sendSelectedFiles() {
        if (connections.size === 0) return showMessage('No active connection', 'error');

        // Send message if there's one typed
        const message = messageInput.value.trim();
        if (message) {
            sendMessage();
        }

        if (selectedFiles.length === 0) {
            if (!message) {
                return showMessage('No files or messages to send', 'error');
            }
            return;
        }

        isTransferring = true;
        await toggleWakeLock(true);

        selectedFiles.sort((a, b) => a.size - b.size);
        const fileCount = selectedFiles.length; // Store count before clearing
        for (const file of selectedFiles) {
            handleSingleFileTransfer(file);
        }
        selectedFiles = [];
        renderFiles();
        showMessage(`Offered ${fileCount} file(s) for transfer.`, 'info'); // Use stored count

        isTransferring = false;
        sendFileButton.disabled = false;
        clearAllButton.disabled = false;
        await toggleWakeLock(false);
    }

    async function handleSingleFileTransfer(file) {
        const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        window['file_' + fileId] = file;
        transferStates[fileId] = 'offered';
        fileAcceptors[fileId] = []; // Initialize acceptor list
        addFileBubbleToChat('sent', file, fileId);
        broadcast({ type: 'file-offer', fileId: fileId, name: file.name, size: file.size, fileType: file.type });
    }

    // Send entire file to someone who accepted after transfer finished
    async function sendEntireFileToLateAcceptor(fileId, peerId) {
        const file = window[`file_${fileId}`];
        if (!file) {
            console.error(`Cannot send file ${fileId} - file not found`);
            return;
        }

        const chunkSize = 256 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);

        console.log(`%cSending entire file (${totalChunks} chunks) to ${peerId}`, 'color: purple; font-weight: bold;');

        // Send all chunks with small delays
        const BATCH_SIZE = 8;
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * chunkSize;
            const chunk = file.slice(offset, offset + chunkSize);
            const buffer = await chunk.arrayBuffer();

            sendToPeer(peerId, {
                type: 'file-chunk',
                fileId: fileId,
                data: buffer,
                index: i,
                isLastChunk: i === totalChunks - 1
            });

            // Small delay every BATCH_SIZE chunks
            if ((i + 1) % BATCH_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Send completion signal
        sendToPeer(peerId, {
            type: 'file-complete',
            fileId: fileId
        });

        console.log(`%cFinished sending entire file to late acceptor ${peerId}`, 'color: green; font-weight: bold;');
    }

    async function transferFile(fileId) {
        const file = window[`file_${fileId}`];
        if (!file) return;

        const messageDiv = document.getElementById(`message_${fileId}`);
        const progressInfo = document.getElementById(`progress_${fileId}`);
        if (progressInfo) progressInfo.style.display = 'none';
        const progressContainer = messageDiv.querySelector('.file-progress-container');
        const progressText = messageDiv.querySelector('.file-progress-text');
        const progressBar = messageDiv.querySelector('.file-progress-bar div');

        if (progressContainer) progressContainer.style.display = 'flex';
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';

        // Track file transfer start for each receiver
        const acceptors = fileAcceptors[fileId] || [];
        const transferIds = [];

        for (const receiverPeerId of acceptors) {
            try {
                const response = await fetch(`${SERVER_URL}/track-file-transfer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomId: originalSessionCode,
                        senderPeerId: myPeerId,
                        receiverPeerId: receiverPeerId,
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: file.type || 'unknown'
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    transferIds.push({ receiverPeerId, transferId: data.transferId });
                }
            } catch (error) {
                console.log('Failed to track file transfer start:', error);
            }
        }

        try {
            await sendFileInChunks(file, fileId, progressBar, progressText);

            // Mark as completed BEFORE sending signals
            transferStates[fileId] = 'completed';

            // Update transfer status to completed for each receiver
            for (const { transferId } of transferIds) {
                try {
                    await fetch(`${SERVER_URL}/track-file-transfer/${transferId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'completed' })
                    });
                } catch (error) {
                    console.log('Failed to update transfer status:', error);
                }
            }

            // Send complete signal to ALL acceptors
            const acceptors = fileAcceptors[fileId] || [];
            console.log(`Sending file-complete to ${acceptors.length} peers:`, acceptors);
            acceptors.forEach(peerId => {
                sendToPeer(peerId, {
                    type: 'file-complete',
                    fileId: fileId
                });
            });

            if (progressText) progressText.innerHTML = '<i class="fa-solid fa-check-circle" style="color:var(--success-glow)"></i>';

            const speedElement = messageDiv.querySelector('.file-progress-speed');
            if (speedElement) {
                speedElement.textContent = '';
            }

            // CRITICAL: Keep file in memory for 2 minutes for late acceptors
            console.log(`Keeping file ${fileId} in memory for 2 minutes for late acceptors`);
            setTimeout(() => {
                console.log(`Cleaning up file ${fileId} after 2 minutes`);
                delete window[`file_${fileId}`];
                delete transferStates[fileId];
                delete fileAcceptors[fileId];
            }, 120000); // 2 minutes

        } catch (error) {
            console.error(`Transfer for ${file.name} failed:`, error);
            showMessage(`Transfer for ${file.name} failed.`, 'error');
            if (progressText) progressText.textContent = "Failed";

            // Update transfer status to failed for each receiver
            for (const { transferId } of transferIds) {
                try {
                    await fetch(`${SERVER_URL}/track-file-transfer/${transferId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'failed' })
                    });
                } catch (err) {
                    console.log('Failed to update transfer status:', err);
                }
            }

            // Clean up on error
            delete window[`file_${fileId}`];
            delete transferStates[fileId];
            delete fileAcceptors[fileId];
        }
    }

    function formatSpeed(bytesPerSecond) {
        if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
        const kbps = bytesPerSecond / 1024;
        if (kbps < 1024) return `${kbps.toFixed(2)} KB/s`
        const mbps = kbps / 1024;
        return `${mbps.toFixed(2)} MB/s`
    }

    function adaptPipelineSize(currentSize, avgRTT) {
        const MIN_PIPELINE_SIZE = 4;
        const MAX_PIPELINE_SIZE = 256;
        const GOOD_RTT = 150; // ms
        const BAD_RTT = 800;  // ms

        if (avgRTT < GOOD_RTT) {
            return Math.min(MAX_PIPELINE_SIZE, currentSize + 1);
        } else if (avgRTT > BAD_RTT) {
            return Math.max(MIN_PIPELINE_SIZE, Math.floor(currentSize / 2));
        }
        return currentSize;
    }

    async function sendFileInChunks(file, fileId, progressBar, progressText) {
        const chunkSize = 256 * 1024;
        outgoingTransfers[fileId] = {
            totalChunks: Math.ceil(file.size / chunkSize),
            ackCount: 0,
            sentChunks: 0, // NEW: Track chunks SENT (not just ACKed)
            pipelineSize: 32,
            avgRTT: 100,
            RTT_ALPHA: 0.1,
            chunksInWaiting: 0,
            ackResolvers: {},
            chunkTimestamps: {},
            progressBar: progressBar,
            progressText: progressText,
            chunkSize: chunkSize,
            lastMeasurementTime: performance.now(),
            bytesSinceLastMeasurement: 0,
            acceptors: fileAcceptors[fileId] || []
        };

        const transfer = outgoingTransfers[fileId];

        try {
            const promises = [];
            for (let i = 0; i < transfer.totalChunks; i++) {
                const sendPromise = (async () => {
                    const MAX_RETRIES = 10;
                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        while (transfer.chunksInWaiting >= transfer.pipelineSize) {
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                        transfer.chunksInWaiting++;

                        try {
                            await new Promise((resolve, reject) => {
                                transfer.ackResolvers[i] = resolve;

                                setTimeout(() => {
                                    if (transfer.ackResolvers[i]) {
                                        reject(new Error(`Timeout for chunk ${i}`));
                                    }
                                }, 5000);

                                (async () => {
                                    const offset = i * chunkSize;
                                    const chunk = file.slice(offset, offset + chunkSize);
                                    const buffer = await chunk.arrayBuffer();
                                    transfer.chunkTimestamps[i] = performance.now();

                                    // Send to ALL acceptors
                                    const acceptors = fileAcceptors[fileId] || [];
                                    acceptors.forEach(peerId => {
                                        sendToPeer(peerId, {
                                            type: 'file-chunk',
                                            fileId: fileId,
                                            data: buffer,
                                            index: i,
                                            isLastChunk: i === transfer.totalChunks - 1
                                        });
                                    });

                                    // NEW: Track that we SENT this chunk
                                    transfer.sentChunks = Math.max(transfer.sentChunks, i + 1);
                                })();
                            });

                            return;

                        } catch (error) {
                            console.warn(`%cSENDER: ${error.message} (Attempt ${attempt + 1})`, 'color: orange;');
                            transfer.chunksInWaiting--;
                            delete transfer.ackResolvers[i];
                            transfer.pipelineSize = adaptPipelineSize(transfer.pipelineSize, 9999);

                            if (attempt === MAX_RETRIES - 1) {
                                console.error(`%cSENDER: FAILED to send chunk ${i} after ${MAX_RETRIES} attempts. Aborting transfer.`, 'color: red; font-weight: bold;');
                                throw error;
                            }
                        }
                    }
                })();
                promises.push(sendPromise);
            }

            await Promise.all(promises);

        } finally {
            delete outgoingTransfers[fileId];
        }
    }

    function handleFileChunk(data) {
        const fileInfo = incomingFiles[data.fileId];

        // CRITICAL FIX: Don't reject chunks if we're catching up!
        if (!fileInfo) {
            console.error(`%cReceived chunk for unknown file: ${data.fileId}`, 'color: red; font-weight: bold;');
            return;
        }

        if (!fileInfo.accepted && !fileInfo.catchingUp) {
            console.warn(`Received chunk for non-accepted file: ${data.fileId}`);
            return;
        }

        // SAFETY CHECK: Ensure storage promise exists
        if (!fileInfo.storagePromise) {
            console.error(`%cERROR: No storage promise for ${data.fileId}! Creating one now...`, 'color: red; font-weight: bold;');
            fileInfo.storagePromise = new Promise(resolve => {
                fileStoredResolvers.set(data.fileId, resolve);
            });
        }

        // Send ACK immediately
        sendToPeer(fileInfo.senderId, {
            type: 'file-ack',
            fileId: data.fileId,
            index: data.index
        });

        // Prevent duplicate chunks
        if (fileInfo.receivedChunks && fileInfo.receivedChunks.has(data.index)) {
            console.log(`Ignoring duplicate chunk: ${data.index} for file: ${data.fileId}`);
            return;
        }

        if (!fileInfo.receivedChunks) fileInfo.receivedChunks = new Set();
        fileInfo.receivedChunks.add(data.index);

        let chunkForWorker;

        if (data.data instanceof ArrayBuffer) {
            chunkForWorker = data.data.slice(0);
        } else if (data.data && data.data.buffer instanceof ArrayBuffer) {
            chunkForWorker = data.data.buffer.slice(0);
        } else {
            console.error("Received chunk data is in an unknown or invalid format.", data.data);
            return;
        }

        if (chunkForWorker.byteLength === 0) {
            console.error(`%cERROR: Received empty chunk ${data.index} for ${data.fileId}!`, 'color: red; font-weight: bold;');
            return;
        }

        console.log(`Chunk ${data.index} for ${data.fileId}: ${chunkForWorker.byteLength} bytes`);

        fileInfo.bytesSinceLastMeasurement = (fileInfo.bytesSinceLastMeasurement || 0) + chunkForWorker.byteLength;

        // Update received size (prevent overflow)
        const newReceivedSize = fileInfo.receivedSize + chunkForWorker.byteLength;
        fileInfo.receivedSize = Math.min(newReceivedSize, fileInfo.size);

        // Update progress
        const progress = Math.min(100, Math.round((fileInfo.receivedSize / fileInfo.size) * 100));
        const messageDiv = document.getElementById(`message_${data.fileId}`);
        if (messageDiv) {
            const progressBar = messageDiv.querySelector('.file-progress-bar div');
            const progressText = messageDiv.querySelector('.file-progress-text');
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressText) progressText.textContent = `${progress}%`;
        }

        // Send to worker for storage (NOW we can safely transfer it)
        dbWorkers[nextWorker].postMessage({
            fileId: data.fileId,
            chunkData: chunkForWorker,
            index: data.index,
            isLastChunk: data.isLastChunk || false
        }, [chunkForWorker]); // Transfer ownership to worker
        nextWorker = (nextWorker + 1) % NUM_WORKERS;
    }

    function getAllChunksForFile(fileId) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('fileStorageDB', 1);
            request.onerror = event => reject(event.target.error);
            request.onsuccess = event => {
                const db = event.target.result;
                const transaction = db.transaction(['fileChunks'], 'readonly');
                const store = transaction.objectStore('fileChunks');
                const index = store.index('by_fileId');
                const getAllRequest = index.getAll(fileId);
                getAllRequest.onsuccess = () => {
                    const items = getAllRequest.result;
                    items.sort((a, b) => a.index - b.index);
                    // The results are objects like { fileId, chunkData }, so we extract just the chunkData.
                    const chunks = items.map(item => item.chunkData);
                    resolve(chunks);
                };
                getAllRequest.onerror = event => reject(event.target.error);
            };
        });
    }

    async function completeFileReceive(fileId) {
        console.log(`%cReceiver: Received file-complete signal for ${fileId}.`, 'color: blue; font-weight: bold;');

        const fileInfo = incomingFiles[fileId];
        if (!fileInfo) {
            console.warn(`File info not found for ${fileId}`);
            return;
        }

        if (fileInfo.completing || fileInfo.completed) {
            console.log(`File ${fileId} is already ${fileInfo.completed ? 'completed' : 'completing'}, skipping duplicate call.`);
            return;
        }

        fileInfo.completing = true;

        const messageDiv = document.getElementById(`message_${fileId}`);
        if (messageDiv) {
            const progressContainer = messageDiv.querySelector('.file-progress-container');
            if (progressContainer) {
                const progressText = progressContainer.querySelector('.file-progress-text');
                if (progressText) progressText.textContent = 'Finalizing...';
                const speedElement = progressContainer.querySelector('.file-progress-speed');
                if (speedElement) speedElement.textContent = '';
            }
        }

        try {
            // Create storage promise if it doesn't exist
            if (!fileInfo.storagePromise) {
                console.warn(`Storage promise missing for ${fileId}, creating new one`);
                fileInfo.storagePromise = new Promise(resolve => {
                    fileStoredResolvers.set(fileId, resolve);
                });
            }

            // Wait for all chunks to be confirmed stored
            console.log(`Waiting for storage confirmation for ${fileId}. Expected: ${fileInfo.totalChunks}, Confirmed: ${fileInfo.confirmedChunks?.size || 0}`);

            const timeoutDuration = 60000; // Increase to 60 seconds for large files
            const timeout = setTimeout(() => {
                console.error(`%cSTORAGE TIMEOUT for ${fileId}!`, 'color: red; font-weight: bold;');
                console.log(`Expected chunks: ${fileInfo.totalChunks}, Confirmed: ${fileInfo.confirmedChunks?.size || 0}, Received: ${fileInfo.receivedChunks?.size || 0}`);

                // Don't proceed if we're missing too many chunks
                const confirmedCount = fileInfo.confirmedChunks?.size || 0;
                const missingChunks = fileInfo.totalChunks - confirmedCount;

                if (missingChunks > 5) { // Allow max 5 missing chunks
                    console.error(`Too many missing chunks (${missingChunks}), aborting download`);
                    showMessage(`File incomplete: ${missingChunks} chunks missing`, 'error');
                    const resolver = fileStoredResolvers.get(fileId);
                    if (resolver) {
                        fileStoredResolvers.delete(fileId);
                    }
                    if (messageDiv) {
                        const progressText = messageDiv.querySelector('.file-progress-text');
                        if (progressText) progressText.textContent = 'Incomplete';
                    }
                    return;
                }

                console.warn(`Proceeding with ${missingChunks} missing chunks...`);
                const resolver = fileStoredResolvers.get(fileId);
                if (resolver) {
                    resolver();
                    fileStoredResolvers.delete(fileId);
                }
            }, timeoutDuration);

            await fileInfo.storagePromise;
            clearTimeout(timeout);

            console.log(`%cAll chunks confirmed stored for ${fileId}. Preparing download button.`, 'color: green; font-weight: bold;');
            console.log(`Final count - Confirmed: ${fileInfo.confirmedChunks.size}, Expected: ${fileInfo.totalChunks}`);

            // Mark as completed
            fileInfo.completed = true;

            // Store file metadata for download
            window[`fileinfo_${fileId}`] = {
                name: fileInfo.name,
                type: fileInfo.type,
                size: fileInfo.size,
                expectedChunks: fileInfo.totalChunks
            };

            // Update UI to show download button
            if (messageDiv) {
                const progressContainer = messageDiv.querySelector('.file-progress-container');
                if (progressContainer) progressContainer.style.display = 'none';

                let actionsDiv = messageDiv.querySelector('.file-actions');
                if (!actionsDiv) {
                    actionsDiv = document.createElement('div');
                    actionsDiv.className = 'file-actions';
                    messageDiv.appendChild(actionsDiv);
                }

                actionsDiv.style.display = 'flex';
                actionsDiv.innerHTML = `<button class="download-btn" onclick="downloadFile('${fileId}')"><i class="fa-solid fa-download"></i> Download</button>`;

                // Only auto-download once
                if (autoDownload && !fileInfo.autoDownloaded) {
                    fileInfo.autoDownloaded = true;
                    setTimeout(() => {
                        const btn = actionsDiv.querySelector('.download-btn');
                        if (btn) btn.click();
                    }, 100);
                }
            }

            // Clean up
            delete incomingFiles[fileId];
            updateButtonVisibility();

        } catch (error) {
            console.error(`Error completing file receive for ${fileId}:`, error);
            showMessage(`Error finalizing ${fileInfo.name}`, 'error');

            if (messageDiv) {
                const progressText = messageDiv.querySelector('.file-progress-text');
                if (progressText) progressText.textContent = 'Error';
            }
        }
    }

    window.downloadFile = async function (fileId) {
        const fileInfo = window[`fileinfo_${fileId}`];
        if (!fileInfo) {
            console.error(`File info not found for ${fileId}`);
            return showMessage('File data not found.', 'error');
        }

        // Prevent duplicate downloads
        if (fileInfo.downloading) {
            console.log(`File ${fileId} is already downloading`);
            return;
        }
        fileInfo.downloading = true;

        if (fileInfo.size > 250 * 1024 * 1024) {
            showMessage('Preparing large file... Browser may become unresponsive.', 'info');
        }

        try {
            console.log(`Starting download for ${fileId} (${fileInfo.name})`);
            const chunks = await getAllChunksForFile(fileId);

            if (!chunks || chunks.length === 0) {
                throw new Error('No chunks found in database');
            }

            console.log(`%cRetrieved ${chunks.length} chunks for ${fileInfo.name} (expected ${fileInfo.expectedChunks})`, 'color: blue; font-weight: bold;');

            // Verify we have all chunks
            if (chunks.length < fileInfo.expectedChunks) {
                console.error(`%cMISSING CHUNKS: Got ${chunks.length}, expected ${fileInfo.expectedChunks}`, 'color: red; font-weight: bold;');
                showMessage(`Warning: File may be incomplete (${chunks.length}/${fileInfo.expectedChunks} chunks)`, 'error');
            }

            const fileBlob = new Blob(chunks, { type: fileInfo.type || 'application/octet-stream' });

            console.log(`%cBlob created - Expected size: ${formatFileSize(fileInfo.size)}, Actual size: ${formatFileSize(fileBlob.size)}`, 'color: purple; font-weight: bold;');

            // Verify blob size matches expected size
            const sizeDiff = Math.abs(fileBlob.size - fileInfo.size);
            if (sizeDiff > 1024) { // More than 1KB difference
                console.error(`%cSIZE MISMATCH: Expected ${fileInfo.size} bytes, got ${fileBlob.size} bytes (diff: ${sizeDiff} bytes)`, 'color: red; font-weight: bold;');
                showMessage(`Warning: File size mismatch - expected ${formatFileSize(fileInfo.size)}, got ${formatFileSize(fileBlob.size)}`, 'error');
            }

            const url = URL.createObjectURL(fileBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileInfo.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => {
                URL.revokeObjectURL(url);
                fileInfo.downloading = false;
            }, 1000);

            showMessage(`Download started: ${fileInfo.name} (${formatFileSize(fileBlob.size)})`, 'success');
        } catch (error) {
            console.error('Download failed:', error);
            showMessage(`Error downloading ${fileInfo.name}: ${error.message}`, 'error');
            fileInfo.downloading = false;
        }
    };

    // Update connection status
    function updateConnectionStatus(connected) {
        const statusIcon = connectionStatus.querySelector('i');
        const statusText = connectionStatus.querySelector('span');

        if (connected) {
            statusIcon.style.color = 'var(--primary)';
            statusText.textContent = 'Connected';
        } else {
            statusIcon.style.color = 'var(--danger)';
            statusText.textContent = 'Disconnected';
        }
    }

    function createGenericPreview(type, isOffer = false) {
        const div = document.createElement('div');
        div.className = 'preview-generic';
        const iconType = type.includes('image') ? 'image' : type.includes('video') ? 'video' : 'file';
        div.innerHTML = `<i class="fas fa-icon-${iconType}"></i><br>Preview not supported for ${type}`;
        if (isOffer) div.innerHTML += '<br><small>Click Accept to download full file.</small>';
        return div;
    }

    function showPreview(data, mode = 'sender') {
        container.innerHTML = '';

        let previewElement;

        const file = data; // complete file object
        let title = document.createElement('h3');
        title.textContent = `Preview : ${file.name}`;
        container.appendChild(title);

        let meta = document.createElement('div');
        meta.innerHTML = `<p><strong>Size:</strong> ${formatFileSize(file.size)}</p><p><strong>Type:</strong> ${file.type || 'Unknown'}</p>`;
        container.appendChild(meta);

        const fileType = file.type || file.name.split('.').pop().toLowerCase();

        if (mode === 'sender') {
            if (fileType.startsWith('image/')) {
                previewElement = document.createElement('img');
                previewElement.src = URL.createObjectURL(file);
            } else if (fileType.startsWith('application/pdf')) {
                previewElement = document.createElement('iframe');
                previewElement.src = URL.createObjectURL(file);
                previewElement.style.width = '100%';
                previewElement.style.height = '70vh';
            } else if (fileType.startsWith('text/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const preview = document.createElement('pre');
                    preview.textContent = event.target.result.substring(0, 5000) + '...'; // limits to 5kb
                    container.appendChild(preview);
                }
                reader.readAsText(file);
                previewElement = null;
            } else previewElement = createGenericPreview(fileType);
        } else {
            if (file.preview) {
                previewElement = document.createElement('img');
                previewElement.src = 'data:image/jpeg;base64,' + file.preview;
                previewElement.style.maxWidth = '300px';
                previewElement.style.borderRadius = '0.5rem';
            } else {
                previewElement = createGenericPreview(fileType || 'Unknown', true);
            }
        }
        if (previewElement) container.appendChild(previewElement);
        modal.style.display = 'flex';

        const closeHandler = () => {
            modal.style.display = 'none';
            if (mode === 'sender' && previewElement && previewElement.src && previewElement.src.startsWith('blob:')) {
                URL.revokeObjectURL(previewElement.src);
            }
        };
        document.querySelector('.close-preview').onclick = closeHandler;
        modal.onclick = (e) => { if (e.target === modal) closeHandler(); };
    }

    async function generateThumbnail(file) {
        const canvas = document.createElement('canvas');
        const canvasContext = canvas.getContext('2d');
        const size = 300
        canvas.width = size;
        canvas.height = size;

        const fileType = file.type || file.name.split('.').pop().toLowerCase();
        if (fileType.startsWith('image/')) {
            return new Promise((resolve) => {
                const image = new Image();
                image.onload = () => {
                    const scale = Math.min(size / image.width, size / image.height);
                    const scaledWidth = image.width * scale;
                    const scaledHeight = image.height * scale;
                    const dx = (size - scaledWidth) / 2;
                    const dy = (size - scaledHeight) / 2;
                    canvasContext.drawImage(image, dx, dy, scaledWidth, scaledHeight);
                    canvas.toBlob(resolve, 'image/jpeg', 1.0);
                };
                image.src = URL.createObjectURL(file);
                image.onerror = () => resolve(null);
            });
        } else if (fileType.startsWith('video/')) {
            return new Promise((resolve) => {
                const video = document.createElement('video');
                video.onloadeddata = () => {
                    video.currentTime = 1;
                    video.onseeked = () => {
                        const scale = Math.min(size / video.width, size / video.height);
                        const scaledWidth = video.width * scale;
                        const scaledHeight = video.height * scale;
                        const dx = (size - scaledWidth) / 2;
                        const dy = (size - scaledHeight) / 2;
                        canvasContext.drawImage(video, dx, dy, scaledWidth, scaledHeight);
                        canvas.toBlob(resolve, 'image/jpeg', 1.0);
                    };
                };
                video.src = URL.createObjectURL(file);
                video.onerror = () => resolve(null);
            });
        }
        return null;
    }

    function toBase64(thumbnail) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(thumbnail);
        });
    }

    // Share code function
    function shareCode(code, url) {
        if (navigator.share) {
            navigator.share({
                title: 'LivelyShare Connection Code',
                text: `Join my file sharing session with code: ${code}`,
                url: url
            }).catch(console.error);
        } else {
            copyText(code);
        }
    }

    // Set up page show effect
    function pageShow() {
        window.addEventListener("pageshow", () => {
            const body = document.body;
            body.classList.remove("fade-out");
            body.classList.add("fade-in");
        });
    }

    async function toggleWakeLock(enable) {
        // checks if API is supported at all or not
        if (!('wakeLock' in navigator)) {
            if (enable && !sessionStorage.getItem('wakeLockWarningShown')) {
                showMessage('To ensure the transfer completes, please keep this browser tab open.', 'info');
                sessionStorage.setItem('wakeLockWarningSession', 'true');
            }
            return;
        }
        try {
            if (enable) {
                screenWakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock activated.');
            } else {
                if (screenWakeLock) {
                    await screenWakeLock.release();
                    screenWakeLock = null;
                    console.log('Screen Wake Lock released.');
                }
            }
        } catch (error) {
            console.error(`Wake Lock error: ${error.name}, ${error.message}`);
        }
    }

    function infoPopup(peerId) {
        // Clone the existing connection info content
        const originalConnectionInfo = document.getElementById('connection-info');
        if (!originalConnectionInfo) return;

        const clonedContent = originalConnectionInfo.cloneNode(true);

        // Update the cloned content
        const h2 = clonedContent.querySelector('h2');
        if (h2) h2.textContent = 'Share this code to invite others:';

        const peerIdDisplayClone = clonedContent.querySelector('#peerIdDisplay');
        if (peerIdDisplayClone) {
            peerIdDisplayClone.textContent = peerId;
        }

        const codeContainerClone = clonedContent.querySelector('#code-container');
        if (codeContainerClone) {
            codeContainerClone.style.display = 'flex';
        }

        const qrCodeClone = clonedContent.querySelector('#qrcode');
        if (qrCodeClone) {
            qrCodeClone.style.display = 'block';
            // Regenerate QR code for the popup with mobile-appropriate size
            const receiverUrl = window.location.href.split('?')[0] + '?peerId=' + peerId;
            qrCodeClone.innerHTML = '';
            const qrSize = window.innerWidth <= 480 ? 140 : 120;
            new QRCode(qrCodeClone, {
                text: receiverUrl,
                width: qrSize,
                height: qrSize,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }

        // Update button functionality

        const copyBtn = clonedContent.querySelector('#copyIdButton');
        const shareBtn = clonedContent.querySelector('#shareIdButton');

        if (copyBtn) {
            copyBtn.onclick = () => copyText(peerId);
        }

        if (shareBtn) {
            shareBtn.onclick = () => {
                const receiverUrl = window.location.href.split('?')[0] + '?peerId=' + peerId;
                shareCode(peerId, receiverUrl);
            };
        }

        // Clear and populate the popup
        infoMenuPopup.innerHTML = '';
        infoMenuPopup.appendChild(clonedContent);
    }

    // Add the missing copyText function
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showMessage('Code copied to clipboard!', 'success');
            }).catch(() => {
                fallbackCopyText(text);
            });
        } else {
            fallbackCopyText(text);
        }
    }

    function fallbackCopyText(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
            showMessage('Code copied to clipboard!', 'success');
        } catch (err) {
            showMessage('Failed to copy code', 'error');
        }

        document.body.removeChild(textArea);
    }

    function updateTransferRates() {
        const now = performance.now();
        for (const fileId in outgoingTransfers) {
            const transfer = outgoingTransfers[fileId];
            const timeElapsed = (now - transfer.lastMeasurementTime) / 1000;
            if (timeElapsed > 0.5) {
                const speed = transfer.bytesSinceLastMeasurement / timeElapsed;
                const speedStr = formatSpeed(speed);

                const speedElement = document.querySelector(`#message_${fileId} .file-progress-speed`);
                if (speedElement) speedElement.textContent = speedStr;

                transfer.bytesSinceLastMeasurement = 0;
                transfer.lastMeasurementTime = now;
            }
        }
        // Update for all incoming transfers
        for (const fileId in incomingFiles) {
            const fileInfo = incomingFiles[fileId];
            if (fileInfo.accepted && !fileInfo.completing) {
                const timeElapsed = (now - fileInfo.lastMeasurementTime) / 1000;
                if (timeElapsed > 0.5) {
                    const speed = fileInfo.bytesSinceLastMeasurement / timeElapsed;
                    const speedStr = formatSpeed(speed);

                    const speedElement = document.querySelector(`#message_${fileId} .file-progress-speed`);
                    if (speedElement) speedElement.textContent = speedStr;

                    fileInfo.bytesSinceLastMeasurement = 0;
                    fileInfo.lastMeasurementTime = now;
                }
            }
        }
    }

    function updateButtonVisibility() {
        const hasSelected = selectedFiles.length > 0;
        const hasIncoming = Object.keys(incomingFiles).length > 0;
        const hasMessage = messageInput.value.trim().length > 0;
        const isSending = isTransferring;

        if (!hasSelected && !hasIncoming && !hasMessage) {
            actionButtonsContainer.style.display = 'none';
            return;
        }
        actionButtonsContainer.style.display = 'flex';

        clearAllButton.style.display = hasSelected ? 'flex' : 'none';
        sendFileButton.style.display = (hasSelected || hasMessage) ? 'flex' : 'none';

        downloadAllButton.style.display = hasIncoming ? 'flex' : 'none';

        clearAllButton.disabled = isSending;
        sendFileButton.disabled = isSending;

        downloadAllButton.disabled = false;
    }

    function downloadAllFiles() {
        const pendingIds = Object.keys(incomingFiles).filter(id => !incomingFiles[id].accepted);
        if (pendingIds.length > 0) {
            autoDownload = true;
            pendingIds.forEach(id => acceptFile(id));
            showMessage(`Auto-accepting and downloading ${pendingIds.length} files as they complete.`, 'info');
        } else {
            document.querySelectorAll('.download-btn').forEach(btn => btn.click());
            showMessage('Downloading all completed files...', 'success');
        }
    }

    downloadAllButton.addEventListener('click', downloadAllFiles);
    messageInput.addEventListener('input', updateButtonVisibility);

    pageShow();
    updateButtonVisibility();
});