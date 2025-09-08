const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

// 創建 Express 應用
const app = express();
const server = http.createServer(app);

// 創建 WebSocket 服務器
const wss = new WebSocket.Server({ server });

// 靜態文件服務
app.use(express.static(path.join(__dirname)));

// 直播狀態
let isStreaming = false;
let broadcaster = null;
let viewers = new Map(); // viewerId -> WebSocket
let viewerCount = 0;

// WebSocket 連接處理
wss.on('connection', function connection(ws, req) {
    console.log('新的 WebSocket 連接');
    
    let clientType = null; // 'broadcaster' 或 'viewer'
    let clientId = null;
    
    ws.on('message', function message(data) {
        try {
            const message = JSON.parse(data);
            console.log('收到訊息:', message.type);
            
            switch (message.type) {
                case 'broadcaster_join':
                    handleBroadcasterJoin(ws, message);
                    clientType = 'broadcaster';
                    break;
                    
                case 'viewer_join':
                    handleViewerJoin(ws, message);
                    clientType = 'viewer';
                    clientId = message.viewerId;
                    break;
                    
                case 'stream_start':
                    handleStreamStart(message);
                    break;
                    
                case 'stream_end':
                    handleStreamEnd();
                    break;
                    
                case 'offer':
                    handleOffer(message);
                    break;
                    
                case 'answer':
                    handleAnswer(message);
                    break;
                    
                case 'ice_candidate':
                    handleIceCandidate(message);
                    break;
                    
                case 'chat_message':
                    handleChatMessage(message);
                    break;
                    
                case 'broadcaster_chat_message':
                    handleBroadcasterChatMessage(message);
                    break;
                    
                case 'heartbeat':
                    // 心跳包，不需要特別處理
                    break;
                    
                default:
                    console.log('未知訊息類型:', message.type);
            }
            
        } catch (error) {
            console.error('處理訊息時發生錯誤:', error);
        }
    });
    
    ws.on('close', function close() {
        console.log('WebSocket 連接關閉');
        
        if (clientType === 'broadcaster') {
            handleBroadcasterDisconnect();
        } else if (clientType === 'viewer' && clientId) {
            handleViewerDisconnect(clientId);
        }
    });
    
    ws.on('error', function error(err) {
        console.error('WebSocket 錯誤:', err);
    });
});

// 處理主播加入
function handleBroadcasterJoin(ws, message) {
    console.log('主播已加入');
    broadcaster = {
        ws: ws,
        id: message.broadcasterId || 'broadcaster_1',
        timestamp: Date.now()
    };
    
    // 發送確認訊息
    ws.send(JSON.stringify({
        type: 'broadcaster_joined',
        message: '主播已成功加入直播間'
    }));
}

// 處理觀眾加入
function handleViewerJoin(ws, message) {
    const viewerId = message.viewerId;
    console.log('觀眾加入:', viewerId);
    
    viewers.set(viewerId, ws);
    viewerCount++;
    
    // 發送確認訊息
    ws.send(JSON.stringify({
        type: 'viewer_joined',
        message: '觀眾已成功加入直播間',
        viewerId: viewerId
    }));
    
    // 如果主播正在直播，發送直播開始訊息
    if (isStreaming && broadcaster) {
        console.log('觀眾加入時主播正在直播，發送 stream_start');
        ws.send(JSON.stringify({
            type: 'stream_start',
            title: '直播中',
            message: '主播正在直播中'
        }));
        
        // 通知主播有新觀眾需要連接
        if (broadcaster.ws.readyState === WebSocket.OPEN) {
            console.log('通知主播有新觀眾需要連接:', viewerId);
            broadcaster.ws.send(JSON.stringify({
                type: 'viewer_join',
                viewerId: viewerId
            }));
        }
    } else {
        console.log('觀眾加入時主播未在直播');
    }
    
    // 更新所有觀眾的觀眾數量
    updateViewerCount();
}

// 處理直播開始
function handleStreamStart(message) {
    console.log('直播開始');
    isStreaming = true;
    
    // 通知所有觀眾直播已開始
    broadcastToViewers({
        type: 'stream_start',
        title: message.title || '直播中',
        message: '主播已開始直播'
    });
    
    // 通知主播有哪些觀眾需要連接
    if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
        const viewerList = Array.from(viewers.keys());
        if (viewerList.length > 0) {
            broadcaster.ws.send(JSON.stringify({
                type: 'viewers_need_connection',
                viewers: viewerList,
                message: `有 ${viewerList.length} 個觀眾等待連接`
            }));
        }
    }
}

// 處理直播結束
function handleStreamEnd() {
    console.log('直播結束');
    isStreaming = false;
    
    // 通知所有觀眾直播已結束
    broadcastToViewers({
        type: 'stream_end',
        message: '直播已結束'
    });
}

// 處理 WebRTC Offer
function handleOffer(message) {
    console.log('處理 Offer from broadcaster to viewer:', message.viewerId);
    
    // 將 Offer 轉發給特定觀眾
    if (message.viewerId && viewers.has(message.viewerId)) {
        const viewerWs = viewers.get(message.viewerId);
        if (viewerWs.readyState === WebSocket.OPEN) {
            viewerWs.send(JSON.stringify({
                type: 'offer',
                offer: message.offer,
                broadcasterId: message.broadcasterId
            }));
        }
    }
}

