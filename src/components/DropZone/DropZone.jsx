import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACCEPT_ATTR } from "@utils/files";
import { UploadIcon } from "../icons";
import styles from "./dropzone.module.css";

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

// A place to drop files or click for the picker. By default it takes receipts; `accept`, `hint`
// and `types` make it take something else. Disabled, it still swallows a drop so the browser does
// not open the file, but passes nothing on.
export default function DropZone({ onFiles, accept = ACCEPT_ATTR, hint, types, disabled = false }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  function handleFiles(files) {
    if (files?.length && !disabled) onFiles(files);
  }

  const typesText = types ?? t("dropzone.types");

  return (
    <div
      className={styles.zone}
      data-over={over}
      data-disabled={disabled}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? "none" : "copy";
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <UploadIcon className={styles.icon} />
      <div className={styles.text}>
        <span>{hint ?? t("dropzone.hint")}</span>
        {typesText && <span className={styles.types}>{typesText}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        hidden
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
