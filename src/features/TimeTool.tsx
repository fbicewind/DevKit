import { useEffect, useState } from "react";
import { Clock3, ArrowDownUp, CalendarClock } from "lucide-react";
import { call, copy, errorMessage } from "../services/api";
import { CopyButton, Field, Result, useNotice } from "../components/common";
interface TimeResult {
  seconds: number;
  milliseconds: number;
  standard: string;
  iso: string;
  timezone: string;
  resolvedUnit: string;
}
const output = (r?: TimeResult) =>
  r
    ? `标准时间  ${r.standard}\n时区      ${r.timezone}\nISO 8601  ${r.iso}\nUnix 秒   ${r.seconds}\nUnix 毫秒 ${r.milliseconds}`
    : "";
export function TimeTool({ active }: { active: boolean }) {
  const [timestamp, setTimestamp] = useState("1767225600000");
  const [unit, setUnit] = useState("auto");
  const [zone, setZone] = useState("Asia/Shanghai");
  const [date, setDate] = useState("2026-01-01 08:00:00");
  const [ambiguity, setAmbiguity] = useState("reject");
  const [forward, setForward] = useState<TimeResult>();
  const [reverse, setReverse] = useState<TimeResult>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const notice = useNotice();
  const convert = async (
    side: "forward" | "reverse",
    value = timestamp,
    quiet = false,
  ) => {
    if (!quiet) setBusy(true);
    try {
      const result = await call<TimeResult>(
        side === "forward" ? "unix_to_time" : "time_to_unix",
        side === "forward"
          ? { value, unit, zone }
          : { value: date, zone, ambiguity },
      );
      if (side === "forward") setForward(result);
      else setReverse(result);
      setErrors((e) => ({ ...e, [side]: "" }));
    } catch (e) {
      setErrors((p) => ({ ...p, [side]: errorMessage(e) }));
      if (side === "forward") setForward(undefined);
      else setReverse(undefined);
    } finally {
      if (!quiet) setBusy(false);
    }
  };
  useEffect(() => {
    if (!live || !active) return;
    const timer = setTimeout(
      () => void convert("forward", timestamp, true),
      350,
    );
    return () => clearTimeout(timer);
  }, [live, active, timestamp, unit, zone]);
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === "result.copy") {
        copy(output(forward) || output(reverse))
          .then(() => notice("已复制"))
          .catch((e) => notice(errorMessage(e), true));
      }
    };
    window.addEventListener("devkit:action", handler);
    return () => window.removeEventListener("devkit:action", handler);
  });
  return (
    <div className="tool">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVERY SECOND, IN CONTEXT</div>
          <h1>时间戳转换</h1>
          <p>跨越时区，准确找到每一个时刻。</p>
        </div>
        <Clock3 size={37} className="heading-symbol" />
      </div>
      <div className="shared-options">
        <Field label="转换时区">
          <select
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setForward(undefined);
              setReverse(undefined);
            }}
            aria-label="转换时区"
          >
            <option value="local">系统本地时区</option>
            {[
              "UTC",
              "Asia/Shanghai",
              "Asia/Tokyo",
              "America/New_York",
              "America/Los_Angeles",
              "Europe/London",
              "Europe/Berlin",
              "Australia/Sydney",
            ].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <span className="help">
          无偏移日期按此时区解释；ISO 中的显式偏移表示绝对时刻。
        </span>
      </div>
      <div className="two tool-cards">
        <section className="card">
          <div className="card-heading">
            <h2>
              <Clock3 size={16} />
              时间戳 → 标准时间
            </h2>
            <span className="tag">UNIX</span>
          </div>
          <Field label="Unix 时间戳">
            <input
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              placeholder="输入秒或毫秒时间戳"
            />
          </Field>
          <div className="segmented" aria-label="时间戳单位">
            {[
              ["auto", "自动识别"],
              ["seconds", "秒"],
              ["milliseconds", "毫秒"],
            ].map(([id, label]) => (
              <button
                className={unit === id ? "selected" : ""}
                key={id}
                onClick={() => setUnit(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="checkrow small">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            输入时自动预览
          </label>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void convert("forward")}
            >
              <ArrowDownUp size={14} />
              转换
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const now = String(Date.now());
                setTimestamp(now);
                setUnit("milliseconds");
                setBusy(true);
                void call<TimeResult>("unix_to_time", {
                  value: now,
                  unit: "milliseconds",
                  zone,
                })
                  .then((r) => {
                    setForward(r);
                    setErrors((p) => ({ ...p, forward: "" }));
                  })
                  .catch((e) =>
                    setErrors((p) => ({ ...p, forward: errorMessage(e) })),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              现在
            </button>
            <button
              onClick={() => {
                setTimestamp("");
                setForward(undefined);
                setErrors((p) => ({ ...p, forward: "" }));
              }}
            >
              清除
            </button>
          </div>
          {errors.forward && (
            <p className="error" role="alert">
              {errors.forward}
            </p>
          )}
          <Result>{output(forward)}</Result>
          <div className="row between">
            <small className="muted">
              {forward
                ? `已使用${forward.resolvedUnit === "seconds" ? "秒" : "毫秒"}单位`
                : "支持负值与小数秒"}
            </small>
            <CopyButton text={output(forward)} label="复制时间结果" />
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>
              <CalendarClock size={16} />
              标准时间 → 时间戳
            </h2>
            <span className="tag">DATE</span>
          </div>
          <Field
            label="日期与时间"
            help="YYYY-MM-DD HH:mm:ss，或带偏移的 ISO 8601"
          >
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-01-01 08:00:00"
            />
          </Field>
          <Field label="夏令时重复时间处理">
            <select
              value={ambiguity}
              onChange={(e) => setAmbiguity(e.target.value)}
            >
              <option value="reject">遇到歧义时提示</option>
              <option value="earlier">选择较早的时刻</option>
              <option value="later">选择较晚的时刻</option>
            </select>
          </Field>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void convert("reverse")}
            >
              <ArrowDownUp size={14} />
              转换为时间戳
            </button>
            <button
              onClick={() => {
                setDate("");
                setReverse(undefined);
                setErrors((p) => ({ ...p, reverse: "" }));
              }}
            >
              清除
            </button>
          </div>
          {errors.reverse && (
            <p className="error" role="alert">
              {errors.reverse}
            </p>
          )}
          <Result>{output(reverse)}</Result>
          <div className="row between">
            <small className="muted">跳变时不存在的本地时间会被拒绝</small>
            <CopyButton text={output(reverse)} label="复制时间戳结果" />
          </div>
        </section>
      </div>
    </div>
  );
}
