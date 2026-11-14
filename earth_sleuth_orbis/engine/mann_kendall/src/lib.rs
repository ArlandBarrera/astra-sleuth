//! Mann-Kendall trend analysis for time series (no dependencies).
//!
//! * `mann_kendall`          plain MK + tie correction, Sen's slope with CI,
//!                           and the Hamed-Rao (1998) autocorrelation-corrected variant
//! * `seasonal_mann_kendall` Hirsch et al. (1982): compare Jan with Jan, Feb with Feb, ...
//! * `anomalies`             remove a monthly climatology (optionally from a base period)
//! * `pettitt`              Pettitt (1979) change-point test
//! * `benjamini_hochberg`    FDR adjustment for many tests (grids, many variables)
use std::collections::BTreeMap;

#[derive(Debug, PartialEq)]
pub enum MkError {
    TooFewPoints,
    LengthMismatch,
    NotIncreasingTime,
    BadSeason,
    EmptyBaseline,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Alternative { TwoSided, Increasing, Decreasing }

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Direction { Up, Down, Flat }

/// Result of `mann_kendall`. Fields without a suffix assume independent data.
/// Fields ending in `_hr` use the Hamed-Rao variance correction (autocorrelation).
/// A "correct autocorrelation" switch in a UI just chooses which set to show.
#[derive(Debug)]
pub struct MkResult {
    pub n: usize,
    pub s: i64,
    pub var_s: f64,
    pub z: f64,
    pub p: f64,
    pub significant: bool,
    pub direction: Direction,
    pub tau: f64,
    pub sen_slope: f64,        // units of v per unit of t
    pub sen_ci: (f64, f64),    // (1 - alpha) confidence interval of the slope
    // --- Hamed-Rao ---
    pub acf_factor: f64,       // Var*(S) / Var(S); > 1 means positive autocorrelation inflated Z
    pub var_s_hr: f64,
    pub z_hr: f64,
    pub p_hr: f64,
    pub significant_hr: bool,
    pub sen_ci_hr: (f64, f64),
}

#[derive(Debug)]
pub struct SeasonalResult {
    pub n: usize,              // samples in seasons that had >= 2 values
    pub s: i64,                // sum of the per-season S
    pub var_s: f64,            // sum of the per-season variances
    pub z: f64,
    pub p: f64,
    pub significant: bool,
    pub direction: Direction,
    pub sen_slope: f64,        // median of all within-season slopes, units of v per unit of t
    pub sen_ci: (f64, f64),
    pub season_s: Vec<i64>,    // S of each season: do they agree in sign?
}

#[derive(Debug)]
pub struct PettittResult {
    pub change_index: usize,   // first sample of the new regime (t[change_index] is the first "after")
    pub k: f64,                // max |U_t|
    pub p: f64,                // approximate two-sided p-value
    pub significant: bool,
    pub mean_before: f64,
    pub mean_after: f64,
}

// ---------- core pieces (private) ----------

fn s_statistic(v: &[f64]) -> i64 {
    let mut s = 0i64;
    for i in 0..v.len().saturating_sub(1) {
        for j in (i + 1)..v.len() {
            s += (v[j] > v[i]) as i64 - (v[j] < v[i]) as i64; // ties add 0
        }
    }
    s
}

fn tie_term(v: &[f64]) -> f64 {
    let mut sorted = v.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let (mut term, mut run) = (0.0, 1usize);
    for k in 1..=sorted.len() {
        if k < sorted.len() && sorted[k] == sorted[k - 1] {
            run += 1;
        } else {
            if run > 1 {
                let t = run as f64;
                term += t * (t - 1.0) * (2.0 * t + 5.0);
            }
            run = 1;
        }
    }
    term
}

fn var_s(v: &[f64]) -> f64 {
    let n = v.len() as f64;
    (n * (n - 1.0) * (2.0 * n + 5.0) - tie_term(v)) / 18.0
}

fn z_score(s: i64, var: f64) -> f64 {
    if s == 0 || var <= 0.0 { return 0.0; }
    let sd = var.sqrt();
    if s > 0 { (s as f64 - 1.0) / sd } else { (s as f64 + 1.0) / sd }
}

/// Standard normal CDF, Abramowitz & Stegun 26.2.17 (error < 7.5e-8).
fn norm_cdf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.2316419 * x.abs());
    let poly = t * (0.319381530
        + t * (-0.356563782
        + t * (1.781477937
        + t * (-1.821255978
        + t * 1.330274429))));
    let pdf = (-0.5 * x * x).exp() / (2.0 * std::f64::consts::PI).sqrt();
    let upper = pdf * poly; // P(Z > |x|)
    if x >= 0.0 { 1.0 - upper } else { upper }
}

