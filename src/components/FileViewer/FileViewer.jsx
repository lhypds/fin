import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isPdf } from "@utils/files";
import styles from "./viewer.module.css";

// A receipt's file as it is: a PDF in the browser's own viewer, an image that zooms to full size
// on a click, or a note when the file is no longer on disk. It fills the flex box it is put in,
// beside the details in the preview or under the row in the confirm dialog.
export default function FileViewer({ item }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  if (!item.url) {
    return (
      <div className={styles.viewer} data-empty="true">
        <p className="muted">{t("preview.noPreview")}</p>
      </div>
    );
  }
  if (isPdf(item.type)) {
    return <iframe className={styles.frame} src={item.url} title={item.name} />;
  }
  return (
    <div className={styles.viewer} data-zoom={zoom} onClick={() => setZoom((z) => !z)}>
      <img src={item.url} alt={item.name} draggable={false} />
    </div>
  );
}
