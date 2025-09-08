// 全局變數
let localStream = null;
let isStreaming = false;
let isVideoEnabled = true;
let isAudioEnabled = true;
let currentFacingMode = 'user'; // 'user' or 'environment'
let streamStartTime = null;
let durationInterval = null;
let messageCount = 0;
let viewerCount = 0;
let currentQuality = '720';
let dataTransferInterval = null;
let currentAudioOutput = null; // 當前音訊輸出端

// WebSocket 連接
let streamingSocket = null;
let peerConnections = new Map(); // viewerId -> RTCPeerConnection

// WebRTC 配置
const constraints = {
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: 'user'
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadDevices();
    checkAudioOutputSupport();
    simulateInitialActivity();
});

// 確保音訊軌道正確啟用
function ensureAudioTracksEnabled(stream) {
    if (!stream) return;
    
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach(track => {
        if (track.readyState === 'live') {
            track.enabled = true;
            console.log('音訊軌道已啟用:', track.id, '狀態:', track.readyState);
        } else {
            console.warn('音訊軌道狀態異常:', track.id, '狀態:', track.readyState);
        }
    });
}

// 檢查音訊輸出端支援
function checkAudioOutputSupport() {
    const localVideo = document.getElementById('localVideo');
    if (!localVideo.setSinkId) {
        addMessage('系統', '⚠️ 您的瀏覽器不支援音訊輸出端切換功能，將使用預設輸出端');
        console.warn('瀏覽器不支援 setSinkId API');
        return false;
    }
    
    // 檢查是否支援音訊輸出端列舉
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        addMessage('系統', '⚠️ 您的瀏覽器不支援裝置列舉功能');
        console.warn('瀏覽器不支援 enumerateDevices API');
        return false;
    }
    
    console.log('音訊輸出端功能支援正常');
    return true;
}

// 載入可用裝置
async function loadDevices() {
    try {
        // 先請求權限以獲取裝置標籤
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const cameras = devices.filter(device => device.kind === 'videoinput');
        const microphones = devices.filter(device => device.kind === 'audioinput');
        const speakers = devices.filter(device => device.kind === 'audiooutput');

        const cameraSelect = document.getElementById('cameraSelect');
        const microphoneSelect = document.getElementById('microphoneSelect');
        const audioOutputSelect = document.getElementById('audioOutputSelect');

        // 載入攝影機
        cameraSelect.innerHTML = '';
        cameras.forEach((camera, index) => {
            const option = document.createElement('option');
            option.value = camera.deviceId;
            option.textContent = camera.label || `攝影機 ${index + 1}`;
            cameraSelect.appendChild(option);
        });

        // 載入麥克風
        microphoneSelect.innerHTML = '';
        microphones.forEach((mic, index) => {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.textContent = mic.label || `麥克風 ${index + 1}`;
            microphoneSelect.appendChild(option);
        });

        // 載入音訊輸出端
        audioOutputSelect.innerHTML = '';
        
        // 添加預設選項
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.textContent = '預設音訊輸出端';
        audioOutputSelect.appendChild(defaultOption);
        
        // 添加檢測到的音訊輸出端
        speakers.forEach((speaker, index) => {
            const option = document.createElement('option');
            option.value = speaker.deviceId;
            option.textContent = speaker.label || `音訊輸出端 ${index + 1}`;
            audioOutputSelect.appendChild(option);
        });

        console.log('檢測到的音訊輸出端:', speakers.length, speakers.map(s => s.label));

    } catch (error) {
        console.error('無法載入裝置列表:', error);
        addMessage('系統', '⚠️ 無法檢測音視訊裝置，請檢查瀏覽器權限');
    }
}

// 開始/停止直播
async function toggleStream() {
    if (!isStreaming) {
        await startStream();
    } else {
        stopStream();
    }
}

// 開始直播
async function startStream() {
    try {
        // 請求媒體權限
        localStream = await navigator.mediaDevices.getUserMedia(getConstraints());
        
        // 顯示本地視訊
        const localVideo = document.getElementById('localVideo');
        const placeholder = document.getElementById('previewPlaceholder');
        
        localVideo.srcObject = localStream;
        localVideo.style.display = 'block';
        placeholder.style.display = 'none';

        // 確保音訊軌道正確啟用
        ensureAudioTracksEnabled(localStream);

        // 設置音訊輸出端（如果已選擇）
        if (currentAudioOutput && currentAudioOutput !== 'default') {
            try {
                const localVideo = document.getElementById('localVideo');
                if (localVideo.setSinkId) {
                    await localVideo.setSinkId(currentAudioOutput);
                    console.log('已設置音訊輸出端:', currentAudioOutput);
                    
                    // 獲取裝置名稱並顯示
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const selectedDevice = devices.find(device => 
                        device.kind === 'audiooutput' && device.deviceId === currentAudioOutput
                    );
                    const deviceName = selectedDevice ? selectedDevice.label : '預設音訊輸出端';
                    addMessage('系統', `🔊 音訊輸出端已設置為: ${deviceName}`);
                    
                    // 確保音訊播放
                    try {
                        await localVideo.play();
                        console.log('音訊已開始播放');
                    } catch (playError) {
                        console.warn('自動播放失敗:', playError);
                        addMessage('系統', '⚠️ 請點擊視訊畫面以開始播放音訊');
                    }
                }
            } catch (error) {
                console.warn('設置音訊輸出端失敗:', error);
                addMessage('系統', '⚠️ 音訊輸出端設置失敗，使用預設輸出端');
            }
        } else {
            addMessage('系統', '🔊 使用預設音訊輸出端');
            
            // 確保音訊播放
            try {
                await localVideo.play();
                console.log('音訊已開始播放');
            } catch (playError) {
                console.warn('自動播放失敗:', playError);
                addMessage('系統', '⚠️ 請點擊視訊畫面以開始播放音訊');
            }
        }

        // 更新 UI 狀態
        isStreaming = true;
        updateStreamStatus(true);
        startStreamTimer();
        // simulateViewers();

        addMessage('系統', '🎉 直播已開始！觀眾可以看到你的畫面了');

        // 模擬數據傳輸
        simulateDataTransfer();
        
        // 連接到直播服務器
        connectToStreamingServer();
        
        // 等待 WebSocket 連接建立後通知服務器直播已開始
        setTimeout(() => {
            if (streamingSocket && streamingSocket.readyState === WebSocket.OPEN) {
                streamingSocket.send(JSON.stringify({
                    type: 'stream_start',
                    title: '直播中',
                    message: '主播已開始直播'
                }));
                
                addMessage('系統', '🔄 正在等待觀眾加入...');
            }
        }, 1000);

    } catch (error) {
        console.error('無法啟動直播:', error);
        
        let errorMessage = '無法啟動直播: ';
        if (error.name === 'NotAllowedError') {
            errorMessage += '請允許存取攝影機和麥克風權限';
        } else if (error.name === 'NotFoundError') {
            errorMessage += '找不到攝影機或麥克風裝置';
        } else {
            errorMessage += error.message;
        }
        
        addMessage('系統', '❌ ' + errorMessage);
        
        // 顯示權限請求提示
        showPermissionRequest();
    }
}

