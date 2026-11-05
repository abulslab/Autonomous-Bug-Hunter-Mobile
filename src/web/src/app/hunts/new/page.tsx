"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Notice, PageHeader, Panel, Select, Spinner, Textarea } from "@/components/ui";
import { api, useAction, useApi } from "@/lib/api";
import { loadUserSettings } from "@/lib/settings";

const STRATEGIES = [
  { id: "Hybrid", title: "Hybrid (Recommended)", text: "Fast deterministic mobile survey, then AI explores deeply." },
  { id: "Guided", title: "Guided", text: "Synthesizes intents from stories and tests each on the Android APK." },
  { id: "Heuristic", title: "Heuristic (No AI)", text: "Pure deterministic mobile exploration and API probes. $0 cost." },
  { id: "Model", title: "AI Driver Only", text: "Model selects every mobile tap, swipe, and input action." },
];

const PRESET_DATA: Record<
  string,
  {
    id: string;
    name: string;
    apk: string;
    pkg: string;
    activity: string;
    url: string;
    mission: string;
    stories: string;
    secrets: { name: string; value: string }[];
    resetUrl?: string;
    resetKey?: string;
  }
> = {
  shop: {
    id: "shop",
    name: "Demo Shop Android APK",
    apk: "android/apks/DemoShopMobile.apk",
    pkg: "com.bughunter.mobile.shop",
    activity: ".MainActivity",
    url: "http://localhost:5290/",
    mission: "Find functional bugs in browsing, search, cart, coupons and checkout.",
    stories: "DEMO-121, DEMO-122, DEMO-123, DEMO-124, DEMO-125, DEMO-126, DEMO-127, DEMO-128",
    secrets: [
      { name: "email", value: "shopper01@shop.demo" },
      { name: "password", value: "Shop123!" },
    ],
    resetUrl: "http://localhost:5290/api/test/reset",
    resetKey: "reset-key",
  },
  hotel: {
    id: "hotel",
    name: "Demo Hotel Android APK",
    apk: "android/apks/DemoHotelMobile.apk",
    pkg: "com.bughunter.mobile.hotel",
    activity: ".MainActivity",
    url: "http://localhost:5291/",
    mission: "Find functional bugs in searching rooms, booking a stay and cancelling bookings.",
    stories: "HOTEL-1, HOTEL-2, HOTEL-3, HOTEL-4, HOTEL-5, HOTEL-6",
    secrets: [],
    resetUrl: "http://localhost:5291/api/test/reset",
    resetKey: "reset-key",
  },
};

