// The Apps Script Web App /exec URL is public configuration, never a secret.
// Leave empty until deployment; no runtime URL override is accepted.
export const CONFIG = Object.freeze({
  API_URL: '',
  APP_VERSION: '1.0.0-phase1',
  REQUEST_TIMEOUT_MS: 30000,
  MAX_READ_RETRIES: 2,
  DEFAULT_LANGUAGE: 'en',
  DEFAULT_THEME: 'light'
});

export function getApiUrl() {
  if (https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnTY87tDrrXl4BVxGEORjODOo8MyzkYQE-AfMjJb21PWopYFZEHdp4IpEOcc-rOrGowwvfQCSyTxtg097DTLG9NETvD3I3W56opAe0uT1cGtrHsETtKdZQSdw4UFRt2FT79wp4fTBjFIzdmJKhgyNhVIcb3tb8NBlMDdCqfNEPUv10GkjLjqh5WFNj74URGO0gRWM-wsOMT7MH1FVTcFtXOa4c0JQno0wU3HFPmfGSFdzqe_V6Cv2PCPHpdY5XHTtrSH1UGnn18UvJO79W_V6Zlakrm8Mg&lib=MMXYObIOyjoCeuPlJtZSklsIDDx8yuSIQ) return '';
  let url;
  try {
    url = new URL(https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnS9qxnauSA_YmBrNZZN69__iGM0DjAm9EXNFwdDCuFWb9UlUC6tFsA-GwTmhuQunePS2sT53CQP5sltqmAXo1gAIphyFPO6XLeXgl1R41kBiUFQoxqGJjPE4E--rF5ztnjwjraaOObJLYNGlKNKKGnaoxrFHkFV0hze2ZNj1HhyCNWDyK8G_b_49dgbEiGi4gVrG3-TSjE7zbCpBYnme6Cmxhq1v6HOINXgGaazFuovo_K9-yaj_I5s_V_jzKRMwNIv-X9ij5fRWfAQie0R5AXecCOV2g&lib=MMXYObIOyjoCeuPlJtZSklsIDDx8yuSIQ);
  } catch (error) {
    throw new Error('invalidApiUrl');
  }
  const validPath = /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !validPath || url.search || url.hash) {
    throw new Error('invalidApiUrl');
  }
  return url.toString();
}