/// Inverse normal CDF (Acklam's rational approximation, relative error ~1e-9).
/// Gives the 1.96 / 1.645 critical values for any alpha.
fn norm_ppf(p: f64) -> f64 {
    const A: [f64; 6] = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
                         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const B: [f64; 5] = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
                         6.680131188771972e+01, -1.328068155288572e+01];
    const C: [f64; 6] = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
                         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const D: [f64; 4] = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
                         3.754408661907416e+00];
    let p_low = 0.02425;
    if p <= 0.0 { return f64::NEG_INFINITY; }
    if p >= 1.0 { return f64::INFINITY; }
    if p < p_low {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= 1.0 - p_low {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    }
}

fn p_value(z: f64, alt: Alternative) -> f64 {
    match alt {
        Alternative::TwoSided   => 2.0 * norm_cdf(-z.abs()),
        Alternative::Increasing => norm_cdf(-z),
        Alternative::Decreasing => norm_cdf(z),
    }
}

fn direction_of(s: i64) -> Direction {
    match s.signum() { 1 => Direction::Up, -1 => Direction::Down, _ => Direction::Flat }
}

/// All pairwise slopes (v_j - v_i)/(t_j - t_i), sorted ascending.
fn sorted_slopes(t: &[f64], v: &[f64]) -> Vec<f64> {
    let n = v.len();
    let mut slopes = Vec::with_capacity(n * n.saturating_sub(1) / 2);
    for i in 0..n.saturating_sub(1) {
        for j in (i + 1)..n {
            slopes.push((v[j] - v[i]) / (t[j] - t[i]));
        }
    }
    slopes.sort_by(|a, b| a.total_cmp(b));
    slopes
}

fn median_sorted(s: &[f64]) -> f64 {
    let n = s.len();
    if n % 2 == 1 { s[n / 2] } else { 0.5 * (s[n / 2 - 1] + s[n / 2]) }
}

/// Sen (1968) / Gilbert (1987) confidence interval of the slope.
/// C = z(1 - alpha/2) * sqrt(Var(S)); lower = round((N - C)/2)-th, upper = round((N + C)/2 + 1)-th
/// of the N sorted slopes (1-based).
fn sen_ci(sorted: &[f64], var: f64, alpha: f64) -> (f64, f64) {
    let n = sorted.len();
    let c = norm_ppf(1.0 - alpha / 2.0) * var.max(0.0).sqrt();
    let nf = n as f64;
    let lo = (((nf - c) / 2.0).round().max(1.0) as usize).min(n);
    let hi = (((nf + c) / 2.0 + 1.0).round().max(1.0) as usize).min(n);
    (sorted[lo - 1], sorted[hi - 1])
}

/// Average ranks (ties share the mean rank), 1-based.
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

/// Hamed & Rao (1998): detrend with Sen's slope, rank the residuals, and use the
/// significant autocorrelations of those ranks to rescale Var(S).
/// Returns n/n*_s, the factor that multiplies Var(S).
fn hamed_rao_factor(t: &[f64], v: &[f64], slope: f64, alpha: f64) -> f64 {
    let n = v.len();
    let resid: Vec<f64> = v.iter().zip(t).map(|(y, x)| y - slope * x).collect();
    let r = avg_ranks(&resid);
    let nf = n as f64;
    let mean = r.iter().sum::<f64>() / nf;
    let c0: f64 = r.iter().map(|x| (x - mean) * (x - mean)).sum();
    if c0 <= 0.0 { return 1.0; }
    let bound = norm_ppf(1.0 - alpha / 2.0) / nf.sqrt();
    let mut acc = 0.0;
    for k in 1..n.saturating_sub(2) {
        let ck: f64 = (0..n - k).map(|i| (r[i] - mean) * (r[i + k] - mean)).sum();
        let rho = ck / c0;
        if rho.abs() > bound {
            let m = (n - k) as f64;
            acc += m * (m - 1.0) * (m - 2.0) * rho;
        }
    }
    let f = 1.0 + 2.0 / (nf * (nf - 1.0) * (nf - 2.0)) * acc;
    // Only inflate Var(S). Spurious negative autocorrelations over many lags push the
    // factor below 1 even for white noise (median ~0.85 for monthly series), which made
    // the "corrected" test reject MORE often than the raw one (~9 % vs 5 %).
    if f.is_finite() { f.max(1.0) } else { 1.0 }
}

