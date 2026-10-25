//! Span index: values are never parsed through floating point or a map.
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const EDIT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_NODES: usize = 1_500_000;
pub const MAX_DEPTH: usize = 128;
const NONE: u32 = u32::MAX;
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Null,
}
#[derive(Debug, Clone)]
struct Node {
    start: u32,
    end: u32,
    key: Option<(u32, u32)>,
    kind: Kind,
    first: u32,
    next: u32,
    count: u32,
}
#[derive(Debug)]
pub struct Document {
    source: String,
    nodes: Vec<Node>,
    pub duplicate_keys: bool,
    duplicate_at: Option<usize>,
    pub path: Option<PathBuf>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonNode {
    pub id: u32,
    pub key: Option<String>,
    pub r#type: Kind,
    pub summary: String,
    pub has_children: bool,
    pub child_count: u32,
}
#[derive(Clone, Default)]
pub struct Control {
    pub cancelled: Arc<AtomicBool>,
    pub processed: Arc<AtomicUsize>,
}
impl Control {
    pub fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(AppError::new("CANCELLED", "任务已取消"))
        } else {
            Ok(())
        }
    }
}

struct Parser<'a> {
    s: &'a [u8],
    pos: usize,
    nodes: Vec<Node>,
    duplicate: bool,
    duplicate_at: Option<usize>,
    control: &'a Control,
}
impl<'a> Parser<'a> {
    fn error(&self, msg: &str) -> AppError {
        let prefix = &self.s[..self.pos.min(self.s.len())];
        let line = prefix.iter().filter(|&&b| b == b'\n').count() + 1;
        let col = prefix
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(prefix.len() + 1, |i| prefix.len() - i);
        AppError {
            code: "JSON_INVALID".into(),
            message: format!("{msg}（第 {line} 行，第 {col} 列）"),
            line: Some(line),
            column: Some(col),
        }
    }
    fn ws(&mut self) {
        while matches!(self.s.get(self.pos), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.pos += 1;
        }
    }
    fn expect(&mut self, b: u8) -> Result<()> {
        if self.s.get(self.pos) == Some(&b) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.error(&format!("预期字符 {}", b as char)))
        }
    }
    fn hex4(&mut self) -> Result<u16> {
        let mut n = 0;
        for _ in 0..4 {
            let b = *self
                .s
                .get(self.pos)
                .ok_or_else(|| self.error("不完整的 Unicode 转义"))?;
            let h = (b as char)
                .to_digit(16)
                .ok_or_else(|| self.error("无效 Unicode 转义"))?;
            n = (n << 4) | h as u16;
            self.pos += 1;
        }
        Ok(n)
    }
    fn string(&mut self) -> Result<(u32, u32)> {
        let start = self.pos;
        self.expect(b'"')?;
        loop {
            if self.pos & 0xffff == 0 {
                self.control.check()?;
                self.control.processed.store(self.pos, Ordering::Relaxed);
            }
            let b = *self
                .s
                .get(self.pos)
                .ok_or_else(|| self.error("字符串未闭合"))?;
            self.pos += 1;
            match b {
                b'"' => return Ok((start as u32, self.pos as u32)),
                0..=31 => return Err(self.error("字符串中包含未转义控制字符")),
                b'\\' => match self.s.get(self.pos).copied() {
                    Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => self.pos += 1,
                    Some(b'u') => {
                        self.pos += 1;
                        let u = self.hex4()?;
                        if (0xd800..=0xdbff).contains(&u) {
                            self.expect(b'\\')?;
                            self.expect(b'u')?;
                            let low = self.hex4()?;
                            if !(0xdc00..=0xdfff).contains(&low) {
                                return Err(self.error("无效 Unicode 代理对"));
                            }
                        } else if (0xdc00..=0xdfff).contains(&u) {
                            return Err(self.error("孤立的 Unicode 低代理项"));
                        }
                    }
                    _ => return Err(self.error("无效字符串转义")),
                },
                _ => {}
            }
        }
    }
    fn number(&mut self) -> Result<()> {
        if self.s.get(self.pos) == Some(&b'-') {
            self.pos += 1;
        }
        match self.s.get(self.pos) {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.s.get(self.pos), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(self.error("无效数字")),
        }
        if self.s.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            let start = self.pos;
            while matches!(self.s.get(self.pos), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
            if start == self.pos {
                return Err(self.error("小数部分缺少数字"));
            }
        }
        if matches!(self.s.get(self.pos), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.s.get(self.pos), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            let start = self.pos;
            while matches!(self.s.get(self.pos), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
            if start == self.pos {
                return Err(self.error("指数部分缺少数字"));
            }
        }
        Ok(())
    }
    fn value(&mut self, depth: usize, key: Option<(u32, u32)>) -> Result<u32> {
        self.control.check()?;
        self.control.processed.store(self.pos, Ordering::Relaxed);
        if depth > MAX_DEPTH {
            return Err(AppError::new(
                "LIMIT_EXCEEDED",
                format!("嵌套深度上限为 {MAX_DEPTH}"),
            ));
        }
        if self.nodes.len() >= MAX_NODES {
            return Err(AppError::new(
                "LIMIT_EXCEEDED",
                format!("节点数量上限为 {MAX_NODES}"),
            ));
        }
        self.ws();
        let start = self.pos;
        let kind = match self.s.get(self.pos) {
            Some(b'{') => Kind::Object,
            Some(b'[') => Kind::Array,
            Some(b'"') => Kind::String,
            Some(b'-' | b'0'..=b'9') => Kind::Number,
            Some(b't' | b'f') => Kind::Boolean,
            Some(b'n') => Kind::Null,
            _ => return Err(self.error("预期 JSON 值")),
        };
        if self.nodes.len() == self.nodes.capacity() {
            self.nodes
                .reserve_exact((MAX_NODES - self.nodes.len()).min(65_536));
        }
        let id = self.nodes.len() as u32;
        self.nodes.push(Node {
            start: start as u32,
            end: 0,
            key,
            kind,
            first: NONE,
            next: NONE,
            count: 0,
        });
        match kind {
            Kind::Object | Kind::Array => {
                self.pos += 1;
                self.ws();
                let end = if kind == Kind::Object { b'}' } else { b']' };
                let mut prev = NONE;
                let mut keys = HashSet::new();
                if self.s.get(self.pos) != Some(&end) {
                    loop {
                        self.ws();
                        let key = if kind == Kind::Object {
                            let span = self.string()?;
                            let decoded: String =
                                serde_json::from_slice(&self.s[span.0 as usize..span.1 as usize])
                                    .map_err(|_| self.error("无效对象键"))?;
                            if !keys.insert(decoded) {
                                self.duplicate = true;
                                self.duplicate_at.get_or_insert(span.0 as usize);
                            }
                            self.ws();
                            self.expect(b':')?;
                            Some(span)
                        } else {
                            None
                        };
                        let child = self.value(depth + 1, key)?;
                        if prev == NONE {
                            self.nodes[id as usize].first = child;
                        } else {
                            self.nodes[prev as usize].next = child;
                        }
                        prev = child;
                        self.nodes[id as usize].count += 1;
                        self.ws();
                        if self.s.get(self.pos) == Some(&end) {
                            break;
                        }
                        self.expect(b',')?;
                    }
                }
                self.expect(end)?;
            }
            Kind::String => {
                self.string()?;
            }
            Kind::Number => self.number()?,
            Kind::Boolean | Kind::Null => {
                let lit: &[u8] = match self.s[self.pos] {
                    b't' => b"true",
                    b'f' => b"false",
                    _ => b"null",
                };
                if self.s.get(self.pos..self.pos + lit.len()) != Some(lit) {
                    return Err(self.error("无效字面量"));
                }
                self.pos += lit.len();
            }
        }
        self.nodes[id as usize].end = self.pos as u32;
        Ok(id)
    }
}
impl Document {
    pub fn parse(source: String, control: &Control) -> Result<Self> {
        if source.len() > MAX_BYTES {
            return Err(AppError::new("LIMIT_EXCEEDED", "文件上限为 64 MiB"));
        }
        let mut p = Parser {
            s: source.as_bytes(),
            pos: 0,
            nodes: Vec::new(),
            duplicate: false,
            duplicate_at: None,
            control,
        };
        p.value(0, None)?;
        p.ws();
        if p.pos != p.s.len() {
            return Err(p.error("JSON 结束后存在额外内容"));
        }
        let nodes = p.nodes;
        let duplicate_keys = p.duplicate;
        let duplicate_at = p.duplicate_at;
        Ok(Self {
            source,
            nodes,
            duplicate_keys,
            duplicate_at,
            path: None,
        })
    }
    pub fn open(path: &Path, control: &Control) -> Result<Self> {
        let mut f = std::fs::File::open(path).map_err(AppError::io)?;
        if f.metadata().map_err(AppError::io)?.len() > MAX_BYTES as u64 {
            return Err(AppError::new("LIMIT_EXCEEDED", "文件上限为 64 MiB"));
        }
        let mut bytes = Vec::new();
        let mut chunk = [0; 65536];
        loop {
            control.check()?;
            let n = f.read(&mut chunk).map_err(AppError::io)?;
            if n == 0 {
                break;
            }
            if bytes.len() + n > MAX_BYTES {
                return Err(AppError::new("LIMIT_EXCEEDED", "文件上限为 64 MiB"));
            }
            bytes.extend_from_slice(&chunk[..n]);
            control.processed.store(bytes.len(), Ordering::Relaxed);
        }
        let source = String::from_utf8(bytes)
            .map_err(|_| AppError::new("JSON_INVALID_UTF8", "文件不是合法 UTF-8"))?;
        let mut doc = Self::parse(source, control)?;
        doc.path = Some(path.canonicalize().map_err(AppError::io)?);
        Ok(doc)
    }
    pub fn size(&self) -> usize {
        self.source.len()
    }
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
    pub fn text(&self) -> Result<&str> {
        if self.size() > EDIT_BYTES {
            Err(AppError::new("LIMIT_EXCEEDED", "大文件请使用树视图并导出"))
        } else {
            Ok(&self.source)
        }
    }
    fn brief(raw: &str) -> String {
        let mut s: String = raw.chars().take(160).collect();
        if raw.chars().take(161).count() > 160 {
            s.push('…');
        }
        s
    }
    pub fn node(&self, id: u32, index: Option<usize>) -> Result<JsonNode> {
        let n = self
            .nodes
            .get(id as usize)
            .ok_or_else(|| AppError::new("NODE_NOT_FOUND", "节点不存在"))?;
        let key = match n.key {
            Some((a, b)) => {
                let raw = &self.source[a as usize..b as usize];
                if raw.len() > 1024 {
                    Some(Self::brief(raw))
                } else {
                    Some(
                        serde_json::from_str(raw)
                            .map_err(|_| AppError::new("JSON_INVALID", "无效键"))?,
                    )
                }
            }
            None => index.map(|i| i.to_string()),
        };
        let summary = match n.kind {
            Kind::Object => format!("{{ {} keys }}", n.count),
            Kind::Array => format!("[ {} items ]", n.count),
            _ => Self::brief(&self.source[n.start as usize..n.end as usize]),
        };
        Ok(JsonNode {
            id,
            key,
            r#type: n.kind,
            summary,
            has_children: n.count > 0,
            child_count: n.count,
        })
    }
    pub fn children(&self, id: u32, offset: usize, limit: usize) -> Result<Vec<JsonNode>> {
        if limit == 0 || limit > 500 {
            return Err(AppError::new("LIMIT_EXCEEDED", "单页节点数须在 1–500 之间"));
        }
        let n = self
            .nodes
            .get(id as usize)
            .ok_or_else(|| AppError::new("NODE_NOT_FOUND", "节点不存在"))?;
        let mut child = n.first;
        let mut i = 0;
        let mut out = Vec::new();
        while child != NONE && out.len() < limit {
            if i >= offset {
                out.push(self.node(child, Some(i))?);
            }
            i += 1;
            child = self.nodes[child as usize].next;
        }
        Ok(out)
    }
    pub fn transform<W: Write>(
        &self,
        mut writer: W,
        options: &Transform,
        control: &Control,
    ) -> Result<()> {
        options.validate()?;
        if options.kind == "sort" && self.duplicate_keys {
            let at = self.duplicate_at.unwrap_or(0);
            let prefix = &self.source[..at];
            let line = prefix.bytes().filter(|b| *b == b'\n').count() + 1;
            let column = prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1;
            return Err(AppError {
                code: "JSON_DUPLICATE_KEY".into(),
                message: format!("第 {line} 行第 {column} 列存在重复键，拒绝排序；可格式化或压缩"),
                line: Some(line),
                column: Some(column),
            });
        }
        self.write_node(0, 0, &mut writer, options, control)?;
        writer.flush().map_err(AppError::io)
    }
    pub fn output_text(&self, options: &Transform, control: &Control) -> Result<String> {
        if self.size() > EDIT_BYTES {
            return Err(AppError::new("LIMIT_EXCEEDED", "大文件只支持导出"));
        }
        struct Bounded(Vec<u8>);
        impl Write for Bounded {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                if self.0.len() + b.len() > EDIT_BYTES {
                    return Err(std::io::Error::other("格式化输出超过 2 MiB，请直接导出"));
                }
                self.0.extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut out = Bounded(Vec::new());
        self.transform(&mut out, options, control)?;
        String::from_utf8(out.0).map_err(|_| AppError::new("JSON_INVALID_UTF8", "输出编码错误"))
    }
    pub fn export(&self, path: &Path, options: &Transform, control: &Control) -> Result<()> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let destination = parent.canonicalize().map_err(AppError::io)?.join(
            path.file_name()
                .ok_or_else(|| AppError::new("INVALID_PATH", "请选择文件"))?,
        );
        if self.path.as_ref().is_some_and(|src| src == &destination)
            || path
                .canonicalize()
                .ok()
                .zip(self.path.as_ref())
                .is_some_and(|(a, b)| &a == b)
        {
            return Err(AppError::new(
                "SOURCE_OVERWRITE",
                "请选择新文件，不能覆盖原始 JSON",
            ));
        }
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(AppError::io)?;
        {
            let writer = std::io::BufWriter::new(temp.as_file_mut());
            self.transform(writer, options, control)?;
        }
        control.check()?;
        temp.as_file().sync_all().map_err(AppError::io)?;
        control.check()?;
        temp.persist(&destination)
            .map_err(|e| AppError::io(e.error))?;
        Ok(())
    }
    fn raw<W: Write>(&self, w: &mut W, start: u32, end: u32, c: &Control) -> Result<()> {
        for chunk in self.source.as_bytes()[start as usize..end as usize].chunks(65536) {
            c.check()?;
            w.write_all(chunk).map_err(AppError::io)?;
            c.processed.fetch_add(chunk.len(), Ordering::Relaxed);
        }
        Ok(())
    }
    fn write_node<W: Write>(
        &self,
        id: u32,
        depth: usize,
        w: &mut W,
        o: &Transform,
        c: &Control,
    ) -> Result<()> {
        c.check()?;
        let n = &self.nodes[id as usize];
        if !matches!(n.kind, Kind::Object | Kind::Array) {
            return self.raw(w, n.start, n.end, c);
        }
        let pretty = o.kind != "minify";
        let indent = o.indent.as_deref().unwrap_or("2");
        let unit = match indent {
            "4" => "    ",
            "tab" => "\t",
            _ => "  ",
        };
        let pad = |w: &mut W, d: usize| -> Result<()> {
            w.write_all(b"\n").map_err(AppError::io)?;
            for _ in 0..d {
                w.write_all(unit.as_bytes()).map_err(AppError::io)?;
            }
            Ok(())
        };
        w.write_all(if n.kind == Kind::Object { b"{" } else { b"[" })
            .map_err(AppError::io)?;
        let mut children = Vec::with_capacity(n.count as usize);
        let mut child = n.first;
        while child != NONE {
            if children.len() & 1023 == 0 {
                c.check()?;
            }
            children.push(child);
            child = self.nodes[child as usize].next;
        }
        if o.kind == "sort" && n.kind == Kind::Object {
            let mut keyed: Vec<(String, u32)> = Vec::with_capacity(children.len());
            for id in children {
                c.check()?;
                let (a, b) = self.nodes[id as usize].key.unwrap();
                let key = serde_json::from_str(&self.source[a as usize..b as usize])
                    .map_err(|_| AppError::new("JSON_INVALID", "无效对象键"))?;
                keyed.push((key, id));
            }
            // UTF-8 byte order, deterministic and independent of OS locale.
            keyed.sort_by(|a, b| {
                if o.sort_direction.as_deref() == Some("desc") {
                    b.0.as_bytes().cmp(a.0.as_bytes())
                } else {
                    a.0.as_bytes().cmp(b.0.as_bytes())
                }
            });
            c.check()?;
            children = keyed.into_iter().map(|(_, id)| id).collect();
        }
        for (i, id) in children.iter().enumerate() {
            if i > 0 {
                w.write_all(b",").map_err(AppError::io)?;
            }
            if pretty {
                pad(w, depth + 1)?;
            }
            let node = &self.nodes[*id as usize];
            if let Some((a, b)) = node.key {
                self.raw(w, a, b, c)?;
                w.write_all(if pretty { b": " } else { b":" })
                    .map_err(AppError::io)?;
            }
            self.write_node(*id, depth + 1, w, o, c)?;
        }
        if pretty && !children.is_empty() {
            pad(w, depth)?;
        }
        w.write_all(if n.kind == Kind::Object { b"}" } else { b"]" })
            .map_err(AppError::io)?;
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub kind: String,
    pub indent: Option<String>,
    pub sort_direction: Option<String>,
}
impl Transform {
    pub fn validate(&self) -> Result<()> {
        if !["format", "minify", "sort"].contains(&self.kind.as_str())
            || self
                .indent
                .as_ref()
                .is_some_and(|s| !["2", "4", "tab"].contains(&s.as_str()))
            || self
                .sort_direction
                .as_ref()
                .is_some_and(|s| !["asc", "desc"].contains(&s.as_str()))
        {
            Err(AppError::new("INVALID_ARGUMENT", "无效 JSON 操作参数"))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn op(kind: &str) -> Transform {
        Transform {
            kind: kind.into(),
            indent: Some("2".into()),
            sort_direction: Some("asc".into()),
        }
    }
    #[test]
    fn precision_duplicates_and_sort() {
        let c = Control::default();
        let src =
            r#"{"z":9007199254740993123456789,"a":[1.2300e+45,{"b":-0,"a":0.00000000000000001}]}"#;
        let doc = Document::parse(src.into(), &c).unwrap();
        let out = doc.output_text(&op("sort"), &c).unwrap();
        assert!(out.contains("9007199254740993123456789"));
        assert!(out.contains("1.2300e+45"));
        assert!(out.find("\"a\"").unwrap() < out.find("\"z\"").unwrap());
        let d = Document::parse(r#"{"a":1,"\u0061":2}"#.into(), &c).unwrap();
        assert!(d.duplicate_keys);
        assert_eq!(
            d.output_text(&op("minify"), &c).unwrap(),
            r#"{"a":1,"\u0061":2}"#
        );
        assert_eq!(
            d.output_text(&op("sort"), &c).unwrap_err().code,
            "JSON_DUPLICATE_KEY"
        );
    }
    #[test]
    fn rejects_invalid_and_limits() {
        let c = Control::default();
        for input in [
            "[1,]",
            "01",
            "1.",
            "1e",
            "true false",
            r#""\uD800""#,
            r#"{"x" 1}"#,
            "{\n\"x\":}",
        ] {
            let err = Document::parse(input.into(), &c).unwrap_err();
            assert_eq!(err.code, "JSON_INVALID", "{input}");
            assert!(err.line.is_some());
        }
        let deep = "[".repeat(130) + &"]".repeat(130);
        assert_eq!(
            Document::parse(deep, &c).unwrap_err().code,
            "LIMIT_EXCEEDED"
        );
    }
    #[test]
    fn paging_and_array_order() {
        let c = Control::default();
        let d = Document::parse(r#"[3,2,1,{"中":1,"Z":2,"a":3}]"#.into(), &c).unwrap();
        let page = d.children(0, 1, 2).unwrap();
        assert_eq!(page[0].summary, "2");
        assert_eq!(page[0].key.as_deref(), Some("1"));
        let out = d.output_text(&op("sort"), &c).unwrap();
        assert!(out.starts_with("[\n  3,\n  2,\n  1,"));
        assert!(out.find("\"Z\"").unwrap() < out.find("\"中\"").unwrap());
    }
    #[test]
    fn cancellation_and_atomic_export() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("in.json");
        std::fs::write(&source, "[1,2,3]").unwrap();
        let c = Control::default();
        let d = Document::open(&source, &c).unwrap();
        assert_eq!(
            d.export(&source, &op("format"), &c).unwrap_err().code,
            "SOURCE_OVERWRITE"
        );
        let dest = dir.path().join("out.json");
        std::fs::write(&dest, "original").unwrap();
        c.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(
            d.export(&dest, &op("format"), &c).unwrap_err().code,
            "CANCELLED"
        );
        assert_eq!(std::fs::read_to_string(dest).unwrap(), "original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn long_string_has_bounded_preview() {
        let c = Control::default();
        let d = Document::parse(format!("\"{}\"", "中".repeat(100000)), &c).unwrap();
        assert!(d.node(0, None).unwrap().summary.chars().count() <= 161);
    }
    #[test]
    fn rejects_file_and_node_budgets_and_invalid_utf8() {
        let c = Control::default();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.json");
        std::fs::File::create(&path)
            .unwrap()
            .set_len((MAX_BYTES + 1) as u64)
            .unwrap();
        assert_eq!(
            Document::open(&path, &c).unwrap_err().code,
            "LIMIT_EXCEEDED"
        );
        std::fs::write(&path, [b'"', 0xff, b'"']).unwrap();
        assert_eq!(
            Document::open(&path, &c).unwrap_err().code,
            "JSON_INVALID_UTF8"
        );
        let input = format!("[{}0]", "0,".repeat(MAX_NODES));
        assert_eq!(
            Document::parse(input, &c).unwrap_err().code,
            "LIMIT_EXCEEDED"
        );
    }
    #[test]
    fn cancellation_during_a_long_scalar_write() {
        struct CancelWriter(Control, usize);
        impl Write for CancelWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.1 += bytes.len();
                self.0.cancelled.store(true, Ordering::Relaxed);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let c = Control::default();
        let d = Document::parse(format!("\"{}\"", "a".repeat(1_000_000)), &c).unwrap();
        let mut writer = CancelWriter(c.clone(), 0);
        assert_eq!(
            d.transform(&mut writer, &op("minify"), &c)
                .unwrap_err()
                .code,
            "CANCELLED"
        );
        assert!(writer.1 <= 65_536);
    }
    #[test]
    fn strings_and_descending_order_remain_exact() {
        let c = Control::default();
        let source = r#"{"a":" \\ \" \u4e2d \n ","😀":1.20E-004,"z":[9,8,7]}"#;
        let d = Document::parse(source.into(), &c).unwrap();
        assert_eq!(d.output_text(&op("minify"), &c).unwrap(), source);
        let mut options = op("sort");
        options.sort_direction = Some("desc".into());
        options.indent = Some("tab".into());
        let result = d.output_text(&options, &c).unwrap();
        assert!(result.starts_with("{\n\t\"😀\": 1.20E-004,"));
        assert!(result.contains(r#"" \\ \" \u4e2d \n ""#));
    }
    #[test]
    #[ignore]
    fn benchmark_30_mib() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("large.json");
        let mut file = std::fs::File::create(&source).unwrap();
        let item = r#"{"z":9007199254740993123456789,"a":"abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789","nested":{"flag":true,"values":[3,2,1]}}"#;
        file.write_all(b"[").unwrap();
        let count = (30 * 1024 * 1024 - 2) / (item.len() + 1);
        for i in 0..count {
            if i > 0 {
                file.write_all(b",").unwrap();
            }
            file.write_all(item.as_bytes()).unwrap();
        }
        let current = file.metadata().unwrap().len() as usize;
        file.write_all(&vec![b' '; 30 * 1024 * 1024 - current - 1])
            .unwrap();
        file.write_all(b"]").unwrap();
        drop(file);
        let c = Control::default();
        let start = std::time::Instant::now();
        let d = Document::open(&source, &c).unwrap();
        eprintln!(
            "open: {:?}, bytes: {}, nodes: {}, index: {} MiB",
            start.elapsed(),
            d.size(),
            d.node_count(),
            d.nodes.len() * std::mem::size_of::<Node>() / 1024 / 1024
        );
        assert_eq!(d.size(), 30 * 1024 * 1024);
        assert_eq!(d.children(0, 1000, 100).unwrap().len(), 100);
        for kind in ["format", "minify", "sort"] {
            let t = std::time::Instant::now();
            let out = dir.path().join(format!("{kind}.json"));
            d.export(&out, &op(kind), &c).unwrap();
            let parsed = Document::open(&out, &c).unwrap();
            assert_eq!(parsed.node_count(), d.node_count());
            assert!(parsed.source.contains("9007199254740993123456789"));
            eprintln!("{kind} export + reparse: {:?}", t.elapsed());
        }
        let cancelled = Control::default();
        cancelled.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(
            d.export(&dir.path().join("cancel.json"), &op("format"), &cancelled)
                .unwrap_err()
                .code,
            "CANCELLED"
        );
        assert!(!dir.path().join("cancel.json").exists());
        let huge =
            Document::parse(format!("\"{}\"", "a".repeat(30 * 1024 * 1024 - 2)), &c).unwrap();
        assert!(huge.node(0, None).unwrap().summary.len() < 200);
        huge.export(&dir.path().join("string.json"), &op("format"), &c)
            .unwrap();
    }
}
