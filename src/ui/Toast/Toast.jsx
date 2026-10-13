import { useEffect, useRef, useState } from "react";
import styles from "./toast.module.css";
import { register } from "./toastApi";

// At the bottom, the toast clears the 24px status bar (pages/Home/home.module.css) by 12px.
const POSITION_STYLES = {
  top: { top: 24, bottom: "auto" },
  center: { top: "50%", bottom: "auto", transform: "translate(-50%, -50%)" },
  bottom: { bottom: 36, top: "auto" },
};

const Toast = () => {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState("bottom");
  const timerRef = useRef(null);
  const deadlineRef = useRef(null); // when the running timer will hide the toast
  const remainingRef = useRef(null); // ms left while paused by hover; null = no pending timer
  const hoveringRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    deadlineRef.current = null;
  };

  const startTimer = (ms) => {
    clearTimer();
    deadlineRef.current = Date.now() + ms;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      deadlineRef.current = null;
      setVisible(false);
    }, ms);
  };

  useEffect(() => {
    return register(
      (content, duration, pos = "bottom") => {
        setMessage(content);
        setPosition(pos);
        setVisible(true);
        clearTimer();
        remainingRef.current = null;
        if (duration == null) return;
        // While the pointer is over the toast, hold the countdown until it leaves.
        if (hoveringRef.current) remainingRef.current = duration;
        else startTimer(duration);
      },
      () => {
        clearTimer();
        remainingRef.current = null;
        hoveringRef.current = false;
        setVisible(false);
      }
    );
  }, []);

  const handleMouseEnter = () => {
    hoveringRef.current = true;
    if (timerRef.current) {
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
      clearTimer();
    }
  };

  const handleMouseLeave = () => {
    hoveringRef.current = false;
    if (remainingRef.current != null) {
      startTimer(remainingRef.current);
      remainingRef.current = null;
    }
  };

  if (!visible) return null;
  return (
    <div
      className={styles.toast}
      style={POSITION_STYLES[position]}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {message}
    </div>
  );
};

export default Toast;
