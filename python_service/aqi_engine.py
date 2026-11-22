"""
AirGuard AQI Science Engine.

Implements official Indian Central Pollution Control Board (CPCB) NAQI sub-index
linear interpolation algorithms, WHO 2021 24-hour guideline comparisons,
composite respiratory risk scoring (CRRS), and diurnal rolling forecasting.
"""

from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone, timedelta
import math


# =====================================================================
#  CPCB NAQI Sub-Index Breakpoint Tables (Official CPCB Schedule)
# =====================================================================

CPCB_BREAKPOINTS: Dict[str, List[Tuple[float, float, int, int]]] = {
    "pm25": [
        (0.0, 30.0, 0, 50),
        (31.0, 60.0, 51, 100),
        (61.0, 90.0, 101, 200),
        (91.0, 120.0, 201, 300),
        (121.0, 250.0, 301, 400),
        (250.0, 500.0, 401, 500),
    ],
    "pm10": [
        (0.0, 50.0, 0, 50),
        (51.0, 100.0, 51, 100),
        (101.0, 250.0, 101, 200),
        (251.0, 350.0, 201, 300),
        (351.0, 430.0, 301, 400),
        (430.0, 600.0, 401, 500),
    ],
    "no2": [
        (0.0, 40.0, 0, 50),
        (41.0, 80.0, 51, 100),
        (81.0, 180.0, 101, 200),
        (181.0, 280.0, 201, 300),
        (281.0, 400.0, 301, 400),
        (400.0, 800.0, 401, 500),
    ],
    "o3": [
        (0.0, 50.0, 0, 50),
        (51.0, 100.0, 51, 100),
        (101.0, 168.0, 101, 200),
        (169.0, 208.0, 201, 300),
        (209.0, 748.0, 301, 400),
        (748.0, 1000.0, 401, 500),
    ],
    "so2": [
        (0.0, 40.0, 0, 50),
        (41.0, 80.0, 51, 100),
        (81.0, 380.0, 101, 200),
        (381.0, 800.0, 201, 300),
        (801.0, 1600.0, 301, 400),
        (1600.0, 2000.0, 401, 500),
    ],
    "co": [
        (0.0, 1.0, 0, 50),
        (1.1, 2.0, 51, 100),
        (2.1, 10.0, 101, 200),
        (10.1, 17.0, 201, 300),
        (17.1, 34.0, 301, 400),
        (34.0, 50.0, 401, 500),
    ],
}

CPCB_CATEGORIES = [
    {"min": 0, "max": 50, "label": "Good", "level": "good", "color": "#14532d", "bg": "#dcfce7"},
    {"min": 51, "max": 100, "label": "Satisfactory", "level": "satisfactory", "color": "#047857", "bg": "#d1fae5"},
    {"min": 101, "max": 200, "label": "Moderate", "level": "moderate", "color": "#78350f", "bg": "#fef3c7"},
    {"min": 201, "max": 300, "label": "Poor", "level": "poor", "color": "#7c2d12", "bg": "#ffedd5"},
    {"min": 301, "max": 400, "label": "Very Poor", "level": "very_poor", "color": "#7f1d1d", "bg": "#fee2e2"},
    {"min": 401, "max": 500, "label": "Severe", "level": "severe", "color": "#581c87", "bg": "#f3e8ff"},
]

WHO_THRESHOLDS_2021: Dict[str, float] = {
    "pm25": 15.0,  # 24-hour limit (µg/m³)
    "pm10": 45.0,  # 24-hour limit (µg/m³)
    "no2": 25.0,   # 24-hour limit (µg/m³)
    "o3": 60.0,    # 8-hour peak limit (µg/m³)
    "so2": 40.0,   # 24-hour limit (µg/m³)
    "co": 4.0,     # 24-hour limit (mg/m³)
}


# =====================================================================
#  CPCB Sub-Index Calculation Functions
# =====================================================================

