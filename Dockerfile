# 使用 Python 3.11 作為基礎映像
FROM python:3.11-slim

# 設定工作目錄
WORKDIR /app

# 安裝系統依賴
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

# 複製 requirements.txt 並安裝套件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製所有應用程式檔案
COPY app.py .
COPY static/ ./static/

# 建立必要的資料夾
RUN mkdir -p uploads outputs models

# 暴露 Flask 的埠號
EXPOSE 5002

# 設定環境變數
ENV PYTHONUNBUFFERED=1

# 啟動應用程式
CMD ["python", "app.py"]