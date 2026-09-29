const API_URL = '/api';
let uploadedFile = null;
let analysisResults = null;
let analysisStats = null;
let outputFilename = null;

// 為活動選項添加監聽器，顯示/隱藏精確小時數輸入框
function setupActivityHoursListeners() {
    const activities = [
        { selectId: 'nearReading', hoursId: 'nearReadingHours' },
        { selectId: 'extraReading', hoursId: 'extraReadingHours' },
        { selectId: 'staticActivity', hoursId: 'staticActivityHours' },
        { selectId: 'dynamicActivity', hoursId: 'dynamicActivityHours' },
        { selectId: 'tvTime', hoursId: 'tvTimeHours' },
        { selectId: 'computerTime', hoursId: 'computerTimeHours' }
    ];
    
    activities.forEach(({ selectId, hoursId }) => {
        const selectEl = document.getElementById(selectId);
        const hoursEl = document.getElementById(hoursId);
        if (selectEl && hoursEl) {
            selectEl.addEventListener('change', function() {
                if (this.value === '2') { // 選擇 >=1小時
                    hoursEl.style.display = 'block';
                } else {
                    hoursEl.style.display = 'none';
                    hoursEl.value = ''; // 清空輸入
                }
            });
        }
    });
}

window.addEventListener('load', () => {
    checkServerStatus();
    setupActivityHoursListeners();
});

// ==================== HMAC-SHA256 加密函數 ====================
async function hashMedicalId(medicalId) {
    if (!medicalId) return '';
    try {
        const resp = await fetch('/api/hash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ medicalId })
        });
        const data = await resp.json();
        return data.hashedId || '';
    } catch (e) {
        console.error('hash API error', e);
        // fallback: 不回傳原始病歷號，改回空字串或用前端雜湊（不推薦）
        return '';
    }
}

async function encryptMedicalId(medicalId) {
    if (!medicalId) return '';
    try {
        const resp = await fetch('/api/encrypt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ medicalId })
        });
        const data = await resp.json();
        return data.encryptedId || '';
    } catch (e) {
        console.error('encrypt API error', e);
        return '';
    }
}

async function checkServerStatus() {
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();

    const statusHTML = ``;

    document.getElementById('serverStatus').innerHTML = statusHTML;
    document.getElementById('serverStatus').className = 'server-status';
  } catch (err) {
    // 🚫 若伺服器無法連線
    const statusHTML = `
      <span class="dot dot-offline"></span>
      無法連線到伺服器（Server Offline）
    `;
    document.getElementById('serverStatus').innerHTML = statusHTML;
    document.getElementById('serverStatus').className = 'server-status server-offline';
  }
}

document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const ok = file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.xlsx');
        if (!ok) {
            alert('請上傳 CSV 或 XLSX 檔案\nPlease upload a CSV or XLSX file');
            return;
        }
        uploadedFile = file;
        document.getElementById('fileName').textContent = `已選擇（Selected）: ${file.name}`;
        document.getElementById('processBtn').style.display = 'block';
        const panel = document.getElementById('personPicker');
        if (panel) panel.style.display = 'none';
        const resultsDiv = document.getElementById('results');
        if (resultsDiv) resultsDiv.style.display = 'none';
    }
});

const uploadSection = document.getElementById('uploadSection');

uploadSection.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadSection.classList.add('dragover');
});

uploadSection.addEventListener('dragleave', () => {
    uploadSection.classList.remove('dragover');
});

uploadSection.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadSection.classList.remove('dragover');
    
    const file = e.dataTransfer.files[0];
    if (file && (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.xlsx'))) {
        uploadedFile = file;
        document.getElementById('fileName').textContent = `已選擇（Selected）: ${file.name}`;
        document.getElementById('processBtn').style.display = 'block';
        const panel = document.getElementById('personPicker');
        if (panel) panel.style.display = 'none';
        const resultsDiv = document.getElementById('results');
        if (resultsDiv) resultsDiv.style.display = 'none';
    } else {
        alert('請上傳 CSV 或 XLSX 檔案（Please upload a CSV or XLSX file）');
    }
});

const SCORE_COL = '認知六大面向總分';
const SCORE_COL_FALLBACKS = ['認知六大面向總分\n', '認知六大面向總分\n\n'];
const activity_features = [
  "平均每天近距離閱讀或書寫的時間",
  "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間",
  "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間",
  "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間",
  "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間",
  "平均每天使用電腦的時間",
];
const eyetracking_features = [
  "總體閱讀時間(秒)",
  "總體固視時間(秒)",
  "較長固視點數量 ( 300-1000 ms )",
  "較長固視點數量 ( 1000 ms以上 )  "
];

// 依決策圖：群集只顯示對應活動
const CLUSTER_TO_FIELDS = {
  '專注閱讀型': [
    '平均每天近距離閱讀或書寫的時間',
    '平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間'
  ],
  '高效靜態型': [
    '平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間'
  ],
  '動態提升型': [
    '平均每天進行動態活動(如抬拳道、空手道、球類等)的時間'
  ],
  '複合活動型': [
    '平均每天進行動態活動(如抬拳道、空手道、球類等)的時間',
    '平均每天近距離閱讀或書寫的時間',
    '平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間'
  ],
  '靜態閱讀型': [
    '平均每天近距離閱讀或書寫的時間',
    '平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間',
    '平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間'
  ],
  '數位使用型': [
    '平均每天觀看電視節目（如卡通、連續劇、電影等）的時間',
    '平均每天使用電腦的時間'
  ],
  '螢幕觀賞型': [
    '平均每天觀看電視節目（如卡通、連續劇、電影等）的時間'
  ]
};

const CLUSTER_EN = {
  '專注閱讀型': 'Focused Reading Group',
  '高效靜態型': 'Efficient Static Group',
  '動態提升型': 'Dynamic Boost Group',
  '複合活動型': 'Composite Activity Group',
  '靜態閱讀型': 'Static Reading Group',
  '數位使用型': 'Digital Usage Group',
  '螢幕觀賞型': 'Screen Viewing Group',
};

const DISPLAY_LABEL_BI = {
  '平均每天近距離閱讀或書寫的時間': '平均每天近距離閱讀或書寫的時間<br>Daily Near-Reading/Writing Time',
  '平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間': '平均每天閱讀課外讀物的時間<br>Daily Extracurricular Reading Time',
  '平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間': '平均每天進行靜態活動時間<br>Daily Static Activity Time',
  '平均每天進行動態活動(如抬拳道、空手道、球類等)的時間': '平均每天進行動態活動時間<br>Daily Dynamic Activity Time',
  '平均每天觀看電視節目（如卡通、連續劇、電影等）的時間': '平均每天觀看電視節目時間<br>Daily TV Watching Time',
  '平均每天使用電腦的時間': '平均每天使用電腦的時間<br>Daily Computer Usage Time',
  '年紀': '年紀<br>Age',
  '認知六大面向總分': '認知六大面向總分<br>Cognitive Six-Dimension Total Score',
};

function biLabel(key) {
  return DISPLAY_LABEL_BI[key] || key; 
}

function biCluster(name) {
  if (!name) return '';
  const en = CLUSTER_EN[name];
  return en ? `${name}<br>${en}` : name; 
}


function readScore(row) {
  if (row[SCORE_COL] != null && row[SCORE_COL] !== '') return row[SCORE_COL];
  for (const alt of SCORE_COL_FALLBACKS) {
    if (row[alt] != null && row[alt] !== '') return row[alt];
  }
  return null;
}

function getIdFieldName(row) {
  const candidates = ['編號', '受測者編號', 'ID', 'id'];
  for (const k of candidates) if (k in row) return k;
  if ('受測者\n姓名' in row) return '受測者\n姓名';
  if ('受測者姓名' in row) return '受測者姓名';
  return null;
}

function getSaveOptions() {
  const subdir = (document.getElementById('saveDir')?.value || '').trim();
  const filename = (document.getElementById('saveName')?.value || '').trim();
  return { subdir, filename };
}