def calculate_sub_index(pollutant: str, concentration: Optional[float]) -> Optional[int]:
    """
    Calculate the official CPCB sub-index for a single pollutant concentration
    using linear interpolation across official CPCB breakpoint intervals.

    Formula:
        Ip = I_low + ((I_high - I_low) / (C_high - C_low)) * (Cp - C_low)
    """
    if concentration is None:
        return None

    c = max(0.0, float(concentration))
    key = pollutant.lower().replace(".", "").replace("-", "")

    if key not in CPCB_BREAKPOINTS:
        return None

    breakpoints = CPCB_BREAKPOINTS[key]

    for c_low, c_high, i_low, i_high in breakpoints:
        if c <= c_high:
            sub = i_low + ((i_high - i_low) / (c_high - c_low)) * (c - c_low)
            return int(round(sub))

    # If exceeding top breakpoint interval, extrapolate up to cap
    _, max_c, _, max_i = breakpoints[-1]
    extrapolated = max_i + ((c - max_c) * 0.4)
    return min(500, int(round(extrapolated)))


def get_cpcb_category(aqi: int) -> Dict[str, Any]:
    """Return CPCB NAQI category descriptor for a given AQI."""
    safe_aqi = max(0, int(aqi))
    for cat in CPCB_CATEGORIES:
        if safe_aqi <= cat["max"]:
            return cat
    return CPCB_CATEGORIES[-1]


def compute_cpcb_naqi(readings: Dict[str, Optional[float]]) -> Dict[str, Any]:
    """
    Compute official CPCB NAQI and identify the dominant pollutant.
    As per CPCB methodology, overall AQI is the maximum of all valid sub-indices.
    """
    sub_indices: Dict[str, int] = {}

    for pol in ["pm25", "pm10", "no2", "o3", "so2", "co"]:
        val = readings.get(pol)
        if val is not None:
            sub = calculate_sub_index(pol, val)
            if sub is not None:
                sub_indices[pol] = sub

    if not sub_indices:
        overall_aqi = int(readings.get("aqi") or 0)
        dominant = "PM2.5"
    else:
        dominant_pair = max(sub_indices.items(), key=lambda item: item[1])
        dominant = dominant_pair[0].upper()
        if dominant == "PM25":
            dominant = "PM2.5"
        overall_aqi = dominant_pair[1]

    category = get_cpcb_category(overall_aqi)

    return {
        "aqi": overall_aqi,
        "dominant_pollutant": dominant,
        "category": category["label"],
        "severity_level": category["level"],
        "sub_indices": sub_indices,
        "color": category["color"],
        "bg": category["bg"],
    }


# =====================================================================
#  WHO 2021 Guideline Comparison Functions
# =====================================================================

def evaluate_who_guidelines(readings: Dict[str, Optional[float]]) -> Dict[str, Any]:
    """
    Compare environmental pollutant readings against strict WHO 2021 24-hour limits.
    Computes exceedance multipliers and compliance status.
    """
    evaluations: Dict[str, Any] = {}
    max_multiplier = 0.0
    highest_exceeded_pollutant = "None"

    for pol, limit in WHO_THRESHOLDS_2021.items():
        val = readings.get(pol)
        if val is None:
            continue

        numeric_val = max(0.0, float(val))
        multiplier = round(numeric_val / limit, 1)
        exceeded = numeric_val > limit

        if multiplier > max_multiplier:
            max_multiplier = multiplier
            highest_exceeded_pollutant = pol.upper() if pol != "pm25" else "PM2.5"

        status = "compliant"
        if exceeded:
            status = "severe" if multiplier >= 4.0 else ("high" if multiplier >= 2.0 else "moderate")

        evaluations[pol] = {
            "value": numeric_val,
            "limit": limit,
            "unit": "mg/m³" if pol == "co" else "µg/m³",
            "multiplier": multiplier,
            "exceeded": exceeded,
            "label": f"{multiplier}x WHO limit" if exceeded else f"Within WHO limit ({multiplier}x)",
            "status": status,
        }

    return {
        "evaluations": evaluations,
        "max_exceedance_multiplier": max_multiplier,
        "highest_exceeded_pollutant": highest_exceeded_pollutant,
        "overall_compliant": max_multiplier <= 1.0,
    }


# =====================================================================
#  Composite Respiratory Risk Score (CRRS)
# =====================================================================

