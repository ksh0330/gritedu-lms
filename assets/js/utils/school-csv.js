const SCHOOL_CSV_BASE_URL = "/assets/school.csv";
let schoolCsvLoadPromise = null;

function getBuildVersion() {
  return document
    .querySelector('meta[name="grit-build-version"]')
    ?.getAttribute("content")
    ?.trim() || "";
}

export function getSchoolCsvUrl() {
  const version = getBuildVersion();
  if (!version) return SCHOOL_CSV_BASE_URL;
  return `${SCHOOL_CSV_BASE_URL}?v=${encodeURIComponent(version)}`;
}

export function loadSchoolCsvArrayBuffer() {
  if (!schoolCsvLoadPromise) {
    schoolCsvLoadPromise = fetch(getSchoolCsvUrl(), { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`school.csv load failed: ${response.status}`);
        }
        return response.arrayBuffer();
      });
  }
  return schoolCsvLoadPromise;
}

export async function loadSchoolCsvText() {
  const buffer = await loadSchoolCsvArrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}
