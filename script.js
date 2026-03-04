// ==========================================
// 0. 初始化 Firebase (v9 模組化寫法)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🔥 請務必替換成你真實的 Firebase 專案設定值
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 1. 取得 HTML 元素
// ==========================================
const screenLogin = document.getElementById('screen-login');
const screenIntro = document.getElementById('screen-intro');
const screenGame = document.getElementById('screen-game');
const screenResult = document.getElementById('screen-result');

const inputName = document.getElementById('userName');
const inputAge = document.getElementById('userAge');
const btnToIntro = document.getElementById('btn-to-intro');
const btnPlayInstruction = document.getElementById('btn-play-instruction');
const btnStartGame = document.getElementById('btn-start-game');
const btnPlayAgain = document.getElementById('btn-play-again');

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const scoreElement = document.getElementById('score');
const timeElement = document.getElementById('time');
const repsElement = document.getElementById('reps');
const statusBar = document.getElementById('status-bar');

const imgBrick = document.getElementById('img-brick');
const imgCoin = document.getElementById('img-coin');

// ==========================================
// 2. 遊戲變數與數據狀態
// ==========================================
let userData = { name: '', age: 0 }; 
let score = 0;
let repsCount = 0; 
let isSquatting = false; 
let showEffectTimer = 0; 
let timeLeft = 30;         
let gameActive = false;    
let countdownTimer = null; 
let isCameraStarted = false;

// 醫療數據變數
let minKneeAngle = 360; 
let maxKneeAngle = 0;   
let lastEffectX = 0; // 記錄特效出現的 X 座標

// ==========================================
// 3. 智慧語音引擎
// ==========================================
const synth = window.speechSynthesis;
let lastSpeakTime = 0;

function speakMsg(text, forceInterrupt = false) {
    const now = Date.now();
    if (!forceInterrupt && synth.speaking) return;
    if (!forceInterrupt && (now - lastSpeakTime < 2000)) return;
    if (forceInterrupt) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.1;
    synth.speak(utterance);
    lastSpeakTime = now;
}

// ==========================================
// 4. 核心邏輯
// ==========================================
function switchScreen(screenToShow) {
    screenLogin.classList.add('hidden');
    screenIntro.classList.add('hidden');
    screenGame.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenToShow.classList.remove('hidden');
}

function resizeCanvas() {
    canvasElement.width = canvasElement.clientWidth;
    canvasElement.height = canvasElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function calculateAngle(a, b, c) {
    let radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

const pose = new Pose({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
}});
pose.setOptions({
    modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
});

pose.onResults((results) => {
    if (!gameActive && !isCameraStarted) return; 

    resizeCanvas(); 
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2, radius: 2});
        
        // --- 1. 動態磚塊：跟隨鼻子移動 ---
        const nose = results.poseLandmarks[0];
        const blockWidth = 100;
        const blockHeight = 100;
        // 磚塊 X 座標跟隨鼻子，限制在畫布內
        let blockX = (nose.x * canvasElement.width) - (blockWidth / 2);
        const blockY = 50; 

        if (imgBrick && imgBrick.complete && imgBrick.naturalHeight > 0) {
            canvasCtx.drawImage(imgBrick, blockX, blockY, blockWidth, blockHeight);
        }

        // --- 2. 醫療數據判斷與得分邏輯 ---
        if (gameActive) {
            const shoulder = results.poseLandmarks[11];
            const hip = results.poseLandmarks[23];
            const knee = results.poseLandmarks[25];
            const ankle = results.poseLandmarks[27];
            
            if (shoulder && hip && knee && ankle && hip.visibility > 0.5 && knee.visibility > 0.5) {
                const kneeAngle = calculateAngle(hip, knee, ankle);
                const hipAngle = calculateAngle(shoulder, hip, knee);
                
                const noseCanvasY = nose.y * canvasElement.height;
                const noseCanvasX = nose.x * canvasElement.width;

                // 物理碰撞判定：頭部是否進入磚塊範圍
                const isTouchingBrick = (
                    noseCanvasX > blockX && noseCanvasX < blockX + blockWidth &&
                    noseCanvasY > blockY && noseCanvasY < blockY + blockHeight
                );

                // 過濾異常角度並記錄
                if (kneeAngle > 40 && kneeAngle <= 180) {
                    if (kneeAngle < minKneeAngle) minKneeAngle = kneeAngle;
                    if (kneeAngle > maxKneeAngle) maxKneeAngle = kneeAngle;
                }
                
                // 蹲下判定 (變嚴格：膝蓋需 < 110 度)
                if (kneeAngle < 110 && hipAngle < 130 && !isSquatting) {
                    isSquatting = true;
                    statusBar.innerText = '到位了！向上頂磚塊！';
                    speakMsg("蹲得好，請起立"); 
                }
                
                // 站起並碰撞判定 (得分)
                if (kneeAngle > 150 && isTouchingBrick && isSquatting) {
                    isSquatting = false; 
                    repsCount++;
                    score += 10;
                    scoreElement.innerText = score;
                    repsElement.innerText = repsCount;
                    statusBar.innerText = '✨ 完美碰撞！得分！';
                    
                    lastEffectX = blockX; // 記錄特效位置
                    showEffectTimer = 40; 
                    speakMsg("得分", true); 
                }
            }
        }

        // --- 3. 金幣彈出動畫 ---
        if (showEffectTimer > 0) {
            const progress = 1 - (showEffectTimer / 40); 
            const easeOut = Math.sin(progress * Math.PI / 2);
            const floatY = blockY - (easeOut * 80); 
            const alpha = showEffectTimer < 10 ? (showEffectTimer / 10) : 1;

            canvasCtx.save(); 
            canvasCtx.globalAlpha = alpha;
            if (imgCoin && imgCoin.complete && imgCoin.naturalHeight > 0) {
                canvasCtx.drawImage(imgCoin, lastEffectX + 25, floatY - 10, 50, 50);
            }
            canvasCtx.fillStyle = '#FF4500'; 
            canvasCtx.font = 'bold 30px Arial';
            canvasCtx.fillText('+10', lastEffectX + 80, floatY + 25);
            canvasCtx.restore(); 
            showEffectTimer--; 
        }
    }
});

