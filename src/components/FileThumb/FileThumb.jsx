import { isPdf, isExcel, CSV_TYPE } from "@utils/files";
import { FileIcon } from "../icons";
import styles from "./thumb.module.css";

export default function FileThumb({ item, size = 40 }) {
  const badge = isPdf(item.type) ? "PDF" : item.type === CSV_TYPE ? "CSV" : isExcel(item.type) ? "XLS" : null;
  // Server-made webp thumbnail when there is one; the original only as a fallback for images.
  const src = item.thumbUrl || (!badge ? item.url : null);
  return (
    <div className={styles.thumb} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable={false} /> : <FileIcon className={styles.icon} />}
      {badge && <span className={styles.badge}>{badge}</span>}
    </div>
  );
}