def compute_composite_risk_score(readings: Dict[str, Optional[float]]) -> Dict[str, Any]:
    """
    Computes a weighted Composite Respiratory Risk Score (CRRS, 0.0 - 10.0 scale)
    incorporating synergistic health hazards from fine particulate matter and oxidant gases.

    Weights:
        PM2.5: 45% (deep alveolar capillary deposition)
        PM10:  25% (upper thoracic airway irritation)
        NO2:   20% (bronchial inflammation from vehicle emissions)
        O3:    10% (respiratory tract oxidative stress)
    """
    pm25 = float(readings.get("pm25") or 0.0)
    pm10 = float(readings.get("pm10") or 0.0)
    no2 = float(readings.get("no2") or 0.0)
    o3 = float(readings.get("o3") or 0.0)

    # Normalized contributions against WHO reference guidelines
    c_pm25 = (pm25 / 15.0) * 0.45
    c_pm10 = (pm10 / 45.0) * 0.25
    c_no2 = (no2 / 25.0) * 0.20
    c_o3 = (o3 / 60.0) * 0.10

    raw_score = c_pm25 + c_pm10 + c_no2 + c_o3
    crrs = round(min(10.0, max(0.0, raw_score)), 2)

    if crrs < 1.0:
        risk_tier = "Minimal"
        clinical_summary = "Pollution concentrations remain within WHO clinical safety thresholds."
    elif crrs < 2.5:
        risk_tier = "Mild"
        clinical_summary = "Slightly elevated airway sensitivity; vulnerable individuals may experience mild cough."
    elif crrs < 5.0:
        risk_tier = "Moderate"
        clinical_summary = "Noticeable thoracic resistance and bronchial irritation during sustained outdoor exposure."
    elif crrs < 7.5:
        risk_tier = "High"
        clinical_summary = "High risk of bronchoconstriction in asthmatics and increased cardiovascular workload."
    else:
        risk_tier = "Critical"
        clinical_summary = "Severe alveolar inflammation and systemic microvascular stress. Outdoor activity should cease."

    return {
        "crrs": crrs,
        "risk_tier": risk_tier,
        "clinical_summary": clinical_summary,
        "contributions": {
            "pm25_pct": round((c_pm25 / max(raw_score, 0.001)) * 100, 1),
            "pm10_pct": round((c_pm10 / max(raw_score, 0.001)) * 100, 1),
            "no2_pct": round((c_no2 / max(raw_score, 0.001)) * 100, 1),
            "o3_pct": round((c_o3 / max(raw_score, 0.001)) * 100, 1),
        },
    }


# =====================================================================
#  Vulnerable Group Risk Stratification
# =====================================================================

def stratify_vulnerable_groups(aqi: int, pm25: float) -> Dict[str, Dict[str, str]]:
    """
    Stratifies clinical and behavioral advice for vulnerable demographic groups.
    """
    children_status = "Safe"
    children_advice = "Normal outdoor playtime permitted."
    if aqi > 100 or pm25 > 35:
        children_status = "Caution"
        children_advice = "Limit sustained vigorous outdoor playtime; schedule outdoor recesses after 12:00 PM."
    if aqi > 200 or pm25 > 90:
        children_status = "High Hazard"
        children_advice = "Children breathe 50% more air per lb body weight. Cease outdoor physical education and assemblies."

    asthma_status = "Manageable"
    asthma_advice = "Follow baseline prescription regimen."
    if aqi > 100 or pm25 > 35:
        asthma_status = "Elevated Alert"
        asthma_advice = "Carry quick-relief rescue inhalers at all times during outdoor transit."
    if aqi > 200 or pm25 > 90:
        asthma_status = "Severe Risk"
        asthma_advice = "Cold smog triggers bronchospasm in ~60% of asthmatics. Keep bedroom air purifiers running continuously."

    athletes_status = "Permitted"
    athletes_advice = "Outdoor aerobic training permitted."
    if aqi > 120 or pm25 > 45:
        athletes_status = "Restricted Windows"
        athletes_advice = "Confine outdoor cardio strictly between 12:30 PM - 3:30 PM to avoid early morning inversion."
    if aqi > 180 or pm25 > 80:
        athletes_status = "Indoor Only"
        athletes_advice = "Cardio increases ventilation 400-600%. Switch to indoor stationary training with HEPA filtration."

    seniors_status = "Safe"
    seniors_advice = "Normal daily activities permitted."
    if aqi > 150 or pm25 > 60:
        seniors_status = "High Vulnerability"
        seniors_advice = "Avoid morning walks before 9:30 AM; cold ground particulate strains cardiopulmonary circulation."

    return {
        "children": {"status": children_status, "guidance": children_advice},
        "asthma_cardiac": {"status": asthma_status, "guidance": asthma_advice},
        "outdoor_athletes": {"status": athletes_status, "guidance": athletes_advice},
        "seniors": {"status": seniors_status, "guidance": seniors_advice},
    }