const camera = new Camera(videoElement, {
    onFrame: async () => { await pose.send({image: videoElement}); },
    width: 640, height: 480, facingMode: 'user'
});

// ==========================================
// 5. 流程與 Firebase 數據
// ==========================================
function startGameTimer() {
    score = 0; repsCount = 0; timeLeft = 30; gameActive = true;
    minKneeAngle = 360; maxKneeAngle = 0;
    scoreElement.innerText = score;
    repsElement.innerText = repsCount;
    timeElement.innerText = timeLeft;
    statusBar.innerText = '🔥 遊戲開始！請退後深蹲！';
    speakMsg("挑戰開始，請開始深蹲", true);

    countdownTimer = setInterval(() => {
        timeLeft--;
        timeElement.innerText = timeLeft;
        if (timeLeft <= 0) endGame();
    }, 1000);
}

async function saveToFirebase(gameData) {
    try {
        const docRef = await addDoc(collection(db, "squatRecords"), gameData);
        console.log("✅ 數據存入 ID: ", docRef.id);
    } catch (e) { console.error("❌ 寫入失敗: ", e); }
}

function endGame() {
    gameActive = false; 
    clearInterval(countdownTimer); 
    statusBar.innerText = '時間到！結算中...';
    speakMsg("時間到，正在結算成績", true);

    let title = repsCount >= 13 ? "傳說級深蹲王 👑" : repsCount >= 6 ? "活力不老松 🌲" : repsCount >= 1 ? "健康練習生 🏃" : "繼續加油！ 😅";
    let avgTime = repsCount > 0 ? (30 / repsCount).toFixed(1) : 0;
    let finalMin = minKneeAngle === 360 ? 0 : Math.round(minKneeAngle);

    const sessionData = {
        name: userData.name, age: userData.age, totalScore: score,
        reps: repsCount, minAngle: finalMin, maxAngle: Math.round(maxKneeAngle),
        avgTimePerRep: avgTime, timestamp: new Date().toISOString()
    };

    saveToFirebase(sessionData);

    document.getElementById('result-name').innerText = `${userData.name} (${userData.age}歲)`;
    document.getElementById('result-title').innerText = title;
    document.getElementById('result-reps').innerText = repsCount;
    document.getElementById('result-score').innerText = score;
    document.getElementById('result-min-angle').innerText = finalMin;
    document.getElementById('result-max-angle').innerText = Math.round(maxKneeAngle);
    document.getElementById('result-avg-time').innerText = avgTime;

    setTimeout(() => { switchScreen(screenResult); }, 1500);
}

// ==========================================
// 6. 按鈕事件
// ==========================================
btnToIntro.addEventListener('click', () => {
    if (!inputName.value || !inputAge.value) return alert("請輸入姓名與年齡");
    userData.name = inputName.value;
    userData.age = parseInt(inputAge.value);
    switchScreen(screenIntro);
});

btnPlayInstruction.addEventListener('click', () => {
    speakMsg("遊戲說明：退後至全身入鏡。蹲下使膝蓋低於一百一十度，再站起用頭頂破移動中的問號磚塊！", true);
});

btnStartGame.addEventListener('click', () => {
    switchScreen(screenGame); 
    if (!isCameraStarted) {
        camera.start().then(() => { isCameraStarted = true; startGameTimer(); });
    } else { startGameTimer(); }
});

btnPlayAgain.addEventListener('click', () => {
    switchScreen(screenGame);
    startGameTimer();
});