// 停止直播
function stopStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // 隱藏視訊，顯示預覽
    const localVideo = document.getElementById('localVideo');
    const placeholder = document.getElementById('previewPlaceholder');
    
    localVideo.style.display = 'none';
    placeholder.style.display = 'flex';

    // 重置狀態
    isStreaming = false;
    updateStreamStatus(false);
    stopStreamTimer();
    resetStats();
    
    // 關閉所有 WebRTC 連接
    peerConnections.forEach(connection => {
        connection.close();
    });
    peerConnections.clear();
    
    // 通知服務器直播結束
    if (streamingSocket) {
        streamingSocket.send(JSON.stringify({
            type: 'stream_end',
            broadcasterId: 'broadcaster_1'
        }));
    }

    addMessage('系統', '📺 直播已結束，感謝觀看！');
}

// 獲取約束條件
function getConstraints() {
    const quality = getQualitySettings(currentQuality);
    return {
        video: {
            ...quality,
            facingMode: currentFacingMode,
            deviceId: document.getElementById('cameraSelect').value || undefined
        },
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            deviceId: document.getElementById('microphoneSelect').value || undefined
        }
    };
}

// 獲取畫質設定
function getQualitySettings(quality) {
    const settings = {
        '480': { width: { ideal: 854 }, height: { ideal: 480 } },
        '720': { width: { ideal: 1280 }, height: { ideal: 720 } },
        '1080': { width: { ideal: 1920 }, height: { ideal: 1080 } }
    };
    return settings[quality] || settings['720'];
}

// 切換視訊
async function toggleVideo() {
    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
        track.enabled = !track.enabled;
    });

    isVideoEnabled = !isVideoEnabled;
    const btn = document.getElementById('videoBtn');
    btn.textContent = isVideoEnabled ? '📹 關閉視訊' : '📹 開啟視訊';

    addMessage('系統', isVideoEnabled ? '📹 視訊已開啟' : '📹 視訊已關閉');
    
    // 更新所有觀眾的軌道狀態
    if (isStreaming) {
        const viewerIds = Array.from(peerConnections.keys());
        for (const viewerId of viewerIds) {
            await updatePeerConnectionTracks(viewerId);
        }
    }
}

// 切換音訊
async function toggleAudio() {
    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
        track.enabled = !track.enabled;
    });

    isAudioEnabled = !isAudioEnabled;
    const btn = document.getElementById('audioBtn');
    btn.textContent = isAudioEnabled ? '🎤 關閉音訊' : '🎤 開啟音訊';

    addMessage('系統', isAudioEnabled ? '🎤 音訊已開啟' : '🎤 音訊已關閉');
    
    // 更新所有觀眾的軌道狀態
    if (isStreaming) {
        const viewerIds = Array.from(peerConnections.keys());
        for (const viewerId of viewerIds) {
            await updatePeerConnectionTracks(viewerId);
        }
    }
}

// 切換鏡頭
async function switchCamera() {
    if (!isStreaming) return;

    try {
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        
        // 保存當前的音訊軌道
        const currentAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        
        // 只停止視訊軌道，保持音訊軌道
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            videoTracks.forEach(track => track.stop());
        }

        // 重新取得媒體串流（只包含視訊）
        const videoConstraints = getConstraints();
        const newVideoStream = await navigator.mediaDevices.getUserMedia(videoConstraints);
        
        // 創建新的串流，包含新的視訊軌道和原有的音訊軌道
        const newStream = new MediaStream();
        
        // 添加新的視訊軌道
        newVideoStream.getVideoTracks().forEach(track => {
            newStream.addTrack(track);
        });
        
        // 保持原有的音訊軌道
        if (currentAudioTrack && currentAudioTrack.readyState === 'live') {
            newStream.addTrack(currentAudioTrack);
            console.log('保持原有音訊軌道，軌道ID:', currentAudioTrack.id);
        }
        
        // 更新本地串流
        localStream = newStream;
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // 確保音訊軌道啟用
        const newAudioTracks4 = localStream.getAudioTracks();
        newAudioTracks4.forEach(track => {
            track.enabled = true;
            console.log('音訊軌道已啟用:', track.id, '狀態:', track.readyState);
        });

        // 重新設置音訊輸出端
        if (currentAudioOutput && currentAudioOutput !== 'default') {
            try {
                const localVideo = document.getElementById('localVideo');
                if (localVideo.setSinkId) {
                    await localVideo.setSinkId(currentAudioOutput);
                    console.log('已重新設置音訊輸出端:', currentAudioOutput);
                }
            } catch (error) {
                console.warn('重新設置音訊輸出端失敗:', error);
            }
        }

        const cameraType = currentFacingMode === 'user' ? '前鏡頭' : '後鏡頭';
        addMessage('系統', `🔄 已切換到${cameraType}，音訊保持不變`);
        
        // 更新所有 WebRTC 連接的軌道
        await updateAllPeerConnections();
    } catch (error) {
        console.error('切換鏡頭失敗:', error);
        addMessage('系統', '❌ 鏡頭切換失敗');
    }
}