// 處理 WebRTC Answer
function handleAnswer(message) {
    console.log('處理 Answer from:', message.viewerId);
    
    // 將 Answer 轉發給主播
    if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
        broadcaster.ws.send(JSON.stringify({
            type: 'answer',
            answer: message.answer,
            viewerId: message.viewerId
        }));
    }
}

// 處理 ICE 候選
function handleIceCandidate(message) {
    console.log('處理 ICE 候選:', message.broadcasterId ? 'from broadcaster' : 'from viewer');
    
    if (message.broadcasterId) {
        // 來自主播的 ICE 候選，轉發給特定觀眾
        if (message.viewerId && viewers.has(message.viewerId)) {
            const viewerWs = viewers.get(message.viewerId);
            if (viewerWs.readyState === WebSocket.OPEN) {
                viewerWs.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: message.candidate,
                    broadcasterId: message.broadcasterId
                }));
            }
        }
    } else if (message.viewerId) {
        // 來自觀眾的 ICE 候選，轉發給主播
        if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify({
                type: 'ice_candidate',
                candidate: message.candidate,
                viewerId: message.viewerId
            }));
        }
    }
}

// 處理聊天訊息
function handleChatMessage(message) {
    console.log('聊天訊息:', message.message);
    
    // 廣播聊天訊息給所有連接的客戶端
    const chatMessage = {
        type: 'chat_message',
        username: message.username || message.viewerId,
        message: message.message,
        timestamp: message.timestamp,
        viewerId: message.viewerId
    };
    
    // 發送給所有觀眾
    broadcastToViewers(chatMessage);
    
    // 發送給主播
    if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
        broadcaster.ws.send(JSON.stringify(chatMessage));
    }
}

// 處理主播聊天訊息
function handleBroadcasterChatMessage(message) {
    console.log('主播聊天訊息:', message.message);
    
    // 廣播主播訊息給所有觀眾
    const chatMessage = {
        type: 'chat_message',
        username: '主播',
        message: message.message,
        timestamp: message.timestamp,
        broadcasterId: message.broadcasterId
    };
    
    // 發送給所有觀眾
    broadcastToViewers(chatMessage);
    
    console.log('已廣播主播訊息給', viewerCount, '個觀眾');
}

// 處理主播斷線
function handleBroadcasterDisconnect() {
    console.log('主播斷線');
    broadcaster = null;
    isStreaming = false;
    
    // 通知所有觀眾主播已斷線
    broadcastToViewers({
        type: 'stream_end',
        message: '主播已斷線，直播結束'
    });
}

// 處理觀眾斷線
function handleViewerDisconnect(viewerId) {
    console.log('觀眾斷線:', viewerId);
    
    if (viewers.has(viewerId)) {
        viewers.delete(viewerId);
        viewerCount--;
        updateViewerCount();
    }
}

// 廣播訊息給所有觀眾
function broadcastToViewers(message) {
    viewers.forEach((viewer, viewerId) => {
        if (viewer.readyState === WebSocket.OPEN) {
            try {
                viewer.send(JSON.stringify(message));
            } catch (error) {
                console.error('發送訊息給觀眾失敗:', error);
                // 移除斷線的觀眾
                viewers.delete(viewerId);
                viewerCount--;
            }
        }
    });
}

// 更新觀眾數量
function updateViewerCount() {
    const countMessage = {
        type: 'viewer_count_update',
        count: viewerCount
    };
    
    // 更新所有觀眾的數量顯示
    broadcastToViewers(countMessage);
    
    // 更新主播的數量顯示
    if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
        broadcaster.ws.send(JSON.stringify(countMessage));
    }
}

// 定期清理斷線的連接
setInterval(() => {
    // 清理斷線的觀眾
    viewers.forEach((viewer, viewerId) => {
        if (viewer.readyState !== WebSocket.OPEN) {
            console.log('清理斷線觀眾:', viewerId);
            viewers.delete(viewerId);
            viewerCount--;
        }
    });
    
    // 清理斷線的主播
    if (broadcaster && broadcaster.ws.readyState !== WebSocket.OPEN) {
        console.log('清理斷線主播');
        broadcaster = null;
        isStreaming = false;
    }
    
    // 更新觀眾數量
    if (viewerCount !== viewers.size) {
        viewerCount = viewers.size;
        updateViewerCount();
    }
}, 30000); // 每30秒檢查一次

// 啟動服務器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 直播服務器已啟動在端口 ${PORT}`);
    console.log(`📺 主播端: http://localhost:${PORT}/livestream_platform.html`);
    console.log(`👥 觀眾端: http://localhost:${PORT}/viewer.html`);
    console.log(`🔧 服務器狀態: 運行中`);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n🛑 正在關閉服務器...');
    
    // 關閉所有 WebSocket 連接
    wss.clients.forEach(client => {
        client.close();
    });
    
    // 關閉 HTTP 服務器
    server.close(() => {
        console.log('✅ 服務器已關閉');
        process.exit(0);
    });
});
