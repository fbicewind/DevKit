use crate::error::{AppError, Result};
use base64::Engine;
use chrono::{DateTime, Local, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeResult {
    pub seconds: i64,
    pub milliseconds: i64,
    pub standard: String,
    pub iso: String,
    pub timezone: String,
    pub resolved_unit: String,
}
fn display_time(ms: i64, zone: &str, unit: &str) -> Result<TimeResult> {
    if ms.unsigned_abs() > 8_640_000_000_000_000 {
        return Err(AppError::new("TIME_INVALID", "时间超出支持范围"));
    }
    let dt = DateTime::<Utc>::from_timestamp_millis(ms)
        .ok_or_else(|| AppError::new("TIME_INVALID", "时间超出支持范围"))?;
    let (standard, timezone) = if zone == "local" {
        let d = dt.with_timezone(&Local);
        (
            d.format("%Y-%m-%d %H:%M:%S%.3f %:z").to_string(),
            d.format("%Z").to_string(),
        )
    } else {
        let tz: Tz = zone
            .parse()
            .map_err(|_| AppError::new("TIMEZONE_INVALID", "无效 IANA 时区"))?;
        let d = dt.with_timezone(&tz);
        (
            d.format("%Y-%m-%d %H:%M:%S%.3f %:z").to_string(),
            zone.into(),
        )
    };
    Ok(TimeResult {
        seconds: ms.div_euclid(1000),
        milliseconds: ms,
        standard,
        iso: dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        timezone,
        resolved_unit: unit.into(),
    })
}
pub fn unix_to_time(value: &str, unit: &str, zone: &str) -> Result<TimeResult> {
    let input = value.trim();
    if input.is_empty() || !["seconds", "milliseconds", "auto"].contains(&unit) {
        return Err(AppError::new("TIME_INVALID", "请输入时间戳并选择单位"));
    }
    let n: f64 = input
        .parse()
        .map_err(|_| AppError::new("TIME_INVALID", "无效时间戳"))?;
    let resolved = if unit == "auto" {
        if n.abs() >= 100_000_000_000.0 {
            "milliseconds"
        } else {
            "seconds"
        }
    } else {
        unit
    };
    let ms = if resolved == "seconds" { n * 1000.0 } else { n };
    if !ms.is_finite() || ms.abs() > 8_640_000_000_000_000.0 {
        return Err(AppError::new("TIME_INVALID", "时间超出支持范围"));
    }
    display_time(ms.round() as i64, zone, resolved)
}
fn resolve<T: TimeZone>(result: LocalResult<DateTime<T>>, ambiguity: &str) -> Result<i64> {
    match result {
        LocalResult::Single(d) => Ok(d.timestamp_millis()),
        LocalResult::None => Err(AppError::new(
            "TIME_NONEXISTENT",
            "该时区的这个本地时间因夏令时跳变而不存在",
        )),
        LocalResult::Ambiguous(a, b) => match ambiguity {
            "earlier" => Ok(a.timestamp_millis().min(b.timestamp_millis())),
            "later" => Ok(a.timestamp_millis().max(b.timestamp_millis())),
            _ => Err(AppError::new(
                "TIME_AMBIGUOUS",
                "这个本地时间有两个偏移，请选择较早或较晚时刻",
            )),
        },
    }
}
pub fn time_to_unix(value: &str, zone: &str, ambiguity: &str) -> Result<TimeResult> {
    let s = value.trim();
    if s.is_empty() {
        return Err(AppError::new("TIME_INVALID", "请输入日期时间"));
    }
    let ms = if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        d.timestamp_millis()
    } else {
        let d = [
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%dT%H:%M",
        ]
        .iter()
        .find_map(|fmt| NaiveDateTime::parse_from_str(s, fmt).ok())
        .ok_or_else(|| {
            AppError::new(
                "TIME_INVALID",
                "请输入 YYYY-MM-DD HH:mm:ss 或 ISO 8601 日期",
            )
        })?;
        if zone == "local" {
            resolve(Local.from_local_datetime(&d), ambiguity)?
        } else {
            let tz: Tz = zone
                .parse()
                .map_err(|_| AppError::new("TIMEZONE_INVALID", "无效 IANA 时区"))?;
            resolve(tz.from_local_datetime(&d), ambiguity)?
        }
    };
    display_time(ms, zone, "milliseconds")
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomRequest {
    pub length: usize,
    pub count: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub custom: String,
}
pub fn random_generate(r: &RandomRequest) -> Result<Vec<String>> {
    if !(1..=4096).contains(&r.length)
        || !(1..=200).contains(&r.count)
        || r.length.saturating_mul(r.count) > 100_000
    {
        return Err(AppError::new(
            "LIMIT_EXCEEDED",
            "长度须为 1–4096，数量须为 1–200，总字符数不能超过 100,000",
        ));
    }
    if r.custom.len() > 65536 {
        return Err(AppError::new("LIMIT_EXCEEDED", "自定义字符集过长"));
    }
    let mut pool = String::new();
    if !r.custom.is_empty() {
        pool.push_str(&r.custom);
    } else {
        if r.uppercase {
            pool.push_str("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        }
        if r.lowercase {
            pool.push_str("abcdefghijklmnopqrstuvwxyz");
        }
        if r.digits {
            pool.push_str("0123456789");
        }
        if r.symbols {
            pool.push_str("!@#$%^&*_-+=?~");
        }
    }
    let mut seen = HashSet::new();
    let chars: Vec<char> = pool.chars().filter(|c| seen.insert(*c)).collect();
    if chars.is_empty() {
        return Err(AppError::new(
            "RANDOM_EMPTY_CHARSET",
            "请至少选择一种字符范围",
        ));
    }
    let mut rng = OsRng;
    Ok((0..r.count)
        .map(|_| {
            (0..r.length)
                .map(|_| chars[rng.gen_range(0..chars.len())])
                .collect()
        })
        .collect())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureTemplate {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub template: String,
    pub unit: String,
    pub variables: HashMap<String, String>,
    pub encoding: String,
    pub uppercase: bool,
    #[serde(default)]
    pub secret_ref: Option<String>,
}
impl SignatureTemplate {
    pub fn validate(&self) -> Result<()> {
        if uuid::Uuid::parse_str(&self.id).is_err()
            || self.name.trim().is_empty()
            || self.name.len() > 200
            || self.template.len() > 16384
            || self.variables.len() > 100
            || self.variables.values().any(|v| v.len() > 65536)
            || self
                .variables
                .keys()
                .any(|k| !valid_name(k) || k == "secret" || k == "timestamp")
            || !["seconds", "milliseconds"].contains(&self.unit.as_str())
            || !["hex", "base64"].contains(&self.encoding.as_str())
            || !["MD5", "SHA1", "SHA256", "HMAC-SHA256"].contains(&self.algorithm.as_str())
        {
            return Err(AppError::new(
                "TEMPLATE_INVALID",
                "无效模板参数；变量名使用英文字母、数字或下划线，不能覆盖 secret 或 timestamp",
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRequest {
    pub algorithm: String,
    pub template: String,
    pub variables: HashMap<String, String>,
    pub timestamp_mode: String,
    pub timestamp: Option<String>,
    pub unit: String,
    pub secret: Option<String>,
    pub template_id: Option<String>,
    pub encoding: String,
    pub uppercase: bool,
    #[serde(default)]
    pub allow_empty_secret: bool,
}
#[derive(Debug, Serialize)]
pub struct SignatureResult {
    pub timestamp: String,
    pub sign: String,
}
fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.as_bytes()[0].is_ascii_alphabetic()
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
pub fn signature_compute(
    r: &SignatureRequest,
    secret: &str,
    now_ms: i64,
) -> Result<SignatureResult> {
    if r.template.len() > 16384
        || r.variables.len() > 100
        || r.variables.values().any(|v| v.len() > 65536)
        || secret.len() > 65536
    {
        return Err(AppError::new("LIMIT_EXCEEDED", "签名输入超出限制"));
    }
    if !["seconds", "milliseconds"].contains(&r.unit.as_str())
        || !["current", "fixed"].contains(&r.timestamp_mode.as_str())
        || !["hex", "base64"].contains(&r.encoding.as_str())
    {
        return Err(AppError::new("INVALID_ARGUMENT", "无效签名参数"));
    }
    if r.variables
        .keys()
        .any(|k| !valid_name(k) || k == "secret" || k == "timestamp")
    {
        return Err(AppError::new(
            "SIGNATURE_VAR_INVALID",
            "变量名无效或覆盖了保留变量",
        ));
    }
    let timestamp = if r.timestamp_mode == "fixed" {
        let s = r.timestamp.as_deref().unwrap_or("").trim();
        s.parse::<i64>()
            .map_err(|_| AppError::new("TIME_INVALID", "固定时间戳须为 64 位整数"))?;
        s.to_owned()
    } else {
        if r.unit == "seconds" {
            now_ms.div_euclid(1000)
        } else {
            now_ms
        }
        .to_string()
    };
    let mut plain = String::new();
    let mut rest = r.template.as_str();
    while !rest.is_empty() {
        match rest.find(['{', '}']) {
            None => {
                plain.push_str(rest);
                break;
            }
            Some(i) => {
                plain.push_str(&rest[..i]);
                if rest.as_bytes()[i] == b'}' {
                    return Err(AppError::new(
                        "SIGNATURE_TEMPLATE_INVALID",
                        "模板中的花括号不匹配",
                    ));
                }
                let end = rest[i + 1..].find('}').map(|v| v + i + 1).ok_or_else(|| {
                    AppError::new("SIGNATURE_TEMPLATE_INVALID", "模板中的花括号不匹配")
                })?;
                let name = &rest[i + 1..end];
                if !valid_name(name) {
                    return Err(AppError::new("SIGNATURE_VAR_INVALID", "无效模板变量"));
                }
                let value = match name {
                    "secret" => {
                        if secret.is_empty() && !r.allow_empty_secret {
                            return Err(AppError::new(
                                "SIGNATURE_SECRET_EMPTY",
                                "Secret 为空；如确有需要请显式允许空 Secret",
                            ));
                        }
                        secret
                    }
                    "timestamp" => &timestamp,
                    _ => r.variables.get(name).ok_or_else(|| {
                        AppError::new("SIGNATURE_VAR_MISSING", format!("缺少变量 {{{name}}}"))
                    })?,
                };
                plain.push_str(value);
                rest = &rest[end + 1..];
                if plain.len() > 2 * 1024 * 1024 {
                    return Err(AppError::new("LIMIT_EXCEEDED", "替换后签名原文超过 2 MiB"));
                }
            }
        }
    }
    let digest = match r.algorithm.as_str() {
        "MD5" => md5::Md5::digest(plain.as_bytes()).to_vec(),
        "SHA1" => sha1::Sha1::digest(plain.as_bytes()).to_vec(),
        "SHA256" => Sha256::digest(plain.as_bytes()).to_vec(),
        "HMAC-SHA256" => {
            if secret.is_empty() && !r.allow_empty_secret {
                return Err(AppError::new("SIGNATURE_SECRET_EMPTY", "HMAC 密钥不能为空"));
            }
            let mut h = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes())
                .map_err(|_| AppError::new("SIGNATURE_INVALID", "无效 HMAC 密钥"))?;
            h.update(plain.as_bytes());
            h.finalize().into_bytes().to_vec()
        }
        _ => {
            return Err(AppError::new(
                "SIGNATURE_ALGORITHM_INVALID",
                "不支持的签名算法",
            ))
        }
    };
    let sign = if r.encoding == "base64" {
        base64::engine::general_purpose::STANDARD.encode(digest)
    } else {
        let hex = digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        if r.uppercase {
            hex.to_uppercase()
        } else {
            hex
        }
    };
    Ok(SignatureResult { timestamp, sign })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timezones_negative_and_dst() {
        assert_eq!(
            unix_to_time("-1", "milliseconds", "UTC").unwrap().seconds,
            -1
        );
        assert_eq!(
            time_to_unix("1970-01-01 08:00:00", "Asia/Shanghai", "reject")
                .unwrap()
                .milliseconds,
            0
        );
        assert_eq!(
            time_to_unix("2024-03-10 02:30:00", "America/New_York", "reject")
                .unwrap_err()
                .code,
            "TIME_NONEXISTENT"
        );
        assert_eq!(
            time_to_unix("2024-11-03 01:30:00", "America/New_York", "reject")
                .unwrap_err()
                .code,
            "TIME_AMBIGUOUS"
        );
        let a = time_to_unix("2024-11-03 01:30:00", "America/New_York", "earlier").unwrap();
        let b = time_to_unix("2024-11-03 01:30:00", "America/New_York", "later").unwrap();
        assert_eq!(b.milliseconds - a.milliseconds, 3600000);
        assert!(time_to_unix("2024-02-30 00:00:00", "UTC", "reject").is_err());
        assert!(unix_to_time("NaN", "seconds", "UTC").is_err());
    }
    fn req(algorithm: &str, template: &str) -> SignatureRequest {
        SignatureRequest {
            algorithm: algorithm.into(),
            template: template.into(),
            variables: HashMap::new(),
            timestamp_mode: "current".into(),
            timestamp: None,
            unit: "milliseconds".into(),
            secret: None,
            template_id: None,
            encoding: "hex".into(),
            uppercase: false,
            allow_empty_secret: false,
        }
    }
    #[test]
    fn signature_public_vectors() {
        for (alg, expected) in [
            ("MD5", "900150983cd24fb0d6963f7d28e17f72"),
            ("SHA1", "a9993e364706816aba3e25717850c26c9cd0d89d"),
            (
                "SHA256",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
        ] {
            assert_eq!(
                signature_compute(&req(alg, "abc"), "", 123).unwrap().sign,
                expected
            );
        }
        let r = req("HMAC-SHA256", "Hi There");
        assert_eq!(
            signature_compute(&r, &"\u{b}".repeat(20), 0).unwrap().sign,
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        let mut r = req("MD5", "{timestamp}{timestamp}");
        let out = signature_compute(&r, "", 123).unwrap();
        assert_eq!(out.timestamp, "123");
        assert_eq!(
            out.sign,
            signature_compute(&req("MD5", "123123"), "", 0)
                .unwrap()
                .sign
        );
        r.template = "{unknown}".into();
        assert_eq!(
            signature_compute(&r, "", 0).unwrap_err().code,
            "SIGNATURE_VAR_MISSING"
        );
        r.template = "{secret}".into();
        assert_eq!(
            signature_compute(&r, "", 0).unwrap_err().code,
            "SIGNATURE_SECRET_EMPTY"
        );
    }
    #[test]
    fn unicode_random_and_boundaries() {
        let mut r = RandomRequest {
            length: 128,
            count: 10,
            uppercase: false,
            lowercase: false,
            digits: false,
            symbols: false,
            custom: "中😀中ab".into(),
        };
        let out = random_generate(&r).unwrap();
        assert!(out
            .iter()
            .all(|s| s.chars().count() == 128 && s.chars().all(|c| "中😀ab".contains(c))));
        let joined = out.join("");
        for ch in "中😀ab".chars() {
            assert!(joined.contains(ch));
        }
        r.custom.clear();
        assert_eq!(
            random_generate(&r).unwrap_err().code,
            "RANDOM_EMPTY_CHARSET"
        );
        r.length = 4097;
        assert_eq!(random_generate(&r).unwrap_err().code, "LIMIT_EXCEEDED");
    }
}
