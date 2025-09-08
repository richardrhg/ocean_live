// 觀眾端 WebRTC 直播觀看
let peerConnection = null;
let socket = null;
let localStream = null;
let isConnected = false;
let viewerId = null;
let messageCount = 0;

// WebRTC 配置
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeViewer();
    generateViewerId();
});

// 初始化觀眾端
function initializeViewer() {
    // 檢查是否支援 WebRTC
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
        addMessage('系統', '❌ 您的瀏覽器不支援 WebRTC，請使用現代瀏覽器');
        return;
    }

    // 嘗試連接到直播服務器
    connectToStreamingServer();
}

// 生成觀眾ID
function generateViewerId() {
    viewerId = 'viewer_' + Math.random().toString(36).substr(2, 9);
}

// 連接到直播服務器
function connectToStreamingServer() {
    updateConnectionStatus('connecting', '連接中...');
    
    try {
        // 建立 WebSocket 連接
        socket = new WebSocket('ws://localhost:3000');
        
        socket.onopen = function() {
            console.log('已連接到直播服務器');
            updateConnectionStatus('connected', '已連接');
            isConnected = true;
            
            // 發送觀眾加入訊息
            socket.send(JSON.stringify({
                type: 'viewer_join',
                viewerId: viewerId,
                timestamp: Date.now()
            }));
            
            addMessage('系統', '✅ 已連接到直播間');
            
            // 如果重整後沒有收到 stream_start，主動請求狀態
            setTimeout(() => {
                if (!document.getElementById('streamInfo').style.display || 
                    document.getElementById('streamInfo').style.display === 'none') {
                    addMessage('系統', '🔄 正在檢查直播狀態...');
                }
            }, 2000);
        };
        
        socket.onmessage = function(event) {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        socket.onclose = function() {
            console.log('與直播服務器斷開連接');
            updateConnectionStatus('disconnected', '連接斷開');
            isConnected = false;
            addMessage('系統', '⚠️ 與直播服務器斷開連接');
            
            // 嘗試重新連接
            setTimeout(() => {
                if (!isConnected) {
                    addMessage('系統', '🔄 嘗試重新連接...');
                    connectToStreamingServer();
                }
            }, 3000);
        };
        
        socket.onerror = function(error) {
            console.error('WebSocket 錯誤:', error);
            updateConnectionStatus('disconnected', '連接錯誤');
            addMessage('系統', '❌ 連接直播服務器失敗');
        };
        
    } catch (error) {
        console.error('無法連接到直播服務器:', error);
        updateConnectionStatus('disconnected', '連接失敗');
        addMessage('系統', '❌ 無法連接到直播服務器，請檢查服務器是否運行');
        
        // 顯示服務器連接提示
        showServerConnectionHelp();
    }
}

// 處理服務器訊息
function handleServerMessage(data) {
    switch (data.type) {
        case 'stream_start':
            handleStreamStart(data);
            break;
        case 'stream_end':
            handleStreamEnd();
            break;
        case 'viewer_joined':
            // 處理觀眾加入確認
            console.log('觀眾加入確認:', data.message);
            break;
        case 'chat_message':
            handleChatMessage(data);
            break;
        case 'viewer_count_update':
            updateViewerCount(data.count);
            break;
        case 'offer':
            handleOffer(data);
            break;
        case 'ice_candidate':
            handleIceCandidate(data);
            break;
        default:
            console.log('未知訊息類型:', data.type, data);
    }
}

// 處理直播開始
function handleStreamStart(data) {
    console.log('收到 stream_start 訊息:', data);
    addMessage('系統', '🎉 主播已開始直播！');
    
    // 顯示直播資訊
    document.getElementById('streamTitle').textContent = data.title || '直播中';
    document.getElementById('streamInfo').style.display = 'block';
    
    // 建立 WebRTC 連接
    createPeerConnection();
    
    // 處理主播的 offer
    if (data.offer) {
        handleOffer(data);
    }
    
    // 更新連接狀態
    updateConnectionStatus('connected', '已連接直播');
    
    // 等待主播發送 offer
    addMessage('系統', '⏳ 等待主播發送串流邀請...');
}

// 處理直播結束
function handleStreamEnd() {
    addMessage('系統', '📺 直播已結束');
    
    // 隱藏直播資訊
    document.getElementById('streamInfo').style.display = 'none';
    
    // 顯示等待畫面
    const remoteVideo = document.getElementById('remoteVideo');
    const placeholder = document.getElementById('videoPlaceholder');
    
    remoteVideo.style.display = 'none';
    placeholder.style.display = 'flex';
    
    // 關閉 WebRTC 連接
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

// 建立 WebRTC 連接
function createPeerConnection() {
    try {
        peerConnection = new RTCPeerConnection(configuration);
        
        // 處理遠端串流
        peerConnection.ontrack = function(event) {
            console.log('收到遠端串流:', event);
            
            const remoteVideo = document.getElementById('remoteVideo');
            const placeholder = document.getElementById('videoPlaceholder');
            
            if (event.streams && event.streams[0]) {
                const stream = event.streams[0];
                console.log('設置視訊源:', stream);
                console.log('串流軌道數量:', stream.getTracks().length);
                
                // 檢查軌道狀態並添加監聽
                stream.getTracks().forEach(track => {
                    console.log('軌道類型:', track.kind, '軌道狀態:', track.readyState, '軌道ID:', track.id);
                    
                    // 監聽軌道結束
                    track.onended = function() {
                        console.warn('軌道已結束:', track.kind, '軌道ID:', track.id);
                        addMessage('系統', `⚠️ ${track.kind === 'video' ? '視訊' : '音訊'}軌道已結束`);
                    };
                    
                    // 監聽軌道靜音狀態
                    track.onmute = function() {
                        console.log('軌道已靜音:', track.kind, '軌道ID:', track.id);
                        addMessage('系統', `${track.kind === 'video' ? '📹' : '🎤'} ${track.kind === 'video' ? '視訊' : '音訊'}已靜音`);
                    };
                    
                    track.onunmute = function() {
                        console.log('軌道已取消靜音:', track.kind, '軌道ID:', track.id);
                        addMessage('系統', `${track.kind === 'video' ? '📹' : '🎤'} ${track.kind === 'video' ? '視訊' : '音訊'}已恢復`);
                    };
                    
                    // 監聽軌道內容變化（用於檢測畫面切換）
                    if (track.kind === 'video') {
                        track.onended = function() {
                            console.log('視訊軌道結束，可能是畫面切換');
                            addMessage('系統', '🔄 檢測到畫面切換，準備自動播放新畫面');
                            
                            // 如果是螢幕分享切換，可能需要自動重整
                            setTimeout(() => {
                                if (detectScreenSwitchIssue()) {
                                    return; // 如果檢測到問題，會自動重整
                                }
                            }, 2000);
                        };
                    }
                });
                
                // 檢查是否是軌道更新
                const isTrackUpdate = remoteVideo.srcObject && remoteVideo.srcObject.id === stream.id;
                
                if (isTrackUpdate) {
                    addMessage('系統', '🔄 正在更新直播畫面...');
                    console.log('檢測到軌道更新，準備自動播放');
                } else {
                    addMessage('系統', '📺 正在接收直播畫面...');
                }
                
                // 設置視訊源
                try {
                    remoteVideo.srcObject = stream;
                    remoteVideo.style.display = 'block';
                    placeholder.style.display = 'none';
                    
                    // 顯示直播資訊
                    document.getElementById('streamInfo').style.display = 'block';
                    
                    if (isTrackUpdate) {
                        addMessage('系統', '✅ 直播畫面已更新！');
                    } else {
                        addMessage('系統', '📺 直播畫面已顯示！');
                    }
                    
                                                                         // 監聽視訊載入
                remoteVideo.onloadedmetadata = function() {
                    console.log('視訊元數據已載入');
                    addMessage('系統', '✅ 視訊已準備就緒');
                    
                    // 創建播放控制界面
                    createVideoControls(remoteVideo);
                    
                    // 視訊元數據載入後立即嘗試播放
                    console.log('嘗試播放視訊...');
                    
                    // 使用智能播放函數
                    setTimeout(() => {
                        playVideoWithFallback(remoteVideo);
                    }, 500);
                };
                    
                    remoteVideo.onplay = function() {
                        console.log('視訊開始播放');
                        addMessage('系統', '🎬 直播開始播放！');
                    };
                    
                    remoteVideo.onerror = function(error) {
                        console.error('視訊播放錯誤:', error);
                        addMessage('系統', '❌ 視訊播放錯誤');
                    };
                    
                                         // 強制播放
                     remoteVideo.play().catch(error => {
                         console.error('自動播放失敗:', error);
                         addMessage('系統', '⚠️ 自動播放失敗，嘗試強制播放...');
                         
                         // 嘗試多種播放方式
                         setTimeout(() => {
                             remoteVideo.play().catch(err => {
                                 console.error('第二次播放嘗試失敗:', err);
                                 addMessage('系統', '⚠️ 嘗試靜音播放...');
                                 
                                 // 嘗試靜音播放（瀏覽器通常允許）
                                 remoteVideo.muted = true;
                                 remoteVideo.play().then(() => {
                                     addMessage('系統', '🎬 靜音播放成功！');
                                     // 播放成功後恢復音量
                                     setTimeout(() => {
                                         remoteVideo.muted = false;
                                         addMessage('系統', '🔊 已恢復音量');
                                     }, 1000);
                                 }).catch(muteErr => {
                                     console.error('靜音播放也失敗:', muteErr);
                                     addMessage('系統', '⚠️ 請點擊視訊區域開始播放');
                                     
                                     // 添加點擊播放功能
                                     remoteVideo.onclick = function() {
                                         this.play().then(() => {
                                             addMessage('系統', '🎬 手動播放成功！');
                                         }).catch(e => {
                                             addMessage('系統', '❌ 手動播放失敗');
                                         });
                                     };
                                 });
                             });
                         }, 1000);
                     });
                    
                } catch (error) {
                    console.error('設置視訊源失敗:', error);
                    addMessage('系統', '❌ 設置視訊源失敗');
                }
            } else {
                console.error('沒有收到串流');
                addMessage('系統', '❌ 沒有收到直播串流');
            }
        };
        
        // 處理 ICE 候選
        peerConnection.onicecandidate = function(event) {
            if (event.candidate && socket && isConnected) {
                socket.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: event.candidate,
                    viewerId: viewerId
                }));
            }
        };
        
        // 處理連接狀態變化
        peerConnection.onconnectionstatechange = function() {
            console.log('WebRTC 連接狀態:', peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                addMessage('系統', '✅ WebRTC 連接已建立');
            } else if (peerConnection.connectionState === 'failed') {
                addMessage('系統', '❌ WebRTC 連接失敗');
            } else if (peerConnection.connectionState === 'connecting') {
                addMessage('系統', '🔄 正在建立 WebRTC 連接...');
            } else if (peerConnection.connectionState === 'disconnected') {
                addMessage('系統', '⚠️ WebRTC 連接已斷開');
            }
        };
        
        // 監聽 ICE 連接狀態
        peerConnection.oniceconnectionstatechange = function() {
            console.log('ICE 連接狀態:', peerConnection.iceConnectionState);
            addMessage('系統', `🌐 ICE 狀態: ${peerConnection.iceConnectionState}`);
            
            if (peerConnection.iceConnectionState === 'failed') {
                addMessage('系統', '❌ ICE 連接失敗，可能需要重新建立連接');
            } else if (peerConnection.iceConnectionState === 'connected') {
                addMessage('系統', '✅ ICE 連接成功，視訊串流已建立');
            } else if (peerConnection.iceConnectionState === 'checking') {
                addMessage('系統', '🔄 ICE 正在檢查連接...');
            }
        };
        
        // 監聽信令狀態
        peerConnection.onsignalingstatechange = function() {
            console.log('信令狀態:', peerConnection.signalingState);
            addMessage('系統', `📡 信令狀態: ${peerConnection.signalingState}`);
            
            if (peerConnection.signalingState === 'stable') {
                addMessage('系統', '✅ 信令狀態穩定');
            } else if (peerConnection.signalingState === 'have-remote-offer') {
                addMessage('系統', '📡 已收到遠端 offer');
            } else if (peerConnection.signalingState === 'have-local-offer') {
                addMessage('系統', '📡 已發送本地 offer');
            }
        };
        
    } catch (error) {
        console.error('建立 WebRTC 連接失敗:', error);
        addMessage('系統', '❌ 建立視訊連接失敗');
    }
}

