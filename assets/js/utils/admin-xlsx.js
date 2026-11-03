const FORMULA_PREFIX = /^[\s\uFEFF]*[=+\-@]/;

export function safeAdminXlsxValue(value) {
  if (typeof value !== "string") return value ?? "";
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function safeAdminXlsxRows(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, safeAdminXlsxValue(value)])
  ));
}

export function adminXlsxFilename(label, count, scope = "전체") {
  const safeScope = String(scope || "전체").replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 30);
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return `그릿에듀_${label}_${safeScope}_${count}건_${date}.xlsx`;
}

export async function writeAdminXlsx(XLSX, { rows, sheetName, sheets, filename, button }) {
  const workbookSheets = sheets || [{ name: sheetName, rows }];
  if (!Array.isArray(workbookSheets) || !workbookSheets.length ||
      !Array.isArray(workbookSheets[0].rows) || !workbookSheets[0].rows.length) return false;
  if (button?.disabled || button?.dataset.exportBusy === "true") return false;
  const originalLabel = button?.textContent || "엑셀";
  if (button) {
    button.dataset.exportBusy = "true";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "준비 중...";
  }
  try {
    const workbook = XLSX.utils.book_new();
    for (const entry of workbookSheets) {
      const sheet = XLSX.utils.json_to_sheet(safeAdminXlsxRows(entry.rows || []));
      XLSX.utils.book_append_sheet(workbook, sheet, entry.name);
    }
    await XLSX.writeFile(workbook, filename);
    return true;
  } finally {
    if (button) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      button.textContent = originalLabel;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      delete button.dataset.exportBusy;
    }
  }
}
