import {
  collection, documentId, getDocs, limit, query, startAfter, where,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const CHUNK_SIZE = 10;
const PAGE_SIZE = 200;
const MAX_RELATION_ROWS = 5000;

export function uniqueExportIds(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export async function fetchScopedExportRows(db, collectionName, field, values) {
  const ids = uniqueExportIds(values);
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const group = ids.slice(offset, offset + CHUNK_SIZE);
    let cursor = null;
    do {
      const constraints = [where(field, "in", group), limit(PAGE_SIZE)];
      if (cursor) constraints.push(startAfter(cursor));
      const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
      rows.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      if (rows.length > MAX_RELATION_ROWS) {
        throw new Error(`관계 기록이 ${MAX_RELATION_ROWS}건을 초과했습니다. 검색 범위를 좁혀 다시 다운로드해 주세요.`);
      }
      cursor = snapshot.size === PAGE_SIZE ? snapshot.docs.at(-1) : null;
    } while (cursor);
  }
  return rows;
}

export async function fetchExportDocuments(db, collectionName, values) {
  const ids = uniqueExportIds(values);
  const rows = new Map();
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const snapshot = await getDocs(query(
      collection(db, collectionName),
      where(documentId(), "in", ids.slice(offset, offset + CHUNK_SIZE))
    ));
    snapshot.docs.forEach((item) => rows.set(item.id, { id: item.id, ...item.data() }));
  }
  return rows;
}