// 處理主播的 offer
async function handleOffer(data) {
    console.log('收到主播的 offer:', data);
    
    // 檢查是否是軌道更新
    const isTrackUpdate = peerConnection && peerConnection.signalingState === 'stable';
    
    if (isTrackUpdate) {
        addMessage('系統', '🔄 收到主播的軌道更新，正在重新協商...');
    } else {
        addMessage('系統', '📡 收到主播的串流邀請，正在建立連接...');
    }
    
    if (!peerConnection) {
        createPeerConnection();
    }
    
    try {
        // 設置遠端描述
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('已設置遠端描述');
        
        if (isTrackUpdate) {
            addMessage('系統', '✅ 軌道更新已處理');
        } else {
            addMessage('系統', '✅ 已設置遠端描述');
        }
        
        // 創建 answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('已創建並設置本地 answer');
        
        if (isTrackUpdate) {
            addMessage('系統', '✅ 軌道更新回應已發送');
        } else {
            addMessage('系統', '✅ 已創建並設置本地 answer');
        }
        
        // 發送 answer 給主播
        if (socket && isConnected) {
            const answerMessage = {
                type: 'answer',
                answer: answer,
                viewerId: viewerId
            };
            console.log('發送 answer 給主播:', answerMessage);
            socket.send(JSON.stringify(answerMessage));
            
            if (isTrackUpdate) {
                addMessage('系統', '📤 軌道更新回應已發送給主播');
            } else {
                addMessage('系統', '📤 已發送連接回應給主播');
            }
        }
        
        if (isTrackUpdate) {
            addMessage('系統', '🔄 軌道更新完成，視訊串流正在更新...');
            
            // 軌道更新後，強制重新播放視訊
            setTimeout(() => {
                if (remoteVideo.srcObject) {
                    console.log('軌道更新後嘗試自動播放...');
                    playVideoWithFallback(remoteVideo);
                    
                    // 檢查是否需要自動重整
                    setTimeout(() => {
                        if (detectScreenSwitchIssue()) {
                            return; // 如果檢測到問題，會自動重整
                        }
                    }, 3000); // 等待3秒後檢查
                }
            }, 1000);
        } else {
            addMessage('系統', '🔄 正在建立視訊連接...');
        }
        
    } catch (error) {
        console.error('處理 offer 失敗:', error);
        if (isTrackUpdate) {
            addMessage('系統', '❌ 軌道更新失敗: ' + error.message);
        } else {
            addMessage('系統', '❌ 連接直播串流失敗: ' + error.message);
        }
    }
}

