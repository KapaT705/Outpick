"use client";

import { useEffect, useState } from "react";

export default function SettingsForm() {
  const [steamId, setSteamId] = useState("");
  const [token, setToken] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [gsi, setGsi] = useState<{ cfg: string; dotaDirs: string[]; fileName: string } | null>(null);
  const [gsiMsg, setGsiMsg] = useState<string | null>(null);
  const [dotaDir, setDotaDir] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [updMsg, setUpdMsg] = useState<string | null>(null);
  const [rawMsg, setRawMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<{ steamAccountId: number | null; hasToken: boolean; tokenTail: string; hasGithubToken?: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<{ running: boolean; message: string; error: string | null; updatedAt: number | null } | null>(null);

  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then(setInfo).catch(() => {}); fetch("/api/gsi/install").then((r) => r.json()).then(setGsi).catch(() => {}); }, []);
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
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stratzToken: token, steamAccountId: steamId, githubToken: ghToken }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setMsg("Сохранено"); setToken(""); setGhToken(""); setInfo({ steamAccountId: r.steamAccountId, hasToken: r.hasToken, tokenTail: "", hasGithubToken: r.hasGithubToken }); } else setMsg(r?.error ?? "Ошибка");
    setBusy(false);
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Настройки</h1>
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
        <label className="flex flex-col gap-1">
          <span>Токен GitHub для обновлений программы <span className="text-muted">({info?.hasGithubToken ? "сохранён" : "не задан"})</span></span>
          <input value={ghToken} onChange={(e) => setGhToken(e.target.value)} type="password" placeholder="github_pat_…"
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent" />
          <span className="text-xs text-muted">Репозиторий закрытый, поэтому без токена программа не сможет скачивать новые версии. GitHub → Settings → Developer settings → Fine-grained tokens: доступ к репозиторию dota-mid-helper, право Contents: Read. После сохранения перезапусти программу.</span>
        </label>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-md bg-accent/20 px-3 py-1.5 text-accent hover:bg-accent/30 disabled:opacity-50">{busy ? "проверяю…" : "Сохранить"}</button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-2 text-sm">
        <div className="font-semibold">Обновления программы</div>
        <div className="flex items-center gap-3">
          <button onClick={async () => { const d = (window as unknown as { desktop?: { checkForUpdates: () => Promise<{ ok: boolean; reason?: string }> } }).desktop; if (!d) { setUpdMsg("Проверка работает только в приложении"); return; } setUpdMsg("проверяю…"); const r = await d.checkForUpdates(); setUpdMsg(r.ok ? "запросил GitHub, результат появится полосой сверху" : r.reason === "no-token" ? "нужен токен GitHub (поле выше), затем перезапусти программу" : r.reason === "dev" ? "в режиме разработки не проверяется" : `ошибка: ${r.reason}`); }}
            className="rounded-md border border-border px-3 py-1.5 hover:border-accent">Проверить обновления</button>
          {updMsg && <span className="text-xs text-muted">{updMsg}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-2 text-sm">
        <div className="font-semibold">Автоподхват драфта из Доты (GSI)</div>
        <p className="text-xs text-muted">Дота умеет отправлять программе состояние матча: это официальная функция Valve, в игру она не вмешивается. Важно: обычному игроку Дота отдаёт только твоего выбранного героя и номер матча, состав драфта она показывает только зрителям. Поэтому врагов ты вводишь сам, а программа в режиме «Авто» дописывает твоего героя и сама сохраняет драфт в историю. Для этого в папку игры кладётся один файл конфига, после установки перезапусти Доту.</p>
        {gsi && gsi.dotaDirs.length > 0 && <div className="text-xs text-muted">Нашёл Доту: {gsi.dotaDirs[0]}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={async () => { setGsiMsg("ставлю…"); const r = await fetch("/api/gsi/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dotaDir: dotaDir || undefined }) }).then((x) => x.json()).catch(() => null); setGsiMsg(r?.ok ? `готово: ${r.file}` : r?.error ?? "ошибка"); }}
            className="rounded-md border border-border px-3 py-1.5 hover:border-accent">Установить конфиг в Доту</button>
          <input value={dotaDir} onChange={(e) => setDotaDir(e.target.value)} placeholder="если не нашёл: путь к …\dota 2 beta\game\dota" className="flex-1 min-w-60 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs outline-none focus:border-accent" />
        </div>
        {gsiMsg && <div className="text-xs text-muted">{gsiMsg}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={async () => { const r = await fetch("/api/gsi/raw").then((x) => x.json()).catch(() => null); const txt = r ? JSON.stringify(r, null, 1) : "нет данных"; setRaw(txt); setRawMsg(r?.receivedAt ? `последнее сообщение от Доты: ${new Date(r.receivedAt).toLocaleTimeString("ru-RU")}, сохранённых образцов драфта: ${r.samples?.length ?? 0}` : "Дота ещё ничего не присылала"); }}
            className="rounded-md border border-border px-3 py-1.5 hover:border-accent">Диагностика GSI</button>
          {raw && <button onClick={async () => { try { await navigator.clipboard.writeText(raw); setRawMsg("скопировано, можно вставить в чат"); } catch { setRawMsg("не удалось скопировать, выдели текст ниже вручную"); } }} className="rounded-md border border-border px-3 py-1.5 hover:border-accent">Скопировать</button>}
          {rawMsg && <span className="text-xs text-muted">{rawMsg}</span>}
        </div>
        {raw && <textarea readOnly value={raw} className="h-48 w-full rounded bg-panel-2 p-2 text-[11px] font-mono text-muted" />}
        {gsi && <details className="text-xs text-muted"><summary className="cursor-pointer">Или вручную: содержимое файла {gsi.fileName}</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-panel-2 p-2 text-[11px]">{gsi.cfg}</pre><div>Положи его в папку <code>dota 2 beta\game\dota\cfg\gamestate_integration\</code>.</div></details>}
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
