let _ask = null;

// Asks in the app's own dialog, in place of window.confirm, and resolves to whether it was
// confirmed. ConfirmModal, mounted once in App, does the asking.
export const confirm = (message, options = {}) => (_ask ? _ask({ message, ...options }) : Promise.resolve(false));

export function register(askFn) {
  _ask = askFn;
  return () => {
    _ask = null;
  };
}
