import path from "node:path";

/** Папка с данными Stratz (только чтение в приложении). В разработке это ../data, в приложении задаётся через DATA_DIR. */
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "..", "data");
/** Папка для записываемых файлов: журнал драфтов, настройки. В приложении это папка пользователя (USER_DIR). */
export const USER_DIR = process.env.USER_DIR ?? DATA_DIR;