// 分享螢幕
async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { 
                cursor: 'always',
                displaySurface: 'monitor'
            },
            audio: true
        });

        // 保存當前的音訊軌道（如果有的話）
        const currentAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        
        // 只停止視訊軌道，保持音訊軌道
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            videoTracks.forEach(track => track.stop());
        }

        // 創建新的串流，包含螢幕分享的視訊軌道和原有的音訊軌道
        const newStream = new MediaStream();
        
        // 添加螢幕分享的視訊軌道
        screenStream.getVideoTracks().forEach(track => {
            newStream.addTrack(track);
        });
        
        // 保持原有的音訊軌道（如果存在且有效）
        if (currentAudioTrack && currentAudioTrack.readyState === 'live') {
            newStream.addTrack(currentAudioTrack);
            console.log('保持原有音訊軌道，軌道ID:', currentAudioTrack.id);
        } else {
            // 如果沒有原有音訊軌道，添加螢幕分享的音訊軌道
            screenStream.getAudioTracks().forEach(track => {
                newStream.addTrack(track);
            });
        }

        // 更新本地串流並設置到視訊元素
        localStream = newStream;
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // 確保音訊軌道啟用
        const newAudioTracks = localStream.getAudioTracks();
        newAudioTracks.forEach(track => {
            track.enabled = true;
            console.log('音訊軌道已啟用:', track.id, '狀態:', track.readyState);
        });

        // 重新設置音訊輸出端
        if (currentAudioOutput && currentAudioOutput !== 'default') {
            try {
                const localVideo = document.getElementById('localVideo');
                if (localVideo.setSinkId) {
                    await localVideo.setSinkId(currentAudioOutput);
                    console.log('已重新設置音訊輸出端:', currentAudioOutput);
                }
            } catch (error) {
                console.warn('重新設置音訊輸出端失敗:', error);
            }
        }

        addMessage('系統', '🖥️ 螢幕分享已開始，音訊保持不變');

        // 監聽螢幕分享結束
        screenStream.getVideoTracks()[0].onended = () => {
            addMessage('系統', '🖥️ 螢幕分享已結束');
            // 可以選擇切回攝影機或結束直播
        };

        // 更新所有觀眾的軌道
        if (isStreaming) {
            await updateAllPeerConnections();
        }

    } catch (error) {
        console.error('螢幕分享失敗:', error);
        addMessage('系統', '❌ 螢幕分享失敗');
    }
}

// 切換畫質
async function changeQuality() {
    if (!isStreaming) {
        currentQuality = document.getElementById('qualitySelect').value;
        document.getElementById('currentQuality').textContent = currentQuality + 'p';
        return;
    }

    try {
        currentQuality = document.getElementById('qualitySelect').value;
        
        // 保存當前的音訊軌道
        const currentAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        
        // 只重新配置視訊軌道
        const videoTracks = localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            const quality = getQualitySettings(currentQuality);
            await videoTracks[0].applyConstraints(quality);
            document.getElementById('currentQuality').textContent = currentQuality + 'p';
            addMessage('系統', `📺 畫質已切換為 ${currentQuality}p，音訊保持不變`);
        }

    } catch (error) {
        console.error('畫質切換失敗:', error);
        addMessage('系統', '❌ 畫質切換失敗');
    }
}

// 切換視訊裝置
async function switchVideoDevice() {
    if (!isStreaming) return;

    try {
        // 保存當前的音訊軌道
        const currentAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        
        // 只停止視訊軌道
        const videoTracks = localStream.getVideoTracks();
        videoTracks.forEach(track => track.stop());

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
                ...getQualitySettings(currentQuality),
                deviceId: document.getElementById('cameraSelect').value
            },
            audio: false
        });

        // 創建新的串流，包含新的視訊軌道和原有的音訊軌道
        const combinedStream = new MediaStream();
        
        // 添加新的視訊軌道
        newStream.getVideoTracks().forEach(track => {
            combinedStream.addTrack(track);
        });
        
        // 保持原有的音訊軌道
        if (currentAudioTrack && currentAudioTrack.readyState === 'live') {
            combinedStream.addTrack(currentAudioTrack);
            console.log('保持原有音訊軌道，軌道ID:', currentAudioTrack.id);
        }

        // 更新本地串流
        localStream = combinedStream;
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // 確保音訊軌道啟用
        const newAudioTracks2 = localStream.getAudioTracks();
        newAudioTracks2.forEach(track => {
            track.enabled = true;
            console.log('音訊軌道已啟用:', track.id, '狀態:', track.readyState);
        });

        // 重新設置音訊輸出端
        if (currentAudioOutput && currentAudioOutput !== 'default') {
            try {
                const localVideo = document.getElementById('localVideo');
                if (localVideo.setSinkId) {
                    await localVideo.setSinkId(currentAudioOutput);
                    console.log('已重新設置音訊輸出端:', currentAudioOutput);
                }
            } catch (error) {
                console.warn('重新設置音訊輸出端失敗:', error);
            }
        }
        
        addMessage('系統', '📹 攝影機已切換，音訊保持不變');

        // 更新所有觀眾的軌道
        if (isStreaming) {
            await updateAllPeerConnections();
        }

    } catch (error) {
        console.error('攝影機切換失敗:', error);
        addMessage('系統', '❌ 攝影機切換失敗');
    }
}

