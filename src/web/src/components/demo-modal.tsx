"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Checkbox, Spinner } from "@/components/ui";
import { api, useAction, useApi } from "@/lib/api";

interface DemoModalProps {
  open: boolean;
  onClose: () => void;
}

export function DemoModal({ open, onClose }: DemoModalProps) {
  const router = useRouter();
  const status = useApi<any>("/hunter/status", { refetch: 4000 });
  const [activeApp, setActiveApp] = useState<string>("shop");
  const [defectState, setDefectState] = useState<Record<string, Record<string, boolean>>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [emuBusy, setEmuBusy] = useState<string | null>(null);

  const toggle = useAction(
    async ({ app, flags }: { app: string; flags: Record<string, boolean> }) => {
      const res = await api<any>(`/hunter/demo/defects?app=${app}`, { method: "PUT", json: flags });
      return res;
    },
    ["/hunter/status"]
  );

  const demos: any[] = (status.data?.demos ?? []).filter((d: any) => d.enabled);
  const device = status.data?.device ?? {
    device: "Pixel_8",
    platform: "Android 16 (API 36)",
    driver: "UiAutomator2",
    emulator: "stopped",
    appium: "stopped",
    apks: [
      { app: "shop", name: "DemoShopMobile.apk", package: "com.bughunter.mobile.shop", built: true, installed: false },
      { app: "hotel", name: "DemoHotelMobile.apk", package: "com.bughunter.mobile.hotel", built: true, installed: false },
      { app: "voice", name: "VoiceAppointmentMobile.apk", package: "com.bughunter.mobile.voice", built: true, installed: false },
    ],
  };

  useEffect(() => {
    if (status.data?.demos) {
      const state: Record<string, Record<string, boolean>> = {};
      for (const d of status.data.demos) {
        if (d.defects) {
          state[d.app] = {};
          for (const def of d.defects) {
            state[d.app][def.id] = def.enabled;
          }
        }
      }
      setDefectState(state);
    }
  }, [status.data?.demos]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const currentDemo = demos.find((d) => d.app === activeApp) || demos[0];
  const currentDefects = currentDemo?.defects ?? [];
  const currentFlags = defectState[activeApp] || {};

  const handleToggleDefect = (id: string, value: boolean) => {
    setDefectState((prev) => ({
      ...prev,
      [activeApp]: {
        ...(prev[activeApp] || {}),
        [id]: value,
      },
    }));
  };

  const handleSetAll = (value: boolean) => {
    const updated: Record<string, boolean> = {};
    for (const d of currentDefects) {
      updated[d.id] = value;
    }
    setDefectState((prev) => ({
      ...prev,
      [activeApp]: updated,
    }));
  };

  const handleSave = async () => {
    if (!currentDemo) return;
    try {
      await toggle.mutateAsync({ app: activeApp, flags: currentFlags });
      setSavedMsg(`Saved defect configuration for ${currentDemo.name}`);
      setTimeout(() => setSavedMsg(null), 3000);
    } catch {
      setSavedMsg("Failed to save defect configuration.");
      setTimeout(() => setSavedMsg(null), 3000);
    }
  };

  const handleEmulatorAction = async (action: "start" | "show" | "stop", app = "shop") => {
    setEmuBusy(action);
    try {
      const path =
        action === "start"
          ? "/hunter/device/emulator/start"
          : action === "show"
          ? "/hunter/device/emulator/show"
          : "/hunter/device/emulator/stop";
      await api(path, { method: "POST", json: action === "start" ? { app, showWindow: true } : {} });
      await status.refetch();
      setSavedMsg(
        action === "start"
          ? `Pixel_8 Emulator & Appium (UiAutomator2) ready (${app.toUpperCase()} APK launched)`
          : action === "show"
          ? "Android Emulator window brought to foreground"
          : "Android Emulator stopped"
      );
      setTimeout(() => setSavedMsg(null), 3500);
    } catch (e: any) {
      setSavedMsg(e?.message ?? "Emulator command failed.");
      setTimeout(() => setSavedMsg(null), 3500);
    } finally {
      setEmuBusy(null);
    }
  };

  const handleSelectPreset = (app: string) => {
    onClose();
    router.push(`/hunts/new?preset=${app}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900">Mobile Lab · Android APKs, Emulator &amp; Seeded Defects</span>
              <Badge tone="accent">Appium · UiAutomator2</Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Boot the Pixel_8 Android Emulator with real Kotlin/Compose APKs or configure ground-truth defect switches.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Android Emulator & Appium Status Bar */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                  Android Emulator ({device.device}) &amp; Appium Server
                </span>
                <Badge tone={device.emulator === "running" ? "success" : device.emulator === "booting" ? "warning" : "neutral"}>
                  Emulator: {device.emulator ?? "stopped"}
                </Badge>
                <Badge tone={device.appium === "running" ? "success" : "neutral"}>
                  Appium (4723): {device.appium ?? "stopped"}
                </Badge>
                <Badge tone="accent">{device.driver ?? "UiAutomator2"}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={emuBusy !== null}
                  onClick={() => handleEmulatorAction("start", activeApp)}
                >
                  {emuBusy === "start" ? "Booting Pixel_8 & Installing APKs…" : "Start Emulator & Appium"}
                </Button>
                {device.emulator === "running" && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={emuBusy !== null}
                      onClick={() => handleEmulatorAction("show")}
                    >
                      Show Window
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={emuBusy !== null}
                      onClick={() => handleEmulatorAction("stop")}
                    >
                      Stop
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Real Compiled APK Packages */}
            <div className="grid gap-2 sm:grid-cols-3 pt-1">
              {(device.apks ?? []).map((apk: any) => (
                <div key={apk.package} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{apk.name}</span>
                    <Badge tone={apk.installed ? "success" : apk.built ? "accent" : "neutral"}>
                      {apk.installed ? "Installed" : apk.built ? "Built APK" : "Source"}
                    </Badge>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5">{apk.package}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Demo Presets */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Target Mobile Applications (Kotlin + Jetpack Compose APKs)
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4 hover:border-blue-400 transition-colors bg-white">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Demo Shop Mobile</h4>
                    <p className="font-mono text-xs text-indigo-700 mt-0.5">com.bughunter.mobile.shop</p>
                    <p className="font-mono text-[11px] text-slate-400">android/apks/DemoShopMobile.apk · :5290</p>
                  </div>
                  <Badge tone="success">Native APK</Badge>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  Android e-commerce app with Catalog, Cart &amp; Checkout, Orders, Staff Order Desk, and Sign-In tabs.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">8 Backlog Stories · 10 Seeded Defects</span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSelectPreset("shop")}
                  >
                    Load into Hunt →
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 hover:border-blue-400 transition-colors bg-white">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Demo Hotel Mobile</h4>
                    <p className="font-mono text-xs text-indigo-700 mt-0.5">com.bughunter.mobile.hotel</p>
                    <p className="font-mono text-[11px] text-slate-400">android/apks/DemoHotelMobile.apk · :5291</p>
                  </div>
                  <Badge tone="accent">Native APK</Badge>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  Android hotel booking app with Rooms &amp; Book, My Stays, and Front Desk check-in/out workflows.
                </p>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">6 Backlog Stories · 8 Seeded Defects</span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSelectPreset("hotel")}
                  >
                    Load into Hunt →
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Configure Seeded Demo Defects */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Configure Seeded Mobile &amp; Backend Defects
              </h3>
              <div className="flex gap-1.5">
                {demos.map((d) => (
                  <button
                    key={d.app}
                    type="button"
                    onClick={() => setActiveApp(d.app)}
                    className={clsx(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                      activeApp === d.app
                        ? "bg-blue-600 text-white font-semibold"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            {status.isLoading ? (
              <Spinner />
            ) : currentDefects.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                No defect injection endpoints detected. Start the demo services to configure defects.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                  <span className="text-xs font-medium text-slate-700">
                    Defects for {currentDemo?.name} ({Object.values(currentFlags).filter(Boolean).length} of {currentDefects.length} enabled)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => handleSetAll(true)}>
                      All On
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleSetAll(false)}>
                      All Off (False-Positive Test)
                    </Button>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {currentDefects.map((def: any) => (
                    <div
                      key={def.id}
                      className="rounded-lg border border-slate-200 bg-white p-2.5 hover:border-slate-300 transition-colors"
                    >
                      <Checkbox
                        checked={currentFlags[def.id] ?? def.enabled}
                        onChange={(val) => handleToggleDefect(def.id, val)}
                        label={def.title}
                        hint={def.description}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3.5 bg-slate-50/70">
          <div>
            {savedMsg && (
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                ✓ {savedMsg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={toggle.isPending}
              onClick={handleSave}
            >
              {toggle.isPending ? "Saving…" : "Save Defect Configuration"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
