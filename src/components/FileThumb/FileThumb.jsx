import { isPdf } from "@utils/files";
import { FileIcon } from "../icons";
import styles from "./thumb.module.css";

export default function FileThumb({ item, size = 40 }) {
  const pdf = isPdf(item.type);
  // Server-made webp thumbnail when there is one; the original only as a fallback for images.
  const src = item.thumbUrl || (!pdf ? item.url : null);
  return (
    <div className={styles.thumb} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable={false} /> : <FileIcon className={styles.icon} />}
      {pdf && <span className={styles.badge}>PDF</span>}
    </div>
  );
}