// 檢查當前音訊輸出端狀態
async function checkAudioOutputStatus() {
    try {
        const localVideo = document.getElementById('localVideo');
        
        if (!localVideo.setSinkId) {
            addMessage('系統', '⚠️ 瀏覽器不支援音訊輸出端切換');
            return;
        }
        
        // 獲取當前音訊輸出端
        const currentSinkId = localVideo.sinkId || 'default';
        
        // 獲取所有音訊輸出端
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
        
        // 找到當前使用的輸出端
        const currentDevice = audioOutputs.find(device => device.deviceId === currentSinkId);
        const deviceName = currentDevice ? currentDevice.label : '預設音訊輸出端';
        
        // 檢查音訊軌道狀態
        const audioTracks = localStream ? localStream.getAudioTracks() : [];
        const enabledTracks = audioTracks.filter(track => track.enabled);
        
        let statusMessage = `🔊 當前音訊輸出端: ${deviceName}\n`;
        statusMessage += `📊 音訊軌道: ${audioTracks.length} 個 (${enabledTracks.length} 個啟用)\n`;
        statusMessage += `▶️ 播放狀態: ${localVideo.paused ? '暫停' : '播放中'}\n`;
        statusMessage += `🔊 音量: ${Math.round(localVideo.volume * 100)}%`;
        
        addMessage('系統', statusMessage);
        
        console.log('音訊輸出端狀態:', {
            sinkId: currentSinkId,
            deviceName: deviceName,
            audioTracks: audioTracks.length,
            enabledTracks: enabledTracks.length,
            paused: localVideo.paused,
            volume: localVideo.volume
        });
        
    } catch (error) {
        console.error('檢查音訊輸出端狀態失敗:', error);
        addMessage('系統', '❌ 檢查音訊輸出端狀態失敗');
    }
}

// 測試音訊輸出端
async function testAudioOutput() {
    try {
        const selectedOutputId = document.getElementById('audioOutputSelect').value;
        const localVideo = document.getElementById('localVideo');
        
        if (!localVideo.setSinkId) {
            addMessage('系統', '⚠️ 您的瀏覽器不支援音訊輸出端切換功能');
            return;
        }

        // 如果正在直播，使用實際的視訊元素測試
        if (isStreaming && localStream) {
            try {
                // 切換到選擇的音訊輸出端
                await localVideo.setSinkId(selectedOutputId);
                
                // 獲取裝置名稱
                const devices = await navigator.mediaDevices.enumerateDevices();
                const selectedDevice = devices.find(device => 
                    device.kind === 'audiooutput' && device.deviceId === selectedOutputId
                );
                const deviceName = selectedDevice ? selectedDevice.label : '預設音訊輸出端';
                
                addMessage('系統', `🔊 正在測試音訊輸出端: ${deviceName}`);
                
                // 確保視訊播放
                if (localVideo.paused) {
                    await localVideo.play();
                }
                
                // 3秒後恢復原來的輸出端
                setTimeout(async () => {
                    if (currentAudioOutput && currentAudioOutput !== 'default') {
                        await localVideo.setSinkId(currentAudioOutput);
                    }
                    addMessage('系統', '🔊 音訊測試完成，已恢復原輸出端');
                }, 3000);
                
            } catch (error) {
                console.error('音訊測試失敗:', error);
                addMessage('系統', '❌ 音訊測試失敗: ' + error.message);
            }
        } else {
            // 如果沒有直播，創建測試音訊
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 音符
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); // 降低音量
            
            oscillator.start();
            
            // 播放 1 秒後停止
            setTimeout(() => {
                oscillator.stop();
                addMessage('系統', '🔊 音訊測試完成');
            }, 1000);
        }
        
    } catch (error) {
        console.error('音訊測試失敗:', error);
        addMessage('系統', '❌ 音訊測試失敗');
    }
}

// 切換音訊輸出端
async function switchAudioOutput() {
    try {
        const selectedOutputId = document.getElementById('audioOutputSelect').value;
        const localVideo = document.getElementById('localVideo');
        
        // 檢查瀏覽器是否支援 setSinkId
        if (!localVideo.setSinkId) {
            addMessage('系統', '⚠️ 您的瀏覽器不支援音訊輸出端切換功能');
            return;
        }

        if (!isStreaming) {
            currentAudioOutput = selectedOutputId;
            addMessage('系統', '🔊 音訊輸出端已設定，開始直播後生效');
            return;
        }

        // 切換音訊輸出端
        await localVideo.setSinkId(selectedOutputId);
        currentAudioOutput = selectedOutputId;
        
        // 獲取裝置名稱
        const devices = await navigator.mediaDevices.enumerateDevices();
        const selectedDevice = devices.find(device => 
            device.kind === 'audiooutput' && device.deviceId === selectedOutputId
        );
        const deviceName = selectedDevice ? selectedDevice.label : '預設音訊輸出端';
        
        addMessage('系統', `🔊 音訊輸出端已切換至: ${deviceName}`);
        
        console.log('音訊輸出端已切換至:', deviceName, 'ID:', selectedOutputId);
        
        // 確保音訊播放
        if (localVideo.paused) {
            try {
                await localVideo.play();
                console.log('音訊已開始播放');
                addMessage('系統', '▶️ 音訊已開始播放');
            } catch (error) {
                console.warn('自動播放失敗:', error);
                addMessage('系統', '⚠️ 請點擊視訊畫面以開始播放音訊');
            }
        } else {
            console.log('視訊已在播放中');
        }
        
        // 檢查音訊軌道狀態
        const audioTracks = localStream ? localStream.getAudioTracks() : [];
        const enabledTracks = audioTracks.filter(track => track.enabled);
        console.log('音訊軌道狀態:', {
            total: audioTracks.length,
            enabled: enabledTracks.length,
            tracks: audioTracks.map(track => ({
                id: track.id,
                enabled: track.enabled,
                readyState: track.readyState
            }))
        });
        
    } catch (error) {
        console.error('切換音訊輸出端失敗:', error);
        
        let errorMessage = '切換音訊輸出端失敗: ';
        if (error.name === 'NotAllowedError') {
            errorMessage += '請允許存取音訊輸出端權限';
        } else if (error.name === 'NotFoundError') {
            errorMessage += '找不到指定的音訊輸出端';
        } else {
            errorMessage += error.message;
        }
        
        addMessage('系統', '❌ ' + errorMessage);
    }
}

