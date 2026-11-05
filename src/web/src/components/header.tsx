"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { DemoModal } from "./demo-modal";

export function Header() {
  const pathname = usePathname();
  const [demoOpen, setDemoOpen] = useState(false);
  const isSettings = pathname?.startsWith("/settings");

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Left: Project Branding & Core Thesis */}
          <Link href="/" className="group flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors">
                Autonomous Bug Hunter · Mobile
              </span>
              <span className="rounded-sm bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                Android · Appium
              </span>
              <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                v1.0
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500">
              AI proposes, the engine verifies · UiAutomator2 &amp; Real Android APKs
            </p>
          </Link>

          {/* Right: Demo / Emulator Lab & Settings */}
          <div className="flex items-center gap-2.5 text-xs">
            {/* Demo & Emulator Lab Button */}
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-2xs cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 2a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H7zm3 14a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>Mobile Lab &amp; APKs</span>
            </button>

            {/* Settings Link */}
            <Link
              href="/settings"
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors border shadow-2xs",
                isSettings
                  ? "bg-blue-50 border-blue-200 text-blue-700 font-semibold"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              <span>Settings</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Demo & Android Emulator Modal */}
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </>
  );
}