fn check_time(t: &[f64]) -> Result<(), MkError> {
    if t.windows(2).any(|w| !(w[1] > w[0])) { Err(MkError::NotIncreasingTime) } else { Ok(()) }
}

// ---------- public API: Mann-Kendall ----------

pub fn mann_kendall(t: &[f64], v: &[f64], alpha: f64, alt: Alternative)
    -> Result<MkResult, MkError>
{
    if t.len() != v.len() { return Err(MkError::LengthMismatch); }
    if v.len() < 4 { return Err(MkError::TooFewPoints); }
    check_time(t)?;

    let n = v.len();
    let s = s_statistic(v);
    let var = var_s(v);
    let z = z_score(s, var);
    let p = p_value(z, alt);
    let pairs = (n * (n - 1) / 2) as f64;

    let slopes = sorted_slopes(t, v);
    let sen = median_sorted(&slopes);

    let factor = hamed_rao_factor(t, v, sen, alpha);
    let var_hr = var * factor;
    let z_hr = z_score(s, var_hr);
    let p_hr = p_value(z_hr, alt);

    Ok(MkResult {
        n, s, var_s: var, z, p,
        significant: p < alpha,
        direction: direction_of(s),
        tau: s as f64 / pairs,
        sen_slope: sen,
        sen_ci: sen_ci(&slopes, var, alpha),
        acf_factor: factor,
        var_s_hr: var_hr,
        z_hr,
        p_hr,
        significant_hr: p_hr < alpha,
        sen_ci_hr: sen_ci(&slopes, var_hr, alpha),
    })
}

// ---------- public API: seasonality ----------

/// Month of year (0 = Jan ... 11 = Dec) and civil date from unix seconds (UTC).
pub fn civil_from_unix(t: f64) -> (i32, u32, u32) {
    let z = (t / 86_400.0).floor() as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y } as i32, m, d)
}

/// Season ids for monthly grouping: 0..=11.
pub fn months_of(t_unix: &[f64]) -> Vec<usize> {
    t_unix.iter().map(|&t| civil_from_unix(t).1 as usize - 1).collect()
}

/// Season ids for hour-of-day grouping: 0..=23.
pub fn hours_of(t_unix: &[f64]) -> Vec<usize> {
    t_unix.iter().map(|&t| (t.rem_euclid(86_400.0) / 3600.0) as usize).collect()
}

/// true for samples whose calendar year is in [y0, y1] (e.g. 1991..=2020 for a climatology).
pub fn year_mask(t_unix: &[f64], y0: i32, y1: i32) -> Vec<bool> {
    t_unix.iter().map(|&t| { let y = civil_from_unix(t).0; y >= y0 && y <= y1 }).collect()
}

/// Deseasonalize: subtract each season's mean (computed over the `base` samples only,
/// or over everything when `base` is None). NaN inputs stay NaN.
pub fn anomalies(v: &[f64], season: &[usize], n_seasons: usize, base: Option<&[bool]>)
    -> Result<Vec<f64>, MkError>
{
    if v.len() != season.len() || base.map_or(false, |b| b.len() != v.len()) {
        return Err(MkError::LengthMismatch);
    }
    if season.iter().any(|&s| s >= n_seasons) { return Err(MkError::BadSeason); }
    let mut sum = vec![0.0; n_seasons];
    let mut cnt = vec![0usize; n_seasons];
    for i in 0..v.len() {
        if v[i].is_finite() && base.map_or(true, |b| b[i]) {
            sum[season[i]] += v[i];
            cnt[season[i]] += 1;
        }
    }
    if (0..v.len()).any(|i| v[i].is_finite() && cnt[season[i]] == 0) {
        return Err(MkError::EmptyBaseline);
    }
    Ok((0..v.len()).map(|i| {
        if v[i].is_finite() { v[i] - sum[season[i]] / cnt[season[i]] as f64 } else { f64::NAN }
    }).collect())
}

