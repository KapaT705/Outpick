"use client";
// Экран первого запуска: три шага (токен Stratz, аккаунт, связь с Дотой) с объяснением, зачем каждый.
// Показывается, пока настройка не завершена и не пропущена (флаг onboardingDone в настройках этого компьютера).
import { useEffect, useState } from "react";
import { Button, Hint } from "@/components/ui";

type Settings = { hasToken: boolean; accounts?: { id: number; name?: string; known: boolean }[]; current?: { id: number | null; source: string; known: boolean; name: string | null }; onboardingDone?: boolean };
type Gsi = { installed?: boolean; dotaDirs?: string[] };

export default function Onboarding() {
  const [s, setS] = useState<Settings | null>(null);
  const [gsi, setGsi] = useState<Gsi | null>(null);
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");
  const [steamId, setSteamId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const reload = () => Promise.all([
    fetch("/api/settings").then((r) => r.json()).then(setS).catch(() => {}),
    fetch("/api/gsi/install").then((r) => r.json()).then(setGsi).catch(() => {}),
  ]);
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (!s) return;
    // открываемся на первом незавершённом шаге
    if (!s.hasToken) setStep(1); else if (!s.accounts?.length || !s.current?.known) setStep(2); else setStep(3);
  }, [s?.hasToken, s?.accounts?.length, s?.current?.known]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !gsi || hidden || s.onboardingDone) return null;
  const complete = s.hasToken && !!s.accounts?.length && !!gsi.installed;
  if (complete) return null;

  const finish = async () => { await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingDone: true }) }).catch(() => {}); setHidden(true); };
  const saveToken = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stratzToken: token }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) { setToken(""); await reload(); setStep(2); } else setMsg(r?.error ?? "не удалось сохранить");
  };
  const pollRefresh = async () => {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await fetch("/api/refresh").then((x) => x.json()).catch(() => null);
      if (!st?.running) { if (st?.error) setMsg(`ошибка: ${st.error}`); return; }
      setMsg(st.message);
    }
  };
  const loadAccount = async (id: number | string) => {
    setBusy(true); setMsg("загружаю историю…");
    const r = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", id }) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setMsg(r?.error ?? "ошибка"); setBusy(false); return; }
    await pollRefresh();
    setBusy(false); setMsg(null); await reload(); setStep(3);
  };
  const installGsi = async () => {
    setBusy(true); setMsg("ставлю…");
    const r = await fetch("/api/gsi/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    setMsg(r?.ok ? "Готово. Перезапусти Доту, если она открыта." : r?.error ?? "Дота на этом компьютере не найдена");
    await reload();
  };

  const Step = ({ n, label, done }: { n: number; label: string; done: boolean }) => (
    <button onClick={() => setStep(n)} className={`flex items-center gap-2 text-sm ${step === n ? "text-foreground" : "text-muted"}`}>
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-good/20 text-good" : step === n ? "bg-accent text-black" : "bg-panel-2 text-muted"}`}>{done ? "✓" : n}</span>{label}
    </button>
  );
  const detected = s.current?.id && (s.current.source === "steam" || s.current.source === "gsi") ? s.current : null;

  return (
    <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 pt-16">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-panel p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Добро пожаловать</h1>
          <p className="text-sm text-muted mt-1">Три шага, и пикер будет советовать героев под твой пул и твоих врагов. Это делается один раз.</p>
        </div>
        <div className="flex flex-wrap gap-5">
          <Step n={1} label="Токен Stratz" done={s.hasToken} />
          <Step n={2} label="Аккаунт" done={!!s.accounts?.length && !!s.current?.known} />
          <Step n={3} label="Связь с Дотой" done={!!gsi.installed} />
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Stratz — это сайт со статистикой Доты. По токену программа берёт контрпики, мету и твои матчи. <Hint text="Токен хранится только на этом компьютере и никуда больше не отправляется." /></p>
            <ol className="text-sm text-muted list-decimal pl-5 flex flex-col gap-1">
              <li>Открой <a href="https://stratz.com/api" target="_blank" rel="noreferrer" className="text-accent underline">stratz.com/api</a> и войди через Steam.</li>
              <li>Нажми «Create token» и скопируй длинную строку.</li>
              <li>Вставь её сюда.</li>
            </ol>
            <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="токен из stratz.com/api" className="rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent" />
            <div className="flex items-center gap-3"><Button variant="primary" onClick={saveToken} disabled={busy || !token.trim()}>{busy ? "проверяю…" : "Сохранить и дальше"}</Button>{msg && <span className="text-xs text-bad">{msg}</span>}</div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            {detected ? (
              <>
                <p className="text-sm">{detected.source === "gsi" ? "Дота сообщила" : "Steam запущен под"} аккаунт{detected.source === "gsi" ? "" : "ом"} <b>{detected.name ?? detected.id}</b>. Загрузим его историю: пул героев и личные винрейты появятся в пикере.</p>
                <div className="flex items-center gap-3"><Button variant="primary" onClick={() => loadAccount(detected.id!)} disabled={busy}>{busy ? "загружаю…" : "Загрузить историю"}</Button>{msg && <span className="text-xs text-muted">{msg}</span>}</div>
              </>
            ) : (
              <>
                <p className="text-sm">Нужен твой Steam ID: число из ссылки на профиль на Dotabuff или Stratz. <Hint text="Например, stratz.com/players/401776935 → 401776935. Можно и 64-битный id из Steam." /> Когда Дота на связи, аккаунт определяется сам, и этот шаг не нужен.</p>
                <input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="например 401776935" className="rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent" />
                <div className="flex items-center gap-3"><Button variant="primary" onClick={() => loadAccount(steamId.trim())} disabled={busy || !steamId.trim()}>{busy ? "загружаю…" : "Добавить и загрузить историю"}</Button>{msg && <span className="text-xs text-muted">{msg}</span>}</div>
              </>
            )}
            <button onClick={() => setStep(3)} className="self-start text-xs text-muted hover:text-foreground underline">Пока без аккаунта: советы по мете, без моего пула</button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Дота умеет сообщать программе, когда начинаются пики и какого героя ты взял. Это официальная функция игры, в игру она не вмешивается. <Hint text="В папку игры кладётся один файл конфига gamestate_integration. Программа при этом читает экран пиков только пока Дота запущена." /></p>
            {gsi.installed ? <p className="text-sm text-good">Конфиг уже стоит. Если Дота открыта, перезапусти её один раз.</p> : (
              <div className="flex items-center gap-3"><Button variant="primary" onClick={installGsi} disabled={busy}>{busy ? "ставлю…" : "Установить конфиг в Доту"}</Button>{msg && <span className="text-xs text-muted">{msg}</span>}</div>
            )}
            {!gsi.installed && !gsi.dotaDirs?.length && <p className="text-xs text-muted">На этом компьютере Дота не найдена: шаг можно пропустить и сделать его на игровом компьютере.</p>}
            <Button variant="primary" onClick={finish} className="self-start">Готово, открыть пикер</Button>
          </div>
        )}

        <button onClick={finish} className="self-end text-xs text-muted hover:text-foreground">Пропустить настройку</button>
      </div>
    </div>
  );
}
