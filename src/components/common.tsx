import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { copy, errorMessage } from "../services/api";
export const NoticeContext = createContext<
  (message: string, error?: boolean) => void
>(() => {});
export function useNotice() {
  return useContext(NoticeContext);
}
export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function CopyButton({
  text,
  label = "复制",
  small = false,
}: {
  text: string;
  label?: string;
  small?: boolean;
}) {
  const notice = useNotice();
  return (
    <button
      className={small ? "icon-button" : ""}
      title={label}
      aria-label={label}
      disabled={!text}
      onClick={() =>
        void copy(text)
          .then(() => notice("已复制到剪贴板"))
          .catch((e) => notice(errorMessage(e), true))
      }
    >
      <Copy size={14} />
      {!small && label}
    </button>
  );
}
export function Result({
  children,
  empty = "转换结果将显示在这里",
}: {
  children?: string;
  empty?: string;
}) {
  return (
    <pre className={`result ${children ? "" : "placeholder"}`}>
      {children || empty}
    </pre>
  );
}
export function Spinner() {
  return <LoaderCircle size={14} className="spin" />;
}
