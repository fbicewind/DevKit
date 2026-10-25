import { useEffect, useState } from "react";
import { Shuffle, Download, Sparkles } from "lucide-react";
import { call, copy, errorMessage, exportText } from "../services/api";
import { CopyButton, Field, useNotice } from "../components/common";
export function RandomTool({ active }: { active: boolean }) {
  const [length, setLength] = useState("32");
  const [count, setCount] = useState("5");
  const [ranges, setRanges] = useState({
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: false,
  });
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notice = useNotice();
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const l = Number(length),
        c = Number(count);
      if (
        !Number.isInteger(l) ||
        !Number.isInteger(c) ||
        l < 1 ||
        l > 4096 ||
        c < 1 ||
        c > 200 ||
        l * c > 100000
      )
        throw new Error("长度须为 1–4096，数量须为 1–200，总字符数 ≤100,000");
      const output = await call<string[]>("random_generate", {
        request: { length: l, count: c, ...ranges, custom },
      });
      setResults(output);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === "result.copy")
        void copy(results.join("\n"))
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
          <div className="eyebrow">A LITTLE RANDOM, BY DESIGN</div>
          <h1>随机字符串</h1>
          <p>为测试数据、临时口令和灵感，留一点随机。</p>
        </div>
        <Shuffle size={37} className="heading-symbol" />
      </div>
      <div className="two tool-cards random-grid">
        <section className="card">
          <div className="card-heading">
            <h2>
              <Shuffle size={16} />
              生成设置
            </h2>
            <span className="tag">CSPRNG</span>
          </div>
          <div className="two">
            <Field label="单条长度">
              <input
                type="number"
                min="1"
                max="4096"
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
            </Field>
            <Field label="生成数量">
              <input
                type="number"
                min="1"
                max="200"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
          </div>
          <div className="field">
            <span>字符范围</span>
            <div className="range-options">
              {(
                [
                  ["uppercase", "大写字母", "A – Z"],
                  ["lowercase", "小写字母", "a – z"],
                  ["digits", "数字", "0 – 9"],
                  ["symbols", "特殊符号", "!@#$%^&*_-+=?~"],
                ] as const
              ).map(([id, label, example]) => (
                <label
                  key={id}
                  className={`range-option ${ranges[id] ? "checked" : ""} ${custom ? "dimmed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={ranges[id]}
                    disabled={!!custom}
                    onChange={(e) =>
                      setRanges((r) => ({ ...r, [id]: e.target.checked }))
                    }
                  />
                  <span>{label}</span>
                  <code>{example}</code>
                </label>
              ))}
            </div>
          </div>
          <Field
            label="自定义字符集"
            help="非空时覆盖上方范围；自动去重，支持中文和 Emoji。"
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="例如 abcXYZ123_-"
            />
          </Field>
          <button
            className="primary wide"
            disabled={busy}
            onClick={() => void generate()}
          >
            <Sparkles size={15} />
            {busy ? "生成中…" : "生成随机字符串"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="help">
            使用操作系统安全随机源，按 Unicode 字符进行无偏采样。总输出不超过
            100,000 个字符。
          </p>
        </section>
        <section className="card random-result">
          <div className="card-heading">
            <h2>
              生成结果 <span className="count">{results.length}</span>
            </h2>
            <div className="row tight">
              <CopyButton text={results.join("\n")} label="全部复制" />
              <button
                disabled={!results.length}
                title="导出 TXT"
                onClick={() =>
                  void exportText(results.join("\n"), "devkit-random.txt")
                    .then((saved) => {
                      if (saved) notice("已导出 TXT");
                    })
                    .catch((e) => notice(errorMessage(e), true))
                }
              >
                <Download size={14} />
              </button>
            </div>
          </div>
          <div className="random-list">
            {results.length ? (
              results.map((value, i) => (
                <div className="random-item" key={i}>
                  <span className="random-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <code>{value}</code>
                  <CopyButton small text={value} label={`复制第 ${i + 1} 条`} />
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Shuffle size={30} />
                <strong>你的下一组随机数</strong>
                <span>选择字符范围，点击生成开始</span>
              </div>
            )}
          </div>
          <p className="help">
            {results.length
              ? `${results.length} 条 · 每条 ${[...results[0]].length} 字符 · 仅保留在当前会话`
              : "本地生成，无网络请求。"}
          </p>
        </section>
      </div>
    </div>
  );
}
