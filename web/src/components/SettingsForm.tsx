"use client";

import { useEffect, useState } from "react";

export default function SettingsForm() {
  const [steamId, setSteamId] = useState("");
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<{ steamAccountId: number | null; hasToken: boolean; tokenTail: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<{ running: boolean; message: string; error: string | null; updatedAt: number | null } | null>(null);

  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then(setInfo).catch(() => {}); }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const r = await fetch("/api/refresh").then((x) => x.json()).catch(() => null);
      if (r) setRef(r);
      if (r?.running) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);
  const startRefresh = async () => {
    const r = await fetch("/api/refresh", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setRef({ running: true, message: "старт", error: null, updatedAt: ref?.updatedAt ?? null }); const tick = async () => { const s = await fetch("/api/refresh").then((x) => x.json()).catch(() => null); if (s) setRef(s); if (s?.running) setTimeout(tick, 1500); }; setTimeout(tick, 1500); }
    else setRef({ running: false, message: "", error: r?.error ?? "ошибка", updatedAt: ref?.updatedAt ?? null });
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stratzToken: token, steamAccountId: steamId }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setMsg("Сохранено"); setToken(""); setInfo({ steamAccountId: r.steamAccountId, hasToken: r.hasToken, tokenTail: "" }); } else setMsg(r?.error ?? "Ошибка");
    setBusy(false);
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <a href="/" className="text-sm text-muted underline hover:text-foreground">К пикеру</a>
      </header>
      <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>Steam ID <span className="text-muted">(число из ссылки Dotabuff или Stratz, можно и 64-битный)</span></span>
          <input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder={info?.steamAccountId ? String(info.steamAccountId) : "например 401776935"}
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Токен Stratz API <span className="text-muted">({info?.hasToken ? `сохранён${info.tokenTail ? `, заканчивается на …${info.tokenTail}` : ""}` : "не задан"})</span></span>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="вставь токен со страницы stratz.com/api"
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent" />
          <span className="text-xs text-muted">Токен нужен для подтягивания результатов матчей и обновления меты. Получить: stratz.com/api, вход через Steam. Хранится только на этом компьютере.</span>
        </label>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-md bg-accent/20 px-3 py-1.5 text-accent hover:bg-accent/30 disabled:opacity-50">{busy ? "проверяю…" : "Сохранить"}</button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-2 text-sm">
        <div className="font-semibold">Данные меты</div>
        <p className="text-xs text-muted">Матчапы, синергии, популярность героев на миде и роли за последние 4 недели на Divine/Immortal, плюс твой пул и личная история за год. Обновлять стоит раз в неделю и после патча. Занимает около минуты.</p>
        <div className="flex items-center gap-3">
          <button onClick={startRefresh} disabled={!!ref?.running} className="rounded-md border border-border px-3 py-1.5 hover:border-accent disabled:opacity-50">{ref?.running ? "обновляю…" : "Обновить мету"}</button>
          <span className="text-xs text-muted">
            {ref?.running ? ref.message : ref?.error ? `ошибка: ${ref.error}` : ref?.updatedAt ? `обновлено ${new Date(ref.updatedAt * 1000).toLocaleString("ru-RU")}` : "пока используются данные из сборки"}
          </span>
        </div>
      </div>
    </main>
  );
}
