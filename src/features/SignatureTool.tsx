import { useEffect, useState } from "react";
import {
  Fingerprint,
  Save,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { call, copy, errorMessage } from "../services/api";
import type { Template } from "../services/api";
import { CopyButton, Field, Result, useNotice } from "../components/common";
export function SignatureTool({
  active,
  templates,
  setTemplates,
}: {
  active: boolean;
  templates: Template[];
  setTemplates: (t: Template[]) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("第三方系统 A");
  const [algorithm, setAlgorithm] = useState("MD5");
  const [formula, setFormula] = useState("{secret}{timestamp}{fixedStr}");
  const [unit, setUnit] = useState("milliseconds");
  const [stamp, setStamp] = useState("");
  const [variables, setVariables] = useState('{\n  "fixedStr": "api-v1"\n}');
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [saveSecret, setSaveSecret] = useState(false);
  const [removeSecret, setRemoveSecret] = useState(false);
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [encoding, setEncoding] = useState("hex");
  const [uppercase, setUppercase] = useState(false);
  const [result, setResult] = useState<{ timestamp: string; sign: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const notice = useNotice();
  const saved = templates.find((t) => t.id === id);
  const parseVariables = (): Record<string, string> => {
    let obj: unknown;
    try {
      obj = JSON.parse(variables);
    } catch {
      throw new Error("变量须为合法 JSON 对象");
    }
    if (
      !obj ||
      typeof obj !== "object" ||
      Array.isArray(obj) ||
      Object.entries(obj).some(
        ([k, v]) =>
          !/^[A-Za-z][A-Za-z0-9_]*$/.test(k) ||
          typeof v !== "string" ||
          ["secret", "timestamp"].includes(k),
      )
    )
      throw new Error("变量须为字符串键值对；不能覆盖 secret / timestamp");
    return obj as Record<string, string>;
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const compute = () =>
    run(async () => {
      setResult(undefined);
      const result = await call<{ timestamp: string; sign: string }>(
        "signature_compute",
        {
          request: {
            algorithm,
            template: formula,
            unit,
            variables: parseVariables(),
            timestampMode: stamp.trim() ? "fixed" : "current",
            timestamp: stamp.trim() || null,
            secret: secret || (saved?.secretRef && !removeSecret ? null : ""),
            templateId: id || null,
            encoding,
            uppercase,
            allowEmptySecret: allowEmpty,
          },
        },
      );
      setResult(result);
      notice("签名已计算");
    });
  const select = (value: string) => {
    setId(value);
    setSecret("");
    setVisible(false);
    setSaveSecret(false);
    setRemoveSecret(false);
    setResult(undefined);
    setError("");
    setDeleting(false);
    setAllowEmpty(false);
    setStamp("");
    const t = templates.find((t) => t.id === value);
    if (t) {
      setName(t.name);
      setAlgorithm(t.algorithm);
      setFormula(t.template);
      setUnit(t.unit);
      setVariables(JSON.stringify(t.variables, null, 2));
      setEncoding(t.encoding);
      setUppercase(t.uppercase);
    } else {
      setName("新模板");
      setAlgorithm("MD5");
      setFormula("{secret}{timestamp}{fixedStr}");
      setUnit("milliseconds");
      setVariables('{\n  "fixedStr": "api-v1"\n}');
      setEncoding("hex");
      setUppercase(false);
    }
  };
  const save = () =>
    run(async () => {
      if (!name.trim()) throw new Error("请输入模板名称");
      const template: Template = {
        id: id || crypto.randomUUID(),
        name: name.trim(),
        algorithm,
        template: formula,
        unit,
        variables: parseVariables(),
        encoding,
        uppercase,
      };
      const all = await call<Template[]>("templates_save", {
        template,
        secret: saveSecret ? secret : null,
        removeSecret,
      });
      setTemplates(all);
      setId(template.id);
      setSaveSecret(false);
      setRemoveSecret(false);
      if (saveSecret) setSecret("");
      notice("模板已保存" + (saveSecret ? "，Secret 已写入钥匙串" : ""));
    });
  const deleteTemplate = () =>
    run(async () => {
      const all = await call<Template[]>("templates_delete", { id });
      setTemplates(all);
      select("");
      notice("模板及关联 Secret 已删除");
    });
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "signature.compute") void compute();
      if (action === "result.copy")
        void copy(result?.sign || "")
          .then(() => notice("已复制"))
          .catch((e) => notice(errorMessage(e), true));
    };
    window.addEventListener("devkit:action", handler);
    return () => window.removeEventListener("devkit:action", handler);
  });
  return (
    <div className="tool">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR FORMULA. YOUR SIGNATURE.</div>
          <h1>签名计算</h1>
          <p>将重复的拼接步骤，变成可复用的本地模板。</p>
        </div>
        <Fingerprint size={37} className="heading-symbol" />
      </div>
      <div className="two tool-cards signature-grid">
        <section className="card">
          <div className="card-heading">
            <h2>签名模板</h2>
            <div className="row tight">
              <button title="新建模板" onClick={() => select("")}>
                <Plus size={14} />
              </button>
              <button disabled={busy} onClick={() => void save()}>
                <Save size={14} />
                保存
              </button>
            </div>
          </div>
          <Field label="本地模板">
            <select value={id} onChange={(e) => select(e.target.value)}>
              <option value="">新模板（未保存）</option>
              {templates.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模板名称">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="two">
            <Field label="算法">
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
              >
                {["MD5", "SHA1", "SHA256", "HMAC-SHA256"].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Field>
            <Field label="动态时间戳单位">
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="milliseconds">毫秒</option>
                <option value="seconds">秒</option>
              </select>
            </Field>
          </div>
          <Field
            label={
              algorithm === "HMAC-SHA256"
                ? "消息模板（Secret 单独作为 HMAC 密钥）"
                : "拼接公式"
            }
            help="可用 {secret}、{timestamp} 和下方定义的变量。"
          >
            <input
              className="mono"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
            />
          </Field>
          <Field
            label={`Secret${saved?.secretRef && !removeSecret ? " · 已存钥匙串，留空使用保存值" : " · 仅当前会话"}`}
          >
            <div className="input-action">
              <input
                autoComplete="off"
                type={visible ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="输入 Secret"
              />
              <button
                aria-label={visible ? "隐藏 Secret" : "显示 Secret"}
                title={visible ? "隐藏 Secret" : "显示 Secret"}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <label className="checkrow small">
            <input
              type="checkbox"
              checked={saveSecret}
              disabled={removeSecret}
              onChange={(e) => setSaveSecret(e.target.checked)}
            />
            <KeyRound size={13} />
            保存模板时，将当前 Secret 存入 macOS 钥匙串
          </label>
          {saved?.secretRef && (
            <label className="checkrow small">
              <input
                type="checkbox"
                checked={removeSecret}
                onChange={(e) => {
                  setRemoveSecret(e.target.checked);
                  if (e.target.checked) setSaveSecret(false);
                }}
              />
              保存时移除已存 Secret
            </label>
          )}
          <label className="checkrow small">
            <input
              type="checkbox"
              checked={allowEmpty}
              onChange={(e) => setAllowEmpty(e.target.checked)}
            />
            允许本次计算使用空 Secret
          </label>
          <Field label="模板变量（JSON 字符串键值对）">
            <textarea
              rows={3}
              className="mono variables"
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
            />
          </Field>
          <Field label="固定时间戳（留空使用当前时间）">
            <input
              value={stamp}
              onChange={(e) => setStamp(e.target.value)}
              placeholder="用于复现历史签名"
            />
          </Field>
          <div className="two">
            <Field label="输出编码">
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
              </select>
            </Field>
            <Field label="Hex 大小写">
              <select
                disabled={encoding !== "hex"}
                value={uppercase ? "upper" : "lower"}
                onChange={(e) => setUppercase(e.target.value === "upper")}
              >
                <option value="lower">小写</option>
                <option value="upper">大写</option>
              </select>
            </Field>
          </div>
          <button
            className="primary wide"
            disabled={busy}
            onClick={() => void compute()}
          >
            <Fingerprint size={15} />
            {busy ? "处理中…" : "计算签名"}
          </button>
          {id && (
            <div className="delete-area">
              {deleting ? (
                <>
                  <span>删除模板和关联 Secret？</span>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => void deleteTemplate()}
                  >
                    确认删除
                  </button>
                  <button onClick={() => setDeleting(false)}>取消</button>
                </>
              ) : (
                <button
                  className="text-button danger"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={12} />
                  删除当前模板
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
        <section className="card signature-result">
          <div className="card-heading">
            <h2>计算结果</h2>
            <span className="tag">UTF-8</span>
          </div>
          <div className="result-field">
            <div className="row between">
              <label>Timestamp</label>
              <CopyButton
                small
                text={result?.timestamp || ""}
                label="复制签名时间戳"
              />
            </div>
            <Result empty="—">{result?.timestamp}</Result>
          </div>
          <div className="result-field">
            <div className="row between">
              <label>签名</label>
              <CopyButton small text={result?.sign || ""} label="复制签名" />
            </div>
            <Result empty="等待计算">{result?.sign}</Result>
          </div>
          <div className="result-field">
            <div className="row between">
              <label>结果 JSON</label>
              <CopyButton
                small
                text={result ? JSON.stringify(result, null, 2) : ""}
                label="复制签名 JSON"
              />
            </div>
            <Result empty={'{\n  "timestamp": "…",\n  "sign": "…"\n}'}>
              {result ? JSON.stringify(result, null, 2) : ""}
            </Result>
          </div>
          <div className="info-box">
            <KeyRound size={16} />
            <div>
              每次计算只生成一个时间戳。
              <br />
              Secret 不进入普通配置、日志或结果。
            </div>
          </div>
          <p className="help">
            MD5 和 SHA-1 用于旧系统兼容。新接口优先使用
            HMAC-SHA256；其密钥与消息独立处理。
          </p>
        </section>
      </div>
    </div>
  );
}