// 切換音訊裝置
async function switchAudioDevice() {
    if (!isStreaming) return;

    try {
        // 保存當前的視訊軌道
        const currentVideoTrack = localStream ? localStream.getVideoTracks()[0] : null;
        
        // 只停止音訊軌道
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => track.stop());

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                deviceId: document.getElementById('microphoneSelect').value
            }
        });

        // 創建新的串流，包含新的音訊軌道和原有的視訊軌道
        const combinedStream = new MediaStream();
        
        // 添加新的音訊軌道
        newStream.getAudioTracks().forEach(track => {
            combinedStream.addTrack(track);
        });
        
        // 保持原有的視訊軌道
        if (currentVideoTrack && currentVideoTrack.readyState === 'live') {
            combinedStream.addTrack(currentVideoTrack);
            console.log('保持原有視訊軌道，軌道ID:', currentVideoTrack.id);
        }

        // 更新本地串流
        localStream = combinedStream;
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // 確保音訊軌道啟用
        const newAudioTracks3 = localStream.getAudioTracks();
        newAudioTracks3.forEach(track => {
            track.enabled = true;
            console.log('音訊軌道已啟用:', track.id, '狀態:', track.readyState);
        });

        // 重新設置音訊輸出端
        if (currentAudioOutput && currentAudioOutput !== 'default') {
            try {
                const localVideo = document.getElementById('localVideo');
                if (localVideo.setSinkId) {
                    await localVideo.setSinkId(currentAudioOutput);
                    console.log('已重新設置音訊輸出端:', currentAudioOutput);
                }
            } catch (error) {
                console.warn('重新設置音訊輸出端失敗:', error);
            }
        }
        
        addMessage('系統', '🎤 麥克風已切換，視訊保持不變');

        // 更新所有觀眾的軌道
        if (isStreaming) {
            await updateAllPeerConnections();
        }

    } catch (error) {
        console.error('麥克風切換失敗:', error);
        addMessage('系統', '❌ 麥克風切換失敗');
    }
}

