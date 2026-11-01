import fs from "node:fs";
import path from "node:path";

/** Атомарная запись JSON: сначала во временный файл рядом, потом переименование. Выход из программы на середине
 *  записи не портит старый файл: он либо прежний, либо уже новый целиком. */
export function writeJsonAtomic(file: string, value: unknown, pretty?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty));
  fs.renameSync(tmp, file);
}

/** Читает JSON. Нет файла: null. Битый файл: откладывается рядом как name.corrupt-<время> (данные не теряются,
 *  их можно вернуть руками) и тоже null, чтобы следующая запись не затёрла его молча. */
export function readJsonOrAside<T>(file: string): T | null {
  let txt: string;
  try { txt = fs.readFileSync(file, "utf8"); } catch { return null; }
  try { return JSON.parse(txt) as T; } catch {
    const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    try { fs.renameSync(file, aside); console.error(`[data] битый файл ${path.basename(file)} отложен: ${aside}`); } catch {}
    return null;
  }
}
