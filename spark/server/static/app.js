// spark/server/static/app.js
// Generate a random session ID
const sessionId = Math.random().toString(36).substring(2, 15);

// DOM elements
const messagesDiv = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// WebSocket connection
let ws = null;
let currentAssistantMessage = null;

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${sessionId}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
        messageInput.disabled = false;
        sendBtn.disabled = false;
        addSystemMessage('已连接到服务器');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        messageInput.disabled = true;
        sendBtn.disabled = true;
        addSystemMessage('连接已断开，正在重连...');
        setTimeout(connect, 2000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
}

function handleMessage(data) {
    switch (data.type) {
        case 'text_delta':
            appendTextDelta(data.delta);
            break;
        case 'tool_call':
            addToolCall(data.name, data.args);
            break;
        case 'tool_result':
            updateToolResult(data.name, data.result);
            break;
        case 'done':
            finishMessage();
            break;
        case 'error':
            addSystemMessage('错误: ' + data.message);
            finishMessage();
            break;
        case 'cleared':
            messagesDiv.innerHTML = '';
            addSystemMessage('对话已清空');
            break;
    }
}

function addUserMessage(content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';
    msgDiv.textContent = content;
    messagesDiv.appendChild(msgDiv);
    scrollToBottom();
}

function addSystemMessage(content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system';
    msgDiv.textContent = content;
    messagesDiv.appendChild(msgDiv);
    scrollToBottom();
}

function startAssistantMessage() {
    currentAssistantMessage = document.createElement('div');
    currentAssistantMessage.className = 'message assistant';
    messagesDiv.appendChild(currentAssistantMessage);
}

function appendTextDelta(delta) {
    if (!currentAssistantMessage) {
        startAssistantMessage();
    }
    currentAssistantMessage.textContent += delta;
    scrollToBottom();
}

function addToolCall(name, args) {
    if (!currentAssistantMessage) {
        startAssistantMessage();
    }

    const toolDiv = document.createElement('div');
    toolDiv.className = 'tool-call';
    toolDiv.id = `tool-${name}-${Date.now()}`;

    toolDiv.innerHTML = `
        <div class="tool-name">🔧 ${name}</div>
        <div class="tool-args">${JSON.stringify(args, null, 2)}</div>
        <div class="tool-result">执行中...</div>
    `;

    currentAssistantMessage.appendChild(toolDiv);
    scrollToBottom();
}

function updateToolResult(name, result) {
    const toolDivs = document.querySelectorAll('.tool-call');
    for (const div of toolDivs) {
        const nameDiv = div.querySelector('.tool-name');
        if (nameDiv && nameDiv.textContent.includes(name)) {
            const resultDiv = div.querySelector('.tool-result');
            resultDiv.textContent = `结果: ${result}`;
        }
    }
}

function finishMessage() {
    enableInput();
    currentAssistantMessage = null;
}

function disableInput() {
    messageInput.disabled = true;
    sendBtn.disabled = true;
}

function enableInput() {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
}

function scrollToBottom() {
    const container = document.getElementById('chat-container');
    container.scrollTop = container.scrollHeight;
}

function sendMessage(content) {
    if (!content.trim()) return;

    addUserMessage(content);
    disableInput();

    ws.send(JSON.stringify({
        type: 'chat',
        content: content
    }));
}

// Event listeners
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = messageInput.value;
    messageInput.value = '';
    sendMessage(content);
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

// Initialize
connect();