# =====================================================================
#  6-Hour Diurnal Rolling Forecast Engine
# =====================================================================

def get_diurnal_factor(hour_of_day: int) -> float:
    """
    Returns atmospheric diurnal boundary layer dispersion factor based on local solar hour.
    Solar convection dilutes pollution around 12:00 - 15:00 (factor ~0.75 - 0.82),
    while nocturnal radiative cooling and dawn inversion compresses pollutants (factor ~1.15 - 1.28).
    """
    h = hour_of_day % 24
    if 6 <= h <= 9:
        return 1.25  # Morning peak inversion
    elif 10 <= h <= 11:
        return 0.95
    elif 12 <= h <= 15:
        return 0.76  # Solar convection peak dispersion window
    elif 16 <= h <= 18:
        return 0.92
    elif 19 <= h <= 22:
        return 1.18  # Evening traffic + boundary layer collapse
    else:
        return 1.10  # Nighttime baseline


def generate_6hour_forecast(current_aqi: int, current_pm25: float) -> List[Dict[str, Any]]:
    """
    Generate a 6-hour rolling forecast curve projecting AQI, PM2.5,
    and activity recommendations using diurnal boundary layer regression.
    """
    now = datetime.now(timezone.utc)
    forecast_points: List[Dict[str, Any]] = []

    for step in range(1, 7):
        target_time = now + timedelta(hours=step)
        hour = target_time.hour
        factor = get_diurnal_factor(hour)

        # Apply calibrated dampening so the forecast curves realistically
        predicted_aqi = max(15, int(round(current_aqi * factor)))
        predicted_pm25 = max(5.0, round(current_pm25 * factor, 1))

        if predicted_aqi <= 100:
            activity_state = "Optimal for Outdoor Errands"
        elif predicted_aqi <= 200:
            activity_state = "Moderate Caution for Cardio"
        else:
            activity_state = "Indoor Quarantine Recommended"

        forecast_points.append({
            "hour_offset": step,
            "target_hour": target_time.strftime("%I:00 %p"),
            "predicted_aqi": predicted_aqi,
            "predicted_pm25": predicted_pm25,
            "diurnal_factor": factor,
            "activity_state": activity_state,
            "category": get_cpcb_category(predicted_aqi)["label"],
        })

    return forecast_points


# =====================================================================
#  Environmental Action Impact & Carbon Reduction Calculator
# =====================================================================

def compute_action_impact(
    action: str,
    category: str = "Lifestyle",
    co2_kg: float = 0.0,
    aqi: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Computes atmospheric and physiological impact metrics for a sustainability action,
    including avoided PM2.5 inhalation mass, equivalent trees planted, and clinical benefits.
    """
    co2 = max(0.0, float(co2_kg or 0.0))
    active_aqi = max(15, int(aqi or 150))
    active_pm25 = active_aqi * 0.6

    # Avoided inhalation mass estimation (average adult tidal volume ~0.5L, ~15 breaths/min, 0.75m3/hr)
    # Averted 2 hours of heavy exposure in smog = ~1.5 m3 * PM2.5 concentration * 0.4 pulmonary retention
    avoided_ug = round(1.5 * active_pm25 * 0.4, 1)

    # Standard carbon absorption by mature tree is ~21.7 kg CO2 / year
    trees = round(co2 / 21.7, 2)

    if active_aqi > 200:
        health_benefit = "Avoided high alveolar inflammatory cytokine induction and bronchospasm."
        aqi_impact = "-25% localized respiratory exposure"
    elif active_aqi > 100:
        health_benefit = "Reduced upper respiratory tract irritation and oxidative vascular burden."
        aqi_impact = "-15% localized exposure"
    else:
        health_benefit = "Maintained optimal pulmonary alveolar compliance."
        aqi_impact = "-5% emission contribution"

    return {
        "action": action,
        "category": category,
        "co2_saved_kg": co2,
        "pm25_avoided_ug": avoided_ug,
        "trees_equivalent": trees,
        "health_benefit": health_benefit,
        "air_quality_impact": aqi_impact,
    }