// 處理 ICE 候選
async function handleIceCandidate(data) {
    console.log('收到 ICE 候選:', data);
    
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('已添加 ICE 候選');
        } catch (error) {
            console.error('添加 ICE 候選失敗:', error);
            addMessage('系統', '❌ 添加 ICE 候選失敗');
        }
    } else {
        console.error('無法處理 ICE 候選:', data);
    }
}

// 處理聊天訊息
function handleChatMessage(data) {
    if (data.viewerId !== viewerId) { // 不顯示自己的訊息
        addMessage(data.username || data.viewerId, data.message);
    }
}

// 發送聊天訊息
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    if (!isConnected) {
        addMessage('系統', '⚠️ 尚未連接到直播間，無法發送訊息');
        return;
    }
    
    // 發送訊息到服務器
    if (socket && isConnected) {
        const messageData = {
            type: 'chat_message',
            viewerId: viewerId,
            username: `觀眾${viewerId.substr(-3)}`,
            message: message,
            timestamp: Date.now()
        };
        
        socket.send(JSON.stringify(messageData));
        
        // 在本地顯示自己的訊息
        addMessage(messageData.username, message);
    }
    
    messageInput.value = '';
}

// 處理 Enter 鍵發送
function handleEnter(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// 添加聊天訊息
function addMessage(username, content) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const timestamp = new Date().toLocaleTimeString('zh-TW', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageDiv.innerHTML = `
        <span class="username">${username}</span>
        <span class="timestamp">${timestamp}</span>
        ${content}
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // 更新訊息計數
    if (username !== '系統') {
        messageCount++;
    }
}

// 更新連接狀態
function updateConnectionStatus(status, text) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    // 移除所有狀態類別
    statusDot.classList.remove('connected', 'connecting', 'disconnected');
    
    // 添加新狀態類別
    statusDot.classList.add(status);
    statusText.textContent = text;
}

// 更新觀眾數量
function updateViewerCount(count) {
    document.getElementById('chatViewerCount').textContent = count;
}

// 顯示服務器連接幫助
function showServerConnectionHelp() {
    const helpMessage = `
        <div style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 15px; padding: 1rem; margin: 1rem 0; color: white;">
            <h4>🔧 需要啟動直播服務器</h4>
            <p>要觀看直播，需要先啟動後端服務器：</p>
            <ol style="text-align: left; margin: 1rem 0;">
                <li>安裝 Node.js</li>
                <li>在終端機中執行：<code>npm install</code></li>
                <li>啟動服務器：<code>npm start</code></li>
                <li>重新整理此頁面</li>
            </ol>
        </div>
    `;
    
    const chatMessages = document.getElementById('chatMessages');
    const helpDiv = document.createElement('div');
    helpDiv.innerHTML = helpMessage;
    chatMessages.appendChild(helpDiv);
}

// 頁面卸載時清理資源
window.addEventListener('beforeunload', function() {
    if (socket) {
        socket.close();
    }
    if (peerConnection) {
        peerConnection.close();
    }
});

// 創建視訊播放控制界面
function createVideoControls(videoElement) {
    // 檢查是否已經有控制界面
    if (document.getElementById('videoControls')) return;
    
    // 添加手動重整按鈕到頁面
    addManualRefreshButton();
    
    const videoContainer = videoElement.parentElement;
    
    // 創建控制界面容器
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'videoControls';
    controlsContainer.className = 'video-controls';
    controlsContainer.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.8));
        padding: 25px 20px 20px;
        display: flex;
        flex-direction: column;
        gap: 15px;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
    `;
    
    // 播放/暫停按鈕 - 大而美觀
    const playPauseBtn = document.createElement('button');
    playPauseBtn.innerHTML = '▶️';
    playPauseBtn.className = 'control-btn play-btn';
    playPauseBtn.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        color: white;
        padding: 15px 20px;
        border-radius: 50px;
        cursor: pointer;
        font-size: 20px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        min-width: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // 播放按鈕懸停效果
    playPauseBtn.onmouseenter = function() { 
        this.style.transform = 'scale(1.1) translateY(-2px)';
        this.style.boxShadow = '0 12px 35px rgba(102, 126, 234, 0.6)';
    };
    playPauseBtn.onmouseleave = function() { 
        this.style.transform = 'scale(1) translateY(0)';
        this.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.4)';
    };
    
    playPauseBtn.onclick = function() {
        if (videoElement.paused) {
            videoElement.play();
            this.innerHTML = '⏸️';
            this.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        } else {
            videoElement.pause();
            this.innerHTML = '▶️';
            this.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
    };
    
    // 音量控制 - 美化
    const volumeControl = document.createElement('div');
    volumeControl.style.cssText = `
        display: flex; 
        align-items: center; 
        gap: 12px;
        background: rgba(255,255,255,0.1);
        padding: 8px 15px;
        border-radius: 25px;
        backdrop-filter: blur(5px);
    `;
    volumeControl.innerHTML = `
        <span style="color: white; font-size: 16px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🔊</span>
        <input type="range" min="0" max="1" step="0.1" value="1" 
               style="width: 80px; height: 6px; cursor: pointer; border-radius: 3px; background: rgba(255,255,255,0.3); outline: none;">
    `;
    
    // 直播串流不需要進度條和時間顯示
    
    // 全螢幕按鈕 - 美化
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.className = 'control-btn fullscreen-btn';
    fullscreenBtn.style.cssText = `
        background: rgba(255,255,255,0.15);
        border: 2px solid rgba(255,255,255,0.3);
        color: white;
        padding: 12px 16px;
        border-radius: 50px;
        cursor: pointer;
        font-size: 18px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(5px);
    `;
    
    fullscreenBtn.onmouseenter = function() { 
        this.style.background = 'rgba(255,255,255,0.25)';
        this.style.borderColor = 'rgba(255,255,255,0.5)';
        this.style.transform = 'scale(1.05)';
    };
    fullscreenBtn.onmouseleave = function() { 
        this.style.background = 'rgba(255,255,255,0.15)';
        this.style.borderColor = 'rgba(255,255,255,0.3)';
        this.style.transform = 'scale(1)';
    };
    
    fullscreenBtn.onclick = function() {
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };
    
    // 組裝控制界面 - 簡化版，適合直播
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    topRow.appendChild(playPauseBtn);
    topRow.appendChild(volumeControl);
    topRow.appendChild(fullscreenBtn);
    
    controlsContainer.appendChild(topRow);
    
    // 直播時不需要進度條，只顯示直播狀態
    const liveIndicator = document.createElement('div');
    liveIndicator.style.cssText = `
        color: #ff4444; 
        font-size: 14px; 
        text-align: center;
        font-weight: 600;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        background: rgba(255,68,68,0.2);
        padding: 8px 15px;
        border-radius: 20px;
        backdrop-filter: blur(5px);
        border: 1px solid rgba(255,68,68,0.3);
    `;
    liveIndicator.innerHTML = '🔴 直播中';
    controlsContainer.appendChild(liveIndicator);
    
    // 添加到視訊容器
    videoContainer.style.position = 'relative';
    videoContainer.appendChild(controlsContainer);
    
    // 音量控制事件
    const volumeSlider = volumeControl.querySelector('input');
    const volumeIcon = volumeControl.querySelector('span');
    volumeSlider.oninput = function() {
        videoElement.volume = this.value;
        volumeIcon.innerHTML = this.value == 0 ? '🔇' : '🔊';
    };
    
    // 直播串流不需要進度條控制
    
    // 滑鼠懸停顯示控制界面
    videoContainer.onmouseenter = function() {
        controlsContainer.style.opacity = '1';
        controlsContainer.style.transform = 'translateY(0)';
    };
    
    videoContainer.onmouseleave = function() {
        controlsContainer.style.opacity = '0';
        controlsContainer.style.transform = 'translateY(10px)';
    };
    
    // 自動隱藏控制界面
    let hideTimeout;
    videoContainer.onmousemove = function() {
        clearTimeout(hideTimeout);
        controlsContainer.style.opacity = '1';
        controlsContainer.style.transform = 'translateY(0)';
        
        hideTimeout = setTimeout(() => {
            if (!videoContainer.matches(':hover')) {
                controlsContainer.style.opacity = '0';
                controlsContainer.style.transform = 'translateY(10px)';
            }
        }, 3000);
    };
}

// 智能播放函數 - 處理各種播放情況
async function playVideoWithFallback(videoElement) {
    try {
        // 首先嘗試正常播放
        await videoElement.play();
        console.log('視訊播放成功！');
        addMessage('系統', '🎬 視訊開始播放！');
        return true;
    } catch (error) {
        console.error('正常播放失敗:', error);
        
        // 嘗試靜音播放
        try {
            videoElement.muted = true;
            await videoElement.play();
            console.log('靜音播放成功！');
            addMessage('系統', '🎬 靜音播放成功！');
            
            // 播放成功後恢復音量
            setTimeout(() => {
                videoElement.muted = false;
                addMessage('系統', '🔊 已恢復音量');
            }, 2000);
            return true;
        } catch (muteError) {
            console.error('靜音播放也失敗:', muteError);
            addMessage('系統', '⚠️ 請點擊播放按鈕開始播放');
            
            // 設置點擊播放
            videoElement.style.cursor = 'pointer';
            videoElement.title = '點擊播放視訊';
            
            // 添加點擊播放事件
            videoElement.onclick = function() {
                this.play().then(() => {
                    addMessage('系統', '🎬 手動播放成功！');
                    this.style.cursor = 'default';
                    this.title = '';
                }).catch(e => {
                    addMessage('系統', '❌ 手動播放失敗');
                });
            };
            return false;
        }
    }
}

// 自動重整功能 - 當檢測到畫面切換問題時自動重整
function autoRefreshOnScreenSwitch() {
    addMessage('系統', '🔄 檢測到畫面切換，正在自動重整...');
    
    // 延遲重整，讓用戶看到訊息
    setTimeout(() => {
        addMessage('系統', '🔄 正在重新載入頁面...');
        window.location.reload();
    }, 2000);
}

// 檢測畫面切換問題
function detectScreenSwitchIssue() {
    const remoteVideo = document.getElementById('remoteVideo');
    
    // 檢查視訊是否卡住
    if (remoteVideo.srcObject && remoteVideo.srcObject.getTracks) {
        const tracks = remoteVideo.srcObject.getTracks();
        const videoTrack = tracks.find(track => track.kind === 'video');
        
        if (videoTrack && videoTrack.readyState === 'ended') {
            console.log('檢測到視訊軌道已結束，可能是畫面切換問題');
            addMessage('系統', '⚠️ 檢測到視訊軌道問題，準備自動重整');
            autoRefreshOnScreenSwitch();
            return true;
        }
    }
    
    return false;
}

// 添加手動重整按鈕
function addManualRefreshButton() {
    // 檢查是否已經有重整按鈕
    if (document.getElementById('manualRefreshBtn')) return;
    
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'manualRefreshBtn';
    refreshBtn.innerHTML = '🔄 重整畫面';
    refreshBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 12px 20px;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        transition: all 0.3s ease;
    `;
    
    // 懸停效果
    refreshBtn.onmouseenter = function() {
        this.style.transform = 'scale(1.05)';
        this.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    };
    
    refreshBtn.onmouseleave = function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    };
    
    // 點擊重整
    refreshBtn.onclick = function() {
        addMessage('系統', '🔄 手動重整畫面...');
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };
    
    document.body.appendChild(refreshBtn);
}

// 直播串流不需要時間格式化

// 定期檢查連接狀態
setInterval(function() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // 發送心跳包
        socket.send(JSON.stringify({
            type: 'heartbeat',
            viewerId: viewerId,
            timestamp: Date.now()
        }));
    }
}, 30000); // 每30秒發送一次心跳包

// 定期檢查畫面切換問題
setInterval(function() {
    if (peerConnection && peerConnection.connectionState === 'connected') {
        detectScreenSwitchIssue();
    }
}, 10000); // 每10秒檢查一次