/// Seasonal Mann-Kendall (Hirsch, Slack & Smith 1982) with the seasonal Sen slope.
/// `season[i]` in 0..n_seasons labels each sample (e.g. `months_of(&t_unix)`).
/// S and Var(S) are computed inside each season and added; seasons are assumed independent.
/// The slope is the median of all within-season slopes, in units of v per unit of t.
pub fn seasonal_mann_kendall(t: &[f64], v: &[f64], season: &[usize], n_seasons: usize,
                             alpha: f64, alt: Alternative) -> Result<SeasonalResult, MkError>
{
    if t.len() != v.len() || v.len() != season.len() { return Err(MkError::LengthMismatch); }
    if season.iter().any(|&s| s >= n_seasons) { return Err(MkError::BadSeason); }
    check_time(t)?;

    let mut tg = vec![Vec::new(); n_seasons];
    let mut vg = vec![Vec::new(); n_seasons];
    for i in 0..v.len() {
        tg[season[i]].push(t[i]);
        vg[season[i]].push(v[i]);
    }
    let (mut s_tot, mut var_tot, mut n_used) = (0i64, 0.0, 0usize);
    let mut season_s = vec![0i64; n_seasons];
    let mut slopes: Vec<f64> = Vec::new();
    for g in 0..n_seasons {
        if vg[g].len() < 2 { continue; }
        season_s[g] = s_statistic(&vg[g]);
        s_tot += season_s[g];
        var_tot += var_s(&vg[g]);
        n_used += vg[g].len();
        slopes.extend(sorted_slopes(&tg[g], &vg[g]));
    }
    if slopes.is_empty() { return Err(MkError::TooFewPoints); }
    slopes.sort_by(|a, b| a.total_cmp(b));

    let z = z_score(s_tot, var_tot);
    let p = p_value(z, alt);
    Ok(SeasonalResult {
        n: n_used, s: s_tot, var_s: var_tot, z, p,
        significant: p < alpha,
        direction: direction_of(s_tot),
        sen_slope: median_sorted(&slopes),
        sen_ci: sen_ci(&slopes, var_tot, alpha),
        season_s,
    })
}

// ---------- public API: change point and multiple testing ----------

/// Pettitt (1979) change-point test. U_t = sum_{i<=t} sum_{j>t} sgn(x_i - x_j),
/// computed from ranks. K = max|U_t|, p ~ 2 exp(-6 K^2 / (n^3 + n^2)) (approximation).
/// A rise gives a negative U at the change; a drop gives a positive U.
pub fn pettitt(v: &[f64], alpha: f64) -> Result<PettittResult, MkError> {
    let n = v.len();
    if n < 4 { return Err(MkError::TooFewPoints); }
    let r = avg_ranks(v);
    let nf = n as f64;
    let (mut cum, mut best_t, mut best_u) = (0.0f64, 1usize, 0.0f64);
    for t in 1..n {
        cum += r[t - 1];
        let u = 2.0 * cum - t as f64 * (nf + 1.0);
        if u.abs() > best_u.abs() { best_u = u; best_t = t; }
    }
    let k = best_u.abs();
    let p = (2.0 * (-6.0 * k * k / (nf.powi(3) + nf.powi(2))).exp()).min(1.0);
    let mean = |s: &[f64]| s.iter().sum::<f64>() / s.len() as f64;
    Ok(PettittResult {
        change_index: best_t,
        k,
        p,
        significant: p < alpha,
        mean_before: mean(&v[..best_t]),
        mean_after: mean(&v[best_t..]),
    })
}

/// Benjamini-Hochberg adjusted p-values (q-values), in the input order.
/// Reject test i at false-discovery rate q if the returned value is <= q.
/// Valid for independent or positively dependent tests.
pub fn benjamini_hochberg(p: &[f64]) -> Vec<f64> {
    let m = p.len();
    let mut order: Vec<usize> = (0..m).collect();
    order.sort_by(|&a, &b| p[a].total_cmp(&p[b]));
    let mut q = vec![0.0; m];
    let mut running_min = 1.0f64;
    for rank in (1..=m).rev() {
        let i = order[rank - 1];
        running_min = running_min.min(p[i] * m as f64 / rank as f64);
        q[i] = running_min;
    }
    q
}

// ---------- helpers for raw satellite data ----------

/// Drop NaN/inf readings (dropouts) but keep timestamps aligned.
pub fn drop_missing(t: &[f64], v: &[f64]) -> (Vec<f64>, Vec<f64>) {
    t.iter().zip(v).filter(|(_, y)| y.is_finite()).map(|(&a, &b)| (a, b)).unzip()
}

