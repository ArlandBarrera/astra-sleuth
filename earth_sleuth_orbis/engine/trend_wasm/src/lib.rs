//! Puente wasm-bindgen del motor estadístico de Earth Sleuth Orbis.
//!
//! Toda la matemática del veredicto vive aquí (Rust → WebAssembly, ejecutado en un
//! Web Worker). La interfaz solo dibuja lo que este módulo devuelve.
//!
//! * `analyze`  serie mensual → anomalías, Mann-Kendall (+ Hamed-Rao), Sen con IC 95 %,
//!              Seasonal Mann-Kendall, Pettitt, Significance Horizon y años necesarios
//!              para detectar la tendencia (Weatherhead et al. 1998).
//! * `couple`   dos series mensuales → Spearman ρ global y por régimen (antes/después
//!              de un quiebre). Se usa para el Modo Dipolo y el Regime Decoupling Plot.
//!
//! Las funciones `*_core` son Rust puro (probadas con `cargo test`); los exports
//! `#[wasm_bindgen]` solo convierten JsValue ↔ structs con serde-wasm-bindgen.

use mann_kendall::{
    anomalies, mann_kendall, pettitt, seasonal_mann_kendall, Alternative, Direction, MkError,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------- tipos de entrada

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    /// Año de cada muestra. La serie debe ser una rejilla mensual continua.
    pub years: Vec<i32>,
    /// Mes de cada muestra, 1..=12.
    pub months: Vec<u32>,
    /// Valor mensual; `null`/NaN = dato faltante.
    pub values: Vec<Option<f64>>,
    /// ALL, DJF, JFM, MAM, JJA o SON.
    pub season: String,
    /// Nivel de significancia (0.05 por defecto en la interfaz).
    pub alpha: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoupleRequest {
    /// Clave mensual (año*12 + mes-1) de la serie A.
    pub keys_a: Vec<i64>,
    pub a: Vec<Option<f64>>,
    pub keys_b: Vec<i64>,
    pub b: Vec<Option<f64>>,
    /// Si existe, separa los pares en "antes" (< split) y "después" (>= split).
    pub split_key: Option<i64>,
}

// ---------------------------------------------------------------- tipos de salida

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MkOut {
    pub n: usize,
    pub s: i64,
    pub var_s: f64,
    pub z: f64,
    pub p: f64,
    pub tau: f64,
    pub significant: bool,
    pub direction: &'static str,
    /// Pendiente de Sen en unidades por década.
    pub slope_decade: f64,
    pub ci_decade: (f64, f64),
    /// Factor Var*(S)/Var(S) de Hamed & Rao (> 1 = autocorrelación positiva).
    pub acf_factor: f64,
    pub z_hr: f64,
    pub p_hr: f64,
    pub significant_hr: bool,
    pub ci_hr_decade: (f64, f64),
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeasonalOut {
    pub n: usize,
    pub s: i64,
    pub z: f64,
    pub p: f64,
    pub significant: bool,
    pub direction: &'static str,
    pub slope_decade: f64,
    pub ci_decade: (f64, f64),
    /// S de cada mes (enero..diciembre); 0 si el mes no participa.
    pub month_s: Vec<i64>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PettittOut {
    /// Índice en la rejilla mensual del primer dato del nuevo régimen.
    pub grid_index: usize,
    pub year: i32,
    pub month: u32,
    /// Clave mensual (año*12 + mes-1) del quiebre.
    pub key: i64,
    pub p: f64,
    pub significant: bool,
    pub mean_before: f64,
    pub mean_after: f64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HorizonWindow {
    pub years: u32,
    pub n: usize,
    pub p: f64,
    pub p_hr: f64,
    pub slope_decade: f64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HorizonOut {
    /// Ventanas retrospectivas (los últimos L años), L = 5, 6, ... hasta el total.
    pub windows: Vec<HorizonWindow>,
    /// Años de registro necesarios para detectar la tendencia actual (Weatherhead 1998).
    pub years_needed: Option<f64>,
    /// Años que faltan respecto a lo disponible (0 si ya alcanza).
    pub years_remaining: Option<f64>,
    pub years_available: f64,
    /// Desviación típica del ruido (residuos tras quitar la tendencia).
    pub noise_sd: f64,
    /// Autocorrelación lag-1 del ruido.
    pub phi: f64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GridOut {
    /// Tiempo decimal en años (año + (mes - 0.5)/12) de cada mes de la rejilla.
    pub t: Vec<f64>,
    pub raw: Vec<Option<f64>>,
    pub anom: Vec<Option<f64>>,
    /// Media móvil centrada de 12 meses de las anomalías.
    pub smooth: Vec<Option<f64>>,
    /// Puntos realmente usados por la prueba (anomalía mensual o media estacional).
    pub tested: Vec<Option<f64>>,
    /// Recta de Sen y bordes de su intervalo de confianza 95 %.
    pub fit: Vec<Option<f64>>,
    pub lo: Vec<Option<f64>>,
    pub hi: Vec<Option<f64>>,
    pub lo_hr: Vec<Option<f64>>,
    pub hi_hr: Vec<Option<f64>>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeOut {
    pub season: String,
    pub n_months: usize,
    pub n_valid: usize,
    pub completeness: f64,
    /// Años cubiertos por la serie usada en la prueba.
    pub span_years: f64,
    /// 12 = prueba con anomalías mensuales; 1 = una media estacional por año.
    pub points_per_year: u32,
    pub mk: MkOut,
    pub seasonal: Option<SeasonalOut>,
    pub pettitt: Option<PettittOut>,
    pub horizon: HorizonOut,
    pub grid: GridOut,
    /// Códigos de aviso: "short_series", "low_completeness", "few_points".
    pub warnings: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CorrOut {
    pub n: usize,
    pub rho: f64,
    pub p: f64,
    pub significant: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoupleOut {
    pub all: Option<CorrOut>,
    pub before: Option<CorrOut>,
    pub after: Option<CorrOut>,
    /// Pares alineados (para el diagrama de dispersión).
    pub keys: Vec<i64>,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
}

// ---------------------------------------------------------------- utilidades

fn err_text(e: MkError) -> String {
    match e {
        MkError::TooFewPoints => "Muy pocos datos válidos para la prueba (mínimo 4 puntos).".into(),
        MkError::LengthMismatch => "Las series de tiempo y valores tienen longitudes distintas.".into(),
        MkError::NotIncreasingTime => "El tiempo de la serie no es estrictamente creciente.".into(),
        MkError::BadSeason => "Identificador de estación fuera de rango.".into(),
        MkError::EmptyBaseline => "No hay datos para calcular la climatología mensual.".into(),
    }
}

fn dir_str(d: Direction) -> &'static str {
    match d {
        Direction::Up => "up",
        Direction::Down => "down",
        Direction::Flat => "flat",
    }
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n == 0 {
        return f64::NAN;
    }
    if n % 2 == 1 { v[n / 2] } else { 0.5 * (v[n / 2 - 1] + v[n / 2]) }
}

/// Ordenada al origen de Sen: mediana de (v - pendiente·t).
fn sen_intercept(t: &[f64], v: &[f64], slope: f64) -> f64 {
    let mut r: Vec<f64> = t.iter().zip(v).map(|(x, y)| y - slope * x).collect();
    median(&mut r)
}

fn finite(o: Option<f64>) -> Option<f64> {
    o.filter(|x| x.is_finite())
}

fn opt(x: f64) -> Option<f64> {
    if x.is_finite() { Some(x) } else { None }
}

/// Meses (1..=12) de cada estación y desplazamiento de año para DJF.
fn season_months(code: &str) -> Result<Option<[u32; 3]>, String> {
    Ok(match code {
        "ALL" => None,
        "DJF" => Some([12, 1, 2]),
        "JFM" => Some([1, 2, 3]),
        "MAM" => Some([3, 4, 5]),
        "JJA" => Some([6, 7, 8]),
        "SON" => Some([9, 10, 11]),
        other => return Err(format!("Estación desconocida: {other}")),
    })
}

/// Año estacional: en DJF, diciembre pertenece al invierno del año siguiente.
fn season_year(code: &str, year: i32, month: u32) -> i32 {
    if code == "DJF" && month == 12 { year + 1 } else { year }
}

// ---------------------------------------------------------------- Spearman y t de Student

fn ln_gamma(x: f64) -> f64 {
    // Lanczos (g = 7, n = 9)
    const G: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        let pi = std::f64::consts::PI;
        return (pi / (pi * x).sin()).ln() - ln_gamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut a = G[0];
    let t = x + 7.5;
    for (i, g) in G.iter().enumerate().skip(1) {
        a += g / (x + i as f64);
    }
    0.5 * (2.0 * std::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
}

/// Fracción continua de la beta incompleta (Numerical Recipes, betacf).
fn beta_cf(a: f64, b: f64, x: f64) -> f64 {
    const FPMIN: f64 = 1e-300;
    let (qab, qap, qam) = (a + b, a + 1.0, a - 1.0);
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN { d = FPMIN; }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..300 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN { d = FPMIN; }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN { c = FPMIN; }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN { d = FPMIN; }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN { c = FPMIN; }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-14 { break; }
    }
    h
}

/// Beta incompleta regularizada I_x(a, b).
fn betai(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 { return 0.0; }
    if x >= 1.0 { return 1.0; }
    let ln_bt = ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln();
    let bt = ln_bt.exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * beta_cf(a, b, x) / a
    } else {
        1.0 - bt * beta_cf(b, a, 1.0 - x) / b
    }
}

/// p bilateral de una t de Student con `df` grados de libertad.
fn t_two_sided_p(t: f64, df: f64) -> f64 {
    if !t.is_finite() { return 0.0; }
    betai(0.5 * df, 0.5, df / (df + t * t)).clamp(0.0, 1.0)
}

fn avg_ranks(v: &[f64]) -> Vec<f64> {
    let n = v.len();
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| v[a].total_cmp(&v[b]));
    let mut ranks = vec![0.0; n];
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && v[idx[j + 1]] == v[idx[i]] { j += 1; }
        let r = (i + j) as f64 / 2.0 + 1.0;
        for k in i..=j { ranks[idx[k]] = r; }
        i = j + 1;
    }
    ranks
}

fn pearson(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    let (mx, my) = (x.iter().sum::<f64>() / n, y.iter().sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx) * (a - mx);
        syy += (b - my) * (b - my);
    }
    if sxx <= 0.0 || syy <= 0.0 { return 0.0; }
    sxy / (sxx * syy).sqrt()
}

/// Spearman ρ con p bilateral (aproximación t con n-2 g.l.).
pub fn spearman(x: &[f64], y: &[f64], alpha: f64) -> Option<CorrOut> {
    let n = x.len();
    if n < 5 || n != y.len() { return None; }
    let rho = pearson(&avg_ranks(x), &avg_ranks(y));
    let df = (n - 2) as f64;
    let p = if rho.abs() >= 1.0 {
        0.0
    } else {
        t_two_sided_p(rho * (df / (1.0 - rho * rho)).sqrt(), df)
    };
    Some(CorrOut { n, rho, p, significant: p < alpha })
}

// ---------------------------------------------------------------- análisis principal

fn mk_out(t: &[f64], v: &[f64], alpha: f64) -> Result<MkOut, String> {
    let r = mann_kendall(t, v, alpha, Alternative::TwoSided).map_err(err_text)?;
    Ok(MkOut {
        n: r.n,
        s: r.s,
        var_s: r.var_s,
        z: r.z,
        p: r.p,
        tau: r.tau,
        significant: r.significant,
        direction: dir_str(r.direction),
        slope_decade: r.sen_slope * 10.0,
        ci_decade: (r.sen_ci.0 * 10.0, r.sen_ci.1 * 10.0),
        acf_factor: r.acf_factor,
        z_hr: r.z_hr,
        p_hr: r.p_hr,
        significant_hr: r.significant_hr,
        ci_hr_decade: (r.sen_ci_hr.0 * 10.0, r.sen_ci_hr.1 * 10.0),
    })
}

/// Años de registro necesarios para detectar una tendencia ω (unidades/año) con
/// 90 % de probabilidad al 95 % de confianza (Weatherhead et al. 1998), generalizado a
/// `k` puntos por año: n* = [3.3·σ·√(12/k)/|ω| · √((1+φ)/(1−φ))]^(2/3).
pub fn weatherhead_years(sigma: f64, phi: f64, slope_per_year: f64, k: f64) -> Option<f64> {
    if !(slope_per_year.abs() > 0.0) || !(sigma > 0.0) { return None; }
    let phi = phi.clamp(-0.95, 0.95);
    let base = 3.3 * sigma * (12.0 / k).sqrt() / slope_per_year.abs() * ((1.0 + phi) / (1.0 - phi)).sqrt();
    let n = base.powf(2.0 / 3.0);
    if n.is_finite() { Some(n) } else { None }
}

pub fn analyze_core(req: &AnalyzeRequest) -> Result<AnalyzeOut, String> {
    let n = req.values.len();
    if req.years.len() != n || req.months.len() != n {
        return Err(err_text(MkError::LengthMismatch));
    }
    if n == 0 {
        return Err("La serie está vacía.".into());
    }
    if req.months.iter().any(|&m| !(1..=12).contains(&m)) {
        return Err("Mes fuera de rango (debe ser 1..12).".into());
    }
    let alpha = if req.alpha > 0.0 && req.alpha < 1.0 { req.alpha } else { 0.05 };
    let months_set = season_months(&req.season)?;
    let in_season = |m: u32| months_set.map_or(true, |s| s.contains(&m));

    let t: Vec<f64> = req
        .years
        .iter()
        .zip(&req.months)
        .map(|(&y, &m)| y as f64 + (m as f64 - 0.5) / 12.0)
        .collect();
    if t.windows(2).any(|w| !(w[1] > w[0])) {
        return Err(err_text(MkError::NotIncreasingTime));
    }
    let v: Vec<f64> = req.values.iter().map(|o| finite(*o).unwrap_or(f64::NAN)).collect();
    let n_valid = v.iter().filter(|x| x.is_finite()).count();
    if n_valid < 4 {
        return Err(err_text(MkError::TooFewPoints));
    }
    let season_ids: Vec<usize> = req.months.iter().map(|&m| (m - 1) as usize).collect();
    let anom = anomalies(&v, &season_ids, 12, None).map_err(err_text)?;

    // Media móvil centrada de 12 meses (requiere >= 8 meses válidos).
    let smooth: Vec<Option<f64>> = (0..n)
        .map(|i| {
            let lo = i.saturating_sub(6);
            let hi = (i + 6).min(n);
            let w: Vec<f64> = anom[lo..hi].iter().copied().filter(|x| x.is_finite()).collect();
            if w.len() >= 8 { Some(w.iter().sum::<f64>() / w.len() as f64) } else { None }
        })
        .collect();

    // ---- serie de prueba
    let mut tested: Vec<Option<f64>> = vec![None; n];
    let (mut tt, mut vv, mut keys_idx) = (Vec::new(), Vec::new(), Vec::new());
    let k_per_year: u32;
    match months_set {
        None => {
            k_per_year = 12;
            for i in 0..n {
                if anom[i].is_finite() {
                    tt.push(t[i]);
                    vv.push(anom[i]);
                    keys_idx.push(i);
                    tested[i] = Some(anom[i]);
                }
            }
        }
        Some(set) => {
            k_per_year = 1;
            let center_month = set[1];
            // año estacional -> (suma, cuenta, índice del mes central en la rejilla)
            let mut groups: BTreeMap<i32, (f64, usize, Option<usize>)> = BTreeMap::new();
            for i in 0..n {
                let m = req.months[i];
                if !set.contains(&m) { continue; }
                let sy = season_year(&req.season, req.years[i], m);
                let e = groups.entry(sy).or_insert((0.0, 0, None));
                if m == center_month { e.2 = Some(i); }
                if anom[i].is_finite() {
                    e.0 += anom[i];
                    e.1 += 1;
                }
            }
            for (sy, (sum, cnt, center_idx)) in groups {
                if cnt < 2 { continue; }
                let mean = sum / cnt as f64;
                // tiempo = mes central de la estación (coincide con la rejilla mensual)
                let tc = sy as f64 + (center_month as f64 - 0.5) / 12.0;
                tt.push(tc);
                vv.push(mean);
                let gi = center_idx.unwrap_or_else(|| {
                    // el mes central quedó fuera de la rejilla: usa el más cercano
                    t.iter()
                        .enumerate()
                        .min_by(|a, b| (a.1 - tc).abs().total_cmp(&(b.1 - tc).abs()))
                        .map(|(i, _)| i)
                        .unwrap_or(0)
                });
                keys_idx.push(gi);
                tested[gi] = Some(mean);
            }
        }
    }

    if vv.len() < 4 {
        return Err(format!(
            "Solo hay {} puntos válidos para la estación {}: amplía el periodo.",
            vv.len(),
            req.season
        ));
    }

    let mk = mk_out(&tt, &vv, alpha)?;
    let k = k_per_year as f64;
    let span_years = (tt[tt.len() - 1] - tt[0]) + 1.0 / k;

    // ---- recta de Sen y bordes del intervalo
    // Los bordes del IC pivotan en el centro temporal de la recta de Sen, así la
    // banda tiene la forma habitual de "moño" (más ancha en los extremos).
    let slope = mk.slope_decade / 10.0;
    let b0 = sen_intercept(&tt, &vv, slope);
    let t_mid = median(&mut tt.clone());
    let f_mid = b0 + slope * t_mid;
    let through = |m: f64| (m, f_mid - m * t_mid);
    let lines = [
        (slope, b0),
        through(mk.ci_decade.0 / 10.0),
        through(mk.ci_decade.1 / 10.0),
        through(mk.ci_hr_decade.0 / 10.0),
        through(mk.ci_hr_decade.1 / 10.0),
    ];
    let (t0, t1) = (tt[0], tt[tt.len() - 1]);
    let eval = |(m, b): (f64, f64)| -> Vec<Option<f64>> {
        t.iter()
            .map(|&x| if x >= t0 - 1e-9 && x <= t1 + 1e-9 { opt(b + m * x) } else { None })
            .collect()
    };

    // ---- Seasonal Mann-Kendall (Hirsch 1982) sobre los valores crudos de la estación
    let (mut st, mut sv, mut ss) = (Vec::new(), Vec::new(), Vec::new());
    for i in 0..n {
        if v[i].is_finite() && in_season(req.months[i]) {
            st.push(t[i]);
            sv.push(v[i]);
            ss.push(season_ids[i]);
        }
    }
    let seasonal = seasonal_mann_kendall(&st, &sv, &ss, 12, alpha, Alternative::TwoSided)
        .ok()
        .map(|r| SeasonalOut {
            n: r.n,
            s: r.s,
            z: r.z,
            p: r.p,
            significant: r.significant,
            direction: dir_str(r.direction),
            slope_decade: r.sen_slope * 10.0,
            ci_decade: (r.sen_ci.0 * 10.0, r.sen_ci.1 * 10.0),
            month_s: r.season_s,
        });

    // ---- Pettitt sobre la serie de prueba
    let pettitt = pettitt(&vv, alpha).ok().map(|r| {
        let gi = keys_idx[r.change_index];
        PettittOut {
            grid_index: gi,
            year: req.years[gi],
            month: req.months[gi],
            key: req.years[gi] as i64 * 12 + req.months[gi] as i64 - 1,
            p: r.p,
            significant: r.significant,
            mean_before: r.mean_before,
            mean_after: r.mean_after,
        }
    });

    // ---- Significance Horizon: ventanas retrospectivas de L años
    let mut windows = Vec::new();
    let max_years = span_years.round() as u32;
    for years in 5..=max_years.max(5) {
        let cut = t1 - years as f64 + 1e-6;
        let start = tt.iter().position(|&x| x > cut).unwrap_or(0);
        let (wt, wv) = (&tt[start..], &vv[start..]);
        if wv.len() < 4 { continue; }
        if let Ok(r) = mann_kendall(wt, wv, alpha, Alternative::TwoSided) {
            windows.push(HorizonWindow {
                years,
                n: r.n,
                p: r.p,
                p_hr: r.p_hr,
                slope_decade: r.sen_slope * 10.0,
            });
        }
        if start == 0 { break; }
    }

    // ---- ruido y años necesarios (Weatherhead 1998)
    let b = lines[0].1;
    let resid: Vec<f64> = tt.iter().zip(&vv).map(|(x, y)| y - (b + slope * x)).collect();
    let rm = resid.iter().sum::<f64>() / resid.len() as f64;
    let c0: f64 = resid.iter().map(|r| (r - rm) * (r - rm)).sum();
    let noise_sd = (c0 / (resid.len().saturating_sub(1).max(1)) as f64).sqrt();
    let c1: f64 = resid.windows(2).map(|w| (w[0] - rm) * (w[1] - rm)).sum();
    let phi = if c0 > 0.0 { c1 / c0 } else { 0.0 };
    let years_needed = weatherhead_years(noise_sd, phi, slope, k);
    let horizon = HorizonOut {
        windows,
        years_needed,
        years_remaining: years_needed.map(|y| (y - span_years).max(0.0)),
        years_available: span_years,
        noise_sd,
        phi,
    };

    let completeness = n_valid as f64 / n as f64;
    let mut warnings = Vec::new();
    if span_years < 15.0 { warnings.push("short_series".to_string()); }
    if completeness < 0.8 { warnings.push("low_completeness".to_string()); }
    if vv.len() < 10 { warnings.push("few_points".to_string()); }

    Ok(AnalyzeOut {
        season: req.season.clone(),
        n_months: n,
        n_valid,
        completeness,
        span_years,
        points_per_year: k_per_year,
        mk,
        seasonal,
        pettitt,
        horizon,
        grid: GridOut {
            t: t.clone(),
            raw: v.iter().map(|&x| opt(x)).collect(),
            anom: anom.iter().map(|&x| opt(x)).collect(),
            smooth,
            tested,
            fit: eval(lines[0]),
            lo: eval(lines[1]),
            hi: eval(lines[2]),
            lo_hr: eval(lines[3]),
            hi_hr: eval(lines[4]),
        },
        warnings,
    })
}

pub fn couple_core(req: &CoupleRequest, alpha: f64) -> Result<CoupleOut, String> {
    if req.keys_a.len() != req.a.len() || req.keys_b.len() != req.b.len() {
        return Err(err_text(MkError::LengthMismatch));
    }
    let bmap: BTreeMap<i64, f64> = req
        .keys_b
        .iter()
        .zip(&req.b)
        .filter_map(|(k, v)| finite(*v).map(|x| (*k, x)))
        .collect();
    let (mut keys, mut x, mut y) = (Vec::new(), Vec::new(), Vec::new());
    for (k, v) in req.keys_a.iter().zip(&req.a) {
        if let (Some(av), Some(bv)) = (finite(*v), bmap.get(k)) {
            keys.push(*k);
            x.push(av);
            y.push(*bv);
        }
    }
    let all = spearman(&x, &y, alpha);
    let (before, after) = match req.split_key {
        Some(s) => {
            let pick = |want_before: bool| -> (Vec<f64>, Vec<f64>) {
                keys.iter()
                    .zip(x.iter().zip(&y))
                    .filter(|(k, _)| (**k < s) == want_before)
                    .map(|(_, (a, b))| (*a, *b))
                    .unzip()
            };
            let (bx, by) = pick(true);
            let (ax, ay) = pick(false);
            (spearman(&bx, &by, alpha), spearman(&ax, &ay, alpha))
        }
        None => (None, None),
    };
    Ok(CoupleOut { all, before, after, keys, x, y })
}

// ---------------------------------------------------------------- exports wasm

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    let ser = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    v.serialize(&ser).map_err(|e| JsError::new(&e.to_string()))
}

/// Analiza una serie mensual. Ver `AnalyzeRequest` / `AnalyzeOut`.
#[wasm_bindgen]
pub fn analyze(request: JsValue) -> Result<JsValue, JsError> {
    let req: AnalyzeRequest =
        serde_wasm_bindgen::from_value(request).map_err(|e| JsError::new(&e.to_string()))?;
    let out = analyze_core(&req).map_err(|e| JsError::new(&e))?;
    to_js(&out)
}

/// Correlación de Spearman entre dos series mensuales alineadas por clave.
#[wasm_bindgen]
pub fn couple(request: JsValue, alpha: f64) -> Result<JsValue, JsError> {
    let req: CoupleRequest =
        serde_wasm_bindgen::from_value(request).map_err(|e| JsError::new(&e.to_string()))?;
    let out = couple_core(&req, if alpha > 0.0 && alpha < 1.0 { alpha } else { 0.05 })
        .map_err(|e| JsError::new(&e))?;
    to_js(&out)
}

/// Versión del motor (se muestra en la interfaz y en el dossier).
#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("trend_wasm {} · mann_kendall 0.1.0", env!("CARGO_PKG_VERSION"))
}

// ---------------------------------------------------------------- pruebas

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool { (a - b).abs() < tol }

    fn monthly(y0: i32, years: i32, f: impl Fn(usize, u32) -> Option<f64>) -> AnalyzeRequest {
        let (mut ys, mut ms, mut vs) = (vec![], vec![], vec![]);
        let mut i = 0;
        for y in y0..y0 + years {
            for m in 1..=12u32 {
                ys.push(y);
                ms.push(m);
                vs.push(f(i, m));
                i += 1;
            }
        }
        AnalyzeRequest { years: ys, months: ms, values: vs, season: "ALL".into(), alpha: 0.05 }
    }

    /// Ruido pseudoaleatorio determinista en [-0.5, 0.5).
    fn noise(i: usize) -> f64 {
        let x = ((i as u64).wrapping_mul(2_654_435_761) ^ 0x9E37_79B9) % 10_000;
        x as f64 / 10_000.0 - 0.5
    }

    #[test]
    fn t_distribution_known_values() {
        // t = 2.228, df = 10 -> p ≈ 0.05 ; t = 1.96, df grande -> p ≈ 0.05
        assert!(close(t_two_sided_p(2.228, 10.0), 0.05, 5e-4));
        assert!(close(t_two_sided_p(1.96, 1e6), 0.05, 5e-4));
        assert!(close(t_two_sided_p(0.0, 10.0), 1.0, 1e-9));
    }

    #[test]
    fn spearman_monotonic_and_ties() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let r = spearman(&x, &[2.0, 4.0, 9.0, 16.0, 25.0, 36.0], 0.05).unwrap();
        assert!(close(r.rho, 1.0, 1e-12) && r.p == 0.0 && r.significant);
        let r = spearman(&x, &[6.0, 5.0, 4.0, 3.0, 2.0, 1.0], 0.05).unwrap();
        assert!(close(r.rho, -1.0, 1e-12));
        // ejemplo clásico: ρ = 0.6 (n = 5 rechazado), con n = 6
        let r = spearman(&x, &[1.0, 3.0, 2.0, 5.0, 4.0, 6.0], 0.05).unwrap();
        assert!(close(r.rho, 0.885_714, 1e-5));
        assert!(spearman(&x[..4], &x[..4], 0.05).is_none());
    }

    #[test]
    fn detects_monthly_trend_with_seasonal_cycle() {
        // ciclo estacional fuerte + 0.3 unidades/década + ruido
        let req = monthly(1981, 40, |i, m| {
            let t = i as f64 / 12.0;
            Some(10.0 * ((m as f64) * 0.52).sin() + 0.03 * t + noise(i))
        });
        let r = analyze_core(&req).unwrap();
        assert_eq!(r.points_per_year, 12);
        assert!(r.mk.significant && r.mk.direction == "up");
        assert!(close(r.mk.slope_decade, 0.3, 0.05), "slope {}", r.mk.slope_decade);
        assert!(r.mk.ci_decade.0 <= r.mk.slope_decade && r.mk.slope_decade <= r.mk.ci_decade.1);
        assert!(r.seasonal.as_ref().unwrap().significant);
        assert!(r.horizon.years_remaining == Some(0.0));
        assert!(!r.horizon.windows.is_empty());
        assert_eq!(r.grid.t.len(), 480);
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn season_filter_builds_annual_means() {
        let mut req = monthly(1990, 20, |i, _| Some(0.1 * (i / 12) as f64 + noise(i)));
        req.season = "JJA".into();
        let r = analyze_core(&req).unwrap();
        assert_eq!(r.points_per_year, 1);
        assert_eq!(r.mk.n, 20);
        // los puntos probados caen en julio (mes central)
        let idx: Vec<usize> = r.grid.tested.iter().enumerate().filter(|(_, v)| v.is_some()).map(|(i, _)| i).collect();
        assert!(idx.iter().all(|&i| req.months[i] == 7));
        assert!(close(r.mk.slope_decade, 1.0, 0.1));
    }

    #[test]
    fn djf_assigns_december_to_next_winter() {
        let mut req = monthly(2000, 10, |i, _| Some(noise(i)));
        req.season = "DJF".into();
        let r = analyze_core(&req).unwrap();
        // inviernos 2000 (solo ene-feb) ... 2010 (solo dic 2009): 2010 tiene 1 mes y se descarta
        assert_eq!(r.mk.n, 10);
    }

    #[test]
    fn missing_values_and_completeness() {
        let req = monthly(2000, 20, |i, _| if i % 4 == 0 { None } else { Some(noise(i)) });
        let r = analyze_core(&req).unwrap();
        assert!(close(r.completeness, 0.75, 1e-9));
        assert!(r.warnings.contains(&"low_completeness".to_string()));
        assert!(r.grid.raw[0].is_none() && r.grid.anom[0].is_none());
    }

    #[test]
    fn pettitt_marks_step_in_grid() {
        let req = monthly(2000, 20, |i, _| Some(if i >= 120 { 2.0 } else { 0.0 } + noise(i) * 0.2));
        let r = analyze_core(&req).unwrap();
        let p = r.pettitt.unwrap();
        assert!(p.significant);
        assert_eq!((p.year, p.month), (2010, 1));
        assert_eq!(p.key, 2010 * 12);
    }

    #[test]
    fn short_noisy_series_needs_more_years() {
        let req = monthly(2015, 8, |i, _| Some(0.002 * i as f64 + 3.0 * noise(i)));
        let r = analyze_core(&req).unwrap();
        assert!(r.warnings.contains(&"short_series".to_string()));
        let need = r.horizon.years_needed.unwrap();
        assert!(need > 8.0, "need {need}");
        assert!(r.horizon.years_remaining.unwrap() > 0.0);
    }

    #[test]
    fn errors_are_readable() {
        let req = monthly(2000, 1, |_, _| None);
        assert!(analyze_core(&req).unwrap_err().contains("Muy pocos"));
        let mut bad = monthly(2000, 5, |i, _| Some(noise(i)));
        bad.season = "XYZ".into();
        assert!(analyze_core(&bad).is_err());
    }

    #[test]
    fn couple_aligns_and_splits() {
        let keys: Vec<i64> = (0..40).collect();
        let a: Vec<Option<f64>> = keys.iter().map(|&k| Some(k as f64 + noise(k as usize))).collect();
        // B: misma tendencia en la primera mitad, opuesta en la segunda; falta k = 3
        let b: Vec<Option<f64>> = keys
            .iter()
            .map(|&k| if k == 3 { None } else if k < 20 { Some(k as f64) } else { Some(-(k as f64)) })
            .collect();
        let out = couple_core(
            &CoupleRequest { keys_a: keys.clone(), a, keys_b: keys, b, split_key: Some(20) },
            0.05,
        )
        .unwrap();
        assert_eq!(out.x.len(), 39);
        assert!(out.before.as_ref().unwrap().rho > 0.9);
        assert!(out.after.as_ref().unwrap().rho < -0.9);
    }
}
