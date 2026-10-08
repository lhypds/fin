import { useTranslation } from "react-i18next";
import { confidenceLevel } from "@utils/format";

const STATUS_CLASS = {
  pending: "plain",
  processing: "info",
  done: "ok",
  error: "err",
  matched: "ok",
  unmatched: "warn",
  missing: "err",
};

export default function StatusTag({ status }) {
  const { t } = useTranslation();
  return <span className={`tag ${STATUS_CLASS[status] || "plain"}`}>{t(`status.${status}`)}</span>;
}

const LEVEL_CLASS = { high: "ok", medium: "warn", low: "err", manual: "plain" };

export function ConfidenceTag({ confidence }) {
  const { t } = useTranslation();
  const level = confidenceLevel(confidence);
  return (
    <span className={`tag ${LEVEL_CLASS[level]}`}>
      {t(`confidence.${level}`)}
      {confidence != null && <span>{Math.round(confidence * 100)}%</span>}
    </span>
  );
}