/// Sub-daily samples (unix seconds) -> one mean per day. Output time is in days.
pub fn daily_means(t_unix: &[f64], v: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let mut days: BTreeMap<i64, (f64, usize)> = BTreeMap::new();
    for (&t, &y) in t_unix.iter().zip(v) {
        if !y.is_finite() { continue; }
        let e = days.entry((t / 86_400.0).floor() as i64).or_insert((0.0, 0));
        e.0 += y;
        e.1 += 1;
    }
    days.into_iter().map(|(d, (sum, c))| (d as f64, sum / c as f64)).unzip()
}

/// Lower-level seasonal MK on pre-grouped values: returns (S', Var(S'), Z).
/// Prefer `seasonal_mann_kendall`, which also returns p, direction and the Sen slope.
pub fn seasonal_mk(groups: &[Vec<f64>]) -> (i64, f64, f64) {
    let (mut s_tot, mut var_tot) = (0i64, 0.0);
    for g in groups.iter().filter(|g| g.len() >= 2) {
        s_tot += s_statistic(g);
        var_tot += var_s(g);
    }
    (s_tot, var_tot, z_score(s_tot, var_tot))
}

/// Split by hour of day (24 groups) so the diurnal cycle never enters a comparison.
pub fn group_by_hour(t_unix: &[f64], v: &[f64]) -> Vec<Vec<f64>> {
    let mut groups = vec![Vec::new(); 24];
    for (&t, &y) in t_unix.iter().zip(v) {
        if y.is_finite() {
            groups[(t.rem_euclid(86_400.0) / 3600.0) as usize].push(y);
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    fn close(a: f64, b: f64, tol: f64) -> bool { (a - b).abs() < tol }
    fn idx(n: usize) -> Vec<f64> { (1..=n).map(|i| i as f64).collect() }
    const UP: [f64; 8] = [10.0, 12.0, 11.0, 14.0, 13.0, 15.0, 17.0, 16.0];

    #[test]
    fn hand_example_up() {
        let r = mann_kendall(&idx(8), &UP, 0.05, Alternative::TwoSided).unwrap();
        assert_eq!(r.s, 22);
        assert!(close(r.var_s, 65.3333, 1e-3));
        assert!(close(r.z, 2.598, 1e-3));
        assert!(close(r.p, 0.0094, 5e-4));
        assert!(close(r.tau, 22.0 / 28.0, 1e-9));
        assert!(close(r.sen_slope, 1.0, 1e-9));
        assert!(r.significant && r.direction == Direction::Up);
        assert!(r.sen_ci.0 <= r.sen_slope && r.sen_slope <= r.sen_ci.1);
    }
    #[test]
    fn hand_example_down() {
        let v = [16.0, 17.0, 15.0, 13.0, 14.0, 11.0, 12.0, 10.0];
        let r = mann_kendall(&idx(8), &v, 0.05, Alternative::TwoSided).unwrap();
        assert_eq!(r.s, -22);
        assert!(close(r.z, -2.598, 1e-3));
        assert!(r.significant && r.direction == Direction::Down);
        let up = mann_kendall(&idx(8), &v, 0.05, Alternative::Increasing).unwrap();
        assert!(!up.significant);
    }
    #[test]
    fn ties_example() {
        let v = [5.0, 7.0, 7.0, 9.0, 10.0, 12.0];
        let r = mann_kendall(&idx(6), &v, 0.05, Alternative::TwoSided).unwrap();
        assert_eq!(r.s, 14);
        assert!(close(r.var_s, 27.3333, 1e-3));
        assert!(close(r.z, 2.49, 5e-3));
    }
    #[test]
    fn even_median_averages() {
        let r = mann_kendall(&idx(4), &[1.0, 2.0, 4.0, 3.0], 0.05, Alternative::TwoSided).unwrap();
        assert!(close(r.sen_slope, 0.8333333, 1e-6));
    }
    #[test]
    fn real_timestamps_change_slope_units() {
        let t = [0.0, 2.0, 4.0, 6.0, 8.0];
        let v = [1.0, 2.0, 3.0, 4.0, 5.0];
        let r = mann_kendall(&t, &v, 0.05, Alternative::TwoSided).unwrap();
        assert!(close(r.sen_slope, 0.5, 1e-9));
    }
    #[test]
    fn errors() {
        assert_eq!(mann_kendall(&idx(3), &[1.0, 2.0, 3.0], 0.05, Alternative::TwoSided).unwrap_err(), MkError::TooFewPoints);
        assert_eq!(mann_kendall(&idx(4), &[1.0, 2.0], 0.05, Alternative::TwoSided).unwrap_err(), MkError::LengthMismatch);
        assert_eq!(mann_kendall(&[1.0, 1.0, 2.0, 3.0], &[1.0, 2.0, 3.0, 4.0], 0.05, Alternative::TwoSided).unwrap_err(), MkError::NotIncreasingTime);
    }
    #[test]
    fn all_equal_is_flat_no_nan() {
        let r = mann_kendall(&idx(6), &[3.0; 6], 0.05, Alternative::TwoSided).unwrap();
        assert_eq!(r.s, 0);
        assert!(r.z == 0.0 && r.p > 0.99 && !r.significant && r.direction == Direction::Flat);
        assert!(r.z_hr == 0.0 && r.acf_factor == 1.0 && r.sen_ci.0.is_finite());
    }
    #[test]
    fn hamed_rao_never_shrinks_variance() {
        // alternating series: strong negative lag-1 autocorrelation
        let v: Vec<f64> = (0..60).map(|i| 0.05 * i as f64 + if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let r = mann_kendall(&idx(60), &v, 0.05, Alternative::TwoSided).unwrap();
        assert!(r.acf_factor >= 1.0);
        assert!(r.p_hr >= r.p - 1e-15);
    }
    #[test]
    fn missing_values() {
        let nan = f64::NAN;
        let (t, v) = drop_missing(&[1.0, 2.0, 3.0, 4.0], &[1.0, nan, 3.0, 4.0]);
        assert_eq!(t, vec![1.0, 3.0, 4.0]);
        assert_eq!(v, vec![1.0, 3.0, 4.0]);
    }
    #[test]
    fn daily_mean_groups() {
        let t = [0.0, 3600.0, 86_400.0, 90_000.0];
        let (d, m) = daily_means(&t, &[10.0, 20.0, 30.0, 50.0]);
        assert_eq!(d, vec![0.0, 1.0]);
        assert_eq!(m, vec![15.0, 40.0]);
    }
    #[test]
    fn seasonal_example() {
        let groups = vec![
            vec![20.0, 22.0, 25.0, 26.0], vec![30.0, 33.0, 31.0, 36.0],
            vec![40.0, 41.0, 45.0, 47.0], vec![25.0, 24.0, 27.0, 26.0]];
        let (s, var, z) = seasonal_mk(&groups);
        assert_eq!(s, 18);
        assert!(close(var, 34.667, 1e-3));
        assert!(close(z, 2.887, 1e-3));
    }
    #[test]
    fn seasonal_full_matches_hand_example() {
        // quarterly table from the explanation, time = year number, season = quarter
        let tab = [[20.0, 30.0, 40.0, 25.0], [22.0, 33.0, 41.0, 24.0],
                   [25.0, 31.0, 45.0, 27.0], [26.0, 36.0, 47.0, 26.0]];
        let (mut t, mut v, mut s) = (vec![], vec![], vec![]);
        for (y, row) in tab.iter().enumerate() {
            for (q, &x) in row.iter().enumerate() { t.push(y as f64); v.push(x); s.push(q); }
        }
        // time must be strictly increasing overall: use y + q/4
        for i in 0..t.len() { t[i] += s[i] as f64 / 4.0; }
        let r = seasonal_mann_kendall(&t, &v, &s, 4, 0.05, Alternative::TwoSided).unwrap();
        assert_eq!(r.s, 18);
        assert_eq!(r.season_s, vec![6, 4, 6, 2]);
        assert!(close(r.var_s, 34.667, 1e-3));
        assert!(close(r.z, 2.887, 1e-3));
        assert!(r.significant && r.direction == Direction::Up);
    }
    #[test]
    fn hour_grouping() {
        let t = [0.0, 3600.0, 86_400.0, 90_000.0];
        let g = group_by_hour(&t, &[1.0, 2.0, 3.0, 4.0]);
        assert_eq!(g[0], vec![1.0, 3.0]);
        assert_eq!(g[1], vec![2.0, 4.0]);
        assert_eq!(hours_of(&t), vec![0, 1, 0, 1]);
    }
    #[test]
    fn normal_cdf_known_values() {
        assert!(close(norm_cdf(0.0), 0.5, 1e-7));
        assert!(close(norm_cdf(1.96), 0.975, 1e-4));
        assert!(close(norm_cdf(1.645), 0.95, 1e-4));
        assert!(close(norm_cdf(-1.96), 0.025, 1e-4));
    }
    #[test]
    fn normal_ppf_known_values() {
        assert!(close(norm_ppf(0.975), 1.959964, 1e-5));
        assert!(close(norm_ppf(0.95), 1.644854, 1e-5));
        assert!(close(norm_ppf(0.995), 2.575829, 1e-5));
        assert!(close(norm_ppf(0.01), -2.326348, 1e-5));
        for &x in &[-2.5, -1.0, 0.3, 1.7] { assert!(close(norm_ppf(norm_cdf(x)), x, 1e-5)); }
    }
    #[test]
    fn calendar_helpers() {
        // 2024-02-29 00:00 UTC, 2000-01-01, 1970-01-01, 2026-11-14 13:00
        assert_eq!(civil_from_unix(1_709_164_800.0), (2024, 2, 29));
        assert_eq!(civil_from_unix(946_684_800.0), (2000, 1, 1));
        assert_eq!(civil_from_unix(0.0), (1970, 1, 1));
        assert_eq!(civil_from_unix(1_794_661_200.0 - 86_400.0 * 0.0).0, 2026);
        assert_eq!(months_of(&[1_709_164_800.0, 946_684_800.0]), vec![1, 0]);
        assert_eq!(year_mask(&[0.0, 946_684_800.0, 1_709_164_800.0], 1991, 2020), vec![false, true, false]);
    }
    #[test]
    fn anomalies_remove_cycle() {
        // two "months", three years, each month has its own level
        let v = [10.0, 20.0, 11.0, 21.0, 12.0, 22.0];
        let s = [0, 1, 0, 1, 0, 1];
        let a = anomalies(&v, &s, 2, None).unwrap();
        let want = [-1.0, -1.0, 0.0, 0.0, 1.0, 1.0];
        for i in 0..6 { assert!(close(a[i], want[i], 1e-12)); }
        // baseline = first two years only
        let base = [true, true, true, true, false, false];
        let b = anomalies(&v, &s, 2, Some(&base)).unwrap();
        assert!(close(b[4], 12.0 - 10.5, 1e-12) && close(b[5], 22.0 - 20.5, 1e-12));
        assert_eq!(anomalies(&v, &[0, 5, 0, 1, 0, 1], 2, None).unwrap_err(), MkError::BadSeason);
        let none = [false; 6];
        assert_eq!(anomalies(&v, &s, 2, Some(&none)).unwrap_err(), MkError::EmptyBaseline);
    }
    #[test]
    fn pettitt_finds_step() {
        let mut v = vec![10.0, 11.0, 9.0, 10.5, 9.5, 10.2];
        v.extend([15.0, 16.0, 14.5, 15.5, 15.2, 14.8]);
        let r = pettitt(&v, 0.05).unwrap();
        assert_eq!(r.change_index, 6);
        assert!(r.significant && r.mean_after > r.mean_before + 4.0);
        let flat = pettitt(&[1.0; 8], 0.05).unwrap();
        assert!(flat.p == 1.0 && !flat.significant);
    }
    #[test]
    fn bh_known_values() {
        let q = benjamini_hochberg(&[0.01, 0.04, 0.03, 0.005]);
        let want = [0.02, 0.04, 0.04, 0.02];
        for i in 0..4 { assert!(close(q[i], want[i], 1e-12)); }
        assert!(benjamini_hochberg(&[]).is_empty());
        assert!(benjamini_hochberg(&[0.9, 0.8]).iter().all(|&x| x <= 1.0));
    }
    #[test]
    fn hamed_rao_inflates_variance_for_slow_waves() {
        // slow wave, no trend: positive autocorrelation, so the factor must be > 1
        let v: Vec<f64> = (0..40).map(|i| (i as f64 * 0.35).sin()).collect();
        let r = mann_kendall(&idx(40), &v, 0.05, Alternative::TwoSided).unwrap();
        assert!(r.acf_factor > 1.0, "factor {}", r.acf_factor);
        assert!(r.p_hr >= r.p);
    }
}
