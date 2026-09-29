from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import os
import joblib
import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import Dict, List, Optional
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import re, json
from werkzeug.utils import secure_filename
import traceback
from datetime import datetime
import base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from openai import OpenAI
from dotenv import load_dotenv

# 載入環境變數
load_dotenv()

app = Flask(__name__)
CORS(app)

# 設定資料夾
UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
MODEL_FOLDER = 'models'
STATIC_FOLDER = 'static'

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER, MODEL_FOLDER, STATIC_FOLDER]:
    os.makedirs(folder, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# ================== 配置 ==================
# ================== 分群顯示對應表 ==================
LVL1_NAME_MAP = {
    0: "專注閱讀型",
    1: "高效靜態型",
    2: "動態提升型",
    3: "複合活動型",
}
LVL2_NAME_MAP = {
    0: "靜態閱讀型",
    1: "數位使用型",
    2: "螢幕觀賞型",
}

DISPLAY_CLUSTER_HABITS = {
    "專注閱讀型": "近距離閱讀或書寫／閱讀課外讀物",
    "高效靜態型": "進行靜態活動",
    "動態提升型": "進行動態活動",
    "複合活動型": "進行動態活動／近距離閱讀或書寫／閱讀課外讀物",
    "靜態閱讀型": "近距離閱讀或書寫／閱讀課外讀物／進行靜態活動",
    "數位使用型": "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間／使用電腦",
    "螢幕觀賞型": "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間",
}

# 活動欄位清單
ACTIVITY_FIELDS = [
    "平均每天近距離閱讀或書寫的時間",
    "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間",
    "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間",
    "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間",
    "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間",
    "平均每天使用電腦的時間",
]

# IPAQ (國際身體活動問卷) 欄位清單 - 選填
IPAQ_FIELDS = [
    "vig_day",    # 一週內，有幾天進行費力的身體活動
    "vig_min",    # 平均每天進行幾分鐘費力的身體活動
    "mod_day",    # 一週內，有幾天進行中等強度的身體活動
    "mod_min",    # 平均每天進行幾分鐘中等強度的身體活動
    "walk_day",   # 一週內，有幾天進行步行活動
    "walk_min",   # 平均每天步行幾分鐘
]
# -------------------- 固定目標值 --------------------
AGE_GROUP_TARGETS = {
    '<60歲': {
        "平均每天近距離閱讀或書寫的時間": 1,
        "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間": 1,
        "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間": 1,
        "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間": 2,
        "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間": 2,
        "平均每天使用電腦的時間": 2,
        "最高認知分數": 98.81,
        "代表年齡": 37,
    },
    '60-70歲': {
        "平均每天近距離閱讀或書寫的時間": 2,
        "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間": 2,
        "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間": 2,
        "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間": 2,
        "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間": 2,
        "平均每天使用電腦的時間": 1,
        "最高認知分數": 98.16,
        "代表年齡": 65,
    },
    '71-79歲': {
        "平均每天近距離閱讀或書寫的時間": 1,
        "平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間": 1,
        "平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間": 1,
        "平均每天進行動態活動(如抬拳道、空手道、球類等)的時間": 2,
        "平均每天觀看電視節目（如卡通、連續劇、電影等）的時間": 2,
        "平均每天使用電腦的時間": 1,
        "最高認知分數": 92.41,
        "代表年齡": 73,
    },
}

def get_age_group(age: int) -> str:
    if age < 60:
        return '<60歲'
    elif age <= 70:
        return '60-70歲'
    elif age <= 79:
        return '71-79歲'
    else:
        return '<60歲'  # 預設

def get_target_values(age: int) -> Dict[str, int]:
    age_group = get_age_group(age)
    targets = AGE_GROUP_TARGETS.get(age_group, AGE_GROUP_TARGETS['<60歲'])
    return {field: targets[field] for field in ACTIVITY_FIELDS}

def get_target_score(age: int) -> float:
    age_group = get_age_group(age)
    return AGE_GROUP_TARGETS.get(age_group, AGE_GROUP_TARGETS['<60歲'])['最高認知分數']

# -------------------- KMeans Bundle --------------------
@dataclass
class KMeansBundle:
    version: str
    feature_cols: List[str]
    scaler: StandardScaler
    kmeans: KMeans
    matched_cols_map: Dict[str, str] = None
    age_col: str = None

    def _ensure_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        def norm(s): return re.sub(r"\s+", "", str(s))
        norm_to_real = {norm(c): c for c in df.columns}
        resolved = []
        for want in self.feature_cols:
            key = norm(want)
            if key in norm_to_real:
                resolved.append(norm_to_real[key])
            else:
                raise KeyError(f"找不到特徵欄位:{want}")
        X = df[resolved].copy()
        for c in X.columns:
            X[c] = pd.to_numeric(X[c], errors="coerce")
        return X

    def predict_on_dataframe(self, df: pd.DataFrame) -> np.ndarray:
        idx = df.index
        X = self._ensure_columns(df)
        valid = X.dropna().index
        labels = np.full(shape=(len(df),), fill_value=np.nan, dtype=float)
        if len(valid) > 0:
            X_scaled = self.scaler.transform(X.loc[valid, X.columns].values)
            labels_valid = self.kmeans.predict(X_scaled)
            labels[idx.get_indexer(valid)] = labels_valid
        return labels

# -------------------- 工具函數 --------------------
def fuzzy_find_column(df_cols, patterns) -> Optional[str]:
    for pat in patterns:
        regex = re.compile(pat, flags=re.IGNORECASE)
        for c in df_cols:
            if regex.search(str(c)):
                return c
    return None

def read_csv_robust(path: str) -> pd.DataFrame:
    for enc in ["utf-8", "utf-8-sig", "cp950", "big5", "latin1"]:
        try:
            df = pd.read_csv(path, encoding=enc)
            print(f"✅ 使用編碼 {enc} 讀取成功")
            return df
        except Exception:
            continue
    raise RuntimeError("讀檔失敗:所有編碼嘗試均失敗")

def process_time_fields(df: pd.DataFrame) -> pd.DataFrame:
    def map_time_value(x):
        if pd.isna(x): return np.nan
        s = str(x).strip()
        if s.startswith(">") or "大於" in s: return 2
        if s.startswith("<") or "小於" in s: return 1
        try:
            v = float(s)
            if v in (1.0, 2.0):
                return int(v)
        except: pass
        return np.nan
    
    for field in ACTIVITY_FIELDS:
        if field in df.columns:
            df[field] = df[field].apply(map_time_value).astype("Int64")
    
    return df

# 從環境變數讀取密鑰
_encrypt_key_b64 = os.environ.get('ENCRYPT_KEY')  # base64 的 32 bytes
if not _encrypt_key_b64:
    raise RuntimeError('Missing ENCRYPT_KEY env variable')
AESGCM_KEY = base64.urlsafe_b64decode(_encrypt_key_b64)  # 32 bytes -> AES-256

def encrypt_medical_id(plain_text: str) -> str:
    """回傳 urlsafe-base64(nonce + ciphertext+tag)"""
    if not plain_text:
        return ''
    aesgcm = AESGCM(AESGCM_KEY)
    nonce = secrets.token_bytes(12)  # 12 bytes for GCM
    ct = aesgcm.encrypt(nonce, plain_text.encode('utf-8'), associated_data=None)
    return base64.urlsafe_b64encode(nonce + ct).decode('utf-8')

def decrypt_medical_id(token_b64: str) -> str:
    blob = base64.urlsafe_b64decode(token_b64)
    nonce, ct = blob[:12], blob[12:]
    aesgcm = AESGCM(AESGCM_KEY)
    pt = aesgcm.decrypt(nonce, ct, associated_data=None)
    return pt.decode('utf-8')

# IPAQ 身體活動量計算與分級 
def validate_and_clean_ipaq_data(ipaq_data: dict) -> dict:
    """
    驗證並清洗IPAQ資料
    規則：
    1. 單次活動最少10分鐘，否則視為0
    2. 一天總活動時間上限960分鐘
    """
    result = {
        'vig_day': 0, 'vig_min': 0,
        'mod_day': 0, 'mod_min': 0,
        'walk_day': 0, 'walk_min': 0,
        'is_valid': True,
        'validation_message': ''
    }
    
    def safe_int(val, default=0):
        if val is None or val == '' or val == 'null':
            return default
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return default
    
    # 讀取原始資料
    vig_day = safe_int(ipaq_data.get('vig_day', 0))
    vig_min = safe_int(ipaq_data.get('vig_min', 0))
    mod_day = safe_int(ipaq_data.get('mod_day', 0))
    mod_min = safe_int(ipaq_data.get('mod_min', 0))
    walk_day = safe_int(ipaq_data.get('walk_day', 0))
    walk_min = safe_int(ipaq_data.get('walk_min', 0))
    
    # 規則1: 單次活動最少10分鐘
    if vig_min < 10:
        vig_day, vig_min = 0, 0
    if mod_min < 10:
        mod_day, mod_min = 0, 0
    if walk_min < 10:
        walk_day, walk_min = 0, 0
    
    # 規則2: 一天總活動時間上限960分鐘
    total_daily_min = vig_min + mod_min + walk_min
    if total_daily_min > 960:
        result['is_valid'] = False
        result['validation_message'] = f'每日總活動時間 ({total_daily_min} 分鐘) 超過上限 960 分鐘，資料無效'
        return result
    
    result.update({
        'vig_day': vig_day, 'vig_min': vig_min,
        'mod_day': mod_day, 'mod_min': mod_min,
        'walk_day': walk_day, 'walk_min': walk_min,
        'validation_message': '資料驗證通過'
    })
    
    return result

def calculate_met_minutes(validated_data: dict) -> dict:
    """
    計算總代謝當量 (MET-minutes/week)
    MET常數：費力 8.0, 中等 4.0, 步行 3.3
    """
    MET_vigorous = validated_data['vig_day'] * validated_data['vig_min'] * 8.0
    MET_moderate = validated_data['mod_day'] * validated_data['mod_min'] * 4.0
    MET_walking = validated_data['walk_day'] * validated_data['walk_min'] * 3.3
    MET_total = MET_vigorous + MET_moderate + MET_walking
    
    return {
        'MET_vigorous': round(MET_vigorous, 2),
        'MET_moderate': round(MET_moderate, 2),
        'MET_walking': round(MET_walking, 2),
        'MET_total': round(MET_total, 2)
    }

def classify_activity_level(validated_data: dict, met_data: dict) -> dict:
    """
    根據IPAQ標準分級為 High / Moderate / Low
    分級順序：由高至低判斷
    """
    vig_day = validated_data['vig_day']
    vig_min = validated_data['vig_min']
    mod_day = validated_data['mod_day']
    mod_min = validated_data['mod_min']
    walk_day = validated_data['walk_day']
    walk_min = validated_data['walk_min']
    MET_total = met_data['MET_total']
    
    total_days = vig_day + mod_day + walk_day
    
    # A. 判斷「高活動量 (High)」
    # 條件1: 費力活動組
    if vig_day >= 3 and MET_total >= 1500:
        return {
            'activity_level': 'High',
            'activity_level_zh': '高活動量',
            'classification_reason': f'費力活動 {vig_day} 天/週，總MET值 {MET_total} ≥ 1500'
        }
    
    # 條件2: 綜合活動組
    if total_days >= 7 and MET_total >= 3000:
        return {
            'activity_level': 'High',
            'activity_level_zh': '高活動量',
            'classification_reason': f'綜合活動 {total_days} 天/週，總MET值 {MET_total} ≥ 3000'
        }
    
    # B. 判斷「中活動量 (Moderate)」
    # 條件1: 費力活動組
    if vig_day >= 3 and vig_min >= 20:
        return {
            'activity_level': 'Moderate',
            'activity_level_zh': '中活動量',
            'classification_reason': f'費力活動 {vig_day} 天/週，每次 {vig_min} 分鐘 ≥ 20'
        }
    
    # 條件2: 中等/步行組
    if (mod_day >= 5 or walk_day >= 5) and (mod_min >= 30 or walk_min >= 30):
        return {
            'activity_level': 'Moderate',
            'activity_level_zh': '中活動量',
            'classification_reason': f'中等/步行活動 ≥ 5 天/週，每次 ≥ 30 分鐘'
        }
    
    # 條件3: 綜合活動組
    if total_days >= 5 and MET_total >= 600:
        return {
            'activity_level': 'Moderate',
            'activity_level_zh': '中活動量',
            'classification_reason': f'綜合活動 {total_days} 天/週，總MET值 {MET_total} ≥ 600'
        }
    
    # C. 低活動量 (Low)
    return {
        'activity_level': 'Low',
        'activity_level_zh': '低活動量',
        'classification_reason': '不滿足高活動量或中活動量標準'
    }

def analyze_ipaq_data(ipaq_data: dict) -> dict:
    """
    整合IPAQ分析流程：驗證 -> 計算MET -> 分級
    """
    if not any(ipaq_data.get(field) for field in IPAQ_FIELDS):
        return {
            'has_ipaq_data': False,
            'message': '未提供IPAQ身體活動資料'
        }
    
    # 步驟1: 驗證與清洗
    validated = validate_and_clean_ipaq_data(ipaq_data)
    
    if not validated['is_valid']:
        return {
            'has_ipaq_data': True,
            'is_valid': False,
            'validation_message': validated['validation_message']
        }
    
    # 步驟2: 計算MET
    met_data = calculate_met_minutes(validated)
    
    # 步驟3: 分級
    classification = classify_activity_level(validated, met_data)
    
    # 整合結果
    return {
        'has_ipaq_data': True,
        'is_valid': True,
        'validated_data': validated,
        'met_data': met_data,
        'classification': classification
    }

# 久坐與運動評估系統（四象限分析）
def calculate_sedentary_activity_quadrant(activity_data: dict) -> dict:
    """
    計算久坐積分與運動保護力，並判定健康風險象限（A、B、C、D組）
    
    計分規則：
    - Q1, Q2, Q3, Q5, Q6 (靜態活動): ≥1小時得1分，<1小時得0分
    - 總分區間：0-5分
      * 0-2分：低久坐風險
      * 3-5分：高久坐風險
    - Q4 (動態活動): ≥1小時=Pass，<1小時=Fail
    
    象限分組：
    - A組（高活動低靜態型）: Pass + 0-2分
    - B組（高活動高靜態型）: Pass + 3-5分
    - C組（低活動低靜態型）: Fail + 0-2分
    - D組（低活動高靜態型）: Fail + 3-5分
    """
    
    def safe_int(val, default=0):
        if val is None or val == '' or val == 'null':
            return default
        try:
            return int(val)
        except (ValueError, TypeError):
            return default
    
    # 靜態活動項目（Q1, Q2, Q3, Q5, Q6）
    # 0=未填寫, 1=<1小時, 2=≥1小時
    q1_reading = safe_int(activity_data.get('平均每天近距離閱讀或書寫的時間', 0))
    q2_extra_reading = safe_int(activity_data.get('平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間', 0))
    q3_static = safe_int(activity_data.get('平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間', 0))
    q5_tv = safe_int(activity_data.get('平均每天觀看電視節目（如卡通、連續劇、電影等）的時間', 0))
    q6_computer = safe_int(activity_data.get('平均每天使用電腦的時間', 0))
    
    # 動態活動項目（Q4）
    q4_dynamic = safe_int(activity_data.get('平均每天進行動態活動(如抬拳道、空手道、球類等)的時間', 0))
    
    all_questions = [q1_reading, q2_extra_reading, q3_static, q4_dynamic, q5_tv, q6_computer]
    if all(q == 0 for q in all_questions):
        return {
            'has_quadrant_data': False,
            'message': '未提供活動習慣資料'
        }
    
    sedentary_score = 0
    sedentary_details = []
    
    if q1_reading == 2:  # ≥1小時
        sedentary_score += 1
        sedentary_details.append('近距離閱讀或書寫')
    
    if q2_extra_reading == 2:
        sedentary_score += 1
        sedentary_details.append('閱讀課外讀物')
    
    if q3_static == 2:
        sedentary_score += 1
        sedentary_details.append('靜態活動')
    
    if q5_tv == 2:
        sedentary_score += 1
        sedentary_details.append('觀看電視')
    
    if q6_computer == 2:
        sedentary_score += 1
        sedentary_details.append('使用電腦')
    
    # 判定久坐風險等級
    if sedentary_score <= 2:
        sedentary_risk = '低久坐風險'
        sedentary_risk_en = 'Low Sedentary Risk'
    else:
        sedentary_risk = '高久坐風險'
        sedentary_risk_en = 'High Sedentary Risk'
    
    # 判定運動保護力
    if q4_dynamic == 2:  # ≥1小時
        activity_protection = 'Pass'
        activity_protection_zh = '運動達標'
    else:
        activity_protection = 'Fail'
        activity_protection_zh = '運動未達標'
    
    # 判定健康風險象限
    if activity_protection == 'Pass' and sedentary_score <= 2:
        quadrant = 'A'
        quadrant_name = 'A組：高活動低靜態型'
        quadrant_name_en = 'Group A: Ideal Health Type'
        quadrant_description = '運動達標/0-2分：預防肌少症與代謝疾病，最理想狀態。'
        quadrant_color = '#4CAF50' 
    elif activity_protection == 'Pass' and sedentary_score >= 3:
        quadrant = 'B'
        quadrant_name = 'B組：高活動高靜態型'
        quadrant_name_en = 'Group B: Active Couch Potato'
        quadrant_description = '運動達標/3-5分：隱性風險，長時間久坐影響血糖控制。雖有運動但久坐積分高，仍會導致胰島素敏感度下降，需每30分鐘起身活動。'
        quadrant_color = '#FF9800'  
    elif activity_protection == 'Fail' and sedentary_score <= 2:
        quadrant = 'C'
        quadrant_name = 'C組：低活動低靜態型'
        quadrant_name_en = 'Group C: Low Activity Type'
        quadrant_description = '運動未達標/0-2分：久坐積分雖低但缺乏運動，面臨骨質與肌肉流失風險，應從每日快走開始。'
        quadrant_color = '#FFC107' 
    else:  # Fail and >= 3
        quadrant = 'D'
        quadrant_name = 'D組：低活動高靜態型'
        quadrant_name_en = 'Group D: Highest Risk Type'
        quadrant_description = '運動未達標/3-5分：代謝症候群、肥胖、肌少症之高危險群。'
        quadrant_color = '#F44336' 
    
    return {
        'has_quadrant_data': True,
        'sedentary_score': sedentary_score,
        'sedentary_risk': sedentary_risk,
        'sedentary_risk_en': sedentary_risk_en,
        'sedentary_details': sedentary_details,
        'activity_protection': activity_protection,
        'activity_protection_zh': activity_protection_zh,
        'quadrant': quadrant,
        'quadrant_name': quadrant_name,
        'quadrant_name_en': quadrant_name_en,
        'quadrant_description': quadrant_description,
        'quadrant_color': quadrant_color,
        'q1_reading': q1_reading,
        'q2_extra_reading': q2_extra_reading,
        'q3_static': q3_static,
        'q4_dynamic': q4_dynamic,
        'q5_tv': q5_tv,
        'q6_computer': q6_computer
    }

# --------------------計算與固定目標值（使用年齡層目標值）的差距--------------------
def add_individual_gaps(df: pd.DataFrame) -> pd.DataFrame:
    age_col = None
    for col in ['年紀', '年齡']:
        if col in df.columns:
            age_col = col
            break
    if not age_col:
        return df


    df['目標群集'] = pd.NA
    df['目標群集認知分數'] = pd.NA
    for field in ACTIVITY_FIELDS:
        df[f'{field}_目標值'] = pd.NA
        df[f'{field}_差距'] = pd.NA
        df[f'{field}_達標狀態'] = pd.NA

    # 計算每個人與固定目標值的差距
    for idx, row in df.iterrows():
        age = row.get(age_col)
        if pd.isna(age):
            continue
        age_int = int(age)

        target_values = get_target_values(age_int)
        target_score = get_target_score(age_int)
        age_group = get_age_group(age_int)

        df.at[idx, '目標群集'] = f'{age_group}最佳表現者'
        df.at[idx, '目標群集認知分數'] = target_score

        for field in ACTIVITY_FIELDS:
            current = row.get(field)
            target = target_values.get(field, 2)

            if pd.notna(current):
                try:
                    current = int(current)
                except:
                    current = 0
                gap = current - target
                df.at[idx, f'{field}_目標值'] = target
                df.at[idx, f'{field}_差距'] = gap
                df.at[idx, f'{field}_達標狀態'] = "已達標" if gap >= 0 else "未達標"

    return df

def calculate_single_gaps(input_data: dict) -> dict:
    """單筆輸入與固定目標值的差距（來自程式碼一）"""
    age = int(input_data.get('年紀', 0))
    target_values = get_target_values(age)
    target_score = get_target_score(age)
    age_group = get_age_group(age)

    result = {
        '目標群集': f'{age_group}最佳表現者',
        '目標群集認知分數': target_score
    }

    for field in ACTIVITY_FIELDS:
        current = input_data.get(field, 0)
        target = target_values.get(field, 2)
        try:
            current = int(current) if current != '' else 0
        except:
            current = 0
        gap = current - target
        status = "已達標" if gap >= 0 else "未達標"
        result[f'{field}_目標值'] = target
        result[f'{field}_差距'] = gap
        result[f'{field}_達標狀態'] = status

    return result

# -------------------- API --------------------
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)


