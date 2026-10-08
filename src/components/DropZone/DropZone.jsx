import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACCEPT_ATTR } from "@utils/files";
import { UploadIcon } from "../icons";
import styles from "./dropzone.module.css";

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

export default function DropZone({ onFiles }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  function handleFiles(files) {
    if (files?.length) onFiles(files);
  }

  return (
    <div
      className={styles.zone}
      data-over={over}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
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
        <span>{t("dropzone.hint")}</span>
        <span className={styles.types}>{t("dropzone.types")}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
