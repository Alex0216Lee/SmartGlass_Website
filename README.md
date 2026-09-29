# 智慧眼鏡數據分析系統

整合性閱讀認知分群系統 (AI READ-COGN EYE)，透過眼動追蹤數據和認知評估，提供個人化的閱讀習慣建議。

[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)
[![Python](https://img.shields.io/badge/Python-3.11-green)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-red)](https://flask.palletsprojects.com/)

## 📋 目錄

- [功能特色](#-功能特色)
- [系統架構](#-系統架構)
- [快速開始](#-快速開始)
- [使用說明](#-使用說明)
- [技術棧](#-技術棧)
- [專案結構](#-專案結構)
- [常見問題](#-常見問題)

## ✨ 功能特色

### 📊 資料分析
- **CSV 批次上傳**：支援大量受測者資料的批次分析
- **手動輸入**：提供單筆資料的即時分析功能
- **智能分群**：基於決策樹演算法的認知類型分類

### 🎯 個人化建議
- **GPT智能建議**：使用GPT API根據WHO指引生成個性化健康建議
- **同齡比較**：與同年齡層最佳表現者進行比較
- **達標分析**：清楚顯示各項活動的達標狀態
- **習慣建議**：根據分群結果提供具體的生活習慣建議

### 🔄 決策可視化
- **決策樹展示**：清晰呈現 AI 的判斷過程
- **分步推理**：展示每個決策節點的判斷依據
- **結果解釋**：提供易於理解的分析結果

### 💾 資料管理
- **結果下載**：支援分析結果的 CSV 匯出
- **資料持久化**：上傳和輸出資料自動保存
- **安全隔離**：Docker 容器化確保環境一致性

## 🏗️ 系統架構

```
┌─────────────────────────────────────────────────────┐
│                   使用者介面                          │
│          (HTML/CSS/JavaScript)                       │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP API
┌──────────────────▼──────────────────────────────────┐
│               Flask 後端服務                          │
│   ┌─────────────────────────────────────────┐      │
│   │  • CSV 處理與驗證                        │      │
│   │  • 決策樹分群演算法                       │      │
│   │  • 同齡比較與達標分析                     │      │
│   │  • 個人化建議生成                         │      │
│   └─────────────────────────────────────────┘      │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│            Docker 容器化環境                          │
│  • Python 3.11 運行環境                              │
│  • 科學計算套件 (NumPy, Pandas, Scikit-learn)       │
│  • 資料持久化 (Volume Mounts)                       │
└─────────────────────────────────────────────────────┘
```

## 🚀 快速開始

### 前置需求

- **Docker Desktop** (版本 20.10 或更高)
  - [Windows/Mac 下載](https://www.docker.com/products/docker-desktop)
- **Docker Compose** (通常隨 Docker Desktop 一起安裝)

### 安裝步驟

#### 1. Clone 專案

```bash
git clone https://github.com/Alex0216Lee/SmartGlass_2025.git
cd SmartGlass_2025
```

#### 2. 建立必要目錄

**Windows (PowerShell):**
```powershell
mkdir uploads, outputs, models
```

**Mac/Linux (Terminal):**
```bash
mkdir -p uploads outputs models
```

#### 3. 配置環境變數

```bash
# 複製環境變數範例文件
cp .env.example .env

# 編輯 .env 文件，填入你的 OpenAI API 密鑰
# OPENAI_API_KEY=your_openai_api_key_here
# ENCRYPT_KEY=your_encrypt_key_here
```

**重要提示：**
- 請前往 [OpenAI Platform](https://platform.openai.com/) 註冊並獲取 API 密鑰
- ENCRYPT_KEY 需要是 32 字節的 base64 編碼字符串
- 不要將 .env 文件提交到版本控制系統

#### 4. 啟動服務

```bash
# 構建並啟動容器（前景執行）
docker-compose up --build

# 或在背景執行
docker-compose up --build -d
```

#### 5. 訪問應用程式

開啟瀏覽器，前往：
```
http://localhost:5002
```

看到以下畫面代表啟動成功：

```
============================================================
🚀 啟動智慧眼鏡數據分析系統後端服務
============================================================
網頁地址: http://localhost:5002
============================================================
```

## 📖 使用說明

### 方式一：CSV 批次上傳

1. **準備 CSV 檔案**
   
   CSV 檔案需包含以下欄位：
   - 年紀
   - 認知六大面向總分
   - 較長固視點數量 (1000ms以上)
   - 較長固視點數量 (300-1000ms)
   - 總體固視時間(秒)
   - 總體閱讀時間(秒)
   - 每日生活習慣相關欄位（選填）

2. **上傳分析**
   - 點擊「選擇檔案」或拖曳 CSV 檔案
   - 點擊「開始分析」按鈕
   - 等待處理完成

3. **查看結果**
   - 選擇受測者編號
   - 查看分群結果和個人建議
   - 下載完整分析報告

### 方式二：手動輸入單筆資料

1. **切換輸入模式**
   
   點擊「🔄 切換為手動輸入」按鈕

2. **填寫資料**
   
   必填欄位：
   - 年齡 (0-79歲)
   - 認知六大面向總分
   - 固視相關數據
   - 閱讀時間數據

   選填欄位（用於個人建議）：
   - 6 項每日生活習慣

3. **分析與查看**
   
   點擊「🔍 分析單筆資料」查看結果

### 分群類型說明

系統會根據年齡層和眼動數據將受測者分為以下類型：

#### < 60 歲
- **專注閱讀型**：建議增加近距離閱讀或書寫、閱讀課外讀物
- **高效靜態型**：建議增加靜態活動（音樂、作文、下棋等）

#### 60-70 歲
- **動態提升型**：建議增加動態活動（運動、球類等）
- **複合活動型**：建議均衡發展動態活動與閱讀習慣

#### 71-79 歲
- **靜態閱讀型**：建議保持閱讀和靜態活動習慣
- **數位使用型**：建議平衡觀看電視與使用電腦的時間
- **螢幕觀賞型**：建議增加非螢幕類活動

## 🛠️ 技術棧

### 後端
- **Python 3.11**
- **Flask 3.0** - Web 框架
- **Pandas** - 資料處理
- **NumPy** - 數值運算
- **Scikit-learn** - 機器學習
- **Flask-CORS** - 跨域請求處理

### 前端
- **HTML5** - 頁面結構
- **CSS3** - 樣式設計
- **Vanilla JavaScript** - 互動邏輯
- **Fetch API** - 後端通訊

### 部署
- **Docker** - 容器化
- **Docker Compose** - 服務編排

## 📁 專案結構

```
SmartGlass_2025/
│
├── 📄 app.py                      # Flask 後端主程式
├── 📄 requirements.txt            # Python 依賴套件
├── 📄 Dockerfile                  # Docker 映像配置
├── 📄 docker-compose.yml          # Docker Compose 配置
├── 📄 .dockerignore               # Docker 忽略檔案
├── 📄 .gitignore                  # Git 忽略檔案
├── 📄 README.md                   # 專案說明文件
│
├── 📁 static/                     # 前端靜態資源
│   ├── index.html                # 主頁面
│   ├── script.js                 # JavaScript 邏輯
│   ├── style.css                 # 樣式表
│   └── logo.jpg                  # Logo 圖片
│
├── 📁 uploads/                    # CSV 上傳目錄（自動建立）
├── 📁 outputs/                    # 分析結果輸出目錄（自動建立）
└── 📁 models/                     # 機器學習模型目錄（自動建立）
```

## 🔧 進階配置

### 修改服務埠號

編輯 `docker-compose.yml`：

```yaml
services:
  web:
    ports:
      - "8080:5002"  # 將 8080 改為你想要的埠號
```

### 環境變數設定

在 `docker-compose.yml` 中添加：

```yaml
environment:
  - FLASK_ENV=production
  - MAX_UPLOAD_SIZE=50M
  - DEBUG=False
```

### 資料備份

```bash
# 備份上傳和輸出資料
tar -czf backup-$(date +%Y%m%d).tar.gz uploads/ outputs/

# 還原資料
tar -xzf backup-20250101.tar.gz
```

## 📊 常用指令

### Docker 操作

```bash
# 啟動服務（前景）
docker-compose up

# 啟動服務（背景）
docker-compose up -d

# 查看運行狀態
docker-compose ps

# 查看日誌
docker-compose logs -f

# 停止服務
docker-compose down

# 重新構建（修改程式碼後）
docker-compose up --build

# 完全重置（刪除所有容器和映像）
docker-compose down --rmi all
```

### 進入容器除錯

```bash
# 進入容器 shell
docker-compose exec web bash

# 查看容器內檔案
docker-compose exec web ls -la

# 查看 Python 版本
docker-compose exec web python --version
```

## ❓ 常見問題

### Q1: 埠號 5002 被佔用怎麼辦？

**A:** 修改 `docker-compose.yml` 中的埠號映射：

```yaml
ports:
  - "5003:5002"  # 改用 5003 或其他未使用的埠號
```

然後訪問 `http://localhost:5003`

### Q2: Docker 容器無法啟動？

**A:** 檢查以下項目：

1. Docker Desktop 是否正在運行
2. 查看詳細錯誤：`docker-compose logs`
3. 嘗試重新構建：`docker-compose down && docker-compose up --build`

### Q3: 修改程式碼後沒有生效？

**A:** 需要重新構建容器：

```bash
docker-compose down
docker-compose up --build
```

### Q4: 上傳的檔案找不到？

**A:** 檢查 `uploads/` 目錄是否存在，並確認檔案權限：

```bash
mkdir -p uploads outputs models
chmod 755 uploads outputs models
```

### Q5: 如何查看容器內的錯誤訊息？

**A:** 使用以下指令查看日誌：

```bash
# 即時查看
docker-compose logs -f

# 查看最近 100 行
docker-compose logs --tail=100
```

### Q6: CSV 檔案格式有什麼要求？

**A:** 
- 編碼：UTF-8、Big5 或 CP950
- 格式：標準 CSV（逗號分隔）
- 必要欄位：年紀、認知分數、眼動追蹤相關數據

### Q7: 可以在沒有 Docker 的環境運行嗎？

**A:** 可以，但需要手動安裝 Python 環境：

```bash
# 安裝依賴
pip install -r requirements.txt

# 啟動服務
python app.py
```

## 🤝 貢獻指南

歡迎貢獻！請遵循以下步驟：

1. **Fork 專案**
2. **建立功能分支** (`git checkout -b feature/AmazingFeature`)
3. **提交變更** (`git commit -m 'Add some AmazingFeature'`)
4. **推送到分支** (`git push origin feature/AmazingFeature`)
5. **開啟 Pull Request**

### 開發建議

- 遵循 PEP 8 Python 編碼規範
- 為新功能添加測試
- 更新相關文檔
- 確保 Docker 容器可以正常構建

## 🔒 資料隱私

- 所有資料處理均在本地 Docker 容器中進行
- 不會上傳任何資料到外部伺服器
- 上傳的檔案僅保存在本地 `uploads/` 目錄


## 🙏 致謝

感謝所有為本專案做出貢獻的開發者和使用者！

---

<div align="center">

**如果這個專案對你有幫助，請給一個 ⭐ Star！**

Made with ❤️ by Alex Lee

</div>