@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        # 1) 檢查檔案是否存在
        if 'file' not in request.files:
            return jsonify({'error': '沒有上傳檔案'}), 400

        file = request.files['file']
        if not file or file.filename.strip() == '':
            return jsonify({'error': '檔案名稱為空'}), 400

        # 2) 先存檔再決定如何讀
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        # 3) 依副檔名讀取（前端允許 .csv / .xlsx）
        ext = os.path.splitext(filename)[1].lower()
        if ext == '.csv':
            df = read_csv_robust(filepath)
        elif ext in ('.xlsx', '.xls'):
            df = pd.read_excel(filepath)  # 若用到 XLSX，requirements.txt 請加 openpyxl
        else:
            return jsonify({'error': '只接受 CSV 或 XLSX 檔案'}), 400

        print(f"✅ 讀取資料成功, 共 {len(df)} 筆")

        # 4) 後處理
        df = process_time_fields(df)
        print("✅ 時間欄位處理完成")

        df = add_individual_gaps(df)
        print("✅ 差距分析完成")

        # 5) 統計與輸出
        result_data = df.replace({np.nan: None}).to_dict('records')

        stats = {
            'total_count': len(df),
            'cluster_distribution': {},
            'achievement_stats': {}
        }

        achieved_cols = [f'{field}_達標狀態' for field in ACTIVITY_FIELDS]
        if all(col in df.columns for col in achieved_cols):
            achieved_all = df[
                (df[achieved_cols[0]] == '已達標') &
                (df[achieved_cols[1]] == '已達標') &
                (df[achieved_cols[2]] == '已達標') &
                (df[achieved_cols[3]] == '已達標') &
                (df[achieved_cols[4]] == '已達標') &
                (df[achieved_cols[5]] == '已達標')
            ]
            stats['achievement_stats'] = {
                'total_achieved': int(len(achieved_all)),
                'achievement_rate': round(len(achieved_all) / max(len(df), 1) * 100, 1)
            }

        output_filename = f'result_{filename}'
        # output_path = os.path.join(OUTPUT_FOLDER, output_filename)
        # df.to_csv(output_path, index=False, encoding='utf-8-sig')
        # print(f"💾 結果已儲存: {output_path}")

        print("="*60)
        print("✅ 分析完成!")
        print("="*60 + "\n")

        return jsonify({
            'success': True,
            'data': result_data,
            'statistics': stats,
            'output_filename': output_filename
        })

    except Exception as e:
        print(f"❌ 錯誤: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download/<path:filename>', methods=['GET'])
def download_file(filename):
    try:
        safe = os.path.normpath(filename).lstrip(os.sep)  # 簡易路徑保護
        filepath = os.path.join(OUTPUT_FOLDER, safe)
        if os.path.exists(filepath):
            return send_file(filepath, as_attachment=True, download_name=os.path.basename(filepath))
        else:
            return jsonify({'error': '檔案不存在'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_image', methods=['POST'])
def save_image():
    """
    接收前端傳來的 PNG data URL，存成檔案到 OUTPUT_FOLDER
    """
    try:
        data = request.get_json() or {}
        data_url = data.get('image')
        filename = data.get('filename')

        if not data_url:
            return jsonify({'success': False, 'error': '缺少 image data'}), 400

        # 如果前端沒給檔名，就產生一個
        if not filename:
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'result_image_{ts}.png'

        # 去掉 data URL 前綴： "data:image/png;base64,xxxx"
        if ',' in data_url:
            header, b64data = data_url.split(',', 1)
        else:
            b64data = data_url

        img_bytes = base64.b64decode(b64data)

        # 存到 OUTPUT_FOLDER（已經跟 ./outputs 掛在一起）
        os.makedirs(OUTPUT_FOLDER, exist_ok=True)
        save_path = os.path.join(OUTPUT_FOLDER, filename)

        with open(save_path, 'wb') as f:
            f.write(img_bytes)

        print(f"✅ 圖片已儲存: {save_path}")

        # 回傳相對路徑 & 如果之後想從後端下載可以用的 download_url
        rel_path = filename
        return jsonify({
            'success': True,
            'saved_path': rel_path,
            'download_url': f'/api/download/{rel_path}'
        })

    except Exception as e:
        print(f"❌ 儲存圖片失敗: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/save_batch_encrypted', methods=['POST'])
def save_batch_encrypted():
    try:
        data = request.get_json() or {}
        records = data.get('records', [])
        if not isinstance(records, list) or len(records) == 0:
            return jsonify({'success': False, 'error': 'records 必須是非空陣列'}), 400

        def _safe_name(s: str) -> str:
            return re.sub(r'[^A-Za-z0-9._-]', '_', s or '')

        subdir = _safe_name(data.get('subdir', ''))
        filename = _safe_name(data.get('filename', ''))
        if not filename:
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'batch_encrypted_{ts}.json'
        if not filename.lower().endswith('.json'):
            filename += '.json'

        target_dir = os.path.join(OUTPUT_FOLDER, subdir) if subdir else OUTPUT_FOLDER
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, filename)

        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(records, f, ensure_ascii=False, indent=2)

        rel_path = filename if not subdir else f"{subdir}/{filename}"
        return jsonify({'success': True, 'saved_path': rel_path, 'download_url': f'/api/download/{rel_path}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"ok": True, "message": "server online"}), 200


@app.route('/api/analyze_single', methods=['POST'])
def analyze_single():
    try:
        print("\n" + "="*60)
        print("🚀 開始處理單筆資料分析")
        print("="*60)

        data = request.get_json()
        print(f"📥 接收到的資料: {data}")

        # ===== 步驟1：檢查必要欄位 =====
        required_fields = [
            '認知六大面向總分',
            '較長固視點數量(1000ms以上)',
            '較長固視點數量 ( 300-1000 ms )',
            '總體固視時間(秒)',
            '總體閱讀時間(秒)'
        ]
        
        for field in required_fields:
            if field not in data or data[field] == '':
                return jsonify({'success': False, 'error': f'缺少必要欄位:{field}'}), 400

        # ===== 步驟2：建立 DataFrame 用於決策樹分析 =====
        df = pd.DataFrame([{
            '認知六大面向總分\n': float(data['認知六大面向總分']),
            '較長固視點數量 ( 1000 ms以上 )  ': float(data['較長固視點數量(1000ms以上)']),
            '總體固視時間(秒)': float(data['總體固視時間(秒)']),
            '總體閱讀時間(秒)': float(data['總體閱讀時間(秒)']),
            '較長固視點數量 ( 300-1000 ms )': float(data.get('較長固視點數量 ( 300-1000 ms )', 0)),
        }])

        print("✅ DataFrame 建立成功")

        # ===== 步驟3：生成決策路徑 =====
        decision = generate_decision_path(data, df)
        decision_path = decision['path']

        # ===== 步驟4：建立結果字典（從 DataFrame 開始） =====
        result = df.replace({np.nan: None}).to_dict('records')[0]
        
        # ===== 步驟5：加入決策樹結果 =====
        result['rule_cluster'] = decision['final_name']
        result['建議習慣'] = decision['habit']
        result['年齡層(規則)'] = decision['age_band']

        # ===== 步驟6：加入年齡與活動欄位 =====
        result['年紀'] = data.get('年紀', 0)
        for field in ACTIVITY_FIELDS:
            result[field] = data.get(field, 0)

        result['病歷號'] = data.get('病歷號', '')
        result['受測者姓名'] = data.get('受測者姓名', '')
        
        # ===== 步驟7：計算與目標值的差距 =====
        gap_analysis = calculate_single_gaps(data)
        result.update(gap_analysis)
        
        # ===== 步驟8：分析IPAQ身體活動資料（選填）=====
        ipaq_data = {field: data.get(field) for field in IPAQ_FIELDS}
        ipaq_result = analyze_ipaq_data(ipaq_data)
        
        # 將IPAQ結果加入result
        if ipaq_result.get('has_ipaq_data'):
            result['IPAQ_has_data'] = True
            if ipaq_result.get('is_valid'):
                result['IPAQ_activity_level'] = ipaq_result['classification']['activity_level_zh']
                result['IPAQ_activity_level_en'] = ipaq_result['classification']['activity_level']
                result['IPAQ_classification_reason'] = ipaq_result['classification']['classification_reason']
                result['IPAQ_MET_total'] = ipaq_result['met_data']['MET_total']
                result['IPAQ_MET_vigorous'] = ipaq_result['met_data']['MET_vigorous']
                result['IPAQ_MET_moderate'] = ipaq_result['met_data']['MET_moderate']
                result['IPAQ_MET_walking'] = ipaq_result['met_data']['MET_walking']
                result['IPAQ_validated_data'] = ipaq_result['validated_data']
            else:
                result['IPAQ_validation_error'] = ipaq_result.get('validation_message', '資料驗證失敗')
        else:
            result['IPAQ_has_data'] = False
        
        # 分析久坐與運動評估（四象限分析）
        quadrant_result = calculate_sedentary_activity_quadrant(data)
        
        # 將象限分析結果加入result
        if quadrant_result.get('has_quadrant_data'):
            result['Quadrant_has_data'] = True
            result['Quadrant_sedentary_score'] = quadrant_result['sedentary_score']
            result['Quadrant_sedentary_risk'] = quadrant_result['sedentary_risk']
            result['Quadrant_sedentary_risk_en'] = quadrant_result['sedentary_risk_en']
            result['Quadrant_sedentary_details'] = quadrant_result['sedentary_details']
            result['Quadrant_activity_protection'] = quadrant_result['activity_protection']
            result['Quadrant_activity_protection_zh'] = quadrant_result['activity_protection_zh']
            result['Quadrant_group'] = quadrant_result['quadrant']
            result['Quadrant_name'] = quadrant_result['quadrant_name']
            result['Quadrant_name_en'] = quadrant_result['quadrant_name_en']
            result['Quadrant_description'] = quadrant_result['quadrant_description']
            result['Quadrant_color'] = quadrant_result['quadrant_color']
        else:
            result['Quadrant_has_data'] = False
        
        # 使用GPT生成個性化建議（包含IPAQ分析與象限分析）
        gpt_recommendation = generate_gpt_recommendations(data, ipaq_result, quadrant_result)
        result['GPT建議'] = gpt_recommendation

        print("✅ 單筆分析完成!")
        print("="*60 + "\n")

        return jsonify({'success': True, 'data': result, 'decision_path': decision_path})

    except ValueError as e:
        return jsonify({'success': False, 'error': f'資料格式錯誤:{str(e)}'}), 400
    except Exception as e:
        print(f"❌ 錯誤: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

def _num(x):
    try:
        return float(str(x).replace(",", "").strip())
    except Exception:
        return float("nan")

def _get_age_band(row, input_data=None):
    band = str(row.get('年齡層', '')).strip()
    if band:
        return band
    if input_data:
        b2 = str(input_data.get('年齡層', '')).strip()
        if b2:
            return b2
    
    def pick_age(src):
        if not src: return float("nan")
        return _num(src.get('年紀', src.get('年齡', float('nan'))))
    
    age = _num(row.get('年紀', row.get('年齡', float('nan'))))
    if np.isnan(age) and input_data:
        age = pick_age(input_data)
    
    if not np.isnan(age):
        if age < 60: return '<60歲'
        if age <= 70: return '60-70歲'
        if age <= 79: return '71-79歲'
    return ''

def generate_decision_path(input_data, df):
    path = []
    row = df.iloc[0].to_dict()
    age_band = _get_age_band(row, input_data)

    fix1000 = _num(input_data.get('較長固視點數量(1000ms以上)', row.get('較長固視點數量 ( 1000 ms以上 )  ')))
    total_fix_time = _num(row.get('總體固視時間(秒)'))
    total_read_time = _num(row.get('總體閱讀時間(秒)'))

    final_name = None

    if age_band == '<60歲':
        if not np.isnan(fix1000):
            path.append({'level': 1, 'condition': '較長固視點(1000ms+) > 0.87', 'value': f'{fix1000:.2f}', 'branch': 'high' if fix1000 > 0.87 else 'low'})
            final_name = '專注閱讀型' if fix1000 > 0.87 else '高效靜態型'
        else:
            path.append({'level': 1, 'condition': '較長固視點(1000ms+) 資料缺失', 'value': '-', 'branch': None})
            final_name = '高效靜態型'

    elif age_band == '60-70歲':
        if not np.isnan(total_fix_time):
            path.append({'level': 1, 'condition': '總體固視時間 > 44.16秒', 'value': f'{total_fix_time:.2f}', 'branch': 'high' if total_fix_time > 44.16 else 'low'})
            final_name = '動態提升型' if total_fix_time > 44.16 else '複合活動型'
        else:
            path.append({'level': 1, 'condition': '總體固視時間 資料缺失', 'value': '-', 'branch': None})
            final_name = '複合活動型'

    elif age_band == '71-79歲':
        if not np.isnan(fix1000):
            b1 = 'high' if fix1000 > 4.61 else 'low'
            path.append({'level': 1, 'condition': '較長固視點(1000ms+) > 4.61', 'value': f'{fix1000:.2f}', 'branch': b1})
            if fix1000 > 4.61:
                if not np.isnan(total_read_time):
                    b2 = 'high' if total_read_time > 127.66 else 'low'
                    path.append({'level': 2, 'condition': '總體閱讀時間 > 127.66秒', 'value': f'{total_read_time:.2f}', 'branch': b2})
                    final_name = '靜態閱讀型' if total_read_time > 127.66 else '數位使用型'
                else:
                    path.append({'level': 2, 'condition': '總體閱讀時間 資料缺失', 'value': '-', 'branch': None})
                    final_name = '靜態閱讀型'
            else:
                final_name = '螢幕觀賞型'
        else:
            path.append({'level': 1, 'condition': '較長固視點(1000ms+) 資料缺失', 'value': '-', 'branch': None})
            final_name = '螢幕觀賞型'
    else:
        path.append({'level': 0, 'condition': '年齡層無法判定', 'value': '-', 'branch': 'none'})
        final_name = '螢幕觀賞型'

    path.append({'result': final_name})
    habit = DISPLAY_CLUSTER_HABITS.get(final_name, '')
    return {'path': path, 'final_name': final_name, 'habit': habit, 'age_band': age_band}

def generate_gpt_recommendations(input_data: dict, ipaq_result: dict = None, quadrant_result: dict = None) -> str:
    """使用GPT API生成個性化健康建議（含IPAQ與四象限分析）"""
    try:
        # 檢查API密鑰
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            print("❌ 錯誤: OPENAI_API_KEY 環境變數未設置")
            return "建議生成失敗：API密鑰未配置。請設置OPENAI_API_KEY環境變數。"
        
        print(f"✅ API密鑰已找到 (前8字符): {api_key[:8]}...")
        
        client = OpenAI(api_key=api_key)
        
        def safe_int(val, default=0):
            if val is None or val == '' or val == 'null':
                return default
            try:
                return int(val)
            except (ValueError, TypeError):
                return default
        
        # 輔助函數：安全轉換為浮點數
        def safe_float(val, default=0.0):
            if val is None or val == '':
                return default
            try:
                return float(val)
            except (ValueError, TypeError):
                return default
        
        # 準備輸入數據
        age = safe_int(input_data.get('年紀', 0))
        cognitive_score = safe_float(input_data.get('認知六大面向總分', 0))
        fixation_1000ms = safe_float(input_data.get('較長固視點數量(1000ms以上)', 0))
        fixation_300_1000ms = safe_float(input_data.get('較長固視點數量 ( 300-1000 ms )', 0))
        total_fixation_time = safe_float(input_data.get('總體固視時間(秒)', 0))
        total_reading_time = safe_float(input_data.get('總體閱讀時間(秒)', 0))
        
        # 活動時間數據（0=未填寫, 1=<1小時, 2=≥1小時）- 需要轉換字串為整數
        reading_writing = safe_int(input_data.get('平均每天近距離閱讀或書寫的時間', 0))
        extra_reading = safe_int(input_data.get('平均每天閱讀課外課物（如繪本、小說、漫畫、散文等）的時間', 0))
        static_activity = safe_int(input_data.get('平均每天進行靜態活動(如音樂、作文、下棋、打牌等)的時間', 0))
        dynamic_activity = safe_int(input_data.get('平均每天進行動態活動(如抬拳道、空手道、球類等)的時間', 0))
        tv_time = safe_int(input_data.get('平均每天觀看電視節目（如卡通、連續劇、電影等）的時間', 0))
        computer_time = safe_int(input_data.get('平均每天使用電腦的時間', 0))
        
        # 精確小時數（當選擇≥1小時時填寫的具體數值）
        reading_writing_hours = input_data.get('nearReadingHours')
        extra_reading_hours = input_data.get('extraReadingHours')
        static_activity_hours = input_data.get('staticActivityHours')
        dynamic_activity_hours = input_data.get('dynamicActivityHours')
        tv_time_hours = input_data.get('tvTimeHours')
        computer_time_hours = input_data.get('computerTimeHours')
        
        # 🔍 Debug: 輸出接收到的所有數據
        print("\n" + "="*60)
        print("📊 GPT 接收到的數據：")
        print(f"  年齡: {age}")
        print(f"  認知六大面向總分: {cognitive_score}")
        print(f"  較長固視點數量(1000ms以上): {fixation_1000ms}")
        print(f"  較長固視點數量(300ms-1000ms): {fixation_300_1000ms}")
        print(f"  總體固視時間: {total_fixation_time}秒")
        print(f"  總體閱讀時間: {total_reading_time}秒")
        print("\n活動習慣數據：")
        print(f"  近距離閱讀或書寫: {reading_writing} (精確小時: {reading_writing_hours})")
        print(f"  閱讀課外讀物: {extra_reading} (精確小時: {extra_reading_hours})")
        print(f"  靜態活動: {static_activity} (精確小時: {static_activity_hours})")
        print(f"  動態活動: {dynamic_activity} (精確小時: {dynamic_activity_hours})")
        print(f"  觀看電視: {tv_time} (精確小時: {tv_time_hours})")
        print(f"  使用電腦: {computer_time} (精確小時: {computer_time_hours})")
        print("="*60 + "\n")
        
        # 構建IPAQ分析結果說明
        ipaq_section = ""
        if ipaq_result and ipaq_result.get('has_ipaq_data'):
            if ipaq_result.get('is_valid'):
                validated = ipaq_result['validated_data']
                met = ipaq_result['met_data']
                classification = ipaq_result['classification']
                
                ipaq_section = f"""

【IPAQ身體活動量評估結果】
活動量分級：{classification['activity_level_zh']} ({classification['activity_level']})
分級原因：{classification['classification_reason']}

過去一週身體活動情況：
- 費力活動：{validated['vig_day']} 天/週，每次 {validated['vig_min']} 分鐘 (MET值: {met['MET_vigorous']})
- 中等強度活動：{validated['mod_day']} 天/週，每次 {validated['mod_min']} 分鐘 (MET值: {met['MET_moderate']})
- 步行活動：{validated['walk_day']} 天/週，每次 {validated['walk_min']} 分鐘 (MET值: {met['MET_walking']})
- 總代謝當量：{met['MET_total']} MET-minutes/week
"""
            else:
                ipaq_section = f"""

【IPAQ身體活動量評估結果】
{ipaq_result['validation_message']}
"""
        
        quadrant_section = ""
        if quadrant_result and quadrant_result.get('has_quadrant_data'):
            sedentary_details_text = '、'.join(quadrant_result['sedentary_details']) if quadrant_result['sedentary_details'] else '無'
            quadrant_section = f"""

【運動與久坐平衡：健康風險四分法評估結果】
您的健康風險分組：{quadrant_result['quadrant_name']}
象限說明：{quadrant_result['quadrant_description']}

評估指標詳情：
1. 久坐風險分數：{quadrant_result['sedentary_score']} 分（滿分5分）
   - 風險等級：{quadrant_result['sedentary_risk']}
   - 超過1小時的靜態活動：{sedentary_details_text}
   
2. 運動保護力：{quadrant_result['activity_protection_zh']} ({quadrant_result['activity_protection']})
   - 動態活動（球類、武術等）每日時數是否達標（≥1小時）

評估說明：
- 久坐積分計算：近距離閱讀/書寫、閱讀課外讀物、靜態活動、觀看電視、使用電腦等5項活動，每項≥1小時得1分
- 0-2分為低久坐風險，3-5分為高久坐風險
- 動態活動≥1小時為運動達標(Pass)，<1小時為未達標(Fail)
"""
        
        # 構建WHO指引內容
        who_guidelines = """
根據世界衛生組織（WHO）於2020年發佈的《關於身體活動和久坐行為指引》(World Health Organization 2020 guidelines on physical activity and sedentary behaviour)與WHO Global action plan on physical activity 2018-2030中的內容，以下整理了針對不同年齡層的身體活動量建議：

5-17歲的兒童與青少年：
a. 每天至少應進行 60 分鐘中等至高強度的體能訓練。
b. 每天進行超過 60 分鐘的體能活動可帶來額外的健康益處。
c. 每週至少進行 3 天的高強度有氧運動以及增強肌肉和骨骼的運動。

18-64歲成年人：
a. 每週至少應進行 150 分鐘的中等強度體能活動，或至少 75 分鐘的高強度體能活動，或合併中等與高強度活動達到相同效用。
b. 成人應該每週2天以上以中等或更高強度，進行包含主要肌群的肌力強化訓練。
c. 成人可以將中等強度有氧運動增加到>300分鐘，或進行高強度的有氧運動>150 min，或者在一週間等效合併中等強度與高強度運動，以獲取額外的健康益處（當沒有慢性疾病時）（有條件建議）。

65歲以上成年人：
a. 每週至少應進行 150 分鐘的中等強度體能活動，或至少 75 分鐘的高強度體能活動，或兩者的等效組合。
b. 為了獲得更多健康益處，他們應該將中等強度的體能活動增加到每週 300 分鐘或同等強度。
c. 行動不便者應每週進行 3 天以上的體能鍛煉，以增強平衡能力並防止跌倒。
d. 肌肉強化活動應涉及主要肌肉群，每週 2 天或以上。
"""
        
        # 將活動代碼轉換為文字描述
        def activity_to_text(code, exact_hours=None):
            if code == 0:
                return "未填寫"
            elif code == 1:
                return "小於1小時"
            elif code == 2:
                # 如果有精確小時數，顯示具體數值
                if exact_hours:
                    try:
                        hours = float(exact_hours)
                        return f"{hours}小時"
                    except (ValueError, TypeError):
                        return "大於等於1小時"
                return "大於等於1小時"
            else:
                return "未知"
        
        # 構建prompt
        prompt = f"""
{who_guidelines}
{quadrant_section}
{ipaq_section}
請根據以上WHO指引、健康風險四分法評估結果以及以下受測者的數據，提供個性化的健康與活動建議：

受測者資料：
- 年齡：{age}歲
- 認知六大面向總分：{cognitive_score}(滿分為100分)
- 較長固視點數量(1000ms以上)：{fixation_1000ms}
- 較長固視點數量(300ms-1000ms)：{fixation_300_1000ms}
- 總體固視時間：{total_fixation_time}秒
- 總體閱讀時間：{total_reading_time}秒

每日活動習慣：
- 平均每天近距離閱讀或書寫的時間：{activity_to_text(reading_writing, reading_writing_hours)}
- 平均每天閱讀課外讀物的時間：{activity_to_text(extra_reading, extra_reading_hours)}
- 平均每天進行靜態活動的時間：{activity_to_text(static_activity, static_activity_hours)}
- 平均每天進行動態活動的時間：{activity_to_text(dynamic_activity, dynamic_activity_hours)}
- 平均每天觀看電視節目的時間：{activity_to_text(tv_time, tv_time_hours)}
- 平均每天使用電腦的時間：{activity_to_text(computer_time, computer_time_hours)}

請提供：
1. 針對該受測者年齡層的WHO活動建議摘要
2. 根據健康風險四分法評估結果，說明受測者目前所處象限的健康風險與特點
3. 根據IPAQ評估結果（若有），比對受測者當前活動量與WHO建議標準，指出是否達標
4. 根據其當前活動習慣、久坐積分和IPAQ分級，建議應該增加或減少哪些活動
5. 具體的活動時間調整建議（以每天或每週為單位）
6. 針對認知健康的特別建議(若認知總分較低可分析各項每日活動習慣的時間長度並提出相關建議)

請先用繁體中文完整回答，再翻成英文回答一次，兩者的內容需一模一樣，保持簡潔專業，內容不能前後矛盾，控制在300字以內。
"""
        
        # 調用GPT API
        print(f"📡 正在調用GPT API...")
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": """
                    你是一位結合「WHO 公共衛生指引」、「臨床常識」與「日常生活可行性」的健康建議專家。
                    請嚴格遵守以下原則進行分析與建議：

                    【重要推理原則】
                    1. 回覆一律用「您」來稱呼受測者，建議內容需符合一般人可長期執行的現實生活情境。
                    2. 任何單一活動（如運動、看電視、使用電腦）之建議時間，須符合常見作息邏輯，不得出現明顯不合理數值（如每日數小時高強度運動）。
                    3. 關於眼動指標（固視時間、固視點數）：
                    - 不得作出診斷性或病理化判斷
                    - 若數值偏高，請以「可能代表長時間專注或視覺負荷較高」等中性表述說明
                    4. 認知六大面向總分為功能性指標：
                    - 用語需溫和、支持性，避免負面標籤或暗示能力不足
                    5. 建議應同時考量：
                    - 身體活動
                    - 久坐與螢幕時間
                    - 認知負荷與視覺休息
                    - 年齡層適切性
                    """},
                {"role": "user", "content": prompt}
            ],
            max_tokens=800,
            temperature=0.7
        )
        
        recommendation = response.choices[0].message.content.strip()
        print(f"✅ GPT建議生成成功 (長度: {len(recommendation)} 字)")
        return recommendation
        
    except Exception as e:
        error_msg = str(e)
        print(f"❌ GPT建議生成失敗: {error_msg}")
        traceback.print_exc()
        if "invalid_api_key" in error_msg.lower() or "unauthorized" in error_msg.lower():
            return "建議生成失敗：API密鑰無效或已過期。請檢查您的OpenAI API密鑰。"
        elif "rate_limit" in error_msg.lower():
            return "建議生成失敗：API調用次數超過限制。請稍後再試。"
        elif "insufficient_quota" in error_msg.lower():
            return "建議生成失敗：API配額不足。請檢查您的OpenAI帳戶餘額。"
        else:
            return f"建議生成失敗：{error_msg}。請根據WHO指引進行適當的身體活動。"

@app.route('/api/encrypt', methods=['POST'])
def api_encrypt():
    try:
        data = request.get_json() or {}
        mid = data.get('medicalId', '') or ''
        enc = encrypt_medical_id(mid)
        return jsonify({'encryptedId': enc})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_input_data', methods=['POST'])
def save_input_data():
    """儲存手動輸入的資料與分析結果, 支援 encryptedJSON / fullReport / legacy 資料"""
    try:
        data = request.get_json() or {}

        # 統一先把 input_data 安全取出（供檔名加密使用）
        input_data = data.get('inputData', {}) if isinstance(data.get('inputData', {}), dict) else {}
        medical_id = input_data.get('病歷號', '') or 'unknown'
        encrypted_id = encrypt_medical_id(medical_id)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # ① 新：整份 JSON 已在前端加密（字串）
        if 'encryptedJSON' in data and data['encryptedJSON']:
            filename = f'分析報告_{encrypted_id}_{timestamp}.json'
            filepath = os.path.join(OUTPUT_FOLDER, filename)
            # 注意：這裡寫入的是已加密過的字串（密文）
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(data['encryptedJSON'])
            print(f"✅ 加密 JSON 已儲存: {filepath}")
            return jsonify({'success': True, 'filename': filename, 'filepath': filepath})

        # ② 舊：前端已生成完整 TXT 內容（fullReport）
        if 'fullReport' in data:
            filename = f'分析報告_{encrypted_id}_{timestamp}.txt'
            filepath = os.path.join(OUTPUT_FOLDER, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(data['fullReport'])
            print(f"✅ 完整分析報告已儲存: {filepath}")
            return jsonify({'success': True, 'filename': filename, 'filepath': filepath})

        # ③ 更舊：只有欄位資料（沒有 fullReport/encryptedJSON）
        # 為了相容，這裡用 data 本身組一個簡單 TXT
        filename = f'輸入資料_{encrypted_id}_{timestamp}.txt'
        filepath = os.path.join(OUTPUT_FOLDER, filename)

        lines = []
        lines.append('='*60)
        lines.append('智慧眼鏡數據分析系統 - 輸入資料')
        lines.append('='*60)
        lines.append('')
        lines.append(f'輸入時間: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
        lines.append('')
        lines.append('【基本資料】')
        lines.append(f'病歷號: {encrypted_id}')
        lines.append(f'年齡: {data.get("年紀", "未提供")} 歲')
        lines.append(f'認知六大面向總分: {data.get("認知六大面向總分", "未提供")}')
        lines.append('')
        lines.append('【眼動追蹤數據】')
        lines.append(f'較長固視點數量(1000ms以上): {data.get("較長固視點數量(1000ms以上)", "未提供")}')
        lines.append(f'較長固視點數量 ( 300-1000 ms ): {data.get("較長固視點數量 ( 300-1000 ms )", "未提供")}')
        lines.append(f'總體固視時間(秒): {data.get("總體固視時間(秒)", "未提供")}')
        lines.append(f'總體閱讀時間(秒): {data.get("總體閱讀時間(秒)", "未提供")}')

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

        print(f"✅ 輸入資料已儲存: {filepath}")
        return jsonify({'success': True, 'filename': filename, 'filepath': filepath})

    except Exception as e:
        print(f"❌ 儲存資料失敗: {str(e)}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# -------------------- 入口 --------------------
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 啟動智慧眼鏡數據分析系統後端服務")
    print("="*60)
    print(f"📁 上傳資料夾: {UPLOAD_FOLDER}")
    print(f"📁 輸出資料夾: {OUTPUT_FOLDER}")
    print(f"📁 模型資料夾: {MODEL_FOLDER}")
    print(f"📁 靜態資料夾: {STATIC_FOLDER}")
    print("="*60)
    print("請確保以下模型檔案存在:")
    print(f"  - {MODEL_FOLDER}/kmeans_lvl1_bundle.pkl")
    print(f"  - {MODEL_FOLDER}/kmeans_lvl2_bundle.pkl")
    print("="*60)
    print("網頁地址: http://localhost:5002")
    print("直接訪問: http://localhost:5002/static/index.html")
    print("="*60 + "\n")
    port = int(os.environ.get("PORT", 5002))
    app.run(host='0.0.0.0', port=port, debug=False)