// 把單筆 row 整理成「與手動輸出相同結構」的物件
function buildDbRecordFromRow(row) {
  // 讀數工具（你已經有 readScore、getIdFieldName 等）
  const activityMapping = { 0: '未填寫', 1: '<1 小時', 2: '≥1 小時' };
  const age = row['年紀'] ?? row['年齡'] ?? null;

  // 眼動核心數據（依你 CSV 欄位）
  const metrics = {
    "較長固視點數量_1000ms以上": row['較長固視點數量(1000ms以上)'] ?? row['較長固視點數量 ( 1000 ms以上 )  '],
    "較長固視點數量_300_1000ms": row['較長固視點數量 ( 300-1000 ms )'],
    "總體固視時間_秒": row['總體固視時間(秒)'],
    "總體閱讀時間_秒": row['總體閱讀時間(秒)']
  };

  // 每日習慣（代碼 + 中文）
  const habitCodes = {
    "近距離閱讀或書寫": row['平均每天近距離閱讀或書寫的時間'],
    "閱讀課外讀物":      row['平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間'],
    "靜態活動":          row['平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間'],
    "動態活動":          row['平均每天進行動態活動(如抬拳道、空手道、球類等)的時間'],
    "觀看電視節目":      row['平均每天觀看電視節目（如卡通、連續劇、電影等）的時間'],
    "使用電腦":          row['平均每天使用電腦的時間']
  };
  const habitTexts = Object.fromEntries(
    Object.entries(habitCodes).map(([k, v]) => [k, activityMapping[v] || '未填寫'])
  );

  // 分群與年齡層（批次上傳沒有決策樹結果；這裡帶上「目標群集」與年齡層）
  const ageBand = (typeof getAgeBand === 'function') ? getAgeBand(row) : (row['年齡層'] || '');
  const clusterName = row['rule_cluster'] || row['目標群集'] || ''; // 沒有決策樹就退回目標群集
  const habitSummary = row['建議習慣'] || ''; // 若後端沒給就留空

  return {
    "病歷號": row['病歷號'] || row['編號'] || row['受測者編號'] || '',
    "生成時間": new Date().toLocaleString('zh-TW'),
    "年齡": age,
    "年齡層": ageBand || "",
    "分群結果": clusterName,
    "認知六大面向總分": (row['認知六大面向總分'] ?? row['認知六大面向總分\n'] ?? row['認知六大面向總分\n\n']) || null,
    "各項數據": {
      "眼動數據": metrics,
      "每日習慣_代碼": habitCodes,
      "每日習慣_中文": habitTexts
    },
    "建議": {
      "總結": habitSummary,
      "個別建議": [] // 批次不做逐欄狀態建議；需的話可比照手動再補
    }
  };
}

// 小工具：安全取輸出檔名
function batchJsonFilename() {
  const base = (outputFilename || 'batch_result.csv').replace(/\.(csv|xlsx)$/i, '.json');
  return `分析報告_批次_${base}`;
}

// 主要函式：把上傳分析結果逐筆加密並匯出成合併 JSON
async function downloadBatchEncryptedJson() {
  if (!analysisResults || !Array.isArray(analysisResults) || analysisResults.length === 0) {
    alert('目前沒有可下載的上傳分析結果（No uploaded analysis result to download）');
    return;
  }

  const out = [];
  for (const row of analysisResults) {
    // 1) 組同結構物件
    const dbRecord = buildDbRecordFromRow(row);

    // 2) 病歷號加密（若無病歷號就給空字串）
    const encId = await encryptMedicalId(dbRecord['病歷號'] || '');

    // 3) 整筆報告內容加密（與手動一致：把整個 JSON 當字串送 /api/encrypt）
    const encJson = await encryptWholeJSON(dbRecord);
    if (!encJson) {
      console.warn('某筆資料加密失敗，已略過（Skipped one record due to encryption failure）', dbRecord);
      continue; // 跳過加密失敗的
    }

    // 4) 只保留加密後內容與最少必要索引欄（避免明文外流）
    out.push({
      "encrypted_medical_id": encId || "",
      "encrypted_payload": encJson
    });
  }

  if (out.length === 0) {
    alert('沒有成功加密的資料可供下載（No encrypted records to download）');
    return;
  }

  // 5) 改為送到後端指定路徑儲存（伺服器端 outputs/ 子資料夾）
  const { subdir, filename } = getSaveOptions();
  const resp = await fetch('/api/save_batch_encrypted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: out, subdir, filename })
  });
  const saved = await resp.json();
  if (!saved.success) {
    showError(saved.error || '伺服器儲存失敗');
    return;
  }
  alert(`✅ 已儲存到伺服器：${saved.saved_path}\n如需下載本機：${saved.download_url}`);
}

function setButtonVisibility(mode, hasResult = false) {
  const btnInput = document.getElementById('downloadInputBtn');     // 手動：下載輸入資料
  const btnImg   = document.getElementById('exportImgBtn');         // 手動：匯出結果圖片
  const btnBatch = document.getElementById('downloadBatchEncryptedBtn'); // 上傳：下載上傳結果

  // 一律先關掉三顆
  if (btnInput) btnInput.style.display = 'none';
  if (btnImg)   btnImg.style.display   = 'none';
  if (btnBatch) btnBatch.style.display = 'none';

  // 再依模式決定要不要打開
  if (mode === 'manual') {
    // 手動模式：只有在已有結果時才顯示兩顆
    if (hasResult) {
      if (btnInput) btnInput.style.display = 'inline-block';
      if (btnImg)   btnImg.style.display   = 'inline-block';
    }
  } else if (mode === 'file') {
    // 檔案上傳模式：只有在已有結果時才顯示上傳那一顆
    if (hasResult) {
      if (btnBatch) btnBatch.style.display = 'inline-block';
    }
  }
}



function isEligibleRow(row) {
  const age = Number(row['年紀']);
  if (!isFinite(age) || age >= 80) return false;

  if (readScore(row) == null) return false;
  for (const f of eyetracking_features) {
    if (!(f in row) || row[f] == null || row[f] === '') return false;
  }
  for (const f of activity_features) {
    if (!(f in row) || row[f] == null || row[f] === '') return false;
  }
  return true;
}

