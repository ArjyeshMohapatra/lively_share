async function copyText(text) {
    // modern and secure way of copying to clipboard
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            showMessage('Code copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy code:', err);
            showMessage('Failed to copy code', 'error');
        }
        return // prevents fallback method from running unnecessarily
    }

    // Fallback for insecure pages (like http://)
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        showMessage('Code copied to clipboard', 'success');
        return document.execCommand("copy"); // an old API to copy content
    } catch (err) {
        console.error('Fallback copy failed:', err);
        showMessage('Failed to copy code', 'error');
    } finally {
        textArea.remove();
    }
}

function navigateWithAnimation(url) {
    const body = document.body;
    body.classList.add('fade-out');
    setTimeout(() => {
        window.location.href = url;
    }, 450);
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
    }, 2400);
}





function showConfirm(message, onYes, onNo) {
    const overlay = document.getElementById("confirmDialog");
    const msg = document.getElementById("confirmMessage");
    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");

    msg.textContent = message;
    overlay.style.display = "flex";

    yesBtn.onclick = () => {
        overlay.style.display = "none";
        if (onYes) onYes();
    };

    noBtn.onclick = () => {
        overlay.style.display = "none";
        if (onNo) onNo();
    };
}

let screenWakeLock = null;
async function toggleWakeLock(enable) {
    const checkbox = document.getElementById('keepScreenOnCheckbox');
    if (!('wakeLock' in navigator)) {
        console.log('Screen Wake Lock API not supported.');
        showMessage('Keep screen on feature is not supported by this browser.', 'info');
        if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
            return;
        }
    }
    if (enable) {
        try {
            screenWakeLock = await navigator.wakeLock.request('screen');
            screenWakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock was released automatically.');
                showMessage('Screen lock released.', 'info');
                if (checkbox) checkbox.checked = false;
            })
            console.log('Screen Wake Lock is active.');
            showMessage('Screen will stay on.', 'success');
        } catch (error) {
            console.error(`${error.name}, ${error.message}`);
            showMessage('Could not activate screen lock.', 'error');
            if (checkbox) checkbox.checked = false;
        }
    } else {
        // if the lock is already active, release it
        if (screenWakeLock !== null) {
            await screenWakeLock.release();
            screenWakeLock = null;
            console.log('Screen Wake Lock released.');
        }
    }
}

function handleBeforeUnload(event) {
    // checks if a connection object exists and is open
    const isConnected = window.connection && window.connection.open;

    // checks if the sender is actively transferring a file.
    const isSenderTransferring = window.isTransferring;

    // checks if the receiver has any files in its list (which implies a transfer has started).
    const isReceiverActive = window.incomingFiles && Object.keys(window.incomingFiles).length > 0;

    if (isConnected || isSenderTransferring || isReceiverActive) {
        event.preventDefault();
        event.returnValue = '';
    }
}

function initializeDarkMode() {
    const darkModeButton = document.getElementById("darkModeButton");
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
}

function pageShow() {
    window.addEventListener("pageshow", () => {
        const body = document.body;
        body.classList.remove("fade-out");
        body.classList.add("fade-in");
    });
}