// 截圖功能
function takeScreenshot() {
    if (!localStream) return;

    const canvas = document.createElement('canvas');
    const video = document.getElementById('localVideo');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // 下載截圖
    const link = document.createElement('a');
    link.download = `screenshot_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
    link.href = canvas.toDataURL();
    link.click();

    addMessage('系統', '📸 截圖已下載');
}

// 全螢幕切換
function toggleFullscreen() {
    const videoContainer = document.querySelector('.video-container');
    
    if (!document.fullscreenElement) {
        videoContainer.requestFullscreen().catch(err => {
            console.error('全螢幕失敗:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// 更新直播狀態
function updateStreamStatus(isLive) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const streamBtn = document.getElementById('streamBtn');

    if (isLive) {
        statusDot.classList.add('live');
        statusText.textContent = '直播中';
        streamBtn.textContent = '⏹️ 停止直播';
        streamBtn.classList.add('streaming');
    } else {
        statusDot.classList.remove('live');
        statusText.textContent = '離線';
        streamBtn.textContent = '🔴 開始直播';
        streamBtn.classList.remove('streaming');
    }
}

// 開始直播計時器
function startStreamTimer() {
    streamStartTime = Date.now();
    durationInterval = setInterval(updateDuration, 1000);
}

// 停止直播計時器
function stopStreamTimer() {
    if (durationInterval) {
        clearInterval(durationInterval);
        durationInterval = null;
    }
    streamStartTime = null;
}

// 更新直播時長
function updateDuration() {
    if (!streamStartTime) return;

    const elapsed = Date.now() - streamStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    document.getElementById('duration').textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 模擬觀眾數量
function simulateViewers() {
    if (!isStreaming) return;

    // 隨機增加觀眾
    const viewerIncrease = Math.floor(Math.random() * 3) + 1;
    viewerCount += viewerIncrease;
    
    document.getElementById('viewerCount').textContent = viewerCount;
    document.getElementById('chatViewerCount').textContent = viewerCount;

    // 隨機發送觀眾訊息
    if (Math.random() < 0.3) {
        const messages = [
            '主播好！',
            '畫面很清晰呢',
            '支持主播！',
            '請問主播在玩什麼遊戲？',
            '主播的聲音很好聽',
            '這個直播間很棒！',
            '主播加油！',
            '請問主播幾歲？',
            '主播的技術很棒',
            '這個直播很有趣'
        ];
        
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const usernames = ['觀眾A', '觀眾B', '觀眾C', '觀眾D', '觀眾E', '觀眾F'];
        const randomUsername = usernames[Math.floor(Math.random() * usernames.length)];
        
        addMessage(randomUsername, randomMessage);
    }

    // 繼續模擬
    setTimeout(simulateViewers, Math.random() * 5000 + 3000);
}

// 模擬數據傳輸
function simulateDataTransfer() {
    if (!isStreaming) return;

    const dataRate = Math.floor(Math.random() * 1000) + 100;
    document.getElementById('dataRate').textContent = `${dataRate} KB/s`;

    dataTransferInterval = setTimeout(simulateDataTransfer, 2000);
}

// 重置統計數據
function resetStats() {
    viewerCount = 0;
    messageCount = 0;
    document.getElementById('viewerCount').textContent = '0';
    document.getElementById('chatViewerCount').textContent = '0';
    document.getElementById('messageCount').textContent = '0';
    document.getElementById('duration').textContent = '00:00';
    document.getElementById('dataRate').textContent = '0 KB/s';

    if (dataTransferInterval) {
        clearTimeout(dataTransferInterval);
        dataTransferInterval = null;
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
        document.getElementById('messageCount').textContent = messageCount;
    }
}

// 發送訊息
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    // 在本地顯示主播的訊息
    addMessage('主播', message);
    
    // 通過 WebSocket 發送訊息給所有觀眾
    if (streamingSocket && streamingSocket.readyState === WebSocket.OPEN) {
        const messageData = {
            type: 'broadcaster_chat_message',
            broadcasterId: 'broadcaster_1',
            message: message,
            timestamp: Date.now()
        };
        
        streamingSocket.send(JSON.stringify(messageData));
        console.log('已發送主播訊息給所有觀眾:', messageData);
    } else {
        console.warn('WebSocket 未連接，無法發送訊息');
        addMessage('系統', '⚠️ 網路連接異常，訊息可能無法發送給觀眾');
    }
    
    messageInput.value = '';
}

// 處理Enter鍵發送
function handleEnter(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// 顯示權限請求提示
function showPermissionRequest() {
    const videoContainer = document.querySelector('.video-container');
    
    // 檢查是否已經有提示
    if (videoContainer.querySelector('.permission-request')) return;
    
    const permissionDiv = document.createElement('div');
    permissionDiv.className = 'permission-request';
    permissionDiv.innerHTML = `
        <h3>🔐 需要權限</h3>
        <p>請允許瀏覽器存取您的攝影機和麥克風來開始直播</p>
        <button class="btn btn-primary" onclick="requestPermissions()">重新請求權限</button>
    `;
    
    videoContainer.appendChild(permissionDiv);
}

// 重新請求權限
async function requestPermissions() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addMessage('系統', '✅ 權限已獲得，請重新點擊開始直播');
        
        // 移除權限提示
        const permissionRequest = document.querySelector('.permission-request');
        if (permissionRequest) {
            permissionRequest.remove();
        }
        
    } catch (error) {
        addMessage('系統', '❌ 權限請求失敗，請檢查瀏覽器設定');
    }
}

// 模擬初始活動
function simulateInitialActivity() {
    // 模擬一些初始的聊天訊息
    setTimeout(() => {
        addMessage('系統', '👋 歡迎來到直播平台！');
    }, 1000);
    
    setTimeout(() => {
        addMessage('系統', '💡 提示：點擊開始直播來啟動您的攝影機');
    }, 3000);
}

// 連接到直播服務器
function connectToStreamingServer() {
    try {
        streamingSocket = new WebSocket('ws://localhost:3000');
        
        streamingSocket.onopen = function() {
            console.log('已連接到直播服務器');
            addMessage('系統', '🔗 已連接到直播服務器');
            
            // 發送主播加入訊息
            streamingSocket.send(JSON.stringify({
                type: 'broadcaster_join',
                broadcasterId: 'broadcaster_1'
            }));
        };
        
        streamingSocket.onmessage = function(event) {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        streamingSocket.onclose = function() {
            console.log('與直播服務器斷開連接');
            addMessage('系統', '⚠️ 與直播服務器斷開連接');
        };
        
        streamingSocket.onerror = function(error) {
            console.error('WebSocket 錯誤:', error);
            addMessage('系統', '❌ 連接直播服務器失敗');
        };
        
    } catch (error) {
        console.error('無法連接到直播服務器:', error);
        addMessage('系統', '❌ 無法連接到直播服務器');
    }
}

// 處理服務器訊息
function handleServerMessage(data) {
    switch (data.type) {
        case 'broadcaster_joined':
            addMessage('系統', '✅ 主播已成功加入直播間');
            break;
            
        case 'viewer_join':
            handleViewerJoin(data);
            break;
            
        case 'viewers_need_connection':
            handleViewersNeedConnection(data);
            break;
            
        case 'answer':
            handleAnswer(data);
            break;
            
        case 'ice_candidate':
            handleIceCandidate(data);
            break;
            
        case 'chat_message':
            handleChatMessage(data);
            break;
            
        case 'viewer_count_update':
            updateViewerCount(data.count);
            break;
            
        default:
            console.log('未知訊息類型:', data.type);
    }
}

// 處理觀眾加入
function handleViewerJoin(data) {
    console.log('觀眾加入:', data.viewerId);
    addMessage('系統', `👥 觀眾 ${data.viewerId.substr(-3)} 已加入直播間`);
    
    // 如果正在直播，為新觀眾建立連接
    if (isStreaming && localStream) {
        // 檢查是否已經有連接
        if (!peerConnections.has(data.viewerId)) {
            addMessage('系統', `🔄 為觀眾 ${data.viewerId.substr(-3)} 建立視訊連接...`);
            
            // 建立 WebRTC 連接
            createPeerConnection(data.viewerId);
            
            // 發送直播串流
            sendStreamToViewer(data.viewerId);
        } else {
            addMessage('系統', `ℹ️ 觀眾 ${data.viewerId.substr(-3)} 已有連接`);
        }
    } else {
        addMessage('系統', `⚠️ 觀眾 ${data.viewerId.substr(-3)} 加入，但直播尚未開始`);
    }
}

// 處理觀眾需要連接
function handleViewersNeedConnection(data) {
    console.log('觀眾需要連接:', data.viewers);
    addMessage('系統', data.message);
    
    // 為所有等待的觀眾建立連接
    data.viewers.forEach(viewerId => {
        if (!peerConnections.has(viewerId)) {
            console.log('為觀眾', viewerId, '建立連接');
            createPeerConnection(viewerId);
            sendStreamToViewer(viewerId);
        }
    });
}

// 建立 WebRTC 連接
function createPeerConnection(viewerId) {
    try {
        console.log('為觀眾', viewerId, '建立 WebRTC 連接');
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // 添加本地串流軌道
        if (localStream) {
            const tracks = localStream.getTracks();
            console.log('本地串流軌道數量:', tracks.length);
            
            tracks.forEach(track => {
                try {
                    peerConnection.addTrack(track, localStream);
                    console.log('已添加軌道:', track.kind, '軌道狀態:', track.readyState);
                } catch (error) {
                    console.error('添加軌道失敗:', track.kind, error);
                }
            });
        } else {
            console.error('本地串流不存在');
            addMessage('系統', `❌ 無法為觀眾 ${viewerId.substr(-3)} 建立連接：本地串流不存在`);
            return;
        }
        
        // 處理 ICE 候選
        peerConnection.onicecandidate = function(event) {
            if (event.candidate && streamingSocket) {
                console.log('發送 ICE 候選給觀眾:', viewerId);
                streamingSocket.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: event.candidate,
                    broadcasterId: 'broadcaster_1',
                    viewerId: viewerId
                }));
            }
        };
        
        // 監聽連接狀態
        peerConnection.onconnectionstatechange = function() {
            console.log('觀眾', viewerId, '連接狀態:', peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                addMessage('系統', `✅ 觀眾 ${viewerId.substr(-3)} 視訊連接成功`);
            } else if (peerConnection.connectionState === 'failed') {
                addMessage('系統', `❌ 觀眾 ${viewerId.substr(-3)} 視訊連接失敗`);
                // 嘗試重新建立連接
                setTimeout(() => {
                    if (peerConnection.connectionState === 'failed') {
                        addMessage('系統', `🔄 嘗試為觀眾 ${viewerId.substr(-3)} 重新建立連接...`);
                        peerConnections.delete(viewerId);
                        createPeerConnection(viewerId);
                        sendStreamToViewer(viewerId);
                    }
                }, 5000);
            } else if (peerConnection.connectionState === 'disconnected') {
                addMessage('系統', `⚠️ 觀眾 ${viewerId.substr(-3)} 視訊連接斷開`);
            }
        };
        
        // 監聽 ICE 連接狀態
        peerConnection.oniceconnectionstatechange = function() {
            console.log('觀眾', viewerId, 'ICE 狀態:', peerConnection.iceConnectionState);
            
            if (peerConnection.iceConnectionState === 'failed') {
                addMessage('系統', `❌ 觀眾 ${viewerId.substr(-3)} ICE 連接失敗`);
            } else if (peerConnection.iceConnectionState === 'connected') {
                addMessage('系統', `✅ 觀眾 ${viewerId.substr(-3)} ICE 連接成功`);
            }
        };
        
        // 監聽信令狀態
        peerConnection.onsignalingstatechange = function() {
            console.log('觀眾', viewerId, '信令狀態:', peerConnection.signalingState);
        };
        
        // 儲存連接
        peerConnections.set(viewerId, peerConnection);
        console.log('WebRTC 連接已建立並儲存');
        
    } catch (error) {
        console.error('建立 WebRTC 連接失敗:', error);
        addMessage('系統', `❌ 為觀眾 ${viewerId.substr(-3)} 建立連接失敗`);
    }
}

// 發送串流給觀眾
async function sendStreamToViewer(viewerId) {
    const peerConnection = peerConnections.get(viewerId);
    if (!peerConnection) return;
    
    try {
        console.log('為觀眾', viewerId, '創建 WebRTC offer');
        
        // 創建 offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // 發送 offer 給觀眾
        if (streamingSocket) {
            const offerMessage = {
                type: 'offer',
                offer: offer,
                broadcasterId: 'broadcaster_1',
                viewerId: viewerId
            };
            console.log('發送 offer 給觀眾:', viewerId, offerMessage);
            streamingSocket.send(JSON.stringify(offerMessage));
        }
        
    } catch (error) {
        console.error('發送串流失敗:', error);
        addMessage('系統', `❌ 發送串流給觀眾 ${viewerId.substr(-3)} 失敗`);
    }
}

// 處理觀眾的 answer
async function handleAnswer(data) {
    console.log('收到觀眾 answer:', data.viewerId);
    const peerConnection = peerConnections.get(data.viewerId);
    
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('已設置觀眾 answer 為遠端描述');
            addMessage('系統', `✅ 觀眾 ${data.viewerId.substr(-3)} 連接回應已處理`);
        } catch (error) {
            console.error('設置觀眾 answer 失敗:', error);
            addMessage('系統', `❌ 處理觀眾 ${data.viewerId.substr(-3)} 回應失敗`);
        }
    } else {
        console.error('找不到觀眾的 WebRTC 連接:', data.viewerId);
        addMessage('系統', `❌ 找不到觀眾 ${data.viewerId.substr(-3)} 的連接`);
    }
}

// 處理 ICE 候選
async function handleIceCandidate(data) {
    console.log('收到觀眾 ICE 候選:', data.viewerId);
    const peerConnection = peerConnections.get(data.viewerId);
    
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('已添加觀眾 ICE 候選');
        } catch (error) {
            console.error('添加觀眾 ICE 候選失敗:', error);
            addMessage('系統', `❌ 處理觀眾 ${data.viewerId.substr(-3)} ICE 候選失敗`);
        }
    } else {
        console.error('無法處理 ICE 候選:', data);
    }
}

// 處理聊天訊息
function handleChatMessage(data) {
    if (data.viewerId) { // 來自觀眾的訊息
        addMessage(`觀眾${data.viewerId.substr(-3)}`, data.message);
    }
}

// 更新觀眾數量
function updateViewerCount(count) {
    viewerCount = count;
    document.getElementById('viewerCount').textContent = count;
    document.getElementById('chatViewerCount').textContent = count;
}

// 更新所有 WebRTC 連接的軌道
async function updateAllPeerConnections() {
    if (!localStream) return;
    
    try {
        addMessage('系統', '🔄 正在更新所有觀眾的視訊軌道...');
        
        // 為每個觀眾重新建立連接
        const viewerIds = Array.from(peerConnections.keys());
        
        for (const viewerId of viewerIds) {
            // 關閉舊連接
            const oldConnection = peerConnections.get(viewerId);
            if (oldConnection) {
                oldConnection.close();
                peerConnections.delete(viewerId);
            }
            
            // 建立新連接
            createPeerConnection(viewerId);
            await sendStreamToViewer(viewerId);
        }
        
        addMessage('系統', '✅ 所有觀眾的視訊軌道已更新');
    } catch (error) {
        console.error('更新 WebRTC 連接失敗:', error);
        addMessage('系統', '❌ 更新視訊軌道失敗');
    }
}

// 更新單個 WebRTC 連接的軌道（用於視訊開關等）
async function updatePeerConnectionTracks(viewerId) {
    const peerConnection = peerConnections.get(viewerId);
    if (!peerConnection || !localStream) return;
    
    try {
        console.log('正在更新觀眾', viewerId, '的軌道...');
        
        // 獲取當前軌道
        const currentTracks = localStream.getTracks();
        const currentSenders = peerConnection.getSenders();
        
        // 檢查是否需要更新軌道
        let needsUpdate = false;
        
        // 檢查軌道數量是否匹配
        if (currentTracks.length !== currentSenders.length) {
            needsUpdate = true;
        } else {
            // 檢查軌道內容是否匹配
            for (let i = 0; i < currentTracks.length; i++) {
                if (currentSenders[i] && currentSenders[i].track) {
                    if (currentSenders[i].track.id !== currentTracks[i].id) {
                        needsUpdate = true;
                        break;
                    }
                } else {
                    needsUpdate = true;
                    break;
                }
            }
        }
        
        if (!needsUpdate) {
            console.log('觀眾', viewerId, '的軌道已是最新，無需更新');
            return;
        }
        
        // 智能軌道更新：只更新變化的軌道，保持音訊軌道
        const audioTrack = currentTracks.find(track => track.kind === 'audio');
        const videoTrack = currentTracks.find(track => track.kind === 'video');
        
        // 找到現有的軌道發送器
        const existingAudioSender = currentSenders.find(sender => 
            sender.track && sender.track.kind === 'audio'
        );
        const existingVideoSender = currentSenders.find(sender => 
            sender.track && sender.track.kind === 'video'
        );
        
        // 只更新視訊軌道，保持音訊軌道
        if (videoTrack && videoTrack.readyState === 'live') {
            if (existingVideoSender) {
                // 替換現有視訊軌道
                await existingVideoSender.replaceTrack(videoTrack);
                console.log('已替換視訊軌道，軌道ID:', videoTrack.id);
            } else {
                // 添加新視訊軌道
                peerConnection.addTrack(videoTrack, localStream);
                console.log('已添加新視訊軌道，軌道ID:', videoTrack.id);
            }
        }
        
        // 確保音訊軌道存在且啟用
        if (audioTrack && audioTrack.readyState === 'live') {
            if (!existingAudioSender) {
                peerConnection.addTrack(audioTrack, localStream);
                console.log('已添加音訊軌道，軌道ID:', audioTrack.id);
            } else if (existingAudioSender.track !== audioTrack) {
                // 音訊軌道已更改，替換它
                await existingAudioSender.replaceTrack(audioTrack);
                console.log('已替換音訊軌道，軌道ID:', audioTrack.id);
            } else {
                console.log('音訊軌道保持不變，軌道ID:', audioTrack.id);
            }
        }
        
        // 重新協商連接
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            // 發送新的 offer 給觀眾
            if (streamingSocket) {
                const offerMessage = {
                    type: 'offer',
                    offer: offer,
                    broadcasterId: 'broadcaster_1',
                    viewerId: viewerId
                };
                console.log('發送更新後的 offer 給觀眾:', viewerId);
                streamingSocket.send(JSON.stringify(offerMessage));
            }
            
            console.log('已更新觀眾', viewerId, '的軌道並重新協商');
        } catch (error) {
            console.error('重新協商失敗:', error);
        }
        
    } catch (error) {
        console.error('更新軌道失敗:', error);
    }
}

// 頁面卸載時清理資源
window.addEventListener('beforeunload', function() {
    if (streamingSocket) {
        streamingSocket.close();
    }
    
    // 關閉所有 WebRTC 連接
    peerConnections.forEach(connection => {
        connection.close();
    });
    peerConnections.clear();
});
