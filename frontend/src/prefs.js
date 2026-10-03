export const PREF_NAME = "mimic.name";
export const PREF_AVATAR = "mimic.avatar";
export const PREF_MIC = "mimic.micDeviceId";

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference is simply not remembered */
  }
}
