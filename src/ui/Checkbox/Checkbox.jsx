import styles from "./checkbox.module.css";

export default function Checkbox({ checked, onChange, disabled = false, className, children }) {
  return (
    <label className={[styles.wrapper, className].filter(Boolean).join(" ")} data-disabled={disabled}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className={styles.box} aria-hidden="true" />
      {children != null && <span className={styles.label}>{children}</span>}
    </label>
  );
}