function populatePersonDropdown(data) {
  const select = document.getElementById('personSelect');
  const panel = document.getElementById('personPicker');
  if (!select || !panel) return;

  select.innerHTML = '';

  const options = [];
  data.forEach((row, i) => {
    if (!isEligibleRow(row)) return;
    const idField = getIdFieldName(row);
    const label = idField ? String(row[idField]) : `樣本#${i + 1}`;
    const value = JSON.stringify({ idx: i, idField: idField || '' });
    options.push({ label, value });
  });

  if (options.length === 0) {
    panel.style.display = 'none';
    return;
  }

  const seen = new Set();
  options.forEach(opt => {
    if (!seen.has(opt.label)) {
      const op = document.createElement('option');
      op.value = opt.value;
      op.textContent = opt.label;
      select.appendChild(op);
      seen.add(opt.label);
    }
  });

  panel.style.display = 'block';

  const viewBtn = document.getElementById('viewPersonBtn');
  if (viewBtn) {
    viewBtn.onclick = () => {
      const val = select.value;
      if (!val) return;
      const info = JSON.parse(val);
      renderSinglePersonView(analysisResults[info.idx], info.idx, analysisStats);
      const resultsDiv = document.getElementById('results');
      if (resultsDiv) resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

async function processData() {
    if (!uploadedFile) {
        alert('請先上傳 CSV 或 XLSX 檔案（Please upload a CSV or XLSX file first）');
        return;
    }

    const personPanel = document.getElementById('personPicker');
    if (personPanel) personPanel.style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('errorMessage').innerHTML = '';

    document.getElementById('loading').style.display = 'block';
    document.getElementById('processBtn').disabled = true;

    try {
        const formData = new FormData();
        formData.append('file', uploadedFile);

        const response = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            analysisResults = result.data;
            analysisStats = result.statistics;
            outputFilename = result.output_filename;
            displayResults(result.data, result.statistics);
            setButtonVisibility('file', true);
        } else {
            showError(result.error || '處理失敗（Processing failed）');
        }

    } catch (error) {
        showError('連接後端失敗（Failed to connect to backend）: ' + error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('processBtn').disabled = false;
    }
}

function showError(message) {
    document.getElementById('errorMessage').innerHTML = `
        <div class="error-message">
            <strong>❌ 錯誤（Error）:</strong> ${message}
        </div>
    `;
}

// 🔽 新增：下載「檔案上傳」分析結果的 JSON
// function downloadBatchJson() {
//   if (!analysisResults || !Array.isArray(analysisResults) || analysisResults.length === 0) {
//     alert('目前沒有可下載的上傳分析結果（No uploaded analysis result to download）');
//     return;
//   }
//   // 用後端回傳的輸出檔名推一個對應的 .json 名字；若沒有就用預設
//   const fname = (outputFilename || 'batch_result.csv').replace(/\.(csv|xlsx)$/i, '.json');

//   const blob = new Blob(
//     [JSON.stringify(analysisResults, null, 2)],
//     { type: 'application/json;charset=utf-8' }
//   );
//   const url = URL.createObjectURL(blob);
//   const a = document.createElement('a');
//   a.href = url;
//   a.download = `分析結果_${fname}`;
//   document.body.appendChild(a);
//   a.click();
//   document.body.removeChild(a);
//   URL.revokeObjectURL(url);
// }

// 四象限圖表繪製函數 
function generateQuadrantChartHTML(quadrantData) {
    if (!quadrantData || !quadrantData.Quadrant_has_data) {
        return '';
    }
    
    const sedentaryScore = quadrantData.Quadrant_sedentary_score || 0;
    const activityPass = quadrantData.Quadrant_activity_protection === 'Pass';
    const quadrantGroup = quadrantData.Quadrant_group || '';
    const quadrantName = quadrantData.Quadrant_name || '';
    const quadrantNameEn = quadrantData.Quadrant_name_en || '';
    const quadrantDescription = quadrantData.Quadrant_description || '';
    const quadrantColor = quadrantData.Quadrant_color || '#999';
    const sedentaryRisk = quadrantData.Quadrant_sedentary_risk || '';
    const sedentaryRiskEn = quadrantData.Quadrant_sedentary_risk_en || '';
    const activityProtectionZh = quadrantData.Quadrant_activity_protection_zh || '';
    const sedentaryDetails = quadrantData.Quadrant_sedentary_details || [];
    
    // 計算散點位置 (x: 久坐積分 0-5, y: 運動保護力 Pass/Fail)
    const x = sedentaryScore;
    const y = activityPass ? 1 : 0;
    
    // 將 0-5 和 0-1 轉換為圖表百分比位置
    const xPercent = (x / 5) * 100;
    const yPercent = (1 - y) * 100; // y軸反轉，上方是Pass
    
    // X軸格線（0,1,2,3,4,5）
    let xGridLines = '';
    for (let i = 0; i <= 5; i++) {
        const leftPercent = (i / 5) * 100;
        xGridLines += `<div style="position: absolute; left: ${leftPercent}%; bottom: 0px; width: 1.5px; height: 10px; background: #000000; z-index: 1;"></div>`;
    }
    
    // 四個象限的背景色和位置（x軸2.5為分界，左側0-2分，右側3-5分）
    const quadrants = [
        { name: 'A組：高活動低靜態型', nameEn: 'Group A: Ideal Health', xStart: 0, xEnd: 50, y: 0, height: 50, color: 'rgba(76, 175, 80, 0.08)', border: '#e0e0e0' },
        { name: 'B組：高活動高靜態型', nameEn: 'Group B: Active Couch Potato', xStart: 50, xEnd: 100, y: 0, height: 50, color: 'rgba(255, 152, 0, 0.08)', border: '#e0e0e0' },
        { name: 'C組：低活動低靜態型', nameEn: 'Group C: Low Activity', xStart: 0, xEnd: 50, y: 50, height: 50, color: 'rgba(255, 193, 7, 0.08)', border: '#e0e0e0' },
        { name: 'D組：低活動高靜態型', nameEn: 'Group D: Highest Risk', xStart: 50, xEnd: 100, y: 50, height: 50, color: 'rgba(244, 67, 54, 0.08)', border: '#e0e0e0' }
    ];
    
    let quadrantHTML = '';
    quadrants.forEach(q => {
        quadrantHTML += `
            <div style="position: absolute; left: ${q.xStart}%; top: ${q.y}%; width: ${q.xEnd - q.xStart}%; height: ${q.height}%; 
                        background: ${q.color}; border: 2px solid ${q.border}; box-sizing: border-box;
                        display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px;">
                <div style="font-size: 1em; font-weight: bold; color: #333; line-height: 1.4;">
                    ${q.name}<br>
                    <span style="font-size: 0.75em; opacity: 0.8;">${q.nameEn}</span>
                </div>
            </div>
        `;
    });
    
    return `
        <div class="result-card">
            <h3>🎯 運動與久坐的平衡：您的健康風險四分法<br>Exercise and Sedentary Balance: Health Risk Quadrant Analysis</h3>
            
            <div style="padding: 15px; background: ${quadrantColor}; color: white; border-radius: 8px; margin: 15px 0; text-align: center;">
                <div style="font-size: 1.3em; font-weight: bold; margin-bottom: 5px;">
                    ${quadrantName}
                </div>
                <div style="font-size: 0.9em; opacity: 0.95;">
                    ${quadrantNameEn}
                </div>
            </div>
            
            <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; margin: 15px 0;">
                <p style="margin: 0; line-height: 1.6;"><strong>象限說明：</strong><br>${quadrantDescription}</p>
            </div>
            
            <h4 style="color: #667eea; margin: 25px 0 15px 0;">📊 您的健康落點分析<br>Your Health Assessment</h4>
            
            <!-- 四象限圖表 -->
            <div style="position: relative; width: 100%; max-width: 450px; margin: 20px auto; padding-bottom: 60px;">
                <div style="position: relative; width: 100%; padding-top: 100%; border: 2px solid #333; border-radius: 8px; background: white;">
                    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;">
                        <!-- X軸格線 -->
                        ${xGridLines}
                        
                        <!-- 四個象限背景 -->
                        ${quadrantHTML}
                        
                        <!-- 主要軸線（2.5分和Pass/Fail分界） -->
                        <div style="position: absolute; left: 50%; top: 0; width: 3px; height: 100%; background: #333; z-index: 5;"></div>
                        <div style="position: absolute; left: 0; top: 50%; width: 100%; height: 3px; background: #333; z-index: 5;"></div>
                        
                        <!-- 受測者位置點 -->
                        <div style="position: absolute; left: calc(${xPercent}% - 12px); top: calc(${yPercent}% - 12px); 
                                    width: 24px; height: 24px; background: ${quadrantColor}; border: 4px solid white; 
                                    border-radius: 50%; box-shadow: 0 3px 10px rgba(0,0,0,0.4); z-index: 10;
                                    animation: pulse 2s infinite;">
                        </div>
                        
                        <!-- 受測者標籤 -->
                        <div style="position: absolute; left: calc(${xPercent}% + 18px); top: calc(${yPercent}% - 18px); 
                                    background: ${quadrantColor}; color: white; padding: 5px 10px; border-radius: 4px; 
                                    font-size: 0.8em; font-weight: bold; white-space: nowrap; z-index: 11;
                                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
                            您的位置
                        </div>
                    </div>
                </div>
                
                <!-- X軸標籤和刻度 -->
                <div style="position: absolute; bottom: 35px; left: 0; width: 100%; height: 20px; display: flex; justify-content: space-between; padding: 15px 2px;">
                    <span style="font-size: 0.85em; font-weight: bold;">0</span>
                    <span style="font-size: 0.85em; font-weight: bold;">1</span>
                    <span style="font-size: 0.85em; font-weight: bold;">2</span>
                    <span style="font-size: 0.85em; font-weight: bold;">3</span>
                    <span style="font-size: 0.85em; font-weight: bold;">4</span>
                    <span style="font-size: 0.85em; font-weight: bold;">5</span>
                </div>
                <div style="position: absolute; bottom: -25px; left: 0; width: 100%; text-align: center; font-size: 0.95em; font-weight: bold; color: #333;">
                    久坐風險分數 (0-5分)<br><span style="font-size: 0.85em;">Sedentary Risk Score</span>
                </div>
                
                <!-- Y軸標籤 -->
                <div style="position: absolute; left: -185px; top: 50%; transform: translateY(-50%) rotate(-90deg); 
                            font-size: 0.95em; font-weight: bold; white-space: nowrap; color: #333;margin-right: 15px;">
                    運動保護力 Activity Protection
                </div>
                <div style="position: absolute; left: -50px; top: 20%; font-size: 0.9em; font-weight: bold; color: #4CAF50;">
                    Pass<br><span style="font-size: 0.75em;">(達標)</span>
                </div>
                <div style="position: absolute; left: -50px; top: 60%; font-size: 0.9em; font-weight: bold; color: #F44336;">
                    Fail<br><span style="font-size: 0.75em;">(未達標)</span>
                </div>
            </div>
            
            <style>
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.15); }
                }
            </style>
            
            <div style="margin-top: 60px;">
                <h4 style="color: #667eea; margin-bottom: 15px;">📋 評估指標詳情<br>Assessment Indicators</h4>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
                    <div style="padding: 15px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 8px;">1️⃣ 久坐風險分數<br>Sedentary Risk Score</div>
                        <div style="font-size: 1.5em; font-weight: bold; color: #1976D2;">${sedentaryScore} 分</div>
                        <div style="margin-top: 8px; font-size: 0.9em;">
                            風險等級：${sedentaryRisk}<br>
                            Risk Level: ${sedentaryRiskEn}
                        </div>
                        ${sedentaryDetails.length > 0 ? `
                        <div style="margin-top: 10px; font-size: 0.85em; color: #666;">
                            超過1小時的活動：<br>
                            ${sedentaryDetails.join('、')}
                        </div>
                        ` : ''}
                    </div>
                    
                    <div style="padding: 15px; background: #f3e5f5; border-left: 4px solid #9C27B0; border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 8px;">2️⃣ 運動保護力<br>Activity Protection</div>
                        <div style="font-size: 1.5em; font-weight: bold; color: #7B1FA2;">
                            ${activityProtectionZh}
                        </div>
                        <div style="margin-top: 8px; font-size: 0.9em;">
                            動態活動（球類、武術等）<br>
                            每日時數${activityPass ? '≥' : '<'}1小時
                        </div>
                    </div>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; font-size: 0.9em;">
                    <strong>📌 評估說明：</strong><br>
                    • 久坐積分：近距離閱讀/書寫、閱讀課外讀物、靜態活動、觀看電視、使用電腦等5項活動，每項≥1小時得1分<br>
                    • 0-2分為低久坐風險，3-5分為高久坐風險<br>
                    • 動態活動≥1小時為運動達標(Pass)，<1小時為未達標(Fail)<br>
                    <br>
                    <strong>Note:</strong> Sedentary score: 5 static activities (reading, computer, TV, etc.), ≥1 hour each = 1 point. 0-2 = Low risk, 3-5 = High risk. Activity protection: Dynamic activities ≥1 hour = Pass.
                </div>
            </div>
        </div>
    `;
}


function displayResults(data, stats) {
    try { populatePersonDropdown(data); } catch (e) { console.warn('下拉選單建立失敗（Failed to create dropdown）', e); }
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) resultsDiv.style.display = 'none';
}

function toggleInputMode() {
    const uploadSection = document.getElementById('uploadSection');
    const manualSection = document.getElementById('manualInputSection');
    const toggleBtn = document.getElementById('toggleBtn');
    const processBtn = document.getElementById('processBtn');
    const personPicker = document.getElementById('personPicker');
    
    if (manualSection.style.display === 'none') {
        uploadSection.style.display = 'none';
        manualSection.style.display = 'block';
        processBtn.style.display = 'none';
        if (personPicker) personPicker.style.display = 'none';
        toggleBtn.textContent = '🔄 切換為檔案上傳\nSwitch to File Upload';
        toggleBtn.style.whiteSpace = 'pre-line'
        setButtonVisibility('manual', false);
    } else {
        uploadSection.style.display = 'block';
        manualSection.style.display = 'none';
        if (personPicker) personPicker.style.display = 'none';
        if (processBtn) processBtn.style.display = (uploadedFile ? 'block' : 'none');
        toggleBtn.textContent = '🔄 切換為手動輸入\nSwitch to Manual Input';
        toggleBtn.style.whiteSpace = 'pre-line';
        setButtonVisibility('file', false);
    }
    
    document.getElementById('results').style.display = 'none';
    document.getElementById('errorMessage').innerHTML = '';
}

// === 手動輸入：單筆分析 ===
async function analyzeSingleData() {
    try {
        document.getElementById('errorMessage').innerHTML = '';

        // 先抓 DOM element，再拿 value，避免 null.value 錯誤
        const medicalIdEl        = document.getElementById('medicalId');
        const nameEl             = document.getElementById('name');
        const ageEl              = document.getElementById('age');
        const cogScoreEl         = document.getElementById('cogScore');
        const fixation1000El     = document.getElementById('fixation1000');
        const fixation300_1000El = document.getElementById('fixation300_1000');
        const totalFixTimeEl     = document.getElementById('totalFixTime');
        const totalReadingTimeEl = document.getElementById('totalReadingTime');

        // 如果有抓不到的欄位，直接提示（避免 null.value）
        if (!medicalIdEl || !nameEl || !ageEl || !cogScoreEl ||
            !fixation1000El || !fixation300_1000El || !totalFixTimeEl || !totalReadingTimeEl) {
            alert('前端欄位 id 與 script.js 不一致，請確認 index.html 的輸入欄位 id。');
            return;
        }

        const medicalId = medicalIdEl.value.trim();
        const name      = nameEl.value.trim();
        const age       = parseInt(ageEl.value, 10);
        const cogScore  = parseFloat(cogScoreEl.value);

        const fixation1000     = parseFloat(fixation1000El.value);
        const fixation300_1000 = parseFloat(fixation300_1000El.value);
        const totalFixTime     = parseFloat(totalFixTimeEl.value);
        const totalReadingTime = parseFloat(totalReadingTimeEl.value);

        // 生活習慣（可以先當成選填，沒填就給 null）
        const nearReadingEl    = document.getElementById('nearReading');
        const extraReadingEl   = document.getElementById('extraReading');
        const staticActivityEl = document.getElementById('staticActivity');
        const dynamicActivityEl= document.getElementById('dynamicActivity');
        const tvTimeEl         = document.getElementById('tvTime');
        const computerTimeEl   = document.getElementById('computerTime');

        const nearReading    = nearReadingEl    ? (nearReadingEl.value    || null) : null;
        const extraReading   = extraReadingEl   ? (extraReadingEl.value   || null) : null;
        const staticActivity = staticActivityEl ? (staticActivityEl.value || null) : null;
        const dynamicActivity= dynamicActivityEl? (dynamicActivityEl.value|| null) : null;
        const tvTime         = tvTimeEl         ? (tvTimeEl.value         || null) : null;
        const computerTime   = computerTimeEl   ? (computerTimeEl.value   || null) : null;
        
        // 收集精確小時數（如果用戶選擇了>=1小時）
        const nearReadingHours = document.getElementById('nearReadingHours')?.value || null;
        const extraReadingHours = document.getElementById('extraReadingHours')?.value || null;
        const staticActivityHours = document.getElementById('staticActivityHours')?.value || null;
        const dynamicActivityHours = document.getElementById('dynamicActivityHours')?.value || null;
        const tvTimeHours = document.getElementById('tvTimeHours')?.value || null;
        const computerTimeHours = document.getElementById('computerTimeHours')?.value || null;

        // ===== IPAQ 身體活動量欄位（選填）=====
        const vigDayEl = document.getElementById('vigDay');
        const vigMinEl = document.getElementById('vigMin');
        const modDayEl = document.getElementById('modDay');
        const modMinEl = document.getElementById('modMin');
        const walkDayEl = document.getElementById('walkDay');
        const walkMinEl = document.getElementById('walkMin');

        const vigDay = vigDayEl?.value ? parseInt(vigDayEl.value, 10) : null;
        const vigMin = vigMinEl?.value ? parseInt(vigMinEl.value, 10) : null;
        const modDay = modDayEl?.value ? parseInt(modDayEl.value, 10) : null;
        const modMin = modMinEl?.value ? parseInt(modMinEl.value, 10) : null;
        const walkDay = walkDayEl?.value ? parseInt(walkDayEl.value, 10) : null;
        const walkMin = walkMinEl?.value ? parseInt(walkMinEl.value, 10) : null;

        // 基本必填檢查
        if (!medicalId || !name || Number.isNaN(age) || Number.isNaN(cogScore) ||
            Number.isNaN(fixation1000) || Number.isNaN(fixation300_1000) ||
            Number.isNaN(totalFixTime) || Number.isNaN(totalReadingTime)) {
            alert('請完整填寫「病歷號 / 受測者 / 年齡 / 認知總分 / 固視點 / 固視時間 / 閱讀時間」等必填欄位。');
            return;
        }

        // 組出送給後端的 data（和原本你的 key 保持一致）
        const data = {
            '病歷號': medicalId,
            '受測者': name,
            '年紀': age,
            '認知六大面向總分': cogScore,
            '較長固視點數量(1000ms以上)': fixation1000,
            '較長固視點數量 ( 300-1000 ms )': fixation300_1000,
            '總體固視時間(秒)': totalFixTime,
            '總體閱讀時間(秒)': totalReadingTime,
            '平均每天近距離閱讀或書寫的時間': nearReading,
            '平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間': extraReading,
            '平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間': staticActivity,
            '平均每天進行動態活動(如抬拳道、空手道、球類等)的時間': dynamicActivity,
            '平均每天觀看電視節目（如卡通、連續劇、電影等）的時間': tvTime,
            '平均每天使用電腦的時間': computerTime,
            // 精確小時數欄位（使用英文key以匹配後端）
            'nearReadingHours': nearReadingHours,
            'extraReadingHours': extraReadingHours,
            'staticActivityHours': staticActivityHours,
            'dynamicActivityHours': dynamicActivityHours,
            'tvTimeHours': tvTimeHours,
            'computerTimeHours': computerTimeHours,
            // IPAQ 身體活動量欄位（選填）
            'vig_day': vigDay,
            'vig_min': vigMin,
            'mod_day': modDay,
            'mod_min': modMin,
            'walk_day': walkDay,
            'walk_min': walkMin
        };

        // 🔍 Debug: 輸出即將發送的數據
        console.log('📤 前端準備發送的數據:');
        console.log('基本資料:', {
            病歷號: medicalId,
            受測者: name,
            年紀: age,
            認知六大面向總分: cogScore
        });
        console.log('眼動數據:', {
            '較長固視點數量(1000ms以上)': fixation1000,
            '較長固視點數量 ( 300-1000 ms )': fixation300_1000,
            '總體固視時間(秒)': totalFixTime,
            '總體閱讀時間(秒)': totalReadingTime
        });
        console.log('活動習慣代碼 (0=未填寫, 1=<1小時, 2=≥1小時):', {
            近距離閱讀或書寫: nearReading,
            閱讀課外讀物: extraReading,
            靜態活動: staticActivity,
            動態活動: dynamicActivity,
            觀看電視: tvTime,
            使用電腦: computerTime
        });
        console.log('精確小時數:', {
            nearReadingHours,
            extraReadingHours,
            staticActivityHours,
            dynamicActivityHours,
            tvTimeHours,
            computerTimeHours
        });
        console.log('IPAQ 身體活動資料:', {
            vig_day: vigDay,
            vig_min: vigMin,
            mod_day: modDay,
            mod_min: modMin,
            walk_day: walkDay,
            walk_min: walkMin
        });

        // 儲存到全域，給後面 download / 自動儲存用
        window.lastInputData = data;

        document.getElementById('loading').style.display = 'block';
        document.getElementById('results').style.display = 'none';

        const resp = await fetch(`${API_URL}/analyze_single`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await resp.json();
        console.log('📥 收到的結果:', result);

        if (result.success) {
            // 顯示結果
            displaySingleResult(result.data, result.decision_path);
            setButtonVisibility('manual', true);

            // 把這次分析的摘要存起來，給 JSON 匯出用
            window.lastAnalysisResult = {
                clusterName: (result.data && result.data['rule_cluster']) || '',
                habit:       (result.data && result.data['建議習慣'])   || '',
                ageBand:     (result.data && result.data['年齡層(規則)']) || ''
            };

            // ⬇️ 這一行是「按下分析就自動把加密 JSON 丟到 Docker 指定資料夾」
            autoSaveSingleJsonToServer().catch(e => console.error('自動儲存失敗', e));
        } else {
            showError(result.error || '分析失敗(Processing failed)');
        }
    } catch (err) {
        console.error(err);
        showError('連接後端失敗(Failed to connect to backend): ' + err.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

// === JSON 全加密輸出功能 ===
async function encryptWholeJSON(obj) {
    try {
        const resp = await fetch('/api/encrypt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ medicalId: JSON.stringify(obj) }) // 把整份 JSON 當成字串加密
        });
        const data = await resp.json();
        return data.encryptedId || '';
    } catch (e) {
        console.error('整份 JSON 加密失敗:', e);
        return '';
    }
}

async function downloadInputData() {
    if (!window.lastInputData) {
        alert('沒有可下載的輸入資料');
        return;
    }

    const inputData      = window.lastInputData;
    const analysisResult = window.lastAnalysisResult || {};

    const encryptedId = await encryptMedicalId(inputData['病歷號']);
    const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filenameJson = `分析報告_${encryptedId}_${timestamp}.json`;

    const activityMapping = { 0: '未填寫', 1: '<1 小時', 2: '≥1 小時' };
    const ageRangeMapping = {
        '60-64': '60-65歲',
        '65-69': '65-70歲',
        '70-74': '70-75歲',
        '75-79': '75-80歲',
        '80+':   '80歲以上'
    };

    const metrics = {
        "較長固視點數量_1000ms以上": inputData['較長固視點數量(1000ms以上)'],
        "較長固視點數量_300_1000ms": inputData['較長固視點數量 ( 300-1000 ms )'],
        "總體固視時間_秒":          inputData['總體固視時間(秒)'],
        "總體閱讀時間_秒":          inputData['總體閱讀時間(秒)']
    };

    const habitCodes = {
        "近距離閱讀或書寫":           inputData['平均每天近距離閱讀或書寫的時間'],
        "課外閱讀":                 inputData['平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間'],
        "靜態活動":                 inputData['平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間'],
        "動態活動":                 inputData['平均每天進行動態活動(如抬拳道、空手道、球類等)的時間'],
        "觀看電視":                 inputData['平均每天觀看電視節目（如卡通、連續劇、電影等）的時間'],
        "使用電腦":                 inputData['平均每天使用電腦的時間']
    };

    const dailyHabits = {};
    for (const [k, v] of Object.entries(habitCodes)) {
        const code = (v === '' || v === null || v === undefined) ? 0 : Number(v);
        dailyHabits[k] = activityMapping[code] || '未填寫';
    }

    const ageRange =
        analysisResult.ageBand && ageRangeMapping[analysisResult.ageBand]
            ? ageRangeMapping[analysisResult.ageBand]
            : null;

    const benchmarkAnalysis = {
        "年齡區間":   ageRange || '未知',
        "分群結果":   analysisResult.clusterName || '未知',
        "建議習慣":   analysisResult.habit || '未知'
    };

    const fullJSON = {
        meta: {
            version:      '1.0',
            exportedAt:   timestamp,
            encryptedId:  encryptedId
        },
        inputData,
        metrics,
        dailyHabits,
        benchmarkAnalysis,
        decisionSummary: analysisResult
    };

    const encryptedJSON = await encryptWholeJSON(fullJSON);
    if (!encryptedJSON) {
        alert('JSON 加密失敗，無法輸出');
        return;
    }

    // ✅ 這裡不再丟到伺服器，而是直接讓使用者下載
    const blob = new Blob([encryptedJSON], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filenameJson;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// 按下「分析單筆資料」後，自動把加密 JSON 丟到伺服器 (Docker 指定資料夾)
async function autoSaveSingleJsonToServer() {
    if (!window.lastInputData) return;

    const inputData      = window.lastInputData;
    const analysisResult = window.lastAnalysisResult || {};

    const encryptedId = await encryptMedicalId(inputData['病歷號']);
    const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    const activityMapping = { 0: '未填寫', 1: '<1 小時', 2: '≥1 小時' };
    const ageRangeMapping = {
        '60-64': '60-65歲',
        '65-69': '65-70歲',
        '70-74': '70-75歲',
        '75-79': '75-80歲',
        '80+':   '80歲以上'
    };

    const metrics = {
        "較長固視點數量_1000ms以上": inputData['較長固視點數量(1000ms以上)'],
        "較長固視點數量_300_1000ms": inputData['較長固視點數量 ( 300-1000 ms )'],
        "總體固視時間_秒":          inputData['總體固視時間(秒)'],
        "總體閱讀時間_秒":          inputData['總體閱讀時間(秒)']
    };

    const habitCodes = {
        "近距離閱讀或書寫":           inputData['平均每天近距離閱讀或書寫的時間'],
        "課外閱讀":                 inputData['平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間'],
        "靜態活動":                 inputData['平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間'],
        "動態活動":                 inputData['平均每天進行動態活動(如抬拳道、空手道、球類等)的時間'],
        "觀看電視":                 inputData['平均每天觀看電視節目（如卡通、連續劇、電影等）的時間'],
        "使用電腦":                 inputData['平均每天使用電腦的時間']
    };

    const dailyHabits = {};
    for (const [k, v] of Object.entries(habitCodes)) {
        const code = (v === '' || v === null || v === undefined) ? 0 : Number(v);
        dailyHabits[k] = activityMapping[code] || '未填寫';
    }

    const ageRange =
        analysisResult.ageBand && ageRangeMapping[analysisResult.ageBand]
            ? ageRangeMapping[analysisResult.ageBand]
            : null;

    const benchmarkAnalysis = {
        "年齡區間":   ageRange || '未知',
        "分群結果":   analysisResult.clusterName || '未知',
        "建議習慣":   analysisResult.habit || '未知',
        "GPT個性化建議": analysisResult.gptRecommendation || ''
    };

    const dbRecord = {
        '加密病歷號': encryptedId,
        '受測者':     inputData['受測者'] || '',
        '年紀':       inputData['年紀'] || '',
        '認知六大面向總分': inputData['認知六大面向總分'] || '',
        '分群結果':   analysisResult.clusterName || '',
        '建議習慣':   analysisResult.habit || '',
        '年齡層(規則)': analysisResult.ageBand || ''
    };

    const fullJSON = {
        meta: {
            version:      '1.0',
            exportedAt:   timestamp,
            encryptedId:  encryptedId
        },
        inputData,
        metrics,
        dailyHabits,
        benchmarkAnalysis,
        decisionSummary: analysisResult
    };

    const encryptedJSON = await encryptWholeJSON(fullJSON);
    if (!encryptedJSON) {
        console.error('JSON 加密失敗，略過自動儲存。');
        return;
    }

    const payload = {
        encryptedJSON,
        inputData: dbRecord
    };
    await saveInputDataToServer(payload);
    console.log('✅ 單筆分析結果已自動儲存到伺服器（Docker 路徑）');
}

function displaySingleResult(data, decisionPath) {
    const resultsDiv = document.getElementById('results');
    
      // 後端若有提供雙語顯示欄位就優先用
    const ruleClusterDisplay =
      data['rule_cluster_display'] ||
      (data['rule_cluster'] ? biCluster(data['rule_cluster']) : '');

    let html = `
        <div class="summary-stats">
            <h3>📊 單筆資料分析結果<br>Single Record Analysis Result</h3>
        </div>
        
        <div class="result-card">
            <h3>🎯 分群結果<br>Clustering Result</h3>
            
            <div class="person-info">
                <div class="info-item">
                  <div class="info-label">病歷號（Medical Record Number）</div>
                  <div class="info-value">${data['病歷號'] || data['編號'] || data['受測者編號'] || '—'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">年紀（Age）</div>
                    <div class="info-value">${data['年紀'] || '-'} 歲（years old）</div>
                </div>
                <div class="info-item">
                    <div class="info-label">認知六大面向總分（Total Cognitive Score）</div>
                    <div class="info-value">${parseFloat(data['認知六大面向總分\n\n'] || data['認知六大面向總分\n'] || data['認知六大面向總分'] || 0).toFixed(1)}</div>
                </div>
            </div>
        </div>
    `;
    
    if (decisionPath && decisionPath.length > 0) {
        html += generateDecisionTreeHTML(decisionPath);
    }
    
    if (data['目標群集']) {
        html += `<div class="result-card">`;
        html += generateTargetAnalysisHTML(data);
        html += `</div>`;
    }
    
    // 添加久坐與運動評估四象限分析（在IPAQ之前）
    if (data['Quadrant_has_data']) {
        html += generateQuadrantChartHTML(data);
    }
    
    // 添加IPAQ身體活動量評估結果
    if (data['IPAQ_has_data']) {
        html += `
        <div class="result-card">
            <h3>📊 IPAQ 身體活動量評估結果<br>IPAQ Physical Activity Assessment Result</h3>
        `;
        
        if (data['IPAQ_validation_error']) {
            // 如果資料驗證失敗
            html += `
                <div style="padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                    <strong>⚠️ 資料驗證失敗：</strong>${data['IPAQ_validation_error']}<br>
                    <strong>Validation Error:</strong> ${data['IPAQ_validation_error']}
                </div>
            `;
        } else {
            // 顯示活動量分級
            const activityLevel = data['IPAQ_activity_level'] || '未知';
            const activityLevelEn = data['IPAQ_activity_level_en'] || 'Unknown';
            const classificationReason = data['IPAQ_classification_reason'] || '';
            const metTotal = data['IPAQ_MET_total'] || 0;
            
            // 根據活動量級別設置顏色
            let levelColor = '#28a745'; // 綠色 - 高活動量
            if (activityLevel === '中活動量') {
                levelColor = '#ffc107'; // 黃色
            } else if (activityLevel === '低活動量') {
                levelColor = '#dc3545'; // 紅色
            }
            
            html += `
                <div style="text-align: center; margin: 20px 0;">
                    <div style="display: inline-block; padding: 20px 40px; background: ${levelColor}; color: white; border-radius: 12px; font-size: 1.5em; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        ${activityLevel}<br>
                        <span style="font-size: 0.7em; opacity: 0.9;">${activityLevelEn}</span>
                    </div>
                </div>
                
                <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; margin: 15px 0;">
                    <div style="margin-bottom: 10px;">
                        <strong>分級原因：</strong><br>
                        <strong>Classification Reason:</strong><br>
                        ${classificationReason}
                    </div>
                    <div>
                        <strong>總代謝當量：</strong>${metTotal} MET-minutes/week
                    </div>
                </div>
            `;
            
            // 顯示詳細活動數據
            if (data['IPAQ_validated_data']) {
                const validated = data['IPAQ_validated_data'];
                const metVig = data['IPAQ_MET_vigorous'] || 0;
                const metMod = data['IPAQ_MET_moderate'] || 0;
                const metWalk = data['IPAQ_MET_walking'] || 0;
                
                html += `
                    <div style="margin-top: 20px;">
                        <h4 style="color: #667eea; margin-bottom: 15px;">過去一週身體活動詳情<br>Physical Activity Details (Past Week)</h4>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #667eea; color: white;">
                                    <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">活動類型<br>Activity Type</th>
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">天數<br>Days/Week</th>
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">分鐘數<br>Minutes/Day</th>
                                    <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">MET值<br>MET Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="background: #fff;">
                                    <td style="padding: 12px; border: 1px solid #ddd;">
                                        <strong>費力/強度活動（8.0 METs）</strong><br>
                                        <small>Vigorous Activity(8.0 METs)</small>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['vig_day']} 天</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['vig_min']} 分鐘</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold; color: #e74c3c;">${metVig}</td>
                                </tr>
                                <tr style="background: #f8f9fa;">
                                    <td style="padding: 12px; border: 1px solid #ddd;">
                                        <strong>中等強度活動（4.0 METs）</strong><br>
                                        <small>Moderate Activity(4.0 METs)</small>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['mod_day']} 天</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['mod_min']} 分鐘</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold; color: #f39c12;">${metMod}</td>
                                </tr>
                                <tr style="background: #fff;">
                                    <td style="padding: 12px; border: 1px solid #ddd;">
                                        <strong>步行活動（3.3 METs）</strong><br>
                                        <small>Walking(3.3 METs)</small>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['walk_day']} 天</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${validated['walk_min']} 分鐘</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold; color: #3498db;">${metWalk}</td>
                                </tr>
                                <tr style="background: #667eea; color: white; font-weight: bold;">
                                    <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid #ddd;">總計 Total:</td>
                                    <td style="padding: 12px; text-align: center; border: 1px solid #ddd; font-size: 1.2em;">${metTotal}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                `;
            }
        }
        
        html += `</div>`;
    }
    
    // 添加GPT個性化建議區塊
    if (data['GPT建議']) {
        html += `
        <div class="result-card">
            <h3>💡 個性化健康建議<br>Personalized Health Recommendations</h3>
            <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; line-height: 1.8;">
                <p style="white-space: pre-wrap; margin: 0;">${data['GPT建議']}</p>
            </div>
            <div style="margin-top: 15px; padding: 10px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px; font-size: 0.9em;">
                <strong>📌 說明：</strong>以上建議基於世界衛生組織(WHO)身體活動指引及您的個人數據生成<br>
                <strong>Note:</strong> The above recommendations are generated based on WHO physical activity guidelines and your personal data
            </div>
        </div>
        `;
    }
    
    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';

    window.lastAnalysisResult = {
        data: data,
        decisionPath: decisionPath,
        cluster: data.rule_cluster || '未分類',
        habit: data['建議習慣'] || '無建議',
        ageBand: data['年齡層(規則)'] || '未知',
        gptRecommendation: data['GPT建議'] || ''
    };
}

function generateDecisionTreeHTML(decisionPath) {
    let html = `
        <div class="result-card">
            <div class="decision-tree-container">
                <h4>🌳 人工智慧決策過程<br>AI Decision Process</h4>
                <div class="tree-visualization">
    `;
    
    decisionPath.forEach((step, index) => {
        const isLast = index === decisionPath.length - 1;
        const nodeClass = isLast ? 'result active' : 'decision active';
        
        html += `
            <div class="tree-level">
                <div class="tree-node ${nodeClass}">
                    <div class="node-label">
                        ${isLast ? '✓ 最終結果（Final Result）' : `第 ${step.level} 層決策（Decision Level ${step.level}）`}
                        ${step.branch ? `<span class="branch-info">${step.branch === 'high' ? '高（High）' : '低（Low）'}</span>` : ''}
                    </div>
                    <div class="node-value">
                        ${step.condition || step.result}
                    </div>
                    ${step.value ? `<div class="node-value" style="margin-top: 5px; color: #e74c3c; font-weight: bold;">實際值（Actual Value）: ${step.value}</div>` : ''}
                </div>
            </div>
        `;
        
        if (!isLast) {
            html += `
                <div class="tree-arrow">
                    ↓
                </div>
            `;
        }
    });
    
    html += `
                </div>
                
                <div class="tree-image-container">
                    <h4 style="margin-top: 30px; color: #667eea;">完整分群流程圖<br>Complete Clustering Flowchart</h4>
                    <p style="color: #666; margin-bottom: 15px;">以下是完整的決策樹邏輯圖<br>The following is the complete decision tree logic diagram</p>
                    <img src="/static/decision_tree.png" alt="分群流程示意圖（Clustering Flow Illustration）" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <p style="display: none; color: #999; font-style: italic;">（流程圖圖片未找到，請確保 decision_tree.png 存在於 static 資料夾中）<br>(Flowchart image not found. Please ensure decision_tree.png exists in the static folder.)</p>
                </div>
            </div>
        </div>
    `;
    
    return html;
}


// 安全取數字：支援精確鍵、trim 後鍵、以及「多一個尾空白」的舊鍵
function getNumSafe(row, key) {
  const tryKeys = [key, key.trim(), key.trim() + ' ', key + ' '];
  for (const k of tryKeys) {
    if (k in row && row[k] !== '' && row[k] != null) {
      const v = parseFloat(row[k]);
      if (!Number.isNaN(v)) return v;
    }
  }
  return NaN;
}

// 好看一點的數字格式：整數顯示整數，小數才顯示到 2 位
function fmt(n) {
  if (Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function generateTargetAnalysisHTML(row) {
    const targetCluster = row['目標群集'] || row['目標群集\n'] || row['目標群集\n\n'];
    const ageBand = getAgeBand(row);
    
    if (!targetCluster) {
        return '';
    }
    
    console.log('Row keys:', Object.keys(row).filter(k => k.includes('目標')));
    
    // 取得目標認知分數（優先使用後端計算的值，否則用前端計算）
    let targetScore = row['目標群集認知分數'] || row['目標群集認知分數\n'] || row['目標群集認知分數\n\n'];
    
    if (targetScore == null) {
        targetScore = getTopScoreForAgeBand(ageBand);
    }
    
    // 取得該受測者的群集名稱（從決策樹結果）
    const decisionPath = buildDecisionPath(row);
    const lastStep = decisionPath[decisionPath.length - 1];
    const userCluster = lastStep.result || '';

        // ===== NEW ①：若「使用者認知總分 > 年齡層最高分」，強制所有活動視為已達標 =====
    const userScore = parseFloat(readScore(row));      // 你原本已有 readScore(row)
    const ageTop = (targetScore != null) ? Number(targetScore) : getTopScoreForAgeBand(ageBand);
    const forceAllAchieved = (!Number.isNaN(userScore) && !Number.isNaN(ageTop) && userScore > ageTop);
    
    console.log('Debug - userCluster:', userCluster); // 除錯用
    
    // 根據群集取得對應的活動欄位（只顯示該群集建議的活動）
    const clusterActivityMap = {
        "專注閱讀型": [
            "平均每天近距離閱讀或書寫的時間",
            "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間"
        ],
        "高效靜態型": [
            "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間"
        ],
        "動態提升型": [
            "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間"
        ],
        "複合活動型": [
            "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間",
            "平均每天近距離閱讀或書寫的時間",
            "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間"
        ],
        "靜態閱讀型": [
            "平均每天近距離閱讀或書寫的時間",
            "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間",
            "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間"
        ],
        "數位使用型": [
            "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間",
            "平均每天使用電腦的時間"
        ],
        "螢幕觀賞型": [
            "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間"
        ]
    };
    
    
    // 取得該群集建議的活動欄位
    const relevantFields = clusterActivityMap[userCluster] || [];
    
    if (relevantFields.length === 0) {
        console.warn('找不到群集對應的活動欄位，群集名稱:', userCluster);
        return `
            <div class="target-analysis">
                <h4>🎯 與目標群集「${targetCluster}」的比較<br>Comparison with Target Cluster "${targetCluster}"</h4>
                <p style="color: #999;">無法判定群集類型（${userCluster}），無法顯示建議活動<br>Unable to determine cluster type (${userCluster}), cannot display suggested activities</p>
            </div>
        `;
    }
    
    let html = `
        <div class="target-analysis">
            <h4>🎯 與目標群集「${targetCluster}」的比較<br>Comparison with Target Cluster "${targetCluster}"</h4>
            <div style="margin-bottom: 15px; padding: 10px; background: #f0f4ff; border-radius: 8px;">
                <strong>該年齡層最佳認知分數：</strong> <b>${targetScore != null ? Number(targetScore).toFixed(1) : '—'}</b><br><strong>Top cognitive score for this age band:</strong> <b>${targetScore != null ? Number(targetScore).toFixed(1) : '—'}</b>
            </div>
            <div style="margin-bottom: 12px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                <strong>📋 您的群集類型：</strong> ${userCluster}<br><strong>Your cluster type:</strong> ${CLUSTER_EN[userCluster] || userCluster}
            </div>
            ${forceAllAchieved ? `
            <div style="margin-bottom: 12px; padding: 10px; background: #eafaf1; border-left: 4px solid #28a745; border-radius: 4px;">
                ✅ <strong>已達高分：</strong>您的認知總分已為高分，因此本區所有活動皆視為<b>已達標</b>，無需進一步建議。<br><strong>High Score Achieved:</strong> Your cognitive total score is already high, so all activities in this section are considered <b>Achieved</b>, no further suggestions needed.
            </div>` : ``}
    `;
    console.log('所有欄位名稱:', Object.keys(row));
    console.log('目標群集:', targetCluster);
    console.log('受測者群集:', userCluster);
    console.log('相關活動欄位:', relevantFields);

    relevantFields.forEach(field => {
        const targetKey = `${field}_目標值`;
        console.log(`檢查 ${field}:`, {
            current: row[field],
            targetKey: targetKey,
            targetValue: row[targetKey],
            allMatchingKeys: Object.keys(row).filter(k => k.includes('目標值'))
        });
    });
    relevantFields.forEach((field) => {
        const current = getNumSafe(row, field);
        const target = getNumSafe(row, `${field}_目標值`);
        const gap = (!Number.isNaN(current) && !Number.isNaN(target)) ? (current - target) : NaN;
        
         // ===== NEW ②：若 forceAllAchieved，直接覆寫為「已達標」
        const computedStatus = (!Number.isNaN(current) && !Number.isNaN(target))
            ? (current >= target ? '已達標（Achieved）' : '未達標（Not Achieved）')
            : '—';
        const status = forceAllAchieved ? '已達標（Achieved）' : computedStatus;

        const statusClass = status === '已達標（Achieved）' ? 'status-achieved' :
                            status === '未達標（Not Achieved）' ? 'status-not-achieved' : '';

        // ===== NEW ③：forceAllAchieved 時，隱藏「差距」與「建議」內容
        const showGap = !forceAllAchieved && !Number.isNaN(gap);
        const showAdvice = !forceAllAchieved && (status === '未達標（Not Achieved）') && !Number.isNaN(gap);

        html += `
            <div class="gap-item" style="border-left: 3px solid ${status === '已達標（Achieved）' ? '#28a745' : '#dc3545'}; padding-left: 12px; margin-bottom: 15px;">
                <div>
                    <span class="gap-label" style="font-weight: 600; color: #333;">${field}</span>
                    <div style="font-size: 0.95em; color: #666; margin-top: 6px;">
                        當前（Current）: <strong>${fmt(current)}</strong> | 目標（Target）: <strong>${fmt(target)}</strong>
                    </div>
                    ${showAdvice ? `
                      <div style="font-size: 0.95em; color: #e74c3c; margin-top: 8px; padding: 8px; background: #fee; border-radius: 6px; font-weight: 500;">
                          <span style="font-size: 1.1em;">💡</span> 建議：每日可多進行該項活動 1 小時<br>Advice: Increase this activity by 1 hour per day
                      </div>` : ``}
                    ${forceAllAchieved ? `
                      <div style="font-size: 0.95em; color: #2e7d32; margin-top: 8px;">
                          ✅ 已達高分，故本項<b>已達標</b>，無需進一步建議<br>High score achieved; this item is <b>marked as achieved</b>, no further advice needed
                      </div>` : ``}
                </div>
                <div style="text-align: right;">
                    <div class="gap-value ${statusClass}" style="font-size: 1.05em; font-weight: 600;">${status}</div>
                    ${showGap ? `
                      <div style="font-size: 0.9em; margin-top: 5px; color: ${gap >= 0 ? '#28a745' : '#dc3545'};">
                          差距（Gap）: ${(gap > 0 ? '+' : '')}${fmt(gap)}
                    </div>` : ``}
                </div>
            </div>
            
        `;
    });
    

    html += `</div>`;
    return html;
}

function renderSinglePersonView(row, index, stats) {
  const resultsDiv = document.getElementById('results');
  if (!resultsDiv) return;

  const name = row['受測者\n姓名'] || row['受測者姓名'] || '未提供姓名';
  const idField = getIdFieldName(row);
  const idVal = idField ? (row[idField] ?? '-') : '-';

  let html = `

  `;


  html += `
      </div>
    </div>

    <div class="result-card">
      <h3>🎯 分群結果<br>Clustering Result</h3>

      <div class="person-info">
        <div class="info-item">
          <div class="info-label">受測者姓名（Name）</div>
          <div class="info-value">${name}</div>
        </div>
        <div class="info-item">
          <div class="info-label">病歷號（ID）</div>
          <div class="info-value">${idVal}</div>
        </div>
        <div class="info-item">
          <div class="info-label">年紀（Age）</div>
          <div class="info-value">${row['年紀'] || '-'} 歲（years old）</div>
        </div>
        <div class="info-item">
          <div class="info-label">認知六大面向總分（Total Cognitive Score）</div>
          <div class="info-value">${parseFloat(row['認知六大面向總分\n\n'] || row['認知六大面向總分\n'] || row['認知六大面向總分'] || 0).toFixed(1)}</div>
        </div>
      </div>
    </div>
  `;

  const decisionPath = buildDecisionPath(row);
  
  if (decisionPath && decisionPath.length > 0) {
    html += generateDecisionTreeHTML(decisionPath);
  }

  if (row['目標群集']) {
    html += `<div class="result-card">`;
    html += generateTargetAnalysisHTML(row);
    html += `</div>`;
  }

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

function getAgeBand(row) {
  const band = (row['年齡層'] || '').toString().trim();
  if (band) return band;

  const age = parseFloat(row['年紀'] || row['年齡'] || '');
  if (!isNaN(age)) {
    if (age < 60) return '<60歲';
    if (age <= 70) return '60-70歲';
    if (age <= 79) return '71-79歲';
  }
  return '';
}

function getTopScoreForAgeBand(ageBand) {
  if (!ageBand || !Array.isArray(analysisResults)) return null;
  let top = null;
  for (const r of analysisResults) {
    if (getAgeBand(r) === ageBand) {
      const sRaw = readScore(r);     
      const s = parseFloat(sRaw);
      if (!isNaN(s)) top = (top == null) ? s : Math.max(top, s);
    }
  }
  return top;
}

function num(v) {
  const x = parseFloat(
    (v ?? '')
      .toString()
      .replace(/[^\d\.\-]/g, '')
  );
  return isNaN(x) ? NaN : x;
}

function buildDecisionPath(row) {
  const path = [];
  const ageBand = getAgeBand(row);

  const fix1000 = num(row['較長固視點數量(1000ms以上)'] ?? row['較長固視點數量 ( 1000 ms以上 )  '] ?? row['較長固視點(1000ms+)']);
  const totalFixTime = num(row['總體固視時間(秒)'] ?? row['總固定視時間(秒)']);
  const totalReading = num(row['總體閱讀時間(秒)'] ?? row['總閱讀時間(秒)']);

  function pushDecision(level, label, featureValue, threshold, comparatorSymbol, branchType) {
    path.push({
      level,
      condition: `${label} ${comparatorSymbol} ${threshold}`,
      value: isNaN(featureValue) ? '-' : featureValue.toFixed(2),
      branch: branchType
    });
  }

  let finalResult = '未分類';

  if (ageBand === '<60歲') {
    if (!isNaN(fix1000)) {
      const branch = fix1000 >= 0.87 ? 'high' : 'low';
      pushDecision(1, '較長固視點(1000ms+)', fix1000, 0.87, '≥', branch);
      finalResult = fix1000 >= 0.87 ? '專注閱讀型' : '高效靜態型';
    } else {
      path.push({ level: 1, condition: '較長固視點(1000ms+) 不可用', value: '-', branch: undefined });
    }

  } else if (ageBand === '60-70歲') {
    if (!isNaN(totalFixTime)) {
      const branch = totalFixTime >= 44.16 ? 'high' : 'low';
      pushDecision(1, '總體固視時間(秒)', totalFixTime, 44.16, '≥', branch);
      finalResult = totalFixTime >= 44.16 ? '動態提升型' : '複合活動型';
    } else {
      path.push({ level: 1, condition: '總體固視時間(秒) 不可用', value: '-', branch: undefined });
    }

  } else if (ageBand === '71-79歲') {
    let lvl = 1;
    if (!isNaN(fix1000)) {
      const branch1 = fix1000 >= 4.61 ? 'high' : 'low';
      pushDecision(lvl++, '較長固視點(1000ms+)', fix1000, 4.61, '≥', branch1);

      if (fix1000 >= 4.61) {
        if (!isNaN(totalReading)) {
          const branch2 = totalReading >= 127.66 ? 'high' : 'low';
          pushDecision(lvl, '總體閱讀時間(秒)', totalReading, 127.66, '≥', branch2);
          finalResult = totalReading >= 127.66 ? '靜態閱讀型' : '數位使用型';
        } else {
          path.push({ level: lvl, condition: '總體閱讀時間(秒) 不可用', value: '-', branch: undefined });
          finalResult = '靜態閱讀型';
        }
      } else {
        finalResult = '螢幕觀賞型';
      }
    } else {
      path.push({ level: 1, condition: '較長固視點(1000ms+) 不可用', value: '-', branch: undefined });
    }

  } else {
    path.push({ level: 1, condition: '年齡層無法判定，略過前端決策示意', value: '-', branch: undefined });
  }

  path.push({
    result: finalResult
  });

  return path;
}

function downloadCSV() {
    if (outputFilename) {
        window.location.href = `${API_URL}/download/${outputFilename}`;
    } else {
        alert('沒有可下載的檔案（No file available for download）');
    }
}
// ===== 只匯出「結果區塊」為圖片 =====
async function exportResultImage() {
  const resultsDiv = document.getElementById('results');

  // 沒有結果就不截
  if (!resultsDiv || resultsDiv.style.display === 'none' || !resultsDiv.innerHTML.trim()) {
    alert('目前沒有可匯出的結果！（No results available for export!）');
    return;
  }

  try {
    // 用 html2canvas 只截 #results 這個區塊
    const canvas = await html2canvas(resultsDiv, {
      scale: 2,              // 解析度可自己調，大一點比較清晰
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    // 轉成 Blob，讓瀏覽器直接下載
    canvas.toBlob((blob) => {
      if (!blob) {
        alert('匯出圖片失敗：無法產生圖片 Blob');
        return;
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `single_result_${ts}.png`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (err) {
    console.error(err);
    alert('匯出圖片失敗：' + (err?.message || err));
  }
}



// 將輸入資料儲存到伺服器
async function saveInputDataToServer(data) {
    try {
        const response = await fetch(`${API_URL}/save_input_data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('✅ 資料已儲存到伺服器:', result.filename);
            console.log('📂 儲存路徑:', result.filepath);
        } else {
            console.error('❌ 儲存失敗:', result.error);
        }
    } catch (error) {
        console.error('❌ 儲存到伺服器失敗:', error);
    }
}

// 把決策樹 .node-value 改成「中文<br>English」
(function bilingualizeDecisionNodes() {
  const METRIC_MAP = [
    { re: /較長固視點.*1000.*ms/i, zh: '較長固視點(1000ms+)', en: 'Long Fixation Count (≥1000 ms)' },
    { re: /總體固視時間.*秒?/i,     zh: '總體固視時間(秒)',     en: 'Total Fixation Time (s)' },
    { re: /總體閱讀時間.*秒?/i,     zh: '總體閱讀時間(秒)',     en: 'Total Reading Time (s)' },
  ];

  function toBilingual(text) {
    if (!text) return text;
    if (text.includes('<br>')) return text;

    // 群集名稱
    if (typeof CLUSTER_EN === 'object' && CLUSTER_EN[text]) {
      return `${text}<br>${CLUSTER_EN[text]}`;
    }

    if (/年齡層無法判定/.test(text)) return `年齡層無法判定<br>Age band unavailable`;
    if (/資料缺失|不可用/.test(text)) return `資料缺失<br>data missing`;

    // 指標 + 比較符號 + 數值
    const metric = METRIC_MAP.find(m => m.re.test(text));
    if (metric) {
      const op = (text.match(/[≥≧>|=|≤<]/) || [''])[0];
      const num = (text.match(/-?\d+(?:\.\d+)?/) || [''])[0];
      const zhUnit = /秒/.test(text) ? '秒' : '';
      const enUnit = /秒/.test(text) ? 's'  : '';
      if (op && num) {
        return `${metric.zh} ${op} ${num}${zhUnit}<br>${metric.en} ${op} ${num}${enUnit}`;
      }
      return `${metric.zh}<br>${metric.en}`;
    }

    const generic = text.match(/^(.+?)\s*(≥|≧|>|=|≤|<)\s*(-?\d+(?:\.\d+)?)(.*)$/);
    if (generic) {
      const [, lhs, op, num, tail] = generic;
      return `${lhs} ${op} ${num}${tail || ''}<br>${lhs} ${op} ${num}`;
    }

    return text; 
  }

  function upgrade() {
    const root = document.getElementById('results');
    if (!root) return;
    root.querySelectorAll('.decision-tree-container .node-value').forEach(el => {
      const raw = el.innerText.trim();
      if (!raw || el.innerHTML.includes('<br>')) return;
      const bi = toBilingual(raw);
      if (bi && bi !== raw) el.innerHTML = bi;
    });
  }

  upgrade();
  const target = document.getElementById('results');
  if (target) {
    new MutationObserver(upgrade).observe(target, { childList: true, subtree: true, attributes: true });
  }
})();

(function bilingualizeBestPerformer() {
  const target = document.getElementById('results');
  if (!target) return;

  function replaceBestPerformer() {
    target.querySelectorAll('h4').forEach(h4 => {
      if (h4.innerHTML.includes('最佳表現者') && !h4.innerHTML.includes('Target Top Performer')) {
        h4.innerHTML = h4.innerHTML.replace(/最佳表現者/g, '最佳表現者（Target Top Performer）');
      }
    });
  }

  replaceBestPerformer();

  new MutationObserver(replaceBestPerformer).observe(target, { childList: true, subtree: true });
})();