export default function NewHuntPage() {
  const router = useRouter();
  const status = useApi<any>("/hunter/status", { refetch: 5000 });
  // Auto-populate with the default Android APK (Demo Shop APK) immediately on page load!
  const [selectedPreset, setSelectedPreset] = useState<string>("shop");
  const [url, setUrl] = useState(PRESET_DATA.shop.url);
  const [mission, setMission] = useState(PRESET_DATA.shop.mission);
  const [strategy, setStrategy] = useState("Hybrid");
  const [budget, setBudget] = useState(1);
  const [maxSteps, setMaxSteps] = useState(60);
  const [driverModel, setDriverModel] = useState("");
  const [plannerModel, setPlannerModel] = useState("");
  const [requirements, setRequirements] = useState(PRESET_DATA.shop.stories);
  const [grounding, setGrounding] = useState("");
  const [rules, setRules] = useState("");
  const [secrets, setSecrets] = useState<{ name: string; value: string }[]>(PRESET_DATA.shop.secrets);
  const [irreversible, setIrreversible] = useState("auto");
  const [setupUrl, setSetupUrl] = useState(PRESET_DATA.shop.resetUrl ?? "");
  const [setupSecret, setSetupSecret] = useState(PRESET_DATA.shop.resetKey ?? "");
  const [probe, setProbe] = useState(true);
  const [confirm, setConfirm] = useState(true);
  const [shrink, setShrink] = useState(true);
  const [groundingProfiles, setGroundingProfiles] = useState<any[]>([]);

  const s = status.data;

  const applyPreset = useCallback(
    (presetKey: string, demosList?: any[]) => {
      const p = PRESET_DATA[presetKey];
      if (!p) return;
      setSelectedPreset(presetKey);
      const liveDemo = demosList?.find((d: any) => d.app === presetKey);
      setUrl(liveDemo?.url ?? p.url);
      setMission(p.mission);
      setRequirements(p.stories);
      setSecrets(p.secrets);
      setSetupUrl(liveDemo?.resetUrl ?? p.resetUrl ?? "");
      setSetupSecret(p.resetKey ?? "");
    },
    []
  );

  // Initialize from saved user settings or API defaults, and auto-populate the target Android app on load
  useEffect(() => {
    try {
      const rawProfiles = localStorage.getItem("bughunter_grounding_items");
      if (rawProfiles) setGroundingProfiles(JSON.parse(rawProfiles));
    } catch {
      // ignore
    }

    const saved = loadUserSettings();
    if (saved.driverModel) setDriverModel(saved.driverModel);
    else if (s?.defaults?.driver) setDriverModel(s.defaults.driver);

    if (saved.plannerModel) setPlannerModel(saved.plannerModel);
    else if (s?.defaults?.planner) setPlannerModel(s.defaults.planner);

    if (saved.maxCostUsd != null) setBudget(saved.maxCostUsd);
    else if (s?.defaults?.maxCostUsd != null) setBudget(s.defaults.maxCostUsd);

    if (saved.maxSteps != null) setMaxSteps(saved.maxSteps);

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const presetKey = params.get("preset") || "shop";
      if (PRESET_DATA[presetKey]) {
        applyPreset(presetKey, s?.demos);
      }
    }
  }, [s?.defaults, s?.demos, applyPreset]);

  const start = useAction(
    async () =>
      api<any>("/hunter/hunts", {
        method: "POST",
        json: {
          url,
          mission,
          strategy,
          maxSteps,
          connection: strategy === "Heuristic" ? null : driverModel || null,
          plannerConnection: strategy === "Heuristic" ? null : plannerModel || null,
          maxCostUsd: budget,
          requirements: requirements.split(/[\s,;]+/).filter(Boolean),
          grounding: grounding.trim() || null,
          rules: rules.trim() || null,
          secrets: Object.fromEntries(secrets.filter((x) => x.name.trim()).map((x) => [x.name.trim(), x.value])),
          allowIrreversible: irreversible === "auto" ? null : irreversible === "allow",
          setupUrl: setupUrl.trim() || null,
          setupSecret: setupUrl.trim() && setupSecret ? setupSecret : null,
          probe,
          confirm,
          shrink,
        },
      }),
    ["/hunter"]
  );

  if (status.error)
    return (
      <>
        <PageHeader title="New Hunt" />
        <ErrorBox error={new Error(`The Bug Hunter API is not reachable (${status.error.message}).`)} />
      </>
    );
  if (!s) return <Spinner />;

  const ai = strategy !== "Heuristic";
  const activeModelLabel =
    s.models?.find((m: any) => m.id === driverModel)?.label || driverModel || s.defaults?.driver || "Default Model";
  const activeApk = PRESET_DATA[selectedPreset] ?? PRESET_DATA.shop;

  return (
    <>
      <PageHeader
        title="Start a New Android Hunt"
        subtitle="Point Autonomous Bug Hunter at a native Android APK on the emulator (Appium · UiAutomator2). Dispatches model-guided exploration, deterministic oracles, and model-free confirmation replays."
      />

      {!s.worker.ok && (
        <div className="mb-5">
          <Notice tone={s.worker.autoStart ? "accent" : "warning"}>
            {s.worker.autoStart
              ? "Starting the mobile Appium worker. You can launch a hunt now; it will begin as soon as the worker connects."
              : `The mobile worker is offline: ${s.worker.error}`}
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        {/* Main Hunt Configuration Form */}
        <div className="space-y-6">
          {/* 1. Target Android Application */}
          <Panel
            title="1. Target Android Application"
            subtitle="Auto-populated with the pre-installed native Android APK on Pixel_8 (emulator-5554). Switch APKs in one click or customize below."
          >
            <div className="space-y-4">
              {/* 1-Click Native Android APK Selector */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Compiled Android APK Target
                </span>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.values(PRESET_DATA).map((p) => {
                    const isSelected = selectedPreset === p.id && url === p.url;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPreset(p.id, s?.demos)}
                        className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                          <Badge tone={isSelected ? "accent" : "neutral"}>APK</Badge>
                        </div>
                        <span className="mt-1 block font-mono text-[11px] text-slate-600">{p.pkg}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-slate-400">
                          {p.apk} · {p.url}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500">Active Android Package: </span>
                  <strong className="font-mono text-slate-900">{activeApk.pkg}</strong>
                  <span className="text-slate-400"> ({activeApk.apk})</span>
                </div>
                <Badge tone="success">Pixel_8 · UiAutomator2</Badge>
              </div>

              <Field
                label="Android App Backend / Bridge Endpoint"
                hint="Auto-populated for the selected Android APK (mapped into the emulator via adb reverse)."
              >
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:5290/ (com.bughunter.mobile.shop)"
                />
              </Field>

              <Field
                label="Mission / Focus Area"
                hint="What mobile screens, workflows, roles, or features the hunter should prioritize."
              >
                <Input
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  placeholder="e.g. Find functional bugs in browsing, shopping cart, promo codes, and checkout."
                />
              </Field>
            </div>
          </Panel>

          {/* 2. Exploration Strategy & Scope */}
          <Panel
            title="2. Exploration Strategy"
            subtitle="AI proposes candidate mobile actions and invariants; deterministic oracles verify."
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {STRATEGIES.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setStrategy(x.id)}
                  className={`rounded-xl border p-3.5 text-left transition-all ${
                    strategy === x.id
                      ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/20"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900">{x.title}</span>
                  <span className="mt-1 block text-xs text-slate-500 leading-snug">{x.text}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-3 border-t border-slate-100">
              <Field label="Step Budget" hint="Maximum mobile exploration actions">
                <Input
                  type="number"
                  min={5}
                  max={150}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value))}
                />
              </Field>

              {ai && (
                <Field label="AI Budget Limit ($ USD)" hint="Stops AI model calls once reached">
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    step={0.25}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  />
                </Field>
              )}
            </div>

            {ai && (
              <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
                <span className="text-slate-600">
                  Active Model: <strong className="text-slate-900">{activeModelLabel}</strong>
                </span>
                <Link href="/settings" className="text-blue-600 hover:underline font-medium">
                  Change Model in Settings →
                </Link>
              </div>
            )}
          </Panel>

          {/* 3. Advanced Configuration (Collapsible) */}
          <details className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <summary className="flex cursor-pointer items-center justify-between font-medium text-sm text-slate-800">
              <span className="flex items-center gap-2">
                <span>Advanced Configuration</span>
                <span className="text-xs text-slate-400 font-normal">
                  (Grounding, Invariant Rules, Secrets &amp; Reset Hook)
                </span>
              </span>
              <span className="text-xs text-blue-600 group-open:rotate-180 transition-transform">▼</span>
            </summary>

            <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
              {/* Grounding & Stories */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Grounding Knowledge
                  </span>
                  <div className="flex items-center gap-3">
                    {groundingProfiles.length > 0 && (
                      <select
                        aria-label="Apply saved grounding profile"
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                        defaultValue=""
                        onChange={(e) => {
                          const found = groundingProfiles.find((g) => g.id === e.target.value);
                          if (found) {
                            if (found.stories) setRequirements(found.stories);
                            if (found.notes) setGrounding(found.notes);
                            if (found.rules) setRules(found.rules);
                          }
                        }}
                      >
                        <option value="" disabled>
                          Apply Grounding Profile…
                        </option>
                        {groundingProfiles.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <Link href="/grounding" className="text-xs text-blue-600 hover:underline">
                      Manage Grounding Profiles →
                    </Link>
                  </div>
                </div>

                <Field label="User Stories / Acceptance Criteria" hint="Backlog keys or acceptance requirements">
                  <Input
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    placeholder="DEMO-121, DEMO-122 or Free shipping above $50"
                  />
                </Field>

                <Field label="Domain Grounding Notes" hint="Specific business rules the hunter must expect">
                  <Textarea
                    rows={2}
                    value={grounding}
                    onChange={(e) => setGrounding(e.target.value)}
                    placeholder="e.g. Orders above $50 ship free. A coupon applies only once per cart."
                  />
                </Field>

                <Field label="Custom Invariant Rules" hint="Custom METHOD /path: assertion expressions">
                  <Textarea
                    rows={2}
                    className="font-mono text-xs"
                    value={rules}
                    onChange={(e) => setRules(e.target.value)}
                    placeholder="GET /api/cart: total == subtotal - discount + shipping + tax"
                  />
                </Field>
              </div>

              {/* Secrets & Reset Hook */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Target Credentials &amp; Reset
                </span>

                <Field label="Target Secrets" hint="Substituted inside isolated mobile worker; never sent to LLMs">
                  <div className="space-y-2">
                    {secrets.map((x, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          className="max-w-40"
                          value={x.name}
                          placeholder="name"
                          onChange={(e) =>
                            setSecrets(secrets.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))
                          }
                        />
                        <Input
                          type="password"
                          value={x.value}
                          placeholder="value"
                          onChange={(e) =>
                            setSecrets(secrets.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSecrets(secrets.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSecrets([...secrets, { name: "", value: "" }])}
                    >
                      Add Secret
                    </Button>
                  </div>
                </Field>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Setup Reset Hook URL" hint="POSTed before hunt & each replay">
                    <Input
                      value={setupUrl}
                      onChange={(e) => setSetupUrl(e.target.value)}
                      placeholder="http://localhost:5290/api/test/reset"
                    />
                  </Field>
                  <Field label="Setup Bearer Secret" hint="Secret sent as Authorization Bearer">
                    <Select value={setupSecret} onChange={(e) => setSetupSecret(e.target.value)}>
                      <option value="">No bearer secret</option>
                      {secrets
                        .filter((x) => x.name.trim())
                        .map((x) => (
                          <option key={x.name} value={x.name.trim()}>
                            {x.name.trim()}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Irreversible Actions" hint="Pay, submit, checkout">
                    <Select value={irreversible} onChange={(e) => setIrreversible(e.target.value)}>
                      <option value="auto">Allow on local &amp; test hosts only</option>
                      <option value="allow">Allow (dedicated staging)</option>
                      <option value="block">Block strictly</option>
                    </Select>
                  </Field>
                </div>
              </div>

              {/* Verification Engine Toggles */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Verification Engine
                </span>
                <div className="flex flex-wrap gap-4 pt-1">
                  <Checkbox checked={probe} onChange={setProbe} label="API Probes" hint="Boundary values & repeat attacks" />
                  <Checkbox checked={confirm} onChange={setConfirm} label="2x Replays" hint="Model-free reproduction" />
                  <Checkbox
                    checked={shrink}
                    onChange={setShrink}
                    disabled={!confirm}
                    label="Delta Debugging"
                    hint="Shrink repro steps"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* Launch Button */}
          <div className="pt-2 flex items-center gap-3">
            <Button
              variant="primary"
              disabled={!url.trim() || start.isPending || !(s.worker.ok || s.worker.autoStart)}
              onClick={() => start.mutate(undefined as never, { onSuccess: (r: any) => router.push(`/hunts/${r.id}`) })}
            >
              {start.isPending ? "Starting Android Hunt…" : "Start Autonomous Android Hunt"}
            </Button>
            <ErrorBox error={start.error} />
          </div>
        </div>

        {/* Right sidebar: how a finding is verified, and safety */}
        <aside className="space-y-4">
          <Panel title="How a mobile finding is verified">
            <ol className="list-decimal space-y-2 pl-4 text-xs text-slate-600 leading-relaxed">
              <li>
                <strong className="text-slate-800">Deterministic Mobile Survey:</strong> Discovers screens, inputs, buttons, and API routes on the Android APK without AI spend.
              </li>
              <li>
                <strong className="text-slate-800">API Boundary Probes:</strong> Executes type-boundary and repeat-attack invariant checks.
              </li>
              <li>
                <strong className="text-slate-800">AI Intent Exploration:</strong> Explores mobile state transitions driven by backlog acceptance criteria.
              </li>
              <li>
                <strong className="text-slate-800">2x Fresh Replays:</strong> Replays every finding twice in fresh mobile sessions with no AI, harvesting <code>adb logcat</code> crashes &amp; ANRs.
              </li>
              <li>
                <strong className="text-slate-800">Delta-Debugging Shrinking:</strong> Eliminates non-essential steps to output minimal reproduction.
              </li>
              <li>
                <strong className="text-slate-800">Export:</strong> Produces SARIF, JUnit, and standalone Appium (UiAutomator2) test suites.
              </li>
            </ol>
            <div className="mt-4 pt-3 border-t border-slate-100">
              <Badge tone="accent">Strategy: {strategy}</Badge>
            </div>
          </Panel>

          <Panel title="Secrets and safety">
            <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <p>
                <strong className="text-slate-800">Secret Obfuscation:</strong> Passwords and API tokens are never sent to LLMs. They are injected as symbols and resolved in the isolated mobile worker.
              </p>
              <p>
                <strong className="text-slate-800">Dynamic User Isolation:</strong> RFC 5233 sub-addressing prevents collisions without requiring destructive database resets.
              </p>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
