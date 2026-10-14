import { useEffect, useRef } from "react";
import { opened, closed } from "./modalApi";
import styles from "./modal.module.css";

// The dialogs open right now, oldest first. Escape closes only the newest, so a preview opened
// from an editor goes before the editor under it.
const openStack = [];

const Modal = ({ isOpen, onClose, title, children, closeOnOverlay = true, closeOnEscape = true, className }) => {
  // A click only counts as "outside" when it both starts and ends on the overlay. A drag that
  // begins inside the dialog (selecting text in a field) and is released over the backdrop
  // must not close it.
  const pressedOnOverlay = useRef(false);
  // The latest onClose, read at key time, so a new callback each render does not re-register the
  // dialog and move it to the top of the stack.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const token = {};
    openStack.push(token);
    const handleKeyDown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (openStack[openStack.length - 1] !== token || !onCloseRef.current) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      openStack.splice(openStack.indexOf(token), 1);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, closeOnEscape]);

  useEffect(() => {
    if (!isOpen) return;
    opened();
    return closed;
  }, [isOpen]);

  // Prevent touchmove on background
  // allow scroll on textarea/input/select but prevent on the rest of the background
  useEffect(() => {
    if (!isOpen) return;
    const isScrollable = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
    };
    const allowTags = ["TEXTAREA", "INPUT", "SELECT"];
    const handleTouchMove = (e) => {
      let el = e.target;
      while (el && el !== document.body) {
        if (allowTags.includes(el.tagName) || isScrollable(el)) {
          return; // allow scroll/touchmove on scrollable elements
        }
        el = el.parentElement;
      }
      e.preventDefault(); // prevent background scroll
    };
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayMouseDown = (e) => {
    pressedOnOverlay.current = e.target === e.currentTarget;
  };

  const handleOverlayClick = (e) => {
    const started = pressedOnOverlay.current;
    pressedOnOverlay.current = false;
    if (closeOnOverlay && onClose && started && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick}>
      <div className={[styles.modal, className].filter(Boolean).join(" ")}>
        <div className={styles.header}>
          {title && <span className={styles.title}>{title}</span>}
          <button className={styles.closeButton} onClick={onClose} disabled={!onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`${styles.content} scroll-y`}>{children}</div>
      </div>
    </div>
  );
};

export default Modal;
