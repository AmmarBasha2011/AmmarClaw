const socket = io();

// UI Elements
const tabs = document.querySelectorAll('nav li');
const tabContents = document.querySelectorAll('.tab-content');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input-text');
const sendBtn = document.getElementById('btn-send-chat');
const debugLogs = document.getElementById('debug-logs');
const btnWaStart = document.getElementById('btn-wa-start');

// Tab Switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(`tab-${target}`).classList.add('active');
    });
});

// Socket Events
socket.on('status', (status) => {
    updateStatus(status);
});

socket.on('debug', (msg) => {
    addLog(msg);
});

socket.on('agent:response', (msg) => {
    addMessage('ai', msg);
});

socket.on('whatsapp:qr', (qr) => {
    showQr(qr);
});

// WhatsApp Actions
btnWaStart.addEventListener('click', () => {
    socket.emit('whatsapp:start');
    addLog('System: Initializing WhatsApp client...');
    document.getElementById('qr-status').innerText = 'Generating QR Code...';
});

// Chat Actions
sendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    addMessage('user', text);
    socket.emit('agent:chat', text);
    chatInput.value = '';
}

// Helpers
function updateStatus(status) {
    const tgPill = document.getElementById('status-tg');
    const waPill = document.getElementById('status-wa');
    const mcpPill = document.getElementById('status-mcp');

    // Telegram
    tgPill.querySelector('span').innerText = status.telegram.enabled ? (status.telegram.connected ? 'Online' : 'Connecting') : 'Off';
    tgPill.className = `status-pill ${status.telegram.enabled ? 'online' : 'offline'}`;
    document.getElementById('tg-info').innerText = status.telegram.enabled ? 'Bot is active and listening.' : 'Telegram interface is disabled.';

    // WhatsApp
    waPill.querySelector('span').innerText = status.whatsapp.enabled ? (status.whatsapp.ready ? 'Online' : 'Waiting') : 'Off';
    waPill.className = `status-pill ${status.whatsapp.ready ? 'online' : 'offline'}`;
    document.getElementById('wa-info').innerText = status.whatsapp.enabled ?
        (status.whatsapp.ready ? 'WhatsApp is connected.' : 'WhatsApp client started, awaiting connection.') :
        'WhatsApp interface is disabled.';

    if (status.whatsapp.enabled && !status.whatsapp.ready) {
        btnWaStart.style.display = 'block';
    } else {
        btnWaStart.style.display = 'none';
    }

    // MCP
    mcpPill.querySelector('span').innerText = status.mcp.toolCount;
}

function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerText = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addLog(msg) {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.innerText = `[${time}] ${msg}`;
    debugLogs.appendChild(div);
    debugLogs.scrollTop = debugLogs.scrollHeight;
}

function showQr(qr) {
    const qrBox = document.getElementById('qr-code-box');
    const qrStatus = document.getElementById('qr-status');

    qrStatus.innerText = 'Scan this code:';

    // Using a simple canvas generation if we had a library, but since we are in a browser
    // and socket.io sends the raw string, we can use a third party QR generator or just
    // display it if it was an image.
    // Actually, whatsapp-web.js sends a raw QR string. We need a library to render it.
    // I'll use a public API for simplicity as I can't easily install a client-side npm lib here without a bundler.

    qrBox.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qr)}" />`;
}
