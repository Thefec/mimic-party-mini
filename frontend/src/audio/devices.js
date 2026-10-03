import { loadPref, PREF_MIC, savePref } from "../prefs.js";

/** Audio inputs. Labels are only filled in after mic permission was granted. */
export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId);
}

export const getSelectedMicId = () => loadPref(PREF_MIC, null);
export const setSelectedMicId = (id) => savePref(PREF_MIC, id);

export function onMicsChanged(fn) {
  const md = navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  md.addEventListener("devicechange", fn);
  return () => md.removeEventListener("devicechange", fn);